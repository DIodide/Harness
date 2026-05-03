/**
 * Server-side sandbox lifecycle operations.
 *
 * Architecture: Daytona is the source of truth for sandbox state. These
 * TanStack Start server functions are the *browser-initiated* client — they
 * run in the same Node/Workers process as the SSR'd web app. FastAPI is a
 * separate client of Daytona used only at inference time (agent tool calls).
 *
 * Whichever service mutated Daytona last is responsible for writing the
 * Convex cache so the UI subscription reflects truth.
 */

import { auth } from "@clerk/tanstack-react-start/server";
import { Daytona, DaytonaNotFoundError } from "@daytonaio/sdk";
import { createServerFn } from "@tanstack/react-start";
import { env } from "../env";

type ConvexStatus =
	| "creating"
	| "starting"
	| "running"
	| "stopping"
	| "stopped"
	| "archived"
	| "error";

let daytonaClient: Daytona | null = null;

function getDaytona(): Daytona {
	if (!daytonaClient) {
		if (!env.DAYTONA_API_KEY) {
			throw new Error(
				"DAYTONA_API_KEY is not configured. Set it in apps/web/.env.local " +
					"to enable browser-initiated sandbox lifecycle ops.",
			);
		}
		daytonaClient = new Daytona({
			apiKey: env.DAYTONA_API_KEY,
			apiUrl: env.DAYTONA_API_URL,
			target: env.DAYTONA_TARGET,
		});
	}
	return daytonaClient;
}

function getConvexDeployKey(): string {
	if (!env.CONVEX_DEPLOY_KEY) {
		throw new Error(
			"CONVEX_DEPLOY_KEY is not configured. Set it in apps/web/.env.local " +
				"to enable browser-initiated sandbox lifecycle ops.",
		);
	}
	return env.CONVEX_DEPLOY_KEY;
}

async function callConvex(
	kind: "query" | "mutation",
	path: string,
	args: Record<string, unknown>,
): Promise<unknown> {
	const url = env.VITE_CONVEX_URL.replace(/\/$/, "");
	const res = await fetch(`${url}/api/${kind}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Convex ${getConvexDeployKey()}`,
		},
		body: JSON.stringify({ path, args, format: "json" }),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`Convex ${kind} '${path}' failed: ${res.status} ${text}`);
	}
	const json = (await res.json()) as { value: unknown };
	return json.value;
}

async function assertOwner(daytonaSandboxId: string): Promise<string> {
	const { userId } = await auth();
	if (!userId) throw new Error("Unauthorized");
	const ownerId = await callConvex("query", "sandboxes:getOwnerByDaytonaId", {
		daytonaSandboxId,
	});
	if (ownerId !== userId) throw new Error("Forbidden");
	return userId;
}

async function setStatus(
	daytonaSandboxId: string,
	status: ConvexStatus,
	errorMessage?: string,
): Promise<void> {
	const args: Record<string, unknown> = {
		daytonaSandboxId,
		status,
	};
	if (errorMessage !== undefined) args.errorMessage = errorMessage;
	await callConvex("mutation", "sandboxes:updateStatus", args);
}

// Daytona statuses → our Convex enum
const DAYTONA_STATUS_MAP: Record<string, ConvexStatus> = {
	started: "running",
	running: "running",
	starting: "starting",
	stopping: "stopping",
	stopped: "stopped",
	archived: "archived",
	creating: "creating",
	destroyed: "archived",
	error: "error",
};

function normalizeDaytonaStatus(raw: unknown): ConvexStatus {
	if (raw == null) return "error";
	const value =
		typeof raw === "object" && raw !== null && "value" in raw
			? String((raw as { value: unknown }).value)
			: String(raw);
	return DAYTONA_STATUS_MAP[value.toLowerCase()] ?? "error";
}

/**
 * True if a Daytona SDK error indicates the sandbox doesn't exist on
 * Daytona's side. The SDK exposes a dedicated `DaytonaNotFoundError`
 * class for 404s — we use that as the sole signal so we don't false-
 * positive on transient errors whose messages happen to contain "not
 * found" / "does not exist" (e.g. an archive-restoration timeout).
 */
function isDaytonaNotFoundError(err: unknown): boolean {
	if (err instanceof DaytonaNotFoundError) return true;
	// Defensive fallback: some SDK code paths might not preserve the class
	// (e.g. errors crossing a worker boundary). Match a 404 status code on
	// the raw error object as a backup signal.
	const obj = err as { statusCode?: number; status_code?: number };
	return obj?.statusCode === 404 || obj?.status_code === 404;
}

const sandboxIdValidator = (data: { sandboxId: string }) => {
	if (!data?.sandboxId || typeof data.sandboxId !== "string") {
		throw new Error("sandboxId is required");
	}
	return data;
};

export interface LifecycleResponse {
	success: boolean;
	status: ConvexStatus;
}

export const startSandbox = createServerFn({ method: "POST" })
	.inputValidator(sandboxIdValidator)
	.handler(async ({ data }): Promise<LifecycleResponse> => {
		await assertOwner(data.sandboxId);
		await setStatus(data.sandboxId, "starting");
		try {
			const sandbox = await getDaytona().get(data.sandboxId);
			await sandbox.start();
		} catch (e) {
			console.error("[startSandbox] error from Daytona:", e);
			if (isDaytonaNotFoundError(e)) {
				// Stale Convex record — the user is trying to start a sandbox
				// that doesn't exist on Daytona anymore. Mark archived so they
				// can delete the row.
				await setStatus(data.sandboxId, "archived");
				throw new Error(
					"This sandbox no longer exists on Daytona. It may have been deleted; remove it from your list to clean up.",
				);
			}
			const msg = e instanceof Error ? e.message : String(e);
			await setStatus(data.sandboxId, "error", msg);
			throw new Error(`Failed to start sandbox: ${msg}`);
		}
		await setStatus(data.sandboxId, "running");
		return { success: true, status: "running" };
	});

