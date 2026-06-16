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

	it("forwards the abort signal to session requests", async () => {
		const convo = "c-signal";
		forgetAgentSession(convo, "claude-code");
		const seen: Array<AbortSignal | undefined> = [];
		const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
			seen.push(init?.signal ?? undefined);
			return {
				ok: true,
				status: 200,
				json: async () => ({ session_id: "s1" }),
				text: async () => "",
			} as unknown as Response;
		});
		vi.stubGlobal("fetch", fetchMock);

		const controller = new AbortController();
		await ensureAgentSession(
			null,
			"claude-code",
			HARNESS,
			convo,
			controller.signal,
		);
		expect(seen[0]).toBe(controller.signal);
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
