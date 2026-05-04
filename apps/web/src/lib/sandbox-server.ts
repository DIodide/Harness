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
	// Read the admin credential directly from process.env rather than through
	// the shared `env` object. `env.ts` is imported by client code, and any
	// reference there to `process.env.CONVEX_DEPLOY_KEY` would be inlined by
	// Vite's `define` into the client bundle. This function is only ever
	// called from `.handler()` bodies, which TanStack Start strips from the
	// client build, so the key stays server-side.
	const key = process.env.CONVEX_DEPLOY_KEY;
	if (!key) {
		throw new Error(
			"CONVEX_DEPLOY_KEY is not configured. Set it in apps/web/.env.local " +
				"to enable browser-initiated sandbox lifecycle ops.",
		);
	}
	return key;
}

// Allowlist of Convex function paths used by this module. Centralizing them
// as string literals lets TypeScript catch typos (e.g. "updateStatu") at
// compile time — a free-form string would silently 404 at runtime and leave
// the cached status stale.
const ConvexFns = {
	getOwnerByDaytonaId: "sandboxes:getOwnerByDaytonaId",
	listForReconcile: "sandboxes:listForReconcile",
	updateStatus: "sandboxes:updateStatus",
	removeByDaytonaIdInternal: "sandboxes:removeByDaytonaIdInternal",
	updateMetadataInternal: "sandboxes:updateMetadataInternal",
} as const;

type ConvexFnPath = (typeof ConvexFns)[keyof typeof ConvexFns];

async function callConvex(
	kind: "query" | "mutation",
	path: ConvexFnPath,
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
	const ownerId = await callConvex("query", ConvexFns.getOwnerByDaytonaId, {
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
	await callConvex("mutation", ConvexFns.updateStatus, args);
}

// Daytona's full SandboxState enum (from `@daytona/api-client`) → our Convex
// enum. Every state Daytona's API can return is covered explicitly so a status
// the dashboard knows nothing about doesn't get classified as "error".
const DAYTONA_STATUS_MAP: Record<string, ConvexStatus> = {
	started: "running",
	running: "running",
	starting: "starting",
	stopping: "stopping",
	stopped: "stopped",
	archived: "archived",
	archiving: "stopping",
	creating: "creating",
	pending_build: "creating",
	building_snapshot: "creating",
	pulling_snapshot: "starting",
	restoring: "starting",
	resizing: "starting",
	snapshotting: "running",
	forking: "creating",
	destroying: "stopping",
	destroyed: "archived",
	error: "error",
	build_failed: "error",
};

/**
 * Normalize a raw Daytona state value (string or enum-like `{ value }` object)
 * into a Convex status. Returns `null` for genuinely unknown values — callers
 * should skip the write in that case, since defaulting to "error" would
 * mis-classify any new state Daytona adds in the future.
 */
function normalizeDaytonaStatus(raw: unknown): ConvexStatus | null {
	if (raw == null) return null;
	const value =
		typeof raw === "object" && raw !== null && "value" in raw
			? String((raw as { value: unknown }).value)
			: String(raw);
	return DAYTONA_STATUS_MAP[value.toLowerCase()] ?? null;
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
			// Inside the try so a Convex write blip on the success path doesn't
			// leave the row stuck on "starting" — the catch below will record
			// "error" and the user can retry or sync.
			await setStatus(data.sandboxId, "running");
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
			await setStatus(data.sandboxId, "stopped");
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
				(sandbox as { state?: unknown }).state,
			);
			// If status is null we can't tell what state Daytona is in — try
			// stop+archive defensively; Daytona's API will reject the call if
			// it's a no-op for the actual state.
			if (status !== "stopped" && status !== "archived") {
				await sandbox.stop();
			}
			if (status !== "archived") {
				await sandbox.archive();
			}
			await setStatus(data.sandboxId, "archived");
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
		await callConvex("mutation", ConvexFns.removeByDaytonaIdInternal, {
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
			await callConvex("mutation", ConvexFns.updateMetadataInternal, {
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
				(sandbox as { state?: unknown }).state,
			);
			if (status === null) {
				// Daytona returned a state the dashboard doesn't recognize.
				// Don't overwrite Convex with a guess — surface it.
				const raw = (sandbox as { state?: unknown }).state;
				throw new Error(
					`Daytona returned an unrecognized state for sync: ${String(raw)}`,
				);
			}
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

export interface ReconcileResult {
	checked: number;
	updated: number;
	errors: number;
}

/**
 * Reconcile every Convex sandbox status for the calling user against
 * Daytona's true state. Called from the `/sandboxes` route on mount so the
 * dashboard reflects out-of-band drift — Daytona's 15-minute idle auto-stop,
 * LRU evictions (which deliberately don't write Convex), and any Daytona
 * admin-side changes. Transient states (`creating`, `starting`, `stopping`)
 * are skipped to avoid racing in-flight ops.
 */
export const reconcileSandboxStatuses = createServerFn({ method: "POST" })
	.handler(async (): Promise<ReconcileResult> => {
		const { userId } = await auth();
		if (!userId) throw new Error("Unauthorized");

		const sandboxes = (await callConvex(
			"query",
			ConvexFns.listForReconcile,
			{ userId },
		)) as Array<{ daytonaSandboxId: string; status: ConvexStatus }>;

		let updated = 0;
		let errors = 0;
		const daytona = getDaytona();

		await Promise.all(
			sandboxes.map(async (s) => {
				if (
					s.status === "creating" ||
					s.status === "starting" ||
					s.status === "stopping"
				) {
					return;
				}
				try {
					const sandbox = await daytona.get(s.daytonaSandboxId);
					const trueStatus = normalizeDaytonaStatus(
						(sandbox as { state?: unknown }).state,
					);
					if (trueStatus === null) {
						// Daytona returned a state the dashboard doesn't recognize.
						// Skip the write — keeping the last-known Convex status is
						// safer than guessing "error".
						console.warn(
							`[reconcileSandboxStatuses] unmapped Daytona state for ${s.daytonaSandboxId}:`,
							(sandbox as { state?: unknown }).state,
						);
						return;
					}
					if (trueStatus !== s.status) {
						await setStatus(s.daytonaSandboxId, trueStatus);
						updated++;
					}
				} catch (e) {
					if (isDaytonaNotFoundError(e)) {
						if (s.status !== "archived") {
							await setStatus(s.daytonaSandboxId, "archived");
							updated++;
						}
						return;
					}
					errors++;
					console.error(
						`[reconcileSandboxStatuses] failed for ${s.daytonaSandboxId}:`,
						e,
					);
				}
			}),
		);

		return { checked: sandboxes.length, updated, errors };
	});
