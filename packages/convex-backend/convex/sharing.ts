import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const createShare = mutation({
	args: { conversationId: v.id("conversations") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		const convo = await ctx.db.get(args.conversationId);
		if (!convo || convo.userId !== identity.subject) {
			throw new Error("Conversation not found");
		}

		// Check if already shared
		const existing = await ctx.db
			.query("sharedConversations")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", args.conversationId),
			)
			.unique();

		if (existing) {
			return existing.shareToken;
		}

		const shareToken = crypto.randomUUID();
		await ctx.db.insert("sharedConversations", {
			conversationId: args.conversationId,
			shareToken,
			userId: identity.subject,
			createdAt: Date.now(),
		});

		return shareToken;
	},
});

export const revokeShare = mutation({
	args: { conversationId: v.id("conversations") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		const convo = await ctx.db.get(args.conversationId);
		if (!convo || convo.userId !== identity.subject) {
			throw new Error("Conversation not found");
		}

		const share = await ctx.db
			.query("sharedConversations")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", args.conversationId),
			)
			.unique();

		if (share) {
			await ctx.db.delete(share._id);
		}
	},
});

export const getShareStatus = query({
	args: { conversationId: v.id("conversations") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;

		const convo = await ctx.db.get(args.conversationId);
		if (!convo || convo.userId !== identity.subject) return null;

		const share = await ctx.db
			.query("sharedConversations")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", args.conversationId),
			)
			.unique();

		return share ? { shareToken: share.shareToken, createdAt: share.createdAt } : null;
	},
});

export const getSharedConversation = query({
	args: { shareToken: v.string() },
	handler: async (ctx, args) => {
		const share = await ctx.db
			.query("sharedConversations")
			.withIndex("by_token", (q) => q.eq("shareToken", args.shareToken))
			.unique();

		if (!share) return null;

		const conversation = await ctx.db.get(share.conversationId);
		if (!conversation) return null;

		const messages = await ctx.db
			.query("messages")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", share.conversationId),
			)
			.collect();

		// Fetch harness name/model (don't expose secrets)
		let harnessName: string | null = null;
		let harnessModel: string | null = null;
		if (conversation.lastHarnessId) {
			const harness = await ctx.db.get(conversation.lastHarnessId);
			if (harness) {
				harnessName = harness.name;
				harnessModel = harness.model;
			}
		}

		return {
			conversation: {
				title: conversation.title,
				lastMessageAt: conversation.lastMessageAt,
			},
			messages: messages.map((m) => ({
				_id: m._id,
				role: m.role,
				content: m.content,
				reasoning: m.reasoning,
				toolCalls: m.toolCalls,
				parts: m.parts,
				model: m.model,
				interrupted: m.interrupted,
			})),
			harnessName,
			harnessModel,
		};
	},
});