export const stopSandbox = createServerFn({ method: "POST" })
	.inputValidator(sandboxIdValidator)
	.handler(async ({ data }): Promise<LifecycleResponse> => {
		await assertOwner(data.sandboxId);
		await setStatus(data.sandboxId, "stopping");
		try {
			const sandbox = await getDaytona().get(data.sandboxId);
			await sandbox.stop();
		} catch (e) {
			if (isDaytonaNotFoundError(e)) {
				// Already gone on Daytona's side — stopped is the desired state.
				await setStatus(data.sandboxId, "archived");
				return { success: true, status: "archived" };
			}
			const msg = e instanceof Error ? e.message : String(e);
			await setStatus(data.sandboxId, "error", msg);
			throw new Error(`Failed to stop sandbox: ${msg}`);
		}
		await setStatus(data.sandboxId, "stopped");
		return { success: true, status: "stopped" };
	});

export const archiveSandbox = createServerFn({ method: "POST" })
	.inputValidator(sandboxIdValidator)
	.handler(async ({ data }): Promise<LifecycleResponse> => {
		await assertOwner(data.sandboxId);
		await setStatus(data.sandboxId, "stopping");
		try {
			const daytona = getDaytona();
			const sandbox = await daytona.get(data.sandboxId);
			const status = normalizeDaytonaStatus(
				(sandbox as { state?: unknown; status?: unknown }).state ??
					(sandbox as { status?: unknown }).status,
			);
			if (status !== "stopped" && status !== "archived") {
				await sandbox.stop();
			}
			if (status !== "archived") {
				await sandbox.archive();
			}
		} catch (e) {
			if (isDaytonaNotFoundError(e)) {
				// Daytona-side sandbox is already gone; mark Convex archived
				// so the user's record reflects that and stop confusing them
				// with a "not found" error on a stale row.
				await setStatus(data.sandboxId, "archived");
				return { success: true, status: "archived" };
			}
			const msg = e instanceof Error ? e.message : String(e);
			await setStatus(data.sandboxId, "error", msg);
			throw new Error(`Failed to archive sandbox: ${msg}`);
		}
		await setStatus(data.sandboxId, "archived");
		return { success: true, status: "archived" };
	});

export const deleteSandbox = createServerFn({ method: "POST" })
	.inputValidator(sandboxIdValidator)
	.handler(async ({ data }) => {
		await assertOwner(data.sandboxId);
		try {
			const sandbox = await getDaytona().get(data.sandboxId);
			await sandbox.delete();
		} catch (e) {
			if (!isDaytonaNotFoundError(e)) {
				const msg = e instanceof Error ? e.message : String(e);
				await setStatus(data.sandboxId, "error", msg);
				throw new Error(`Failed to delete sandbox: ${msg}`);
			}
			// Daytona-side already gone — fall through to Convex cleanup,
			// since "deleted" is the desired end state regardless.
		}
		await callConvex("mutation", "sandboxes:removeByDaytonaIdInternal", {
			daytonaSandboxId: data.sandboxId,
		});
		return { success: true };
	});

export const updateSandboxMetadata = createServerFn({ method: "POST" })
	.inputValidator((data: { sandboxId: string; name?: string }) => {
		if (!data?.sandboxId) throw new Error("sandboxId is required");
		return data;
	})
	.handler(async ({ data }) => {
		await assertOwner(data.sandboxId);
		if (data.name !== undefined) {
			try {
				const sandbox = await getDaytona().get(data.sandboxId);
				await sandbox.setLabels({ harness_name: data.name });
			} catch (e) {
				// Mirroring the name into Daytona labels is best-effort.
				// Whether the sandbox is missing on Daytona or the label
				// update fails, the Convex rename below still lands.
				console.warn("Failed to mirror name to Daytona label:", e);
			}
			await callConvex("mutation", "sandboxes:updateMetadataInternal", {
				daytonaSandboxId: data.sandboxId,
				name: data.name,
			});
		}
		return { success: true, name: data.name };
	});

export const syncSandbox = createServerFn({ method: "POST" })
	.inputValidator(sandboxIdValidator)
	.handler(async ({ data }): Promise<LifecycleResponse> => {
		await assertOwner(data.sandboxId);
		try {
			const sandbox = await getDaytona().get(data.sandboxId);
			const status = normalizeDaytonaStatus(
				(sandbox as { state?: unknown; status?: unknown }).state ??
					(sandbox as { status?: unknown }).status,
			);
			await setStatus(data.sandboxId, status);
			return { success: true, status };
		} catch (e) {
			if (isDaytonaNotFoundError(e)) {
				// Sandbox is gone on Daytona's side. Mark Convex as archived
				// — a terminal state the user can act on (delete to fully
				// clean up, or ignore).
				await setStatus(data.sandboxId, "archived");
				return { success: true, status: "archived" };
			}
			throw e;
		}
	});
