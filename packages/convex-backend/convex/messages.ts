import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

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
		harnessId: v.optional(v.id("harnesses")),
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

		const patch: { lastMessageAt: number; lastHarnessId?: typeof args.harnessId } = {
			lastMessageAt: Date.now(),
		};
		if (args.harnessId) {
			patch.lastHarnessId = args.harnessId;
		}
		await ctx.db.patch(args.conversationId, patch);

		return id;
	},
});

/**
 * Internal mutation called by the FastAPI backend (via deploy key) to persist
 * assistant messages after streaming completes. Not callable from the frontend.
 */
export const saveAssistantMessage = internalMutation({
	args: {
		conversationId: v.id("conversations"),
		content: v.string(),
		reasoning: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const convo = await ctx.db.get(args.conversationId);
		if (!convo) throw new Error("Conversation not found");

		await ctx.db.insert("messages", {
			conversationId: args.conversationId,
			role: "assistant",
			content: args.content,
			...(args.reasoning ? { reasoning: args.reasoning } : {}),
		});

		await ctx.db.patch(args.conversationId, {
			lastMessageAt: Date.now(),
		});
	},
});
