import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
	args: { conversationId: v.id("conversations") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		const convo = await ctx.db.get(args.conversationId);
		if (!convo || convo.userId !== identity.subject) return [];
		return await ctx.db
			.query("messages")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", args.conversationId),
			)
			.collect();
	},
});

export const send = mutation({
	args: {
		conversationId: v.id("conversations"),
		role: v.union(v.literal("user"), v.literal("assistant")),
		content: v.string(),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const convo = await ctx.db.get(args.conversationId);
		if (!convo || convo.userId !== identity.subject) {
			throw new Error("Not found");
		}
		const id = await ctx.db.insert("messages", {
			conversationId: args.conversationId,
			role: args.role,
			content: args.content,
		});
		await ctx.db.patch(args.conversationId, {
			lastMessageAt: Date.now(),
		});
		return id;
	},
});
