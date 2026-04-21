import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const DEFAULTS = {
	autoSwitchHarness: true,
	displayMode: "standard" as const,
	modelSelectorMode: "session" as const,
	workspacesMode: "basic" as const,
} as const;

export const get = query({
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return DEFAULTS;

		const settings = await ctx.db
			.query("userSettings")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.unique();

		if (!settings) return DEFAULTS;

		return {
			autoSwitchHarness: settings.autoSwitchHarness,
			displayMode: settings.displayMode ?? "standard",
			modelSelectorMode: settings.modelSelectorMode ?? "session",
			workspacesMode: settings.workspacesMode ?? "basic"
		};
	},
});

export const update = mutation({
	args: {
		autoSwitchHarness: v.optional(v.boolean()),
		displayMode: v.optional(
			v.union(
				v.literal("zen"),
				v.literal("standard"),
				v.literal("developer"),
			),
		),
		modelSelectorMode: v.optional(
			v.union(v.literal("session"), v.literal("harness")),
		),
		workspacesMode: v.optional(
			v.union(v.literal("basic"), v.literal("workspaces")),
		),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		const existing = await ctx.db
			.query("userSettings")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.unique();

		const updates = Object.fromEntries(
			Object.entries(args).filter(([, v]) => v !== undefined),
		);

		if (existing) {
			await ctx.db.patch(existing._id, updates);
		} else {
			await ctx.db.insert("userSettings", {
				userId: identity.subject,
				...DEFAULTS,
				...updates,
			});
		}
	},
});
