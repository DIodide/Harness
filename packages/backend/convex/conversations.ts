import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const listByUser = query({
	args: { userId: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query("conversations")
			.withIndex("by_user", (q) => q.eq("userId", args.userId))
			.order("desc")
			.collect();
	},
});

export const get = query({
	args: { id: v.id("conversations") },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.id);
	},
});

export const create = mutation({
	args: {
		userId: v.string(),
		harnessId: v.id("harnesses"),
		title: v.string(),
		model: v.string(),
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		return await ctx.db.insert("conversations", {
			userId: args.userId,
			harnessId: args.harnessId,
			title: args.title,
			model: args.model,
			createdAt: now,
			updatedAt: now,
		});
	},
});

export const updateTitle = mutation({
	args: { id: v.id("conversations"), title: v.string() },
	handler: async (ctx, args) => {
		await ctx.db.patch(args.id, {
			title: args.title,
			updatedAt: Date.now(),
		});
	},
});

export const remove = mutation({
	args: { id: v.id("conversations") },
	handler: async (ctx, args) => {
		const messages = await ctx.db
			.query("messages")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", args.id),
			)
			.collect();

		for (const msg of messages) {
			await ctx.db.delete(msg._id);
		}

		await ctx.db.delete(args.id);
	},
});
