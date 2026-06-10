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
	agent: "claude-code",
	kind: "oauth_token" as const,
	ciphertext: "sealed-blob-1",
};

describe("agentCredentials.listMine", () => {
	it("returns [] when unauthenticated", async () => {
		const { raw } = makeT();
		expect(await raw.query(api.agentCredentials.listMine, {})).toEqual([]);
	});

	it("exposes metadata but never ciphertext, newest first", async () => {
		const { raw, asUser } = makeT();
		await raw.mutation(internal.agentCredentials.create, {
			...CRED,
			label: "work",
		});
		await raw.mutation(internal.agentCredentials.create, {
			...CRED,
			ciphertext: "sealed-blob-2",
			label: "personal",
		});
		const rows = await asUser("u-a").query(api.agentCredentials.listMine, {});
		expect(rows).toHaveLength(2);
		expect(rows[0].agent).toBe("claude-code");
		expect(JSON.stringify(rows)).not.toContain("sealed-blob");
		expect(rows.map((r) => r.label).sort()).toEqual(["personal", "work"]);
	});

	it("only returns the calling user's rows", async () => {
		const { raw, asUser } = makeT();
		await raw.mutation(internal.agentCredentials.create, CRED);
		expect(
			await asUser("u-b").query(api.agentCredentials.listMine, {}),
		).toEqual([]);
	});
});

describe("agentCredentials.create + getById", () => {
	it("supports multiple credentials per (user, agent)", async () => {
		const { raw } = makeT();
		const id1 = await raw.mutation(internal.agentCredentials.create, CRED);
		const id2 = await raw.mutation(internal.agentCredentials.create, {
			...CRED,
			kind: "api_key" as const,
			ciphertext: "sealed-blob-2",
		});
		expect(id1).not.toBe(id2);
		const row1 = await raw.query(internal.agentCredentials.getById, {
			credentialId: id1,
			userId: "u-a",
		});
		const row2 = await raw.query(internal.agentCredentials.getById, {
			credentialId: id2,
			userId: "u-a",
		});
		expect(row1?.ciphertext).toBe("sealed-blob-1");
		expect(row2?.ciphertext).toBe("sealed-blob-2");
	});

	it("getById enforces ownership", async () => {
		const { raw } = makeT();
		const id = await raw.mutation(internal.agentCredentials.create, CRED);
		expect(
			await raw.query(internal.agentCredentials.getById, {
				credentialId: id,
				userId: "u-other",
			}),
		).toBeNull();
	});
});

describe("agentCredentials.updateSecret", () => {
	it("replaces the ciphertext in place", async () => {
		const { raw } = makeT();
		const id = await raw.mutation(internal.agentCredentials.create, CRED);
		await raw.mutation(internal.agentCredentials.updateSecret, {
			credentialId: id,
			userId: "u-a",
			kind: "oauth_token" as const,
			ciphertext: "sealed-blob-new",
		});
		const row = await raw.query(internal.agentCredentials.getById, {
			credentialId: id,
			userId: "u-a",
		});
		expect(row?.ciphertext).toBe("sealed-blob-new");
	});

	it("rejects other users' credentials", async () => {
		const { raw } = makeT();
		const id = await raw.mutation(internal.agentCredentials.create, CRED);
		await expect(
			raw.mutation(internal.agentCredentials.updateSecret, {
				credentialId: id,
				userId: "u-other",
				kind: "oauth_token" as const,
				ciphertext: "x",
			}),
		).rejects.toThrow();
	});
});

describe("agentCredentials.getForAgent", () => {
	it("returns the most recently created credential", async () => {
		const { raw } = makeT();
		await raw.mutation(internal.agentCredentials.create, CRED);
		const id2 = await raw.mutation(internal.agentCredentials.create, {
			...CRED,
			ciphertext: "sealed-blob-2",
		});
		const row = await raw.query(internal.agentCredentials.getForAgent, {
			userId: "u-a",
			agent: "claude-code",
		});
		expect(row?.credentialId).toBe(id2);
	});
});

describe("agentCredentials.remove", () => {
	it("deletes the row and unlinks harnesses that referenced it", async () => {
		const { raw, asUser } = makeT();
		const id = await raw.mutation(internal.agentCredentials.create, CRED);
		const a = asUser("u-a");
		const harnessId = await a.mutation(api.harnesses.create, {
			name: "H",
			model: "sonnet",
			status: "started",
			mcpServers: [],
			skills: [],
			agent: "claude-code",
			agentCredentialId: id,
		});
		await a.mutation(api.agentCredentials.remove, { credentialId: id });
		expect(await a.query(api.agentCredentials.listMine, {})).toEqual([]);
		const harness = (await a.query(api.harnesses.list, {})).find(
			(h) => h._id === harnessId,
		);
		expect(harness?.agentCredentialId).toBeUndefined();
		// the agent choice itself survives
		expect(harness?.agent).toBe("claude-code");
	});

	it("rejects other users' credentials", async () => {
		const { raw, asUser } = makeT();
		const id = await raw.mutation(internal.agentCredentials.create, CRED);
		await expect(
			asUser("u-b").mutation(api.agentCredentials.remove, {
				credentialId: id,
			}),
		).rejects.toThrow();
	});
});
