import { v } from "convex/values";
import {
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";
import { getIdentity } from "./authDev";

/**
 * Per-user named env-var credentials, assignable to workspaces and injected as
 * environment variables into the workspace/agent sandbox at run time.
 *
 * `name` (e.g. GITHUB_TOKEN) is NOT secret; `ciphertext` is AES-256-GCM(value)
 * produced by the FastAPI backend (same AGENT_CREDENTIALS_KEY as
 * agentCredentials). Convex and the browser never see the plaintext value:
 * the write path is browser → FastAPI (Clerk JWT) → encrypt → `create`
 * (deploy key); the value is only ever returned to FastAPI via `getForWorkspace`.
 *
 * Cross-tenant safety: the FastAPI deploy key can read ANY tenant's rows, so
 * every internal fn takes `userId` and re-checks it against each row.
 */

/** All of the current user's credentials (frontend — metadata, no secrets). */
export const listMine = query({
	handler: async (ctx) => {
		const identity = await getIdentity(ctx);
		if (!identity) return [];
		const rows = await ctx.db
			.query("workspaceCredentials")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.collect();
		const out = [];
		for (const row of rows) {
			const assignments = await ctx.db
				.query("credentialAssignments")
				.withIndex("by_credential", (q) => q.eq("credentialId", row._id))
				.collect();
			out.push({
				_id: row._id,
				name: row.name,
				label: row.label,
				createdAt: row.createdAt,
				lastUsedAt: row.lastUsedAt,
				workspaceCount: assignments.length,
			});
		}
		return out.sort((a, b) => b.createdAt - a.createdAt);
	},
});

/**
 * Upsert a credential by (user, name): re-setting an existing env-var name
 * replaces its value. FastAPI via deploy key. Returns the credential id.
 */
export const create = internalMutation({
	args: {
		userId: v.string(),
		name: v.string(),
		ciphertext: v.string(),
		label: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query("workspaceCredentials")
			.withIndex("by_user_name", (q) =>
				q.eq("userId", args.userId).eq("name", args.name),
			)
			.unique();
		if (existing) {
			await ctx.db.patch(existing._id, {
				ciphertext: args.ciphertext,
				label: args.label ?? existing.label,
				createdAt: Date.now(),
			});
			return existing._id;
		}
		return await ctx.db.insert("workspaceCredentials", {
			userId: args.userId,
			name: args.name,
			ciphertext: args.ciphertext,
			label: args.label,
			createdAt: Date.now(),
		});
	},
});

/** Rotate an existing credential's value by id (FastAPI via deploy key). */
export const updateSecret = internalMutation({
	args: {
		credentialId: v.id("workspaceCredentials"),
		userId: v.string(),
		ciphertext: v.string(),
		label: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const row = await ctx.db.get(args.credentialId);
		if (!row || row.userId !== args.userId) {
			throw new Error("Credential not found");
		}
		await ctx.db.patch(args.credentialId, {
			ciphertext: args.ciphertext,
			label: args.label ?? row.label,
			createdAt: Date.now(),
		});
		return args.credentialId;
	},
});

/**
 * Resolve a workspace's assigned credentials WITH ciphertext (FastAPI only).
 * Re-checks ownership on the workspace AND every joined credential — the deploy
 * key has no tenant boundary of its own.
 */
export const getForWorkspace = internalQuery({
	args: { workspaceId: v.id("workspaces"), userId: v.string() },
	handler: async (ctx, args) => {
		const workspace = await ctx.db.get(args.workspaceId);
		if (!workspace || workspace.userId !== args.userId) return [];
		const assignments = await ctx.db
			.query("credentialAssignments")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
			.collect();
		const out: { credentialId: string; name: string; ciphertext: string }[] =
			[];
		for (const a of assignments) {
			if (a.userId !== args.userId) continue;
			const cred = await ctx.db.get(a.credentialId);
			if (!cred || cred.userId !== args.userId) continue;
			out.push({
				credentialId: cred._id,
				name: cred.name,
				ciphertext: cred.ciphertext,
			});
		}
		return out;
	},
});

/** The credentials assigned to a workspace (frontend — metadata, no secrets). */
export const listForWorkspace = query({
	args: { workspaceId: v.id("workspaces") },
	handler: async (ctx, args) => {
		const identity = await getIdentity(ctx);
		if (!identity) return [];
		const workspace = await ctx.db.get(args.workspaceId);
		if (!workspace || workspace.userId !== identity.subject) return [];
		const assignments = await ctx.db
			.query("credentialAssignments")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
			.collect();
		const out = [];
		for (const a of assignments) {
			if (a.userId !== identity.subject) continue;
			const cred = await ctx.db.get(a.credentialId);
			if (!cred || cred.userId !== identity.subject) continue;
			out.push({ _id: cred._id, name: cred.name, label: cred.label });
		}
		return out;
	},
});

/** Assign a credential to a workspace. Both must belong to the caller. Idempotent. */
export const assign = mutation({
	args: {
		credentialId: v.id("workspaceCredentials"),
		workspaceId: v.id("workspaces"),
	},
	handler: async (ctx, args) => {
		const identity = await getIdentity(ctx);
		if (!identity) throw new Error("Unauthenticated");
		const cred = await ctx.db.get(args.credentialId);
		if (!cred || cred.userId !== identity.subject) {
			throw new Error("Credential not found");
		}
		const workspace = await ctx.db.get(args.workspaceId);
		if (!workspace || workspace.userId !== identity.subject) {
			throw new Error("Workspace not found");
		}
		const existing = await ctx.db
			.query("credentialAssignments")
			.withIndex("by_workspace_credential", (q) =>
				q
					.eq("workspaceId", args.workspaceId)
					.eq("credentialId", args.credentialId),
			)
			.unique();
		if (existing) return existing._id;
		return await ctx.db.insert("credentialAssignments", {
			userId: identity.subject,
			credentialId: args.credentialId,
			workspaceId: args.workspaceId,
			createdAt: Date.now(),
		});
	},
});

/** Remove a credential ↔ workspace assignment (owner-gated). */
export const unassign = mutation({
	args: {
		credentialId: v.id("workspaceCredentials"),
		workspaceId: v.id("workspaces"),
	},
	handler: async (ctx, args) => {
		const identity = await getIdentity(ctx);
		if (!identity) throw new Error("Unauthenticated");
		const existing = await ctx.db
			.query("credentialAssignments")
			.withIndex("by_workspace_credential", (q) =>
				q
					.eq("workspaceId", args.workspaceId)
					.eq("credentialId", args.credentialId),
			)
			.unique();
		if (existing && existing.userId === identity.subject) {
			await ctx.db.delete(existing._id);
		}
		return { removed: true };
	},
});

/** Delete a credential the user owns + cascade-delete its assignments. */
export const remove = mutation({
	args: { credentialId: v.id("workspaceCredentials") },
	handler: async (ctx, args) => {
		const identity = await getIdentity(ctx);
		if (!identity) throw new Error("Unauthenticated");
		const row = await ctx.db.get(args.credentialId);
		if (!row || row.userId !== identity.subject) {
			throw new Error("Credential not found");
		}
		const assignments = await ctx.db
			.query("credentialAssignments")
			.withIndex("by_credential", (q) =>
				q.eq("credentialId", args.credentialId),
			)
			.collect();
		for (const a of assignments) await ctx.db.delete(a._id);
		await ctx.db.delete(args.credentialId);
		return { removed: true };
	},
});

/** Best-effort lastUsedAt bump (FastAPI, sampled). */
export const touch = internalMutation({
	args: { credentialId: v.id("workspaceCredentials") },
	handler: async (ctx, args) => {
		const row = await ctx.db.get(args.credentialId);
		if (row) await ctx.db.patch(args.credentialId, { lastUsedAt: Date.now() });
	},
});
