import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const DEFAULTS = {
	autoSwitchHarness: true,
	displayMode: "standard" as const,
	modelSelectorMode: "session" as const,
	chatConfigScope: "harness" as const,
	workspacesMode: "workspaces" as const,
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
			// In-chat config changes (model/agent/modes) default to updating
			// the harness; "session" keeps them ephemeral.
			chatConfigScope: settings.chatConfigScope ?? "harness",
			workspacesMode: settings.workspacesMode ?? "workspaces"
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
		chatConfigScope: v.optional(
			v.union(v.literal("harness"), v.literal("session")),
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
