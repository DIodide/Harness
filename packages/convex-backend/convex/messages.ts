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
		attachments: v.optional(
			v.array(
				v.object({
					storageId: v.id("_storage"),
					mimeType: v.string(),
					fileName: v.string(),
					fileSize: v.number(),
				}),
			),
		),
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
			workspaceId: convo.workspaceId,
			userId: identity.subject,
			role: args.role,
			content: args.content,
			...(args.attachments && args.attachments.length > 0
				? { attachments: args.attachments }
				: {}),
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

export const remove = mutation({
	args: { id: v.id("messages") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		const message = await ctx.db.get(args.id);
		if (!message) throw new Error("Not found");

		const convo = await ctx.db.get(message.conversationId);
		if (!convo || convo.userId !== identity.subject) {
			throw new Error("Not found");
		}

		await ctx.db.delete(args.id);
	},
});

/**
 * Frontend-callable mutation to save a partial assistant message when the user
 * interrupts a streaming response. Auth-gated to the conversation owner.
 */
export const saveInterruptedMessage = mutation({
	args: {
		conversationId: v.id("conversations"),
		content: v.string(),
		reasoning: v.optional(v.string()),
		toolCalls: v.optional(
			v.array(
				v.object({
					tool: v.string(),
					arguments: v.any(),
					call_id: v.string(),
					result: v.string(),
				}),
			),
		),
		parts: v.optional(
			v.array(
				v.object({
					type: v.union(
						v.literal("text"),
						v.literal("reasoning"),
						v.literal("tool_call"),
					),
					content: v.optional(v.string()),
					tool: v.optional(v.string()),
					arguments: v.optional(v.any()),
					call_id: v.optional(v.string()),
					result: v.optional(v.string()),
				}),
			),
		),
		usage: v.optional(
			v.object({
				promptTokens: v.number(),
				completionTokens: v.number(),
				totalTokens: v.number(),
				cost: v.optional(v.number()),
			}),
		),
		model: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const convo = await ctx.db.get(args.conversationId);
		if (!convo || convo.userId !== identity.subject) throw new Error("Not found");

		await ctx.db.insert("messages", {
			conversationId: args.conversationId,
			workspaceId: convo.workspaceId,
			userId: identity.subject,
			role: "assistant",
			content: args.content,
			interrupted: true,
			...(args.reasoning ? { reasoning: args.reasoning } : {}),
			...(args.toolCalls && args.toolCalls.length > 0
				? { toolCalls: args.toolCalls }
				: {}),
			...(args.parts && args.parts.length > 0
				? { parts: args.parts }
				: {}),
			...(args.usage ? { usage: args.usage } : {}),
			...(args.model ? { model: args.model } : {}),
		});

		await ctx.db.patch(args.conversationId, {
			lastMessageAt: Date.now(),
		});
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
		toolCalls: v.optional(
			v.array(
				v.object({
					tool: v.string(),
					arguments: v.any(),
					call_id: v.string(),
					result: v.string(),
				}),
			),
		),
		parts: v.optional(
			v.array(
				v.object({
					type: v.union(
						v.literal("text"),
						v.literal("reasoning"),
						v.literal("tool_call"),
					),
					content: v.optional(v.string()),
					tool: v.optional(v.string()),
					arguments: v.optional(v.any()),
					call_id: v.optional(v.string()),
					result: v.optional(v.string()),
				}),
			),
		),
		usage: v.optional(
			v.object({
				promptTokens: v.number(),
				completionTokens: v.number(),
				totalTokens: v.number(),
				cost: v.optional(v.number()),
			}),
		),
		model: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const convo = await ctx.db.get(args.conversationId);
		if (!convo) throw new Error("Conversation not found");

		await ctx.db.insert("messages", {
			conversationId: args.conversationId,
			workspaceId: convo.workspaceId,
			userId: convo.userId,
			role: "assistant",
			content: args.content,
			...(args.reasoning ? { reasoning: args.reasoning } : {}),
			...(args.toolCalls && args.toolCalls.length > 0
				? { toolCalls: args.toolCalls }
				: {}),
			...(args.parts && args.parts.length > 0
				? { parts: args.parts }
				: {}),
			...(args.usage ? { usage: args.usage } : {}),
			...(args.model ? { model: args.model } : {}),
		});

		await ctx.db.patch(args.conversationId, {
			lastMessageAt: Date.now(),
		});
	},
});

/**
 * Internal mutation called by the FastAPI backend to backfill usage data
 * on an interrupted message after draining the OpenRouter stream.
 */
export const patchMessageUsage = internalMutation({
	args: {
		conversationId: v.id("conversations"),
		usage: v.object({
			promptTokens: v.number(),
			completionTokens: v.number(),
			totalTokens: v.number(),
			cost: v.optional(v.number()),
		}),
		model: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const messages = await ctx.db
			.query("messages")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", args.conversationId),
			)
			.collect();
		const last = messages[messages.length - 1];
		if (!last || last.role !== "assistant") return;

		const patch: Record<string, unknown> = { usage: args.usage };
		if (args.model) {
			patch.model = args.model;
		}
		await ctx.db.patch(last._id, patch);
	},
});
