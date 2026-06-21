import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

function makeT() {
	const raw = convexTest(schema, modules);
	const asUser = (userId: string) =>
		raw.withIdentity({ subject: userId, issuer: "test" });
	return { raw, asUser };
}

type UserClient = ReturnType<ReturnType<typeof makeT>["asUser"]>;

async function createHarness(
	u: UserClient,
	skillPackIds?: Id<"skillPacks">[],
): Promise<Id<"harnesses">> {
	return await u.mutation(api.harnesses.create, {
		name: "H",
		model: "gpt-5.5",
		status: "started",
		mcpServers: [],
		skills: [],
		...(skillPackIds ? { skillPackIds } : {}),
	});
}

describe("skillPacks CRUD", () => {
	it("create + list returns only the caller's packs", async () => {
		const { asUser } = makeT();
		const a = asUser("user-a");
		const b = asUser("user-b");
		await a.mutation(api.skillPacks.create, { name: "Frontend" });
		await b.mutation(api.skillPacks.create, { name: "Other" });
		const rowsA = await a.query(api.skillPacks.list, {});
		expect(rowsA.map((r) => r.name)).toEqual(["Frontend"]);
	});

	it("requires authentication and a name", async () => {
		const { raw, asUser } = makeT();
		await expect(
			raw.mutation(api.skillPacks.create, { name: "x" }),
		).rejects.toThrow(/Unauthenticated/);
		await expect(
			asUser("user-a").mutation(api.skillPacks.create, { name: "   " }),
		).rejects.toThrow(/name is required/);
	});

	it("stores skills + markdown + import flag", async () => {
		const a = makeT().asUser("user-a");
		const id = await a.mutation(api.skillPacks.create, {
			name: "Pack",
			description: "desc",
			skills: [{ name: "owner/repo/skill-a", description: "A" }],
			agentsMd: "# Agents",
			claudeMd: "# Claude",
			claudeImportsAgents: true,
		});
		const pack = await a.query(api.skillPacks.get, { id });
		expect(pack?.skills).toEqual([{ name: "owner/repo/skill-a", description: "A" }]);
		expect(pack?.agentsMd).toBe("# Agents");
		expect(pack?.claudeMd).toBe("# Claude");
		expect(pack?.claudeImportsAgents).toBe(true);
	});

	it("update clears markdown when given an empty string", async () => {
		const a = makeT().asUser("user-a");
		const id = await a.mutation(api.skillPacks.create, {
			name: "Pack",
			agentsMd: "# Agents",
		});
		await a.mutation(api.skillPacks.update, { id, agentsMd: "" });
		expect((await a.query(api.skillPacks.get, { id }))?.agentsMd).toBeUndefined();
	});

	it("get returns null for another user's pack", async () => {
		const { asUser } = makeT();
		const id = await asUser("user-a").mutation(api.skillPacks.create, {
			name: "Pack",
		});
		expect(await asUser("user-b").query(api.skillPacks.get, { id })).toBeNull();
	});

	it("remove detaches the pack from harnesses that reference it", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("user-a");
		const packId = await a.mutation(api.skillPacks.create, { name: "Pack" });
		const otherPack = await a.mutation(api.skillPacks.create, { name: "Keep" });
		const harnessId = await createHarness(a, [packId, otherPack]);

		await a.mutation(api.skillPacks.remove, { id: packId });

		const harness = await raw.run(async (ctx) => ctx.db.get(harnessId));
		expect(harness?.skillPackIds).toEqual([otherPack]);
		expect(await a.query(api.skillPacks.get, { id: packId })).toBeNull();
	});
});

describe("skillPacks.resolveForGateway", () => {
	it("concatenates markdown, unions skills, and joins SKILL.md detail", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("user-a");
		// Cache one skill's SKILL.md so the join returns detail.
		await raw.run(async (ctx) => {
			await ctx.db.insert("skillDetails", {
				name: "owner/repo/skill-a",
				skillName: "skill-a",
				description: "A",
				detail: "# Skill A body",
				code: "install a",
			});
		});

		const p1 = await a.mutation(api.skillPacks.create, {
			name: "P1",
			skills: [{ name: "owner/repo/skill-a", description: "A" }],
			agentsMd: "A-agents",
			claudeMd: "A-claude",
			claudeImportsAgents: true,
		});
		const p2 = await a.mutation(api.skillPacks.create, {
			name: "P2",
			skills: [
				{ name: "owner/repo/skill-a", description: "dup" }, // de-duped
				{ name: "owner/repo/skill-b", description: "B" }, // no cached detail
			],
			agentsMd: "B-agents",
		});

		const ctx = await raw.query(internal.skillPacks.resolveForGateway, {
			userId: "user-a",
			skillPackIds: [p1, p2],
		});

		expect(ctx.agentsMd).toBe("<!-- P1 -->\nA-agents\n\n<!-- P2 -->\nB-agents");
		expect(ctx.claudeMd).toBe("<!-- P1 -->\nA-claude");
		expect(ctx.claudeImportsAgents).toBe(true);
		const byName = Object.fromEntries(ctx.skills.map((s) => [s.name, s]));
		expect(Object.keys(byName).sort()).toEqual([
			"owner/repo/skill-a",
			"owner/repo/skill-b",
		]);
		expect(byName["owner/repo/skill-a"].detail).toBe("# Skill A body");
		expect(byName["owner/repo/skill-b"].detail).toBe(""); // uncached → empty
	});

	it("ignores packs owned by another user", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("user-a");
		const foreign = await asUser("user-b").mutation(api.skillPacks.create, {
			name: "Foreign",
			agentsMd: "secret",
		});
		const ctx = await raw.query(internal.skillPacks.resolveForGateway, {
			userId: "user-a",
			skillPackIds: [foreign],
		});
		expect(ctx.agentsMd).toBe("");
		expect(ctx.skills).toEqual([]);
	});
});
