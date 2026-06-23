import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { contentFromParts } from "./messageParts";
import { getOrCreateDefaultWorkspace } from "./workspaces";

// Trailing "(fork)" / "(fork N)" suffix, case-insensitive, tolerant of spacing.
const FORK_SUFFIX = /\s*\(fork(?:\s+\d+)?\)$/i;

// High code point that sorts after any normal title char, for prefix-range
// scans ("title >= base AND title < base+PREFIX_END" → titles starting with base).
const PREFIX_END = "￿";

/** Strip an existing fork suffix so re-forking a fork yields "(fork 2)", not
 *  "(fork) (fork)". */
function forkBaseTitle(title: string): string {
	return title.replace(FORK_SUFFIX, "").trimEnd();
}

/**
 * Next available fork title for `rawBase` given the user's existing titles:
 * "X (fork)", then "X (fork 2)", "X (fork 3)", filling gaps. "(fork)" holds
 * slot 1. Case-insensitive matching; always emits lowercase "(fork)".
 */
function nextForkTitle(rawBase: string, siblingTitles: string[]): string {
	const base = forkBaseTitle(rawBase);
	const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const re = new RegExp(`^${escaped}\\s*\\(fork(?:\\s+(\\d+))?\\)$`, "i");
	const taken = new Set<number>();
	for (const t of siblingTitles) {
		const m = t.match(re);
		if (m) taken.add(m[1] ? Number(m[1]) : 1);
	}
	if (!taken.has(1)) return `${base} (fork)`;
	let n = 2;
	while (taken.has(n)) n++;
	return `${base} (fork ${n})`;
}

const LIST_CAP = 100;

/** Pinned conversations first (most-recently-pinned on top), then by recency. */
function sortPinnedFirst(rows: Array<Doc<"conversations">>) {
	return [...rows].sort((a, b) => {
		const ap = a.pinnedAt != null;
		const bp = b.pinnedAt != null;
		if (ap !== bp) return ap ? -1 : 1;
		if (ap && bp) return (b.pinnedAt as number) - (a.pinnedAt as number);
		return b.lastMessageAt - a.lastMessageAt;
	});
}

/**
 * Merge the always-included pinned rows with the recency window: drop edit-fork
 * sibling rows (not user-visible), dedupe, then pinned-first. Fetching pinned
 * SEPARATELY guarantees a pinned chat is never truncated out by the recency cap,
 * and filtering edit-forks server-side keeps the cap spent on visible chats.
 */
function mergeConversationList(
	pinned: Array<Doc<"conversations">>,
	recent: Array<Doc<"conversations">>,
) {
	const seen = new Set<string>();
	const out: Array<Doc<"conversations">> = [];
	for (const c of [...pinned, ...recent]) {
		if (c.editParentConversationId) continue;
		if (seen.has(c._id)) continue;
		seen.add(c._id);
		out.push(c);
	}
	return sortPinnedFirst(out);
}

/**
 * Run a query against a NEW index that may be mid-backfill in the minutes after
 * a deploy (querying a backfilling index THROWS). Swallow that so callers
 * degrade gracefully instead of taking the whole request down. by_user_pinned /
 * by_workspace_pinned / by_user_title were all added in one PR; before this
 * guard a deploy could blank the entire sidebar and break forking.
 */
async function tolerateBackfill<T>(run: () => Promise<T[]>): Promise<T[]> {
	try {
		return await run();
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		if (msg.includes("backfilling")) return [];
		throw e;
	}
}

