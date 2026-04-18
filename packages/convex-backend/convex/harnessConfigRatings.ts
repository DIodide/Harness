import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const rate = mutation({
	args: {
		rating: v.union(v.literal("up"), v.literal("down")),
		configSnapshot: v.object({
			name: v.string(),
			model: v.string(),
			mcpIds: v.array(v.string()),
		}),
		conversationSnapshot: v.array(
			v.object({
				role: v.string(),
				content: v.string(),
			}),
		),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		return await ctx.db.insert("harnessConfigRatings", {
			userId: identity.subject,
			rating: args.rating,
			configSnapshot: args.configSnapshot,
			conversationSnapshot: args.conversationSnapshot,
			createdAt: Date.now(),
		});
	},
});

export const listByRating = query({
	args: {
		rating: v.union(v.literal("up"), v.literal("down")),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		return await ctx.db
			.query("harnessConfigRatings")
			.withIndex("by_rating", (q) => q.eq("rating", args.rating))
			.order("desc")
			.collect();
	},
});
