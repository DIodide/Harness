import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";

/**
 * Per-user credentials for external ACP agents (Codex CLI, Claude Code).
 *
 * Write path: browser → FastAPI (Clerk JWT) → AES-256-GCM encrypt →
 * internal mutation here via deploy key. The browser only ever reads
 * metadata through `listStatuses`; ciphertext is only returned to the
 * FastAPI backend through internal queries.
 */

const KIND = v.union(
	v.literal("auth_json"),
	v.literal("api_key"),
	v.literal("oauth_token"),
);

/** Connection metadata for the current user (frontend use — no secrets). */
export const listStatuses = query({
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		const rows = await ctx.db
			.query("agentCredentials")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.collect();
		return rows.map((row) => ({
			agent: row.agent,
			kind: row.kind,
			label: row.label,
			createdAt: row.createdAt,
			lastUsedAt: row.lastUsedAt,
		}));
	},
});

/** Upsert a credential (FastAPI via deploy key; value already encrypted). */
export const store = internalMutation({
	args: {
		userId: v.string(),
		agent: v.string(),
		kind: KIND,
		ciphertext: v.string(),
		label: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query("agentCredentials")
			.withIndex("by_user_agent", (q) =>
				q.eq("userId", args.userId).eq("agent", args.agent),
			)
			.unique();
		if (existing) {
			await ctx.db.patch(existing._id, {
				kind: args.kind,
				ciphertext: args.ciphertext,
				label: args.label,
				createdAt: Date.now(),
			});
		} else {
			await ctx.db.insert("agentCredentials", {
				...args,
				createdAt: Date.now(),
			});
		}
	},
});

/** Fetch one credential, ciphertext included (FastAPI only). */
export const getForAgent = internalQuery({
	args: { userId: v.string(), agent: v.string() },
	handler: async (ctx, args) => {
		const row = await ctx.db
			.query("agentCredentials")
			.withIndex("by_user_agent", (q) =>
				q.eq("userId", args.userId).eq("agent", args.agent),
			)
			.unique();
		if (!row) return null;
		return {
			agent: row.agent,
			kind: row.kind,
			ciphertext: row.ciphertext,
			label: row.label,
		};
	},
});

/** Connection metadata for one user (FastAPI use — no secrets). */
export const listForUser = internalQuery({
	args: { userId: v.string() },
	handler: async (ctx, args) => {
		const rows = await ctx.db
			.query("agentCredentials")
			.withIndex("by_user", (q) => q.eq("userId", args.userId))
			.collect();
		return rows.map((row) => ({
			agent: row.agent,
			kind: row.kind,
			label: row.label,
			createdAt: row.createdAt,
		}));
	},
});

export const remove = internalMutation({
	args: { userId: v.string(), agent: v.string() },
	handler: async (ctx, args) => {
		const row = await ctx.db
			.query("agentCredentials")
			.withIndex("by_user_agent", (q) =>
				q.eq("userId", args.userId).eq("agent", args.agent),
			)
			.unique();
		if (row) await ctx.db.delete(row._id);
		return { removed: row !== null };
	},
});

export const touch = internalMutation({
	args: { userId: v.string(), agent: v.string() },
	handler: async (ctx, args) => {
		const row = await ctx.db
			.query("agentCredentials")
			.withIndex("by_user_agent", (q) =>
				q.eq("userId", args.userId).eq("agent", args.agent),
			)
			.unique();
		if (row) await ctx.db.patch(row._id, { lastUsedAt: Date.now() });
	},
});
