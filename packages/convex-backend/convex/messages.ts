import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { contentFromParts } from "./messageParts";
import {
	authorizeConversationWrite,
	MAX_MESSAGE_CONTENT_CHARS,
	resolveConversationRole,
} from "./shares";

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
		if (args.content.length > MAX_MESSAGE_CONTENT_CHARS) {
			throw new Error("Message too long");
		}
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

		const patch: {
			lastMessageAt: number;
			lastHarnessId?: typeof args.harnessId;
		} = {
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
	// `token` lets an editor-grant collaborator delete from a shared
	// conversation (owners pass nothing). Authorization is the active grant.
	args: { id: v.id("messages"), token: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		const message = await ctx.db.get(args.id);
		if (!message) throw new Error("Not found");

		await authorizeConversationWrite(
			ctx,
			identity.subject,
			message.conversationId,
			args.token,
		);

		await ctx.db.delete(args.id);
	},
});

/**
 * Delete a message and every later message in its conversation. Used by
 * regenerate: regenerating a (possibly mid-conversation) assistant message
 * must truncate the conversation at that point, otherwise the messages after
 * it are orphaned when the new response is appended at the end.
 */
export const removeFrom = mutation({
	// `token` lets an editor-grant collaborator regenerate (which truncates)
	// from a shared conversation (owners pass nothing).
	args: { id: v.id("messages"), token: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		const message = await ctx.db.get(args.id);
		if (!message) throw new Error("Not found");

		await authorizeConversationWrite(
			ctx,
			identity.subject,
			message.conversationId,
			args.token,
		);

		const inConvo = await ctx.db
			.query("messages")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", message.conversationId),
			)
			.collect();
		for (const m of inConvo) {
			if (m._creationTime >= message._creationTime) {
				await ctx.db.delete(m._id);
			}
		}
	},
});

/**
 * Rewind a thread TO a message: delete every message strictly AFTER it,
 * keeping the target itself. Unlike `removeFrom` (inclusive, used by
 * regenerate), this is exclusive — rewinding to a user message keeps that
 * message so the thread ends there. Same authorization as `removeFrom`
 * (owner, or an editor-grant collaborator via `token`).
 *
 * Deletes by POSITION in the canonical (by_conversation) order rather than a
 * `_creationTime` comparison, so same-millisecond siblings (e.g. messages
 * copied in one transaction) are handled correctly.
 */
export const removeAfter = mutation({
	args: { id: v.id("messages"), token: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		const message = await ctx.db.get(args.id);
		if (!message) throw new Error("Not found");

		await authorizeConversationWrite(
			ctx,
			identity.subject,
			message.conversationId,
			args.token,
		);

		const inConvo = await ctx.db
			.query("messages")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", message.conversationId),
			)
			.collect();
		const targetIdx = inConvo.findIndex((m) => m._id === args.id);
		for (let i = targetIdx + 1; i < inConvo.length; i++) {
			await ctx.db.delete(inConvo[i]._id);
		}
	},
});

/**
 * Rewind into the MIDDLE of an assistant message: keep the first
 * `keepPartCount` flat `parts[]` of one assistant message, drop the rest, and
 * delete every message after it. A generalization of `removeAfter` that also
 * rewrites the boundary message in place.
 *
 * `keepPartCount` is a FLAT index into `parts[]` (not the organized render
 * tree) and must keep the message non-empty and actually shrink it
 * (1 <= keepPartCount < parts.length); the frontend computes it so a kept
 * tool-call keeps all its nested subagent children. `content` is recomputed
 * from the kept text parts so the agent transcript reseeds from the truncated
 * text on its next turn. Legacy `reasoning`/`toolCalls` (only used by the
 * no-parts fallback render) are cleared so nothing stale survives.
 *
 * Patch + delete run in one transaction, so the boundary message and the tail
 * can never half-commit. Same authorization as `removeAfter`.
 */
