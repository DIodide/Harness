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

const today = new Date().toISOString().slice(0, 10);

async function seedCredential(raw: ReturnType<typeof makeT>["raw"], userId: string, label: string) {
	return await raw.mutation(internal.agentCredentials.create, {
		userId,
		agent: "claude-code",
		kind: "oauth_token" as const,
		ciphertext: "sealed",
		label,
	});
}

async function seedConversation(raw: ReturnType<typeof makeT>["raw"], userId: string) {
	return await raw.run(async (ctx) =>
		ctx.db.insert("conversations", {
			title: "t",
			userId,
			lastMessageAt: Date.now(),
		}),
	);
}

function turn(extra: Record<string, unknown>) {
	return {
		userId: "u-a",
		agent: "claude-code",
		usedTokens: 100,
		costUsd: 0.01,
		currency: "USD",
		day: today,
		week: "2026-W25",
		...extra,
	};
}

describe("agentUsage.getMyAgentUsage", () => {
	it("returns [] when unauthenticated", async () => {
		const { raw } = makeT();
		expect(await raw.query(api.agentUsage.getMyAgentUsage, {})).toEqual([]);
	});

	it("aggregates cost/tokens/turns per credential, joined with the label", async () => {
		const { raw, asUser } = makeT();
		const credId = await seedCredential(raw, "u-a", "work");
		const convoId = await seedConversation(raw, "u-a");

		await raw.mutation(
			internal.agentUsage.record,
			turn({ agentCredentialId: credId, conversationId: convoId, model: "sonnet", turnKey: "s1:1" }),
		);
		await raw.mutation(
			internal.agentUsage.record,
			turn({
				agentCredentialId: credId,
				conversationId: convoId,
				model: "opus",
				usedTokens: 200,
				costUsd: 0.05,
				turnKey: "s1:2",
			}),
		);

		const rows = await asUser("u-a").query(api.agentUsage.getMyAgentUsage, {});
		expect(rows).toHaveLength(1);
		const r = rows[0];
		expect(r.label).toBe("work");
		expect(r.agent).toBe("claude-code");
		expect(r.turns).toBe(2);
		expect(r.totalTokens).toBe(300);
		expect(r.totalCostUsd).toBeCloseTo(0.06);
		expect(r.todayTokens).toBe(300);
		// per-model breakdown sorted by cost desc
		expect(r.perModel.map((m) => m.model)).toEqual(["opus", "sonnet"]);
	});

	it("is idempotent on turnKey (no double-count)", async () => {
		const { raw, asUser } = makeT();
		const credId = await seedCredential(raw, "u-a", "work");
		const convoId = await seedConversation(raw, "u-a");
		const t = turn({ agentCredentialId: credId, conversationId: convoId, turnKey: "s1:1" });
		await raw.mutation(internal.agentUsage.record, t);
		await raw.mutation(internal.agentUsage.record, t); // duplicate fire
		const rows = await asUser("u-a").query(api.agentUsage.getMyAgentUsage, {});
		expect(rows[0].turns).toBe(1);
		expect(rows[0].totalCostUsd).toBeCloseTo(0.01);
	});

	it("separates usage per credential and excludes other users", async () => {
		const { raw, asUser } = makeT();
		const work = await seedCredential(raw, "u-a", "work");
		const personal = await seedCredential(raw, "u-a", "personal");
		const convoId = await seedConversation(raw, "u-a");
		await raw.mutation(
			internal.agentUsage.record,
			turn({ agentCredentialId: work, conversationId: convoId, costUsd: 0.1, turnKey: "s1:1" }),
		);
		await raw.mutation(
			internal.agentUsage.record,
			turn({ agentCredentialId: personal, conversationId: convoId, costUsd: 0.02, turnKey: "s2:1" }),
		);

		const rows = await asUser("u-a").query(api.agentUsage.getMyAgentUsage, {});
		expect(rows).toHaveLength(2);
		// sorted by cost desc → work first
		expect(rows[0].label).toBe("work");
		expect(rows[0].totalCostUsd).toBeCloseTo(0.1);
		expect(rows[1].label).toBe("personal");

		// a different user sees nothing
		expect(await asUser("u-b").query(api.agentUsage.getMyAgentUsage, {})).toEqual([]);
	});

	it("omits credentials with no recorded usage", async () => {
		const { raw, asUser } = makeT();
		await seedCredential(raw, "u-a", "unused");
		const rows = await asUser("u-a").query(api.agentUsage.getMyAgentUsage, {});
		expect(rows).toEqual([]);
	});

	it("excludes past-day rows from today* but counts them in totals", async () => {
		const { raw, asUser } = makeT();
		const credId = await seedCredential(raw, "u-a", "work");
		const convoId = await seedConversation(raw, "u-a");
		await raw.mutation(
			internal.agentUsage.record,
			turn({ agentCredentialId: credId, conversationId: convoId, day: "2026-06-18", turnKey: "old:1" }),
		);
		await raw.mutation(
			internal.agentUsage.record,
			turn({ agentCredentialId: credId, conversationId: convoId, turnKey: "new:1" }),
		);
		const rows = await asUser("u-a").query(api.agentUsage.getMyAgentUsage, {});
		expect(rows[0].turns).toBe(2);
		expect(rows[0].totalTokens).toBe(200);
		expect(rows[0].totalCostUsd).toBeCloseTo(0.02);
		expect(rows[0].todayTokens).toBe(100); // only the today row
		expect(rows[0].todayCostUsd).toBeCloseTo(0.01);
	});

	it("buckets turns with no model under 'unknown'", async () => {
		const { raw, asUser } = makeT();
		const credId = await seedCredential(raw, "u-a", "work");
		const convoId = await seedConversation(raw, "u-a");
		await raw.mutation(
			internal.agentUsage.record,
			turn({ agentCredentialId: credId, conversationId: convoId, turnKey: "s1:1" }),
		);
		const rows = await asUser("u-a").query(api.agentUsage.getMyAgentUsage, {});
		expect(rows[0].perModel.map((m) => m.model)).toEqual(["unknown"]);
		expect(rows[0].lastModel).toBeNull();
	});

	it("takes lastModel/rateLimit from the latest-recorded turn (null overwrites)", async () => {
		const { raw, asUser } = makeT();
		const credId = await seedCredential(raw, "u-a", "work");
		const convoId = await seedConversation(raw, "u-a");
		await raw.mutation(
			internal.agentUsage.record,
			turn({
				agentCredentialId: credId,
				conversationId: convoId,
				model: "opus",
				rateLimit: { remaining: 5 },
				turnKey: "s1:1",
			}),
		);
		await raw.mutation(
			internal.agentUsage.record,
			turn({ agentCredentialId: credId, conversationId: convoId, model: "sonnet", turnKey: "s1:2" }),
		);
		const rows = await asUser("u-a").query(api.agentUsage.getMyAgentUsage, {});
		expect(rows[0].lastModel).toBe("sonnet");
		// the newer turn has no rateLimit → it overwrites the older snapshot to null
		expect(rows[0].rateLimit).toBeNull();
	});

	it("cascade-deletes usage when the owning credential is removed", async () => {
		const { raw, asUser } = makeT();
		const credId = await seedCredential(raw, "u-a", "work");
		const convoId = await seedConversation(raw, "u-a");
		await raw.mutation(
			internal.agentUsage.record,
			turn({ agentCredentialId: credId, conversationId: convoId, turnKey: "s1:1" }),
		);
		expect(
			await asUser("u-a").query(api.agentUsage.getMyAgentUsage, {}),
		).toHaveLength(1);
		await asUser("u-a").mutation(api.agentCredentials.remove, {
			credentialId: credId,
		});
		// the ledger rows are gone, not just hidden
		expect(await asUser("u-a").query(api.agentUsage.getMyAgentUsage, {})).toEqual([]);
		const remaining = await raw.run(async (ctx) =>
			ctx.db.query("agentUsageLedger").collect(),
		);
		expect(remaining).toEqual([]);
	});
});
