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

/** ISO-8601 "YYYY-WNN" — must match the gateway's Python `_current_week()`
 *  (datetime.isocalendar) and the OpenRouter `usage.ts` formatWeek. */
function weekKey(): string {
	const now = new Date();
	const d = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
	d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	const weekNo = Math.ceil(
		((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
	);
	return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * Record one ACP agent turn's usage (FastAPI gateway via deploy key).
 *
 * Idempotent on `turnKey` — a usage_update can fire more than once per turn or
 * on reconnect, and we must not double-count. EXCEPTION: an `authoritative` row
 * (sourced from the SDK result message: real total_cost_usd + cache tokens) may
 * REPLACE an earlier non-authoritative row for the same turnKey. The thin ACP
 * `usage_update` writes the non-authoritative row first (a fail-safe if the
 * result message never arrives); the result message patches it in place.
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
		inputTokens: v.optional(v.number()),
		outputTokens: v.optional(v.number()),
		cacheReadTokens: v.optional(v.number()),
		cacheCreationTokens: v.optional(v.number()),
		costUsd: v.number(),
		currency: v.string(),
		authoritative: v.optional(v.boolean()),
		rateLimit: v.optional(v.any()),
		turnKey: v.string(),
		day: v.string(),
		week: v.string(),
	},
	handler: async (ctx, args) => {
		const { authoritative, ...rest } = args;
		const dupe = await ctx.db
			.query("agentUsageLedger")
			.withIndex("by_turnKey", (q) => q.eq("turnKey", args.turnKey))
			.first();
		if (dupe) {
			// Upgrade a thin row to the authoritative numbers; otherwise keep the
			// first write (true idempotency for re-fired non-authoritative updates).
			if (authoritative && !dupe.authoritative) {
				await ctx.db.patch(dupe._id, {
					...rest,
					authoritative: true,
					isEstimate: true,
					recordedAt: Date.now(),
				});
			}
			return dupe._id;
		}
		return await ctx.db.insert("agentUsageLedger", {
			...rest,
			authoritative: authoritative ?? false,
			isEstimate: true,
			recordedAt: Date.now(),
		});
	},
});

interface CredAcc {
	totalCostUsd: number;
	totalTokens: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
	turns: number;
	todayCostUsd: number;
	todayTokens: number;
	weekCostUsd: number;
	weekTokens: number;
	perModel: Map<string, { tokens: number; costUsd: number }>;
	lastTurnAt: number;
	lastModel: string | null;
	rateLimit: unknown;
}

function emptyAcc(): CredAcc {
	return {
		totalCostUsd: 0,
		totalTokens: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheCreationTokens: 0,
		turns: 0,
		todayCostUsd: 0,
		todayTokens: 0,
		weekCostUsd: 0,
		weekTokens: 0,
		perModel: new Map(),
		lastTurnAt: 0,
		lastModel: null,
		rateLimit: null,
	};
}

// Bound the ledger scan so the query degrades (caps totals) rather than
// THROWING past Convex's per-transaction read limit. One row per agent turn;
// 8000 leaves ample headroom under the limit for the credential join + the
// rateLimit blobs. If a user ever exceeds this, introduce a per-period rollup.
const MAX_LEDGER_ROWS = 8000;

/**
 * The current user's agent usage, aggregated per credential.
 *
 * Sums the (capped) ledger — no rollup table, which keeps period totals exact
 * and dodges the cumulative-cost double-count trap.
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
				.take(MAX_LEDGER_ROWS),
		]);

		const today = todayKey();
		const week = weekKey();
		const byCred = new Map<string, CredAcc>();
		for (const r of rows) {
			const key = r.agentCredentialId as string;
			let acc = byCred.get(key);
			if (!acc) {
				acc = emptyAcc();
				byCred.set(key, acc);
			}
			acc.totalCostUsd += r.costUsd;
			acc.totalTokens += r.usedTokens;
			acc.inputTokens += r.inputTokens ?? 0;
			acc.outputTokens += r.outputTokens ?? 0;
			acc.cacheReadTokens += r.cacheReadTokens ?? 0;
			acc.cacheCreationTokens += r.cacheCreationTokens ?? 0;
			acc.turns += 1;
			if (r.day === today) {
				acc.todayCostUsd += r.costUsd;
				acc.todayTokens += r.usedTokens;
			}
			if (r.week === week) {
				acc.weekCostUsd += r.costUsd;
				acc.weekTokens += r.usedTokens;
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

		// One entry per credential (including connected-but-unused accounts, so
		// every agent the user has shows up); join the human label. The UI groups
		// these by `agent`.
		const out = creds.map((cred) => {
			const acc = byCred.get(cred._id as string) ?? emptyAcc();
			return {
				credentialId: cred._id,
				agent: cred.agent,
				label: cred.label ?? null,
				totalCostUsd: acc.totalCostUsd,
				totalTokens: acc.totalTokens,
				inputTokens: acc.inputTokens,
				outputTokens: acc.outputTokens,
				cacheReadTokens: acc.cacheReadTokens,
				cacheCreationTokens: acc.cacheCreationTokens,
				turns: acc.turns,
				todayCostUsd: acc.todayCostUsd,
				todayTokens: acc.todayTokens,
				weekCostUsd: acc.weekCostUsd,
				weekTokens: acc.weekTokens,
				lastTurnAt: acc.lastTurnAt,
				lastModel: acc.lastModel,
				rateLimit: acc.rateLimit,
				perModel: [...acc.perModel.entries()]
					.map(([model, m]) => ({ model, tokens: m.tokens, costUsd: m.costUsd }))
					.sort((a, b) => b.costUsd - a.costUsd),
			};
		});
		out.sort((a, b) => b.totalCostUsd - a.totalCostUsd);
		return out;
	},
});