export const truncatePart = mutation({
	args: {
		id: v.id("messages"),
		keepPartCount: v.number(),
		token: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		const message = await ctx.db.get(args.id);
		if (!message) throw new Error("Not found");
		if (message.role !== "assistant")
			throw new Error("Can only truncate an assistant message");
		const parts = message.parts;
		if (!parts || parts.length === 0)
			throw new Error("Message has no parts to truncate");

		const keep = Math.floor(args.keepPartCount);
		if (keep < 1 || keep >= parts.length)
			throw new Error("keepPartCount out of range");

		await authorizeConversationWrite(
			ctx,
			identity.subject,
			message.conversationId,
			args.token,
		);

		const trimmedParts = parts.slice(0, keep);
		await ctx.db.patch(args.id, {
			content: contentFromParts(trimmedParts),
			parts: trimmedParts,
			reasoning: undefined,
			toolCalls: undefined,
		});

		// Delete every message AFTER the boundary, by position (same canonical
		// order as removeAfter — robust to same-millisecond siblings).
		const inConvo = await ctx.db
			.query("messages")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", message.conversationId),
			)
			.collect();
		const targetIdx = inConvo.findIndex((m) => m._id === args.id);
		for (let i = targetIdx + 1; i < inConvo.length; i++) {
			await ctx.db.delete(inConvo[i]._id);
		}
	},
});

/**
 * Frontend-callable mutation to save a partial assistant message when the user
 * interrupts a streaming response. Authorized to the owner OR an editor-grant
 * collaborator (who pass the share `token`). The assistant message is always
 * owner-attributed (userId = convo.userId) so it stays in the owner's search
 * index, regardless of who interrupted.
 */
export const saveInterruptedMessage = mutation({
	args: {
		conversationId: v.id("conversations"),
		token: v.optional(v.string()),
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
					kind: v.optional(v.string()),
					parent_id: v.optional(v.string()),
					status: v.optional(v.string()),
					exit_code: v.optional(v.number()),
					server_name: v.optional(v.string()),
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
		const convo = await authorizeConversationWrite(
			ctx,
			identity.subject,
			args.conversationId,
			args.token,
		);

		await ctx.db.insert("messages", {
			conversationId: args.conversationId,
			workspaceId: convo.workspaceId,
			userId: convo.userId,
			role: "assistant",
			// Enforce the invariant content == contentFromParts(parts) here too,
			// rather than trusting the client-supplied content — the one
			// frontend-callable persistence path. The streaming client already
			// keeps state.content in lockstep with its text parts, so for a
			// well-behaved caller this recompute equals what it sent (the
			// `convexHasMessage` handshake, which compares lastMsg.content to the
			// client's pendingDoneContent, still matches). Falls back to the raw
			// content only when no parts were captured.
			content:
				args.parts && args.parts.length > 0
					? contentFromParts(args.parts)
					: args.content,
			interrupted: true,
			...(args.reasoning ? { reasoning: args.reasoning } : {}),
			...(args.toolCalls && args.toolCalls.length > 0
				? { toolCalls: args.toolCalls }
				: {}),
			...(args.parts && args.parts.length > 0 ? { parts: args.parts } : {}),
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
					kind: v.optional(v.string()),
					parent_id: v.optional(v.string()),
					status: v.optional(v.string()),
					exit_code: v.optional(v.number()),
					server_name: v.optional(v.string()),
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
		interrupted: v.optional(v.boolean()),
		interruptionReason: v.optional(v.string()),
		// Defense-in-depth: the FastAPI backend passes who triggered the turn
		// (and the share token they used, when a collaborator). The message is
		// still owner-attributed, but the mutation re-verifies that a non-owner
		// requester actually holds an editor grant — so a forgotten FastAPI gate
		// can never inject an assistant message into a stranger's thread.
		requesterUserId: v.optional(v.string()),
		requesterToken: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const convo = await ctx.db.get(args.conversationId);
		if (!convo) throw new Error("Conversation not found");

		if (args.requesterUserId && args.requesterUserId !== convo.userId) {
			const role = await resolveConversationRole(
				ctx,
				args.requesterUserId,
				args.conversationId,
				args.requesterToken,
			);
			if (role !== "editor") throw new Error("Not authorized");
		}

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
			...(args.parts && args.parts.length > 0 ? { parts: args.parts } : {}),
			...(args.usage ? { usage: args.usage } : {}),
			...(args.model ? { model: args.model } : {}),
			...(args.interrupted ? { interrupted: true } : {}),
			...(args.interruptionReason
				? { interruptionReason: args.interruptionReason }
				: {}),
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
