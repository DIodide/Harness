import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type AgentHarnessConfig,
	cancelAgentTurn,
	ensureAgentSession,
	forgetAgentSession,
	getCachedAgentSessionId,
} from "./agent-mode";

const HARNESS: AgentHarnessConfig = { harness_id: "h1", mcp_servers: [] };

type Reply = { status?: number; json?: unknown };
type Handler = (url: string, method: string, init?: RequestInit) => Reply;

function installFetch(handler: Handler): { calls: string[] } {
	const calls: string[] = [];
	const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
		const method = init?.method ?? "GET";
		calls.push(`${method} ${String(url)}`);
		const { status = 200, json } = handler(String(url), method, init) ?? {};
		return {
			ok: status >= 200 && status < 300,
			status,
			json: async () => json,
			text: async () => JSON.stringify(json ?? ""),
		} as unknown as Response;
	});
	vi.stubGlobal("fetch", fetchMock);
	return { calls };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("ensureAgentSession", () => {
	it("recreates a session whose runtime reported status 'error'", async () => {
		const convo = "c-error";
		forgetAgentSession(convo, "claude-code");
		let posts = 0;
		const { calls } = installFetch((url, method) => {
			if (url.endsWith("/sessions") && method === "POST") {
				posts += 1;
				return { json: { session_id: posts === 1 ? "s1" : "s2" } };
			}
			if (method === "GET" && url.includes("/sessions/s1")) {
				return { json: { session_id: "s1", status: "error" } };
			}
			return { json: {} };
		});

		const first = await ensureAgentSession(null, "claude-code", HARNESS, convo);
		expect(first).toBe("s1");

		const second = await ensureAgentSession(
			null,
			"claude-code",
			HARNESS,
			convo,
		);
		expect(second).toBe("s2");
		// The dead session was explicitly closed before recreating.
		expect(
			calls.some((c) => c.startsWith("DELETE") && c.includes("/sessions/s1")),
		).toBe(true);
		expect(posts).toBe(2);
	});

	it("recreates a session whose runtime was 'closed'", async () => {
		const convo = "c-closed";
		forgetAgentSession(convo, "claude-code");
		let posts = 0;
		installFetch((url, method) => {
			if (url.endsWith("/sessions") && method === "POST") {
				posts += 1;
				return { json: { session_id: posts === 1 ? "s1" : "s2" } };
			}
			if (method === "GET" && url.includes("/sessions/s1")) {
				return { json: { session_id: "s1", status: "closed" } };
			}
			return { json: {} };
		});

		await ensureAgentSession(null, "claude-code", HARNESS, convo);
		const second = await ensureAgentSession(
			null,
			"claude-code",
			HARNESS,
			convo,
		);
		expect(second).toBe("s2");
	});

	it("reuses a healthy session without recreating", async () => {
		const convo = "c-ok";
		forgetAgentSession(convo, "claude-code");
		let posts = 0;
		const { calls } = installFetch((url, method) => {
			if (url.endsWith("/sessions") && method === "POST") {
				posts += 1;
				return { json: { session_id: "s1" } };
			}
			if (method === "GET" && url.includes("/sessions/s1")) {
				return { json: { session_id: "s1", status: "ready" } };
			}
			return { json: {} };
		});

		await ensureAgentSession(null, "claude-code", HARNESS, convo);
		const second = await ensureAgentSession(
			null,
			"claude-code",
			HARNESS,
			convo,
		);
		expect(second).toBe("s1");
		expect(posts).toBe(1); // no second create
		expect(calls.some((c) => c.startsWith("DELETE"))).toBe(false);
	});

	it("forwards the abort signal to every session request on the recreate path", async () => {
		// Seed a cached session, then force a dead-status recreate so GET →
		// DELETE → POST all fire and each must carry the signal.
		const convo = "c-signal";
		forgetAgentSession(convo, "claude-code");
		const controller = new AbortController();
		const seen: Array<{ method: string; signal: AbortSignal | undefined }> = [];
		let posts = 0;
		const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
			const method = init?.method ?? "GET";
			seen.push({ method, signal: init?.signal ?? undefined });
			if (String(url).endsWith("/sessions") && method === "POST") {
				posts += 1;
				return {
					ok: true,
					status: 200,
					json: async () => ({ session_id: posts === 1 ? "s1" : "s2" }),
					text: async () => "",
				} as unknown as Response;
			}
			if (method === "GET") {
				return {
					ok: true,
					status: 200,
					json: async () => ({ session_id: "s1", status: "error" }),
					text: async () => "",
				} as unknown as Response;
			}
			return {
				ok: true,
				status: 200,
				json: async () => ({}),
				text: async () => "",
			} as unknown as Response;
		});
		vi.stubGlobal("fetch", fetchMock);

		// First call seeds the cache (create POST).
		await ensureAgentSession(null, "claude-code", HARNESS, convo);
		seen.length = 0;
		// Second call: dead session → GET, DELETE, POST — all with the signal.
		await ensureAgentSession(
			null,
			"claude-code",
			HARNESS,
			convo,
			controller.signal,
		);
		const methods = seen.map((s) => s.method);
		expect(methods).toEqual(["GET", "DELETE", "POST"]);
		expect(seen.every((s) => s.signal === controller.signal)).toBe(true);
	});

	it("fires onProvisioning only when a cold start is actually paid", async () => {
		const convo = "c-prov";
		forgetAgentSession(convo, "claude-code");
		let posts = 0;
		installFetch((url, method) => {
			if (url.endsWith("/sessions") && method === "POST") {
				posts += 1;
				return { json: { session_id: "s1" } };
			}
			if (method === "GET" && url.includes("/sessions/s1")) {
				return { json: { session_id: "s1", status: "ready" } };
			}
			return { json: {} };
		});

		let provisioningCalls = 0;
		const onProvisioning = () => {
			provisioningCalls += 1;
		};
		// Cold start (empty cache) → fires once.
		await ensureAgentSession(
			null,
			"claude-code",
			HARNESS,
			convo,
			undefined,
			onProvisioning,
		);
		expect(provisioningCalls).toBe(1);
		// Warm reuse → must NOT fire again.
		await ensureAgentSession(
			null,
			"claude-code",
			HARNESS,
			convo,
			undefined,
			onProvisioning,
		);
		expect(provisioningCalls).toBe(1);
		expect(posts).toBe(1);
	});
});

describe("cancelAgentTurn", () => {
	it("throws when the gateway can't stop the turn", async () => {
		installFetch(() => ({ status: 404 }));
		await expect(cancelAgentTurn(null, "s1")).rejects.toThrow(/Failed to stop/);
	});

	it("resolves when the cancel lands", async () => {
		installFetch(() => ({ status: 200, json: {} }));
		await expect(cancelAgentTurn(null, "s1")).resolves.toBeUndefined();
	});
});

describe("getCachedAgentSessionId", () => {
	it("returns null after the session is forgotten", () => {
		forgetAgentSession("nope", "claude-code");
		expect(getCachedAgentSessionId("nope", "claude-code")).toBeNull();
	});
});
