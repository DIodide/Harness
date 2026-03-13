import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

export const list = query({
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		return await ctx.db
			.query("sandboxes")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.collect();
	},
});

export const get = query({
	args: { id: v.id("sandboxes") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const sandbox = await ctx.db.get(args.id);
		if (!sandbox || sandbox.userId !== identity.subject) return null;
		return sandbox;
	},
});

export const getByHarness = query({
	args: { harnessId: v.id("harnesses") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const sandboxes = await ctx.db
			.query("sandboxes")
			.withIndex("by_harness", (q) => q.eq("harnessId", args.harnessId))
			.collect();
		const sandbox = sandboxes[0];
		if (!sandbox || sandbox.userId !== identity.subject) return null;
		return sandbox;
	},
});

export const create = mutation({
	args: {
		harnessId: v.optional(v.id("harnesses")),
		daytonaSandboxId: v.string(),
		name: v.string(),
		status: v.union(
			v.literal("creating"),
			v.literal("starting"),
			v.literal("running"),
			v.literal("stopping"),
			v.literal("stopped"),
			v.literal("archived"),
			v.literal("error"),
		),
		language: v.optional(v.string()),
		ephemeral: v.boolean(),
		resources: v.object({
			cpu: v.number(),
			memoryGB: v.number(),
			diskGB: v.number(),
		}),
		snapshotId: v.optional(v.string()),
		gitRepo: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const id = await ctx.db.insert("sandboxes", {
			...args,
			userId: identity.subject,
			createdAt: Date.now(),
			lastAccessedAt: Date.now(),
		});
		// Link to harness if provided
		if (args.harnessId) {
			const harness = await ctx.db.get(args.harnessId);
			if (harness && harness.userId === identity.subject) {
				await ctx.db.patch(args.harnessId, {
					sandboxId: id,
					daytonaSandboxId: args.daytonaSandboxId,
				});
			}
		}
		return id;
	},
});

export const update = mutation({
	args: {
		id: v.id("sandboxes"),
		status: v.optional(
			v.union(
				v.literal("creating"),
				v.literal("starting"),
				v.literal("running"),
				v.literal("stopping"),
				v.literal("stopped"),
				v.literal("archived"),
				v.literal("error"),
			),
		),
		name: v.optional(v.string()),
		errorMessage: v.optional(v.string()),
		lastAccessedAt: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const sandbox = await ctx.db.get(args.id);
		if (!sandbox || sandbox.userId !== identity.subject) {
			throw new Error("Not found");
		}
		const { id, ...updates } = args;
		const filtered = Object.fromEntries(
			Object.entries(updates).filter(([, v]) => v !== undefined),
		);
		await ctx.db.patch(id, filtered);
	},
});

export const remove = mutation({
	args: { id: v.id("sandboxes") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const sandbox = await ctx.db.get(args.id);
		if (!sandbox || sandbox.userId !== identity.subject) {
			throw new Error("Not found");
		}
		// Unlink from harness if linked
		if (sandbox.harnessId) {
			const harness = await ctx.db.get(sandbox.harnessId);
			if (harness && harness.sandboxId === args.id) {
				await ctx.db.patch(sandbox.harnessId, { sandboxId: undefined });
			}
		}
		await ctx.db.delete(args.id);
	},
});

/**
 * Internal mutation called by the FastAPI backend to create a sandbox record
 * and link it to a harness. Uses deploy key auth — not callable from the frontend.
 */
export const createInternal = internalMutation({
	args: {
		userId: v.string(),
		harnessId: v.optional(v.string()),
		daytonaSandboxId: v.string(),
		name: v.string(),
		status: v.union(
			v.literal("creating"),
			v.literal("starting"),
			v.literal("running"),
			v.literal("stopping"),
			v.literal("stopped"),
			v.literal("archived"),
			v.literal("error"),
		),
		language: v.optional(v.string()),
		ephemeral: v.boolean(),
		resources: v.object({
			cpu: v.number(),
			memoryGB: v.number(),
			diskGB: v.number(),
		}),
	},
	handler: async (ctx, args) => {
		const { harnessId: harnessIdStr, ...rest } = args;
		const id = await ctx.db.insert("sandboxes", {
			...rest,
			harnessId: harnessIdStr
				? (harnessIdStr as any)
				: undefined,
			createdAt: Date.now(),
			lastAccessedAt: Date.now(),
		});
		// Link to harness if provided
		if (harnessIdStr) {
			const harness = await ctx.db.get(harnessIdStr as any);
			if (harness) {
				await ctx.db.patch(harness._id, {
					sandboxId: id,
					daytonaSandboxId: args.daytonaSandboxId,
				});
			}
		}
		return id;
	},
});

/**
 * Internal mutation called by the FastAPI backend to update sandbox status.
 * Uses deploy key auth — not callable from the frontend.
 */
export const updateStatus = internalMutation({
	args: {
		daytonaSandboxId: v.string(),
		status: v.union(
			v.literal("creating"),
			v.literal("starting"),
			v.literal("running"),
			v.literal("stopping"),
			v.literal("stopped"),
			v.literal("archived"),
			v.literal("error"),
		),
		errorMessage: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const sandboxes = await ctx.db
			.query("sandboxes")
			.withIndex("by_daytona_id", (q) =>
				q.eq("daytonaSandboxId", args.daytonaSandboxId),
			)
			.collect();
		const sandbox = sandboxes[0];
		if (!sandbox) return;
		const patch: Record<string, unknown> = {
			status: args.status,
			lastAccessedAt: Date.now(),
		};
		if (args.errorMessage !== undefined) {
			patch.errorMessage = args.errorMessage;
		}
		await ctx.db.patch(sandbox._id, patch);
	},
});
