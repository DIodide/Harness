import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";

// Single source of truth for default cost limits (USD).
// Per-user overrides are stored in usageBudgets.costLimit via adminSetLimits.
const DEFAULT_DAILY_COST_LIMIT = 20.0;
const DEFAULT_WEEKLY_COST_LIMIT = 100.0;

/**
 * Check whether a user is within their daily and weekly cost budgets.
 * Called by FastAPI via the HTTP API before starting a chat stream.
 */
export const checkBudget = internalQuery({
	args: {
		userId: v.string(),
		day: v.string(), // "2026-04-08"
		week: v.string(), // "2026-W15"
	},
	handler: async (ctx, args) => {
		const daily = await ctx.db
			.query("usageBudgets")
			.withIndex("by_user_period", (q) =>
				q
					.eq("userId", args.userId)
					.eq("periodType", "daily")
					.eq("period", args.day),
			)
			.unique();

		const weekly = await ctx.db
			.query("usageBudgets")
			.withIndex("by_user_period", (q) =>
				q
					.eq("userId", args.userId)
					.eq("periodType", "weekly")
					.eq("period", args.week),
			)
			.unique();

		const dailyCostUsed = daily?.totalCostUsed ?? 0;
		const dailyCostLimit = daily?.costLimit ?? DEFAULT_DAILY_COST_LIMIT;
		const weeklyCostUsed = weekly?.totalCostUsed ?? 0;
		const weeklyCostLimit = weekly?.costLimit ?? DEFAULT_WEEKLY_COST_LIMIT;

		const dailyPct = dailyCostLimit > 0 ? (dailyCostUsed / dailyCostLimit) * 100 : 0;
		const weeklyPct = weeklyCostLimit > 0 ? (weeklyCostUsed / weeklyCostLimit) * 100 : 0;

		const allowed = dailyCostUsed < dailyCostLimit && weeklyCostUsed < weeklyCostLimit;

		return {
			allowed,
			daily: {
				costUsed: dailyCostUsed,
				costLimit: dailyCostLimit,
				pctUsed: Math.min(dailyPct, 100),
			},
			weekly: {
				costUsed: weeklyCostUsed,
				costLimit: weeklyCostLimit,
				pctUsed: Math.min(weeklyPct, 100),
			},
		};
	},
});

/**
 * Record usage after a chat stream completes. Called by FastAPI via the HTTP API.
 * Inserts a ledger row and upserts both daily and weekly budget documents.
 *
 * Concurrency note: upsertBudget uses a read-then-patch pattern. Under concurrent
 * requests for the same user, Convex's OCC (optimistic concurrency control) will
 * detect the conflict and automatically retry the mutation, so increments are not lost.
 */
export const recordUsage = internalMutation({
	args: {
		userId: v.string(),
		conversationId: v.id("conversations"),
		harnessId: v.optional(v.string()),
		harnessName: v.optional(v.string()),
		model: v.string(),
		promptTokens: v.number(),
		completionTokens: v.number(),
		totalTokens: v.number(),
		cost: v.number(),
		day: v.string(),
		week: v.string(),
	},
	handler: async (ctx, args) => {
		// Insert ledger entry
		await ctx.db.insert("usageLedger", {
			userId: args.userId,
			conversationId: args.conversationId,
			harnessId: args.harnessId,
			harnessName: args.harnessName,
			model: args.model,
			promptTokens: args.promptTokens,
			completionTokens: args.completionTokens,
			totalTokens: args.totalTokens,
			cost: args.cost,
			day: args.day,
			week: args.week,
			recordedAt: Date.now(),
		});

		// Upsert daily budget
		await upsertBudget(ctx, {
			userId: args.userId,
			periodType: "daily" as const,
			period: args.day,
			defaultLimit: DEFAULT_DAILY_COST_LIMIT,
			cost: args.cost,
			totalTokens: args.totalTokens,
			model: args.model,
			harnessId: args.harnessId,
			harnessName: args.harnessName,
		});

		// Upsert weekly budget
		await upsertBudget(ctx, {
			userId: args.userId,
			periodType: "weekly" as const,
			period: args.week,
			defaultLimit: DEFAULT_WEEKLY_COST_LIMIT,
			cost: args.cost,
			totalTokens: args.totalTokens,
			model: args.model,
			harnessId: args.harnessId,
			harnessName: args.harnessName,
		});
	},
});

