import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { resolveConversationRole } from "./shares";

// Clamp the stored summary so a pathological capture can't blow the Convex
// document size limit. Generous — real compaction summaries are a few KB.
const MAX_SUMMARY_CHARS = 100_000;

/**
 * Record a Claude Code compaction (called by the FastAPI backend mid-turn).
 * internalMutation: backend-only, derives userId/workspaceId from the
 * conversation — NEVER trusts a client-supplied owner. Defense-in-depth: when
 * the turn was triggered by a collaborator, re-verify they hold an editor
 * grant (mirrors messages.saveAssistantMessage).
 */
export const record = internalMutation({
	args: {
		conversationId: v.id("conversations"),
		summary: v.string(),
		trigger: v.union(v.literal("manual"), v.literal("auto")),
		atMessageCount: v.optional(v.number()),
		preTokens: v.optional(v.number()),
		postTokens: v.optional(v.number()),
		model: v.optional(v.string()),
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

		return await ctx.db.insert("compactions", {
			conversationId: args.conversationId,
			workspaceId: convo.workspaceId,
			userId: convo.userId,
			summary: args.summary.slice(0, MAX_SUMMARY_CHARS),
			trigger: args.trigger,
			atMessageCount: args.atMessageCount,
			preTokens: args.preTokens,
			postTokens: args.postTokens,
			model: args.model,
			createdAt: Date.now(),
		});
	},
});

/** Compactions for a conversation, oldest-first. Owner-gated. */
export const listByConversation = query({
	args: { conversationId: v.id("conversations") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		const convo = await ctx.db.get(args.conversationId);
		if (!convo || convo.userId !== identity.subject) return [];
		return await ctx.db
			.query("compactions")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", args.conversationId),
			)
			.collect();
	},
});

/**
 * "New session from summary": fork a fresh conversation seeded with a
 * compaction's summary instead of the full transcript. Carries the source
 * harness + workspace forward (a continuation), and reuses the existing fork
 * lineage (`forkedFromConversationId`/`forkedAtMessageCount`) so the
 * "Branched from" banner + jump-to-original work for free. The single seeded
 * message is the summary itself — the agent route detects it (by its canonical
 * preamble) and replays it in full as the new session's context.
 */
export const cloneFromCompaction = mutation({
	args: {
		compactionId: v.id("compactions"),
		harnessId: v.optional(v.id("harnesses")),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		const compaction = await ctx.db.get(args.compactionId);
		if (!compaction || compaction.userId !== identity.subject)
			throw new Error("Not found");

		const convo = await ctx.db.get(compaction.conversationId);
		if (!convo || convo.userId !== identity.subject)
			throw new Error("Not found");

		// Optionally re-bind to a different harness (defense-in-depth: ownership).
		let lastHarnessId = convo.lastHarnessId;
		if (args.harnessId) {
			const harness = await ctx.db.get(args.harnessId);
			if (!harness || harness.userId !== identity.subject)
				throw new Error("Harness not found");
			lastHarnessId = args.harnessId;
		}

		const newConvoId = await ctx.db.insert("conversations", {
			title: `Session from summary of ${convo.title}`,
			lastHarnessId,
			workspaceId: convo.workspaceId,
			userId: identity.subject,
			lastMessageAt: Date.now(),
			forkedFromConversationId: compaction.conversationId,
			forkedAtMessageCount: compaction.atMessageCount ?? 0,
			seededFromCompactionId: args.compactionId,
		});

		// Seed the new thread with the summary as its sole message. Claude Code
		// itself injects the compaction summary as a user message, so role:"user"
		// is faithful; the agent route replays it as context on the first turn.
		await ctx.db.insert("messages", {
			conversationId: newConvoId,
			workspaceId: convo.workspaceId,
			userId: identity.subject,
			role: "user",
			content: compaction.summary,
		});

		return newConvoId;
	},
});
