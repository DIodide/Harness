import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";

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
			.withIndex("by_user_last_used", (q) => q.eq("userId", identity.subject))
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

/**
 * Resolve the user's Default workspace, creating/backfilling it so EXACTLY ONE
 * exists and is flagged `isDefault`. Idempotent. Backfill for accounts predating
 * the flag: adopt an existing "Default"-named workspace if present, else create a
 * fresh one (never flag an arbitrarily-named existing workspace). Returns its id.
 */
export async function getOrCreateDefaultWorkspace(
	ctx: MutationCtx,
	userId: string,
	harnessId?: Id<"harnesses">,
): Promise<Id<"workspaces">> {
	const all = await ctx.db
		.query("workspaces")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.collect();

	const flagged = all.find((w) => w.isDefault);
	if (flagged) return flagged._id;

	// Backfill an account predating the flag: adopt ONLY a workspace
	// conventionally named "Default" (what old onboarding created). Never flag an
	// arbitrarily-named workspace (e.g. "Production") — that would silently make a
	// workspace the user could previously delete permanently undeletable. If
	// there's no "Default", fall through and create a fresh one.
	const adopt = all.find((w) => w.name === "Default");
	if (adopt) {
		await ctx.db.patch(adopt._id, { isDefault: true });
		return adopt._id;
	}

	let linkHarness = harnessId;
	if (linkHarness) {
		const harness = await ctx.db.get(linkHarness);
		if (!harness || harness.userId !== userId) linkHarness = undefined;
	}
	const now = Date.now();
	return await ctx.db.insert("workspaces", {
		userId,
		name: "Default",
		isDefault: true,
		...(linkHarness ? { harnessId: linkHarness } : {}),
		createdAt: now,
		lastUsedAt: now,
	});
}

/**
 * Every user gets an undeletable "Default" workspace so conversations always
 * have a home. Idempotent; returns the Default workspace id (creating or
 * backfilling it). `harnessId` links the harness onboarding just created when
 * the Default is first created.
 */
export const ensureDefault = mutation({
	args: { harnessId: v.optional(v.id("harnesses")) },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		return await getOrCreateDefaultWorkspace(
			ctx,
			identity.subject,
			args.harnessId,
		);
	},
});

export const create = mutation({
	args: {
		name: v.optional(v.string()),
		harnessId: v.optional(v.id("harnesses")),
		sandboxId: v.optional(v.id("sandboxes")),
		color: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		const [harness, sandbox] = await Promise.all([
			args.harnessId ? ctx.db.get(args.harnessId) : Promise.resolve(null),
			args.sandboxId ? ctx.db.get(args.sandboxId) : Promise.resolve(null),
		]);

		if (args.harnessId && (!harness || harness.userId !== identity.subject)) {
			throw new Error("Harness not found");
		}
		if (args.sandboxId && (!sandbox || sandbox.userId !== identity.subject)) {
			throw new Error("Sandbox not found");
		}

		const now = Date.now();
		return await ctx.db.insert("workspaces", {
			userId: identity.subject,
			name: args.name?.trim() || harness?.name || "New workspace",
			...(args.harnessId ? { harnessId: args.harnessId } : {}),
			...(args.sandboxId ? { sandboxId: args.sandboxId } : {}),
			...(args.color ? { color: args.color } : {}),
			createdAt: now,
			lastUsedAt: now,
		});
	},
});

export const update = mutation({
	args: {
		id: v.id("workspaces"),
		name: v.optional(v.string()),
		harnessId: v.optional(v.union(v.id("harnesses"), v.null())),
		sandboxId: v.optional(v.union(v.id("sandboxes"), v.null())),
		color: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		await assertOwnedWorkspace(ctx, args.id, identity.subject);
		const updates: {
			name?: string;
			harnessId?: Id<"harnesses"> | undefined;
			sandboxId?: Id<"sandboxes"> | undefined;
			color?: string;
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
			if (args.harnessId === null) {
				updates.harnessId = undefined;
			} else {
				const harness = await ctx.db.get(args.harnessId);
				if (!harness || harness.userId !== identity.subject) {
					throw new Error("Harness not found");
				}
				updates.harnessId = args.harnessId;
			}
		}
		if (args.sandboxId !== undefined) {
			if (args.sandboxId === null) {
				updates.sandboxId = undefined;
			} else {
				const sandbox = await ctx.db.get(args.sandboxId);
				if (!sandbox || sandbox.userId !== identity.subject) {
					throw new Error("Sandbox not found");
				}
				updates.sandboxId = args.sandboxId;
			}
		}
		if (args.color !== undefined) {
			// Empty string clears the color field (patch with undefined deletes it).
			updates.color = args.color || undefined;
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

export const remove = mutation({
	args: { id: v.id("workspaces") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		const workspace = await assertOwnedWorkspace(
			ctx,
			args.id,
			identity.subject,
		);
		// The Default workspace is permanent — it's every conversation's fallback
		// home. Its harness/sandbox stay editable via `update`.
		if (workspace.isDefault) {
			throw new Error("The Default workspace can't be deleted");
		}

		const conversations = await ctx.db
			.query("conversations")
			.withIndex("by_workspace_last_message", (q) =>
				q.eq("workspaceId", args.id),
			)
			.collect();

		for (const conversation of conversations) {
			const messages = await ctx.db
				.query("messages")
				.withIndex("by_conversation", (q) =>
					q.eq("conversationId", conversation._id),
				)
				.collect();

			await Promise.all(messages.map((m) => ctx.db.delete(m._id)));

			await ctx.db.delete(conversation._id);
		}

		await ctx.db.delete(args.id);
	},
});
