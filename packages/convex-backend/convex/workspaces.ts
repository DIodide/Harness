import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

async function assertOwnedWorkspace(
	ctx: MutationCtx,
	workspaceId: Id<"workspaces">,
	userId: string,
) {
	const workspace = await ctx.db.get(workspaceId);
	if (!workspace || workspace.userId !== userId) {
		throw new Error("Workspace not found");
	}
	return workspace;
}

export const list = query({
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];

		return await ctx.db
			.query("workspaces")
			.withIndex("by_user_last_used", (q) =>
				q.eq("userId", identity.subject),
			)
			.order("desc")
			.collect();
	},
});

export const get = query({
	args: { id: v.id("workspaces") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;

		const workspace = await ctx.db.get(args.id);
		if (!workspace || workspace.userId !== identity.subject) return null;
		return workspace;
	},
});

export const create = mutation({
	args: {
		name: v.optional(v.string()),
		harnessId: v.id("harnesses"),
		sandboxId: v.id("sandboxes"),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		const [harness, sandbox] = await Promise.all([
			ctx.db.get(args.harnessId),
			ctx.db.get(args.sandboxId),
		]);

		if (!harness || harness.userId !== identity.subject) {
			throw new Error("Harness not found");
		}
		if (!sandbox || sandbox.userId !== identity.subject) {
			throw new Error("Sandbox not found");
		}

		const now = Date.now();
		return await ctx.db.insert("workspaces", {
			userId: identity.subject,
			name: args.name?.trim() || harness.name,
			harnessId: args.harnessId,
			sandboxId: args.sandboxId,
			createdAt: now,
			lastUsedAt: now,
		});
	},
});

export const update = mutation({
	args: {
		id: v.id("workspaces"),
		name: v.optional(v.string()),
		harnessId: v.optional(v.id("harnesses")),
		sandboxId: v.optional(v.id("sandboxes")),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		await assertOwnedWorkspace(ctx, args.id, identity.subject);
		const updates: {
			name?: string;
			harnessId?: Id<"harnesses">;
			sandboxId?: Id<"sandboxes">;
			lastUsedAt: number;
		} = {
			lastUsedAt: Date.now(),
		};
		if (args.name !== undefined) {
			const name = args.name.trim();
			if (!name) throw new Error("Workspace name is required");
			updates.name = name;
		}
		if (args.harnessId !== undefined) {
			const harness = await ctx.db.get(args.harnessId);
			if (!harness || harness.userId !== identity.subject) {
				throw new Error("Harness not found");
			}
			updates.harnessId = args.harnessId;
		}
		if (args.sandboxId !== undefined) {
			const sandbox = await ctx.db.get(args.sandboxId);
			if (!sandbox || sandbox.userId !== identity.subject) {
				throw new Error("Sandbox not found");
			}
			updates.sandboxId = args.sandboxId;
		}
		await ctx.db.patch(args.id, updates);
	},
});

export const touch = mutation({
	args: { id: v.id("workspaces") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		await assertOwnedWorkspace(ctx, args.id, identity.subject);
		await ctx.db.patch(args.id, { lastUsedAt: Date.now() });
	},
});
