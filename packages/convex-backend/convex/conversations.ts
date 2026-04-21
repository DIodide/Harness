import { v } from "convex/values";
import { Id } from "./_generated/dataModel"
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";

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

export const createCreationSession = mutation({
	args: { title: v.string() },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		return await ctx.db.insert("conversations", {
			title: args.title,
			userId: identity.subject,
			lastMessageAt: Date.now(),
			isCreationSession: true,
		});
	},
});

export const linkToHarness = mutation({
	args: { id: v.id("conversations"), harnessId: v.id("harnesses") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const convo = await ctx.db.get(args.id);
		if (!convo || convo.userId !== identity.subject) throw new Error("Not found");
		await ctx.db.patch(args.id, { lastHarnessId: args.harnessId, isCreationSession: undefined });
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
			.take(8192);

		const targetIdx = allMessages.findIndex((m) => m._id === args.upToMessageId);
		if (targetIdx === -1) throw new Error("Message not found in this conversation");
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

/**
 * Atomically fork a conversation at a given message position and insert the
 * edited user message in a single transaction. This eliminates the flicker
 * where the forked conversation would briefly appear without the new message.
 */
export const editForkAndSend = mutation({
	args: {
		conversationId: v.id("conversations"),
		upToMessageCount: v.number(),
		newContent: v.string(),
		harnessId: v.optional(v.id("harnesses")),
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
			.take(8192);

		if (args.upToMessageCount < 0 || args.upToMessageCount > allMessages.length) {
			throw new Error("Invalid message count");
		}

		const messagesToCopy = allMessages.slice(0, args.upToMessageCount);

		// Walk the ancestor chain to find the true group parent for this edit
		// position. All edits at the same message position within the same lineage
		// must share a common parent so pagination stays consistent across branches.
		//
		// Rules while walking up:
		//   - ancestor forked at SAME position  → its parent is the group root
		//   - ancestor forked at LATER position  → content at pos came from its
		//                                          parent; keep walking up
		//   - ancestor forked at EARLIER position (or no parent) → ancestor is the
		//                                          local root for this position
		const MAX_DEPTH = 100;
		let parentId: typeof args.conversationId = args.conversationId;
		let current = convo;
		for (let depth = 0; depth < MAX_DEPTH; depth++) {
			if (!current.editParentConversationId) {
				parentId = current._id;
				break;
			}
			if (current.editParentMessageCount === args.upToMessageCount) {
				parentId = current.editParentConversationId;
				break;
			}
			if ((current.editParentMessageCount ?? 0) > args.upToMessageCount) {
				const parent = await ctx.db.get(current.editParentConversationId);
				if (!parent || parent.userId !== identity.subject) {
					parentId = current._id;
					break;
				}
				current = parent;
			} else {
				parentId = current._id;
				break;
			}
		}

		const now = Date.now();
		const newConvoId = await ctx.db.insert("conversations", {
			title: convo.title,
			lastHarnessId: args.harnessId ?? convo.lastHarnessId,
			userId: identity.subject,
			lastMessageAt: now,
			editParentConversationId: parentId,
			editParentMessageCount: args.upToMessageCount,
		});

		for (const msg of messagesToCopy) {
			const { _id, _creationTime, conversationId, ...rest } = msg;
			await ctx.db.insert("messages", {
				...rest,
				conversationId: newConvoId,
			});
		}

		// Insert the edited user message in the same transaction
		await ctx.db.insert("messages", {
			conversationId: newConvoId,
			userId: identity.subject,
			role: "user",
			content: args.newContent,
		});

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

export const searchTitles = query({
	args: { query: v.string(), paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity)
			return { page: [], isDone: true, continueCursor: "" };
		
		return await ctx.db
			.query("conversations")
			.withSearchIndex("search_title", (q) =>
				q.search("title", args.query).eq("userId", identity.subject)
			)
			.paginate(args.paginationOpts);
	},
});

export const searchContent = query({
	args: { query: v.string(), paginationOpts: paginationOptsValidator },
	handler: async (ctx, args ) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity)
			return { page: [], isDone: true, continueCursor: ""};

		const result = await ctx.db
			.query("messages")
			.withSearchIndex("search_content", (q) =>
				q.search("content", args.query).eq("userId", identity.subject)
			)
			.paginate(args.paginationOpts);
		
		// Pre-fetch all referenced conversations in parallel to avoid N+1
		const uniqueConvoIds = [...new Set(result.page.map((m) => m.conversationId))];
		const convos = await Promise.all(uniqueConvoIds.map((id) => ctx.db.get(id)));
		const convoMap = new Map(
			convos.filter((c): c is NonNullable<typeof c> => c !== null).map((c) => [c._id, c]),
		);

		// Enrich each message with snippet + convo title
		// make sure it has an annotated type so convex doesn't infer the paginate type
		const enrichedPage: {
			messageId: Id<"messages">;
			conversationId: Id<"conversations">;
			conversationTitle: string;
			role: string;
			snippet: string;
		}[] = [];
		for (const msg of result.page) {
			const convo = convoMap.get(msg.conversationId);
			if (!convo || convo.userId !== identity.subject) continue

			const lowerContent = msg.content.toLowerCase();
			const lowerQuery = args.query.toLowerCase();
			const matchIndex = lowerContent.indexOf(lowerQuery);

			let snippet: string;
			if (matchIndex !== -1) {
				const start = Math.max(0, matchIndex - 40);
				const end = Math.min(msg.content.length, matchIndex + args.query.length + 40);
				snippet = (start > 0 ? "..." : "")
					+ msg.content.slice(start, end)
					+ (end < msg.content.length ? "..." : "");
			} else {
				snippet = msg.content.slice(0, 80) + (msg.content.length > 80 ? "..." : "");
			}

			enrichedPage.push({
				messageId: msg._id,
				conversationId: msg.conversationId,
				conversationTitle: convo.title,
				role: msg.role,
				snippet,
			});
		}

		return {
			...result,
			page: enrichedPage,
		};
	},
});

export const searchTitlesCount = query({
	args: { query: v.string() },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return 0;

		const results = await ctx.db
			.query("conversations")
			.withSearchIndex("search_title", (q) =>
				q.search("title", args.query).eq("userId", identity.subject)
			)
			.collect();
		return results.length;
	},
});

export const searchContentCount = query({
	args: { query: v.string() },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return 0;

		// Filter at the index level using userId, cap to avoid read limits
		const results = await ctx.db
			.query("messages")
			.withSearchIndex("search_content", (q) =>
				q.search("content", args.query).eq("userId", identity.subject)
			)
			.take(1000);

		return results.length;
	},
});