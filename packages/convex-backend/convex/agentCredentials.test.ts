import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

function makeT() {
	const raw = convexTest(schema, modules);
	return {
		raw,
		asUser: (uid: string) => raw.withIdentity({ subject: uid, issuer: "test" }),
	};
}

const CRED = {
	userId: "u-a",
	agent: "codex",
	kind: "auth_json" as const,
	ciphertext: "base64-sealed-blob",
};

describe("agentCredentials.listStatuses", () => {
	it("returns [] when unauthenticated", async () => {
		const { raw } = makeT();
		expect(await raw.query(api.agentCredentials.listStatuses, {})).toEqual([]);
	});

	it("exposes metadata but never ciphertext", async () => {
		const { raw, asUser } = makeT();
		await raw.mutation(internal.agentCredentials.store, {
			...CRED,
			label: "work account",
		});
		const rows = await asUser("u-a").query(
			api.agentCredentials.listStatuses,
			{},
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].agent).toBe("codex");
		expect(rows[0].kind).toBe("auth_json");
		expect(rows[0].label).toBe("work account");
		expect(JSON.stringify(rows[0])).not.toContain("base64-sealed-blob");
	});

	it("only returns the calling user's rows", async () => {
		const { raw, asUser } = makeT();
		await raw.mutation(internal.agentCredentials.store, CRED);
		expect(
			await asUser("u-b").query(api.agentCredentials.listStatuses, {}),
		).toEqual([]);
	});
});

describe("agentCredentials.store", () => {
	it("upserts per (user, agent)", async () => {
		const { raw } = makeT();
		await raw.mutation(internal.agentCredentials.store, CRED);
		await raw.mutation(internal.agentCredentials.store, {
			...CRED,
			kind: "api_key" as const,
			ciphertext: "new-blob",
		});
		const row = await raw.query(internal.agentCredentials.getForAgent, {
			userId: "u-a",
			agent: "codex",
		});
		expect(row?.kind).toBe("api_key");
		expect(row?.ciphertext).toBe("new-blob");
	});

	it("keeps agents independent", async () => {
		const { raw } = makeT();
		await raw.mutation(internal.agentCredentials.store, CRED);
		await raw.mutation(internal.agentCredentials.store, {
			...CRED,
			agent: "claude-code",
			kind: "oauth_token" as const,
			ciphertext: "claude-blob",
		});
		const codex = await raw.query(internal.agentCredentials.getForAgent, {
			userId: "u-a",
			agent: "codex",
		});
		const claude = await raw.query(internal.agentCredentials.getForAgent, {
			userId: "u-a",
			agent: "claude-code",
		});
		expect(codex?.ciphertext).toBe("base64-sealed-blob");
		expect(claude?.ciphertext).toBe("claude-blob");
	});
});

describe("agentCredentials.remove", () => {
	it("removes the row and reports it", async () => {
		const { raw } = makeT();
		await raw.mutation(internal.agentCredentials.store, CRED);
		const result = await raw.mutation(internal.agentCredentials.remove, {
			userId: "u-a",
			agent: "codex",
		});
		expect(result).toEqual({ removed: true });
		expect(
			await raw.query(internal.agentCredentials.getForAgent, {
				userId: "u-a",
				agent: "codex",
			}),
		).toBeNull();
	});

	it("is a no-op when nothing stored", async () => {
		const { raw } = makeT();
		const result = await raw.mutation(internal.agentCredentials.remove, {
			userId: "u-a",
			agent: "codex",
		});
		expect(result).toEqual({ removed: false });
	});
});

describe("agentCredentials.touch", () => {
	it("sets lastUsedAt", async () => {
		const { raw, asUser } = makeT();
		await raw.mutation(internal.agentCredentials.store, CRED);
		await raw.mutation(internal.agentCredentials.touch, {
			userId: "u-a",
			agent: "codex",
		});
		const rows = await asUser("u-a").query(
			api.agentCredentials.listStatuses,
			{},
		);
		expect(rows[0].lastUsedAt).toBeGreaterThan(0);
	});
});