async function upsertBudget(
	ctx: Pick<MutationCtx, "db">,
	params: {
		userId: string;
		periodType: "daily" | "weekly";
		period: string;
		defaultLimit: number;
		cost: number;
		totalTokens: number;
		model: string;
		harnessId?: string;
		harnessName?: string;
	},
) {
	const existing = await ctx.db
		.query("usageBudgets")
		.withIndex("by_user_period", (q) =>
			q
				.eq("userId", params.userId)
				.eq("periodType", params.periodType)
				.eq("period", params.period),
		)
		.unique();

	if (existing) {
		// Update per-model usage
		const perModelUsage = [...existing.perModelUsage];
		const modelIdx = perModelUsage.findIndex((m) => m.model === params.model);
		if (modelIdx >= 0) {
			perModelUsage[modelIdx] = {
				...perModelUsage[modelIdx],
				tokensUsed: perModelUsage[modelIdx].tokensUsed + params.totalTokens,
				costUsed: perModelUsage[modelIdx].costUsed + params.cost,
			};
		} else {
			perModelUsage.push({
				model: params.model,
				tokensUsed: params.totalTokens,
				costUsed: params.cost,
			});
		}

		// Update per-harness usage
		const perHarnessUsage = [...existing.perHarnessUsage];
		if (params.harnessId) {
			const harnessIdx = perHarnessUsage.findIndex(
				(h) => h.harnessId === params.harnessId,
			);
			if (harnessIdx >= 0) {
				perHarnessUsage[harnessIdx] = {
					...perHarnessUsage[harnessIdx],
					tokensUsed: perHarnessUsage[harnessIdx].tokensUsed + params.totalTokens,
					costUsed: perHarnessUsage[harnessIdx].costUsed + params.cost,
				};
			} else {
				perHarnessUsage.push({
					harnessId: params.harnessId,
					harnessName: params.harnessName ?? "Unknown",
					tokensUsed: params.totalTokens,
					costUsed: params.cost,
				});
			}
		}

		await ctx.db.patch(existing._id, {
			totalCostUsed: existing.totalCostUsed + params.cost,
			totalTokensUsed: existing.totalTokensUsed + params.totalTokens,
			perModelUsage,
			perHarnessUsage,
			updatedAt: Date.now(),
		});
	} else {
		// Create new budget document
		const perModelUsage = [
			{ model: params.model, tokensUsed: params.totalTokens, costUsed: params.cost },
		];
		const perHarnessUsage = params.harnessId
			? [
					{
						harnessId: params.harnessId,
						harnessName: params.harnessName ?? "Unknown",
						tokensUsed: params.totalTokens,
						costUsed: params.cost,
					},
				]
			: [];

		await ctx.db.insert("usageBudgets", {
			userId: params.userId,
			periodType: params.periodType,
			period: params.period,
			totalCostUsed: params.cost,
			costLimit: params.defaultLimit,
			totalTokensUsed: params.totalTokens,
			perModelUsage,
			perHarnessUsage,
			updatedAt: Date.now(),
		});
	}
}

/**
 * Get the current user's usage as percentages. Never exposes raw costs.
 * Called by the frontend reactively.
 */
export const getUserUsage = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const userId = identity.subject;

		const now = new Date();
		const day = formatDay(now);
		const week = formatWeek(now);

		const daily = await ctx.db
			.query("usageBudgets")
			.withIndex("by_user_period", (q) =>
				q.eq("userId", userId).eq("periodType", "daily").eq("period", day),
			)
			.unique();

		const weekly = await ctx.db
			.query("usageBudgets")
			.withIndex("by_user_period", (q) =>
				q.eq("userId", userId).eq("periodType", "weekly").eq("period", week),
			)
			.unique();

		const dailyCostLimit = daily?.costLimit ?? DEFAULT_DAILY_COST_LIMIT;
		const weeklyCostLimit = weekly?.costLimit ?? DEFAULT_WEEKLY_COST_LIMIT;
		const dailyCostUsed = daily?.totalCostUsed ?? 0;
		const weeklyCostUsed = weekly?.totalCostUsed ?? 0;

		const dailyPct = dailyCostLimit > 0 ? Math.min((dailyCostUsed / dailyCostLimit) * 100, 100) : 0;
		const weeklyPct = weeklyCostLimit > 0 ? Math.min((weeklyCostUsed / weeklyCostLimit) * 100, 100) : 0;

		// Per-model percentages (relative to total usage, not limit)
		const totalCost = daily?.totalCostUsed ?? 0;
		const perModelPct = (daily?.perModelUsage ?? []).map((m) => ({
			model: m.model,
			pct: totalCost > 0 ? (m.costUsed / totalCost) * 100 : 0,
			tokensUsed: m.tokensUsed,
		}));

		// Per-harness percentages (relative to total usage)
		const perHarnessPct = (daily?.perHarnessUsage ?? []).map((h) => ({
			harnessId: h.harnessId,
			harnessName: h.harnessName,
			pct: totalCost > 0 ? (h.costUsed / totalCost) * 100 : 0,
			tokensUsed: h.tokensUsed,
		}));

		// Compute reset times
		const tomorrow = new Date(now);
		tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
		tomorrow.setUTCHours(0, 0, 0, 0);

		// Weekly reset: next Monday 00:00 UTC
		const dayOfWeek = now.getUTCDay(); // 0=Sun
		const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
		const nextMonday = new Date(now);
		nextMonday.setUTCDate(nextMonday.getUTCDate() + daysUntilMonday);
		nextMonday.setUTCHours(0, 0, 0, 0);

		return {
			dailyPctUsed: Math.round(dailyPct * 10) / 10,
			weeklyPctUsed: Math.round(weeklyPct * 10) / 10,
			dailyLimitReached: dailyCostUsed >= dailyCostLimit,
			weeklyLimitReached: weeklyCostUsed >= weeklyCostLimit,
			perModelPct,
			perHarnessPct,
			dailyResetAt: tomorrow.toISOString(),
			weeklyResetAt: nextMonday.toISOString(),
		};
	},
});

