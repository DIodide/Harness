import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		return await ctx.db
			.query("harnesses")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.collect();
	},
});

export const get = query({
	args: { id: v.id("harnesses") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const harness = await ctx.db.get(args.id);
		if (!harness || harness.userId !== identity.subject) return null;
		return harness;
	},
});

export const create = mutation({
	args: {
		name: v.string(),
		model: v.string(),
		status: v.union(
			v.literal("started"),
			v.literal("stopped"),
			v.literal("draft"),
		),
		mcpServers: v.array(
			v.object({
				name: v.string(),
				url: v.string(),
				authType: v.union(v.literal("none"), v.literal("bearer"), v.literal("oauth")),
				authToken: v.optional(v.string()),
			}),
		),
		skills: v.array(v.string()),
		sandboxEnabled: v.optional(v.boolean()),
		sandboxConfig: v.optional(
			v.object({
				persistent: v.boolean(),
				autoStart: v.boolean(),
				defaultLanguage: v.string(),
				resourceTier: v.union(
					v.literal("basic"),
					v.literal("standard"),
					v.literal("performance"),
				),
				snapshotId: v.optional(v.string()),
				gitRepo: v.optional(v.string()),
				networkRestricted: v.optional(v.boolean()),
			}),
		),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		return await ctx.db.insert("harnesses", {
			...args,
			userId: identity.subject,
			lastUsedAt: Date.now(),
		});
	},
});

export const update = mutation({
	args: {
		id: v.id("harnesses"),
		name: v.optional(v.string()),
		model: v.optional(v.string()),
		status: v.optional(
			v.union(
				v.literal("started"),
				v.literal("stopped"),
				v.literal("draft"),
			),
		),
		mcpServers: v.optional(
			v.array(
				v.object({
					name: v.string(),
					url: v.string(),
					authType: v.union(v.literal("none"), v.literal("bearer"), v.literal("oauth")),
					authToken: v.optional(v.string()),
				}),
			),
		),
		skills: v.optional(v.array(v.string())),
		suggestedPrompts: v.optional(v.array(v.string())),
		sandboxEnabled: v.optional(v.boolean()),
		sandboxId: v.optional(v.id("sandboxes")),
		daytonaSandboxId: v.optional(v.string()),
		sandboxConfig: v.optional(
			v.object({
				persistent: v.boolean(),
				autoStart: v.boolean(),
				defaultLanguage: v.string(),
				resourceTier: v.union(
					v.literal("basic"),
					v.literal("standard"),
					v.literal("performance"),
				),
				snapshotId: v.optional(v.string()),
				gitRepo: v.optional(v.string()),
				networkRestricted: v.optional(v.boolean()),
			}),
		),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const harness = await ctx.db.get(args.id);
		if (!harness || harness.userId !== identity.subject) {
			throw new Error("Not found");
		}
		const { id, ...updates } = args;
		const filtered = Object.fromEntries(
			Object.entries(updates).filter(([, v]) => v !== undefined),
		);
		await ctx.db.patch(id, filtered);
	},
});

export const duplicate = mutation({
	args: { id: v.id("harnesses") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const harness = await ctx.db.get(args.id);
		if (!harness || harness.userId !== identity.subject) {
			throw new Error("Not found");
		}
		return await ctx.db.insert("harnesses", {
			name: `Copy of ${harness.name}`,
			model: harness.model,
			status: harness.status,
			mcpServers: harness.mcpServers,
			skills: harness.skills,
			userId: identity.subject,
			lastUsedAt: Date.now(),
		});
	},
});

export const remove = mutation({
	args: { id: v.id("harnesses") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const harness = await ctx.db.get(args.id);
		if (!harness || harness.userId !== identity.subject) {
			throw new Error("Not found");
		}
		await ctx.db.delete(args.id);
	},
});
