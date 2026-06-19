import { v } from "convex/values";
import {
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";

/**
 * Per-user credentials for external ACP agents (Codex CLI, Claude Code,
 * Cursor). A user may hold MULTIPLE credentials per agent (e.g. a work and
 * a personal Claude account); each harness references one by id. Values are
 * AES-256-GCM ciphertext produced by the FastAPI backend — Convex and the
 * browser never see plaintext.
 *
 * Write path: browser → FastAPI (Clerk JWT) → AES-256-GCM encrypt →
 * `create` (deploy key). Ciphertext is only ever returned to FastAPI via
 * the internal queries.
 */

const KIND = v.union(
	v.literal("auth_json"),
	v.literal("api_key"),
	v.literal("oauth_token"),
);

/** All credentials for the current user (frontend — metadata, no secrets). */
export const listMine = query({
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		const rows = await ctx.db
			.query("agentCredentials")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.collect();
		return rows
			.map((row) => ({
				_id: row._id,
				agent: row.agent,
				kind: row.kind,
				label: row.label,
				createdAt: row.createdAt,
				lastUsedAt: row.lastUsedAt,
			}))
			.sort((a, b) => b.createdAt - a.createdAt);
	},
});

/** Insert a new credential (FastAPI via deploy key). Returns the new id. */
export const create = internalMutation({
	args: {
		userId: v.string(),
		agent: v.string(),
		kind: KIND,
		ciphertext: v.string(),
		label: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		return await ctx.db.insert("agentCredentials", {
			...args,
			createdAt: Date.now(),
		});
	},
});

/** Replace an existing credential's secret/label (FastAPI via deploy key). */
export const updateSecret = internalMutation({
	args: {
		credentialId: v.id("agentCredentials"),
		userId: v.string(),
		// `kind` is validated against the REQUEST's agent upstream, so a
		// rotation aimed at the wrong row would otherwise write a kind that
		// is invalid for the row's actual agent (corrupting it). Optional
		// only for deploy-window compatibility — FastAPI always sends it.
		agent: v.optional(v.string()),
		kind: KIND,
		ciphertext: v.string(),
		label: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const row = await ctx.db.get(args.credentialId);
		if (!row || row.userId !== args.userId) {
			throw new Error("Credential not found");
		}
		if (args.agent !== undefined && row.agent !== args.agent) {
			throw new Error(
				`Credential belongs to '${row.agent}', not '${args.agent}'`,
			);
		}
		await ctx.db.patch(args.credentialId, {
			kind: args.kind,
			ciphertext: args.ciphertext,
			label: args.label ?? row.label,
			createdAt: Date.now(),
		});
		return args.credentialId;
	},
});

/** Fetch one credential by id, ciphertext included (FastAPI only). */
export const getById = internalQuery({
	args: { credentialId: v.id("agentCredentials"), userId: v.string() },
	handler: async (ctx, args) => {
		const row = await ctx.db.get(args.credentialId);
		if (!row || row.userId !== args.userId) return null;
		return {
			agent: row.agent,
			kind: row.kind,
			ciphertext: row.ciphertext,
			label: row.label,
		};
	},
});

/** Most-recently-created credential for an agent (FastAPI fallback when a
 *  harness has no explicit credential link). */
export const getForAgent = internalQuery({
	args: { userId: v.string(), agent: v.string() },
	handler: async (ctx, args) => {
		const rows = await ctx.db
			.query("agentCredentials")
			.withIndex("by_user_agent", (q) =>
				q.eq("userId", args.userId).eq("agent", args.agent),
			)
			.collect();
		if (rows.length === 0) return null;
		const row = rows.sort(
			(a, b) =>
				b.createdAt - a.createdAt ||
				b._creationTime - a._creationTime ||
				(b._id > a._id ? 1 : -1),
		)[0];
		return {
			credentialId: row._id,
			agent: row.agent,
			kind: row.kind,
			ciphertext: row.ciphertext,
			label: row.label,
		};
	},
});

/** Credentials for one user (FastAPI use — metadata, no secrets). */
export const listForUser = internalQuery({
	args: { userId: v.string() },
	handler: async (ctx, args) => {
		const rows = await ctx.db
			.query("agentCredentials")
			.withIndex("by_user", (q) => q.eq("userId", args.userId))
			.collect();
		return rows.map((row) => ({
			credentialId: row._id,
			agent: row.agent,
			kind: row.kind,
			label: row.label,
			createdAt: row.createdAt,
		}));
	},
});

/** Delete a credential the user owns, and unlink any harnesses using it. */
export const remove = mutation({
	args: { credentialId: v.id("agentCredentials") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const row = await ctx.db.get(args.credentialId);
		if (!row || row.userId !== identity.subject) {
			throw new Error("Credential not found");
		}
		const harnesses = await ctx.db
			.query("harnesses")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.collect();
		for (const harness of harnesses) {
			if (harness.agentCredentialId === args.credentialId) {
				await ctx.db.patch(harness._id, { agentCredentialId: undefined });
			}
		}
		// Cascade-delete this credential's usage ledger so it doesn't dangle as
		// orphaned-but-summed rows (agentUsage totals are summed from the ledger).
		const usage = await ctx.db
			.query("agentUsageLedger")
			.withIndex("by_credential", (q) =>
				q.eq("agentCredentialId", args.credentialId),
			)
			.collect();
		for (const row of usage) {
			await ctx.db.delete(row._id);
		}
		await ctx.db.delete(args.credentialId);
		return { removed: true };
	},
});

export const touch = internalMutation({
	args: { credentialId: v.id("agentCredentials") },
	handler: async (ctx, args) => {
		const row = await ctx.db.get(args.credentialId);
		if (row) await ctx.db.patch(args.credentialId, { lastUsedAt: Date.now() });
	},
});
