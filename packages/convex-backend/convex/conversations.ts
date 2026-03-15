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

export const search = query({
	args: { query: v.string() },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return { titleMatches: [], contentMatches: [] };

		// 1. Search conversation titles
		const titleMatches = await ctx.db
			.query("conversations")
			.withSearchIndex("search_title", (q) =>
				q.search("title", args.query).eq("userId", identity.subject)
			)
			.take(10);

		// 2. Search message content
		const messageHits = await ctx.db
			.query("messages")
			.withSearchIndex("search_content", (q) =>
				q.search("content", args.query)
			)
			.take(30);

		// 3. Build content matches with snippets
		const contentMatches = [];
		for (const msg of messageHits) {
			const convo = await ctx.db.get(msg.conversationId);
			if (!convo || convo.userId !== identity.subject) continue;

			// Extract a snippet around the first occurrence of the query
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
				// Full-text search matched but exact substring didn't
				// (e.g. different word forms) — just take the beginning
				snippet = msg.content.slice(0, 80) + (msg.content.length > 80 ? "..." : "");
			}

			contentMatches.push({
				messageId: msg._id,
				conversationId: msg.conversationId,
				conversationTitle: convo.title,
				role: msg.role,
				snippet,
			});
		}

		return { titleMatches, contentMatches };
	},
});