import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

function makeT() {
	const raw = convexTest(schema, modules);
	return {
		raw,
		asUser: (uid: string) =>
			raw.withIdentity({ subject: uid, issuer: "test" }),
	};
}

const baseHarness = (o = {}) => ({
	name: "h",
	model: "m",
	status: "stopped" as const,
	mcpServers: [],
	skills: [],
	...o,
});

describe("usage.checkBudget", () => {
	it("returns allowed with defaults when no budget rows exist", async () => {
		const { raw } = makeT();
		const res = await raw.query(internal.usage.checkBudget, {
			userId: "u-a",
			day: "2026-04-21",
			week: "2026-W17",
		});
		expect(res.allowed).toBe(true);
		expect(res.daily.costLimit).toBe(2);
		expect(res.weekly.costLimit).toBe(10);
		expect(res.daily.pctUsed).toBe(0);
	});

	it("blocks when daily cost has hit the limit", async () => {
		const { raw } = makeT();
		await raw.run(async (ctx) => {
			await ctx.db.insert("usageBudgets", {
				userId: "u-a",
				periodType: "daily",
				period: "2026-04-21",
				totalCostUsed: 2,
				costLimit: 2,
				totalTokensUsed: 0,
				perModelUsage: [],
				perHarnessUsage: [],
				updatedAt: Date.now(),
			});
		});
		const res = await raw.query(internal.usage.checkBudget, {
			userId: "u-a",
			day: "2026-04-21",
			week: "2026-W17",
		});
		expect(res.allowed).toBe(false);
		expect(res.daily.pctUsed).toBe(100);
	});
});

describe("usage.recordUsage", () => {
	async function recordFrom(userId: string, conversationId: string, overrides: Partial<{
		cost: number;
		totalTokens: number;
		model: string;
		day: string;
		week: string;
		harnessId?: string;
		harnessName?: string;
	}> = {}) {
		return {
			userId,
			conversationId,
			model: overrides.model ?? "m",
			promptTokens: 10,
			completionTokens: 20,
			totalTokens: overrides.totalTokens ?? 30,
			cost: overrides.cost ?? 0.5,
			day: overrides.day ?? "2026-04-21",
			week: overrides.week ?? "2026-W17",
			...(overrides.harnessId ? { harnessId: overrides.harnessId } : {}),
			...(overrides.harnessName ? { harnessName: overrides.harnessName } : {}),
		};
	}

	it("creates a ledger row plus daily and weekly budget docs", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("u-a");
		const h = await a.mutation(api.harnesses.create, baseHarness());
		const convId = await a.mutation(api.conversations.create, {
			title: "c",
			harnessId: h,
		});
		await raw.mutation(
			internal.usage.recordUsage,
			// biome-ignore lint/suspicious/noExplicitAny: the recordUsage validator requires Id<"conversations">
			(await recordFrom("u-a", convId)) as any,
		);

		await raw.run(async (ctx) => {
			const ledger = await ctx.db.query("usageLedger").collect();
			expect(ledger).toHaveLength(1);
			const budgets = await ctx.db.query("usageBudgets").collect();
			expect(budgets.map((b) => b.periodType).sort()).toEqual([
				"daily",
				"weekly",
			]);
			const daily = budgets.find((b) => b.periodType === "daily")!;
			expect(daily.totalCostUsed).toBe(0.5);
			expect(daily.perModelUsage[0]).toMatchObject({ model: "m", tokensUsed: 30 });
		});
	});

	it("accumulates cost + tokens on the same day", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("u-a");
		const h = await a.mutation(api.harnesses.create, baseHarness());
		const convId = await a.mutation(api.conversations.create, {
			title: "c",
			harnessId: h,
		});
		// biome-ignore lint/suspicious/noExplicitAny: recordUsage validator requires the id type
		const payload = (await recordFrom("u-a", convId, { cost: 0.3 })) as any;
		await raw.mutation(internal.usage.recordUsage, payload);
		await raw.mutation(internal.usage.recordUsage, payload);

		await raw.run(async (ctx) => {
			const daily = await ctx.db
				.query("usageBudgets")
				.withIndex("by_user_period", (q) =>
					q
						.eq("userId", "u-a")
						.eq("periodType", "daily")
						.eq("period", "2026-04-21"),
				)
				.unique();
			expect(daily!.totalCostUsed).toBeCloseTo(0.6, 5);
			expect(daily!.totalTokensUsed).toBe(60);
			// Same model → single accumulated row, not duplicated
			expect(daily!.perModelUsage).toHaveLength(1);
			expect(daily!.perModelUsage[0].tokensUsed).toBe(60);
		});
	});
});

