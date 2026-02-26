import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		return await ctx.db
			.query("conversations")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.order("desc")
			.collect();
	},
});

export const get = query({
	args: { id: v.id("conversations") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const convo = await ctx.db.get(args.id);
		if (!convo || convo.userId !== identity.subject) return null;
		return convo;
	},
});

export const create = mutation({
	args: {
		title: v.string(),
		harnessId: v.id("harnesses"),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		return await ctx.db.insert("conversations", {
			...args,
			userId: identity.subject,
			lastMessageAt: Date.now(),
		});
	},
});

export const updateTitle = mutation({
	args: { id: v.id("conversations"), title: v.string() },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const convo = await ctx.db.get(args.id);
		if (!convo || convo.userId !== identity.subject) {
			throw new Error("Not found");
		}
		await ctx.db.patch(args.id, { title: args.title });
	},
});

export const remove = mutation({
	args: { id: v.id("conversations") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const convo = await ctx.db.get(args.id);
		if (!convo || convo.userId !== identity.subject) {
			throw new Error("Not found");
		}
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
