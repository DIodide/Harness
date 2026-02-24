import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const listByConversation = query({
	args: { conversationId: v.id("conversations") },
	handler: async (ctx, args) => {
		return await ctx.db
			.query("messages")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", args.conversationId),
			)
			.order("asc")
			.collect();
	},
});

export const send = mutation({
	args: {
		conversationId: v.id("conversations"),
		content: v.string(),
	},
	handler: async (ctx, args) => {
		const id = await ctx.db.insert("messages", {
			conversationId: args.conversationId,
			role: "user",
			content: args.content,
			isStreaming: false,
			isError: false,
			createdAt: Date.now(),
		});

		await ctx.db.patch(args.conversationId, { updatedAt: Date.now() });

		return id;
	},
});

export const createAssistant = mutation({
	args: { conversationId: v.id("conversations") },
	handler: async (ctx, args) => {
		return await ctx.db.insert("messages", {
			conversationId: args.conversationId,
			role: "assistant",
			content: "",
			isStreaming: true,
			isError: false,
			createdAt: Date.now(),
		});
	},
});

export const updateStreaming = mutation({
	args: {
		messageId: v.id("messages"),
		content: v.string(),
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.messageId, { content: args.content });
	},
});

export const finalizeMessage = mutation({
	args: {
		messageId: v.id("messages"),
		content: v.optional(v.string()),
		toolCalls: v.optional(v.any()),
		toolResults: v.optional(v.any()),
		isError: v.optional(v.boolean()),
	},
	handler: async (ctx, args) => {
		const patch: Record<string, unknown> = { isStreaming: false };
		if (args.content !== undefined) patch.content = args.content;
		if (args.toolCalls !== undefined) patch.toolCalls = args.toolCalls;
		if (args.toolResults !== undefined)
			patch.toolResults = args.toolResults;
		if (args.isError !== undefined) patch.isError = args.isError;
		await ctx.db.patch(args.messageId, patch);
	},
});