export const list = query({
	args: { workspaceId: v.optional(v.id("workspaces")) },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		if (args.workspaceId) {
			const workspace = await ctx.db.get(args.workspaceId);
			if (!workspace || workspace.userId !== identity.subject) return [];
			const recent = await ctx.db
				.query("conversations")
				.withIndex("by_workspace_last_message", (q) =>
					q.eq("workspaceId", args.workspaceId),
				)
				.order("desc")
				// Exclude edit-fork siblings DURING the scan so the cap is spent on
				// user-visible chats (edit-forks carry a fresh lastMessageAt and
				// would otherwise crowd the window).
				.filter((q) => q.eq(q.field("editParentConversationId"), undefined))
				.take(LIST_CAP);
			const pinned = await tolerateBackfill(() =>
				ctx.db
					.query("conversations")
					.withIndex("by_workspace_pinned", (q) =>
						q.eq("workspaceId", args.workspaceId).gt("pinnedAt", 0),
					)
					.order("desc")
					.take(LIST_CAP),
			);
			return mergeConversationList(pinned, recent);
		}
		// /chat lists ALL the user's recent conversations regardless of workspace
		// (workspace-assigned ones are tinted client-side). Previously this
		// excluded any conversation with a workspaceId.
		const recent = await ctx.db
			.query("conversations")
			.withIndex("by_user_last_message", (q) =>
				q.eq("userId", identity.subject),
			)
			.order("desc")
			// Exclude edit-fork siblings DURING the scan so the cap is spent on
			// user-visible chats (edit-forks carry a fresh lastMessageAt and would
			// otherwise crowd the window).
			.filter((q) => q.eq(q.field("editParentConversationId"), undefined))
			.take(LIST_CAP);
		const pinned = await tolerateBackfill(() =>
			ctx.db
				.query("conversations")
				.withIndex("by_user_pinned", (q) =>
					q.eq("userId", identity.subject).gt("pinnedAt", 0),
				)
				.order("desc")
				.take(LIST_CAP),
		);
		return mergeConversationList(pinned, recent);
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

/**
 * Resolve the workspace a conversation lives in, adopting it into the owner's
 * Default workspace when it has none (legacy /chat conversations). Owner-gated.
 * Lets the share page open an owned conversation in workspaces mode. Returns the
 * workspace id.
 */
export const ensureInWorkspace = mutation({
	args: { conversationId: v.id("conversations") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const convo = await ctx.db.get(args.conversationId);
		if (!convo || convo.userId !== identity.subject) {
			throw new Error("Not found");
		}
		if (convo.workspaceId) return convo.workspaceId;
		const workspaceId = await getOrCreateDefaultWorkspace(
			ctx,
			identity.subject,
		);
		await ctx.db.patch(args.conversationId, { workspaceId });
		// Re-stamp the conversation's messages too — the message search index
		// filters on each row's own workspaceId, so without this the adopted
		// conversation's existing messages would be invisible to a
		// workspace-scoped content search.
		const messages = await ctx.db
			.query("messages")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", args.conversationId),
			)
			// Bound the scan like fork() does — an uncapped .collect() + patch
			// fan-out on a very long conversation can blow the per-transaction
			// read/write limit and abort the whole adoption.
			.take(8192);
		await Promise.all(
			messages.map((m) => ctx.db.patch(m._id, { workspaceId })),
		);
		return workspaceId;
	},
});

export const create = mutation({
	args: {
		title: v.string(),
		harnessId: v.id("harnesses"),
		workspaceId: v.optional(v.id("workspaces")),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		const harness = await ctx.db.get(args.harnessId);
		if (!harness || harness.userId !== identity.subject) {
			throw new Error("Harness not found");
		}
		if (args.workspaceId) {
			const workspace = await ctx.db.get(args.workspaceId);
			if (!workspace || workspace.userId !== identity.subject) {
				throw new Error("Workspace not found");
			}
			if (workspace.harnessId && workspace.harnessId !== args.harnessId) {
				throw new Error("Workspace harness mismatch");
			}
		}

		return await ctx.db.insert("conversations", {
			title: args.title,
			lastHarnessId: args.harnessId,
			workspaceId: args.workspaceId,
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

/** Pin / unpin a conversation. Pinned chats sort to the top of the sidebar. */
export const setPinned = mutation({
	args: { id: v.id("conversations"), pinned: v.boolean() },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const convo = await ctx.db.get(args.id);
		if (!convo || convo.userId !== identity.subject) {
			throw new Error("Not found");
		}
		await ctx.db.patch(args.id, {
			pinnedAt: args.pinned ? Date.now() : undefined,
		});
	},
});

/**
 * Move a conversation to a workspace (or to the Default workspace when
 * `workspaceId` is omitted). Re-stamps every message's `workspaceId` too, since
 * the message search index filters per-row — without it a moved conversation's
 * messages would be invisible to a workspace-scoped search. Cross-harness moves
 * are allowed (reorganizing shouldn't be blocked by the harness-match rule).
 */
export const moveToWorkspace = mutation({
	args: {
		id: v.id("conversations"),
		workspaceId: v.optional(v.id("workspaces")),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const convo = await ctx.db.get(args.id);
		if (!convo || convo.userId !== identity.subject) {
			throw new Error("Not found");
		}

		const targetWorkspaceId =
			args.workspaceId ??
			(await getOrCreateDefaultWorkspace(ctx, identity.subject));
		const workspace = await ctx.db.get(targetWorkspaceId);
		if (!workspace || workspace.userId !== identity.subject) {
			throw new Error("Workspace not found");
		}
		if (convo.workspaceId === targetWorkspaceId) return targetWorkspaceId;

		await ctx.db.patch(args.id, { workspaceId: targetWorkspaceId });
		const messages = await ctx.db
			.query("messages")
			.withIndex("by_conversation", (q) => q.eq("conversationId", args.id))
			// Bound the scan like fork() does — an uncapped .collect() + patch
			// fan-out on a very long conversation can blow the per-transaction
			// read/write limit and abort the move.
			.take(8192);
		await Promise.all(
			messages.map((m) =>
				ctx.db.patch(m._id, { workspaceId: targetWorkspaceId }),
			),
		);
		return targetWorkspaceId;
	},
});

export const fork = mutation({
	args: {
		conversationId: v.id("conversations"),
		// Omit to fork the ENTIRE conversation (sidebar "Fork"); set to fork up to
		// and including a specific message (rewind & fork).
		upToMessageId: v.optional(v.id("messages")),
		// "Rewind & fork into the middle of an assistant message": when set, the
		// LAST copied message (must be the boundary assistant message, with
		// parts) is copied TRUNCATED to this many flat parts, with `content`
		// recomputed to match. The original conversation is untouched — a fork
		// has no live agent session, so there is nothing to reset and zero
		// desync risk, which is why fork is the safe primary for mid-message.
		truncateLastPartCount: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		const convo = await ctx.db.get(args.conversationId);
		if (!convo || convo.userId !== identity.subject)
			throw new Error("Not found");

		const allMessages = await ctx.db
			.query("messages")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", args.conversationId),
			)
			.take(8192);

		let messagesToCopy = allMessages;
		if (args.upToMessageId != null) {
			const targetIdx = allMessages.findIndex(
				(m) => m._id === args.upToMessageId,
			);
			if (targetIdx === -1)
				throw new Error("Message not found in this conversation");
			messagesToCopy = allMessages.slice(0, targetIdx + 1);
		}

		// Name the fork "X (fork)" / "X (fork N)" relative to the user's existing
		// titles. Scan only titles sharing the stripped base prefix (exact, via
		// the by_user_title index) so naming is correct even on large accounts —
		// an unordered global cap could miss recent forks.
		const base = forkBaseTitle(convo.title);
		// by_user_title is a NEW index that can be mid-backfill right after a
		// deploy — querying it would throw and break forking. On that (and only
		// that) error, fall back to a bounded by_user scan; nextForkTitle
		// regex-filters internally, so the wider result set is harmless.
		let siblings: Array<Doc<"conversations">>;
		try {
			siblings = await ctx.db
				.query("conversations")
				.withIndex("by_user_title", (q) =>
					q
						.eq("userId", identity.subject)
						.gte("title", base)
						.lt("title", `${base}${PREFIX_END}`),
				)
				.take(2000);
		} catch (e) {
			if (!(e instanceof Error) || !e.message.includes("backfilling")) throw e;
			siblings = await ctx.db
				.query("conversations")
				.withIndex("by_user", (q) => q.eq("userId", identity.subject))
				.take(2000);
		}
		const title = nextForkTitle(
			convo.title,
			siblings.map((s) => s.title),
		);

		const newConvoId = await ctx.db.insert("conversations", {
			title,
			lastHarnessId: convo.lastHarnessId,
			workspaceId: convo.workspaceId,
			userId: identity.subject,
			lastMessageAt: Date.now(),
			forkedFromConversationId: args.conversationId,
			// Message COUNT is unchanged by a mid-message truncation (the boundary
			// message is kept, just shortened), so version-sibling bookkeeping
			// stays valid.
			forkedAtMessageCount: messagesToCopy.length,
		});

		for (let i = 0; i < messagesToCopy.length; i++) {
			const msg = messagesToCopy[i];
			const { _id, _creationTime, conversationId, ...rest } = msg;
			const isLast = i === messagesToCopy.length - 1;
			if (
				isLast &&
				args.truncateLastPartCount != null &&
				msg.role === "assistant" &&
				msg.parts
			) {
				const keep = Math.floor(args.truncateLastPartCount);
				if (keep >= 1 && keep < msg.parts.length) {
					const trimmedParts = msg.parts.slice(0, keep);
					await ctx.db.insert("messages", {
						...rest,
						parts: trimmedParts,
						content: contentFromParts(trimmedParts),
						reasoning: undefined,
						toolCalls: undefined,
						conversationId: newConvoId,
						workspaceId: convo.workspaceId,
					});
					continue;
				}
			}
			await ctx.db.insert("messages", {
				...rest,
				conversationId: newConvoId,
				workspaceId: convo.workspaceId,
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
		if (!convo || convo.userId !== identity.subject)
			throw new Error("Not found");

		const allMessages = await ctx.db
			.query("messages")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", args.conversationId),
			)
			.take(8192);

		if (
			args.upToMessageCount < 0 ||
			args.upToMessageCount > allMessages.length
		) {
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
			workspaceId: convo.workspaceId,
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
				workspaceId: convo.workspaceId,
			});
		}

		// Insert the edited user message in the same transaction
		await ctx.db.insert("messages", {
			conversationId: newConvoId,
			workspaceId: convo.workspaceId,
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
			.withIndex("by_conversation", (q) => q.eq("conversationId", args.id))
			.collect();
		for (const msg of messages) {
			await ctx.db.delete(msg._id);
		}
		await ctx.db.delete(args.id);
	},
});

export const searchTitles = query({
	args: {
		query: v.string(),
		workspaceId: v.optional(v.id("workspaces")),
		paginationOpts: paginationOptsValidator,
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return { page: [], isDone: true, continueCursor: "" };
		if (args.workspaceId) {
			const workspace = await ctx.db.get(args.workspaceId);
			if (!workspace || workspace.userId !== identity.subject) {
				return { page: [], isDone: true, continueCursor: "" };
			}
		}

		return await ctx.db
			.query("conversations")
			.withSearchIndex("search_title", (q) =>
				args.workspaceId
					? q
							.search("title", args.query)
							.eq("userId", identity.subject)
							.eq("workspaceId", args.workspaceId)
					: q.search("title", args.query).eq("userId", identity.subject),
			)
			.paginate(args.paginationOpts);
	},
});

export const searchContent = query({
	args: {
		query: v.string(),
		workspaceId: v.optional(v.id("workspaces")),
		paginationOpts: paginationOptsValidator,
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return { page: [], isDone: true, continueCursor: "" };
		if (args.workspaceId) {
			const workspace = await ctx.db.get(args.workspaceId);
			if (!workspace || workspace.userId !== identity.subject) {
				return { page: [], isDone: true, continueCursor: "" };
			}
		}

		const result = await ctx.db
			.query("messages")
			.withSearchIndex("search_content", (q) =>
				args.workspaceId
					? q
							.search("content", args.query)
							.eq("userId", identity.subject)
							.eq("workspaceId", args.workspaceId)
					: q.search("content", args.query).eq("userId", identity.subject),
			)
			.paginate(args.paginationOpts);

		// Pre-fetch all referenced conversations in parallel to avoid N+1
		const uniqueConvoIds = [
			...new Set(result.page.map((m) => m.conversationId)),
		];
		const convos = await Promise.all(
			uniqueConvoIds.map((id) => ctx.db.get(id)),
		);
		const convoMap = new Map(
			convos
				.filter((c): c is NonNullable<typeof c> => c !== null)
				.map((c) => [c._id, c]),
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
			if (!convo || convo.userId !== identity.subject) continue;

			const lowerContent = msg.content.toLowerCase();
			const lowerQuery = args.query.toLowerCase();
			const matchIndex = lowerContent.indexOf(lowerQuery);

			let snippet: string;
			if (matchIndex !== -1) {
				const start = Math.max(0, matchIndex - 40);
				const end = Math.min(
					msg.content.length,
					matchIndex + args.query.length + 40,
				);
				snippet =
					(start > 0 ? "..." : "") +
					msg.content.slice(start, end) +
					(end < msg.content.length ? "..." : "");
			} else {
				snippet =
					msg.content.slice(0, 80) + (msg.content.length > 80 ? "..." : "");
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
	args: { query: v.string(), workspaceId: v.optional(v.id("workspaces")) },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return 0;
		if (args.workspaceId) {
			const workspace = await ctx.db.get(args.workspaceId);
			if (!workspace || workspace.userId !== identity.subject) return 0;
		}

		const results = await ctx.db
			.query("conversations")
			.withSearchIndex("search_title", (q) =>
				args.workspaceId
					? q
							.search("title", args.query)
							.eq("userId", identity.subject)
							.eq("workspaceId", args.workspaceId)
					: q.search("title", args.query).eq("userId", identity.subject),
			)
			.collect();
		return results.length;
	},
});

export const searchContentCount = query({
	args: { query: v.string(), workspaceId: v.optional(v.id("workspaces")) },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return 0;
		if (args.workspaceId) {
			const workspace = await ctx.db.get(args.workspaceId);
			if (!workspace || workspace.userId !== identity.subject) return 0;
		}

		// Filter at the index level using userId, cap to avoid read limits
		const results = await ctx.db
			.query("messages")
			.withSearchIndex("search_content", (q) =>
				args.workspaceId
					? q
							.search("content", args.query)
							.eq("userId", identity.subject)
							.eq("workspaceId", args.workspaceId)
					: q.search("content", args.query).eq("userId", identity.subject),
			)
			.take(1000);

		return results.length;
	},
});