describe("usage.getUserUsage", () => {
	it("returns null when unauthenticated", async () => {
		const { raw } = makeT();
		expect(await raw.query(api.usage.getUserUsage, {})).toBeNull();
	});

	it("returns zero percentages when no budget rows exist", async () => {
		const a = makeT().asUser("u-a");
		const res = await a.query(api.usage.getUserUsage, {});
		expect(res!.dailyPctUsed).toBe(0);
		expect(res!.weeklyPctUsed).toBe(0);
		expect(res!.dailyLimitReached).toBe(false);
		expect(res!.perModelPct).toEqual([]);
	});
});

describe("usage.getConversationUsage", () => {
	it("returns null for a conversation owned by another user", async () => {
		const { asUser } = makeT();
		const a = asUser("u-a");
		const b = asUser("u-b");
		const h = await a.mutation(api.harnesses.create, baseHarness());
		const c = await a.mutation(api.conversations.create, {
			title: "c",
			harnessId: h,
		});
		expect(
			await b.query(api.usage.getConversationUsage, { conversationId: c }),
		).toBeNull();
	});

	it("aggregates totals across ledger rows", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("u-a");
		const h = await a.mutation(api.harnesses.create, baseHarness());
		const c = await a.mutation(api.conversations.create, {
			title: "c",
			harnessId: h,
		});
		await raw.run(async (ctx) => {
			await ctx.db.insert("usageLedger", {
				userId: "u-a",
				conversationId: c,
				model: "m",
				promptTokens: 10,
				completionTokens: 20,
				totalTokens: 30,
				cost: 0.1,
				day: "2026-04-21",
				week: "2026-W17",
				recordedAt: Date.now(),
			});
			await ctx.db.insert("usageLedger", {
				userId: "u-a",
				conversationId: c,
				model: "m",
				promptTokens: 5,
				completionTokens: 5,
				totalTokens: 10,
				cost: 0.05,
				day: "2026-04-21",
				week: "2026-W17",
				recordedAt: Date.now(),
			});
		});
		const res = await a.query(api.usage.getConversationUsage, {
			conversationId: c,
		});
		expect(res).toEqual({
			totalTokens: 40,
			totalCost: expect.closeTo(0.15, 5),
			messageCount: 2,
		});
	});
});

describe("usage.adminSetLimits (internal)", () => {
	it("creates budget rows with custom limits when none exist", async () => {
		const { raw } = makeT();
		await raw.mutation(internal.usage.adminSetLimits, {
			userId: "u-a",
			dailyCostLimit: 5,
			weeklyCostLimit: 25,
		});
		await raw.run(async (ctx) => {
			const rows = await ctx.db.query("usageBudgets").collect();
			const limits = rows.map((r) => r.costLimit).sort((x, y) => x - y);
			expect(limits).toEqual([5, 25]);
		});
	});

	it("patches existing budget rows without resetting usage", async () => {
		const { raw } = makeT();
		const today = new Date().toISOString().slice(0, 10);
		await raw.run(async (ctx) => {
			await ctx.db.insert("usageBudgets", {
				userId: "u-a",
				periodType: "daily",
				period: today,
				totalCostUsed: 1.5,
				costLimit: 2,
				totalTokensUsed: 100,
				perModelUsage: [],
				perHarnessUsage: [],
				updatedAt: Date.now(),
			});
		});
		await raw.mutation(internal.usage.adminSetLimits, {
			userId: "u-a",
			dailyCostLimit: 10,
		});
		await raw.run(async (ctx) => {
			const daily = await ctx.db
				.query("usageBudgets")
				.withIndex("by_user_period", (q) =>
					q
						.eq("userId", "u-a")
						.eq("periodType", "daily")
						.eq("period", today),
				)
				.unique();
			expect(daily!.costLimit).toBe(10);
			expect(daily!.totalCostUsed).toBe(1.5);
		});
	});
});
