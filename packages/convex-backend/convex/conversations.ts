import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		return await ctx.db
			.query("conversations")
			.withIndex("by_user_last_message", (q) =>
				q.eq("userId", identity.subject),
			)
			.order("desc")
			.take(50);
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

		const harness = await ctx.db.get(args.harnessId);
		if (!harness || harness.userId !== identity.subject) {
			throw new Error("Harness not found");
		}

		return await ctx.db.insert("conversations", {
			title: args.title,
			lastHarnessId: args.harnessId,
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

export const fork = mutation({
	args: {
		conversationId: v.id("conversations"),
		upToMessageId: v.id("messages"),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		const convo = await ctx.db.get(args.conversationId);
		if (!convo || convo.userId !== identity.subject) throw new Error("Not found");

		const allMessages = await ctx.db
			.query("messages")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", args.conversationId),
			)
			.collect();

		const targetIdx = allMessages.findIndex((m) => m._id === args.upToMessageId);
		if (targetIdx === -1) throw new Error("Message not found");
		const messagesToCopy = allMessages.slice(0, targetIdx + 1);

		const newConvoId = await ctx.db.insert("conversations", {
			title: `Fork of ${convo.title}`,
			lastHarnessId: convo.lastHarnessId,
			userId: identity.subject,
			lastMessageAt: Date.now(),
			forkedFromConversationId: args.conversationId,
			forkedAtMessageCount: messagesToCopy.length,
		});

		for (const msg of messagesToCopy) {
			const { _id, _creationTime, conversationId, ...rest } = msg;
			await ctx.db.insert("messages", {
				...rest,
				conversationId: newConvoId,
			});
		}

		return newConvoId;
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
