import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getIdentity } from "./authDev";

const DEFAULTS = {
	autoSwitchHarness: true,
	displayMode: "standard" as const,
	modelSelectorMode: "session" as const,
	chatConfigScope: "harness" as const,
	workspacesMode: "workspaces" as const,
	rewindSeams: true,
} as const;

export const get = query({
	handler: async (ctx) => {
		const identity = await getIdentity(ctx);
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
			// the harness; "session" keeps them ephemeral. chatConfigScope
			// replaced modelSelectorMode (whose default was "session") — a
			// user who explicitly chose session-scoped switching under the
			// old setting keeps that behavior instead of silently having
			// every in-chat switch rewrite their harness.
			chatConfigScope:
				settings.chatConfigScope ??
				(settings.modelSelectorMode === "session" ? "session" : "harness"),
			workspacesMode: settings.workspacesMode ?? "workspaces",
			rewindSeams: settings.rewindSeams ?? true,
		};
	},
});

export const update = mutation({
	args: {
		autoSwitchHarness: v.optional(v.boolean()),
		displayMode: v.optional(
			v.union(v.literal("zen"), v.literal("standard"), v.literal("developer")),
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
		rewindSeams: v.optional(v.boolean()),
	},
	handler: async (ctx, args) => {
		const identity = await getIdentity(ctx);
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