/**
 * Get usage aggregated for a specific conversation.
 */
export const getConversationUsage = query({
	args: { conversationId: v.id("conversations") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;

		const convo = await ctx.db.get(args.conversationId);
		if (!convo || convo.userId !== identity.subject) return null;

		const entries = await ctx.db
			.query("usageLedger")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", args.conversationId),
			)
			.collect();

		let totalTokens = 0;
		let totalCost = 0;
		for (const entry of entries) {
			totalTokens += entry.totalTokens;
			totalCost += entry.cost;
		}

		return { totalTokens, totalCost, messageCount: entries.length };
	},
});

/**
 * Admin/system mutation to override a user's cost limits.
 */
export const adminSetLimits = internalMutation({
	args: {
		userId: v.string(),
		dailyCostLimit: v.optional(v.number()),
		weeklyCostLimit: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const now = new Date();
		const day = formatDay(now);
		const week = formatWeek(now);

		if (args.dailyCostLimit !== undefined) {
			const daily = await ctx.db
				.query("usageBudgets")
				.withIndex("by_user_period", (q) =>
					q
						.eq("userId", args.userId)
						.eq("periodType", "daily")
						.eq("period", day),
				)
				.unique();

			if (daily) {
				await ctx.db.patch(daily._id, { costLimit: args.dailyCostLimit, updatedAt: Date.now() });
			} else {
				await ctx.db.insert("usageBudgets", {
					userId: args.userId,
					periodType: "daily",
					period: day,
					totalCostUsed: 0,
					costLimit: args.dailyCostLimit,
					totalTokensUsed: 0,
					perModelUsage: [],
					perHarnessUsage: [],
					updatedAt: Date.now(),
				});
			}
		}

		if (args.weeklyCostLimit !== undefined) {
			const weekly = await ctx.db
				.query("usageBudgets")
				.withIndex("by_user_period", (q) =>
					q
						.eq("userId", args.userId)
						.eq("periodType", "weekly")
						.eq("period", week),
				)
				.unique();

			if (weekly) {
				await ctx.db.patch(weekly._id, { costLimit: args.weeklyCostLimit, updatedAt: Date.now() });
			} else {
				await ctx.db.insert("usageBudgets", {
					userId: args.userId,
					periodType: "weekly",
					period: week,
					totalCostUsed: 0,
					costLimit: args.weeklyCostLimit,
					totalTokensUsed: 0,
					perModelUsage: [],
					perHarnessUsage: [],
					updatedAt: Date.now(),
				});
			}
		}
	},
});

/**
 * Reset every usageBudgets row's costLimit to the current defaults.
 * Run via: `bunx convex run usage:resetAllCostLimits` (or the Convex dashboard).
 *
 * Does not touch totalCostUsed — only the limit. Returns counts for verification.
 */
export const resetAllCostLimits = internalMutation({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query("usageBudgets").collect();
		const now = Date.now();
		let dailyPatched = 0;
		let weeklyPatched = 0;
		for (const row of rows) {
			const newLimit =
				row.periodType === "daily"
					? DEFAULT_DAILY_COST_LIMIT
					: DEFAULT_WEEKLY_COST_LIMIT;
			if (row.costLimit === newLimit) continue;
			await ctx.db.patch(row._id, { costLimit: newLimit, updatedAt: now });
			if (row.periodType === "daily") dailyPatched++;
			else weeklyPatched++;
		}
		return {
			dailyPatched,
			weeklyPatched,
			total: rows.length,
			dailyLimit: DEFAULT_DAILY_COST_LIMIT,
			weeklyLimit: DEFAULT_WEEKLY_COST_LIMIT,
		};
	},
});

// --- Helpers ---

function formatDay(date: Date): string {
	return date.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

/**
 * ISO 8601 week number. Uses the Thursday-based algorithm: the week containing
 * the year's first Thursday is week 1.
 *
 * IMPORTANT: The Python counterpart in fastapi/app/services/usage.py uses
 * datetime.isocalendar() which implements the same ISO 8601 standard. Both must
 * produce identical week keys — if they drift, Python-written records become
 * invisible to TypeScript queries. Test at year boundaries if modifying.
 */
function formatWeek(date: Date): string {
	const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
	d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
