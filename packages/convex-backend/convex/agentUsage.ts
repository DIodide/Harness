import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

/**
 * Per-credential usage for ACP agents (Claude Code, Codex, Cursor).
 *
 * Cost bills to the user's OWN agent account, so this is informational only —
 * never a budget gate (that's `usage.ts`, for OpenRouter). Cost is the SDK's
 * client-side `total_cost_usd` estimate, surfaced as "estimated" in the UI.
 */

/** UTC "YYYY-MM-DD" — must match the gateway's Python `_current_day()`. */
function todayKey(): string {
	return new Date().toISOString().slice(0, 10);
}

/**
 * Record one ACP agent turn's usage (FastAPI gateway via deploy key).
 * Idempotent on `turnKey` — a usage_update can fire more than once per turn
 * or on reconnect, and we must not double-count.
 */
export const record = internalMutation({
	args: {
		userId: v.string(),
		agentCredentialId: v.id("agentCredentials"),
		agent: v.string(),
		conversationId: v.id("conversations"),
		acpSessionId: v.optional(v.string()),
		model: v.optional(v.string()),
		usedTokens: v.number(),
		contextSize: v.optional(v.number()),
		costUsd: v.number(),
		currency: v.string(),
		rateLimit: v.optional(v.any()),
		turnKey: v.string(),
		day: v.string(),
		week: v.string(),
	},
	handler: async (ctx, args) => {
		const dupe = await ctx.db
			.query("agentUsageLedger")
			.withIndex("by_turnKey", (q) => q.eq("turnKey", args.turnKey))
			.first();
		if (dupe) return dupe._id;
		return await ctx.db.insert("agentUsageLedger", {
			...args,
			isEstimate: true,
			recordedAt: Date.now(),
		});
	},
});

interface CredAcc {
	totalCostUsd: number;
	totalTokens: number;
	turns: number;
	todayCostUsd: number;
	todayTokens: number;
	perModel: Map<string, { tokens: number; costUsd: number }>;
	lastTurnAt: number;
	lastModel: string | null;
	rateLimit: unknown;
}

/**
 * The current user's agent usage, aggregated per credential.
 *
 * Sums the ledger (no rollup table — keeps period totals exact and dodges the
 * cumulative-cost double-count trap). Fine at current volume; if a single user
 * ever accumulates many thousands of turns, introduce a per-period rollup.
 */
export const getMyAgentUsage = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		const userId = identity.subject;

		const [creds, rows] = await Promise.all([
			ctx.db
				.query("agentCredentials")
				.withIndex("by_user", (q) => q.eq("userId", userId))
				.collect(),
			ctx.db
				.query("agentUsageLedger")
				.withIndex("by_user", (q) => q.eq("userId", userId))
				.collect(),
		]);

		const today = todayKey();
		const byCred = new Map<string, CredAcc>();
		for (const r of rows) {
			const key = r.agentCredentialId as string;
			let acc = byCred.get(key);
			if (!acc) {
				acc = {
					totalCostUsd: 0,
					totalTokens: 0,
					turns: 0,
					todayCostUsd: 0,
					todayTokens: 0,
					perModel: new Map(),
					lastTurnAt: 0,
					lastModel: null,
					rateLimit: null,
				};
				byCred.set(key, acc);
			}
			acc.totalCostUsd += r.costUsd;
			acc.totalTokens += r.usedTokens;
			acc.turns += 1;
			if (r.day === today) {
				acc.todayCostUsd += r.costUsd;
				acc.todayTokens += r.usedTokens;
			}
			const model = r.model ?? "unknown";
			const pm = acc.perModel.get(model) ?? { tokens: 0, costUsd: 0 };
			pm.tokens += r.usedTokens;
			pm.costUsd += r.costUsd;
			acc.perModel.set(model, pm);
			if (r.recordedAt >= acc.lastTurnAt) {
				acc.lastTurnAt = r.recordedAt;
				acc.lastModel = r.model ?? null;
				acc.rateLimit = r.rateLimit ?? null;
			}
		}

		// One entry per credential that has usage; join the human label.
		const out = [];
		for (const cred of creds) {
			const acc = byCred.get(cred._id as string);
			if (!acc) continue;
			out.push({
				credentialId: cred._id,
				agent: cred.agent,
				label: cred.label ?? null,
				totalCostUsd: acc.totalCostUsd,
				totalTokens: acc.totalTokens,
				turns: acc.turns,
				todayCostUsd: acc.todayCostUsd,
				todayTokens: acc.todayTokens,
				lastTurnAt: acc.lastTurnAt,
				lastModel: acc.lastModel,
				rateLimit: acc.rateLimit,
				perModel: [...acc.perModel.entries()]
					.map(([model, m]) => ({ model, tokens: m.tokens, costUsd: m.costUsd }))
					.sort((a, b) => b.costUsd - a.costUsd),
			});
		}
		out.sort((a, b) => b.totalCostUsd - a.totalCostUsd);
		return out;
	},
});
