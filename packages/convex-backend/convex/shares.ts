import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";

/**
 * Conversation sharing.
 *
 * Phase 1 (this file): public copyable links + read-only viewing (anonymous
 * or authenticated) + owner permission management (create / rotate / revoke /
 * set-role) + fork-a-shared-chat-into-your-own-account.
 *
 * Security model:
 *   - Access to a shared conversation is ALWAYS decided by an active
 *     `shareGrants` row — never by trusting a field on the conversation or
 *     message. A grant is active when not revoked and not expired.
 *   - The public link secret is a high-entropy client-generated token looked
 *     up via the `by_token` index (the Convex _id is never the secret).
 *   - Public (no-identity) queries return only public-safe message fields and
 *     a neutral `null`/`[]` for an invalid/expired/revoked token (so they
 *     never leak whether a conversation exists).
 *   - Mint / rotate / revoke / set-role / list are owner-gated with the same
 *     `convo.userId !== identity.subject` pattern used everywhere else.
 */

// A client-generated 256-bit token (base64url of 32 bytes ≈ 43 chars). We
// require a healthy minimum so a caller can't pass a guessable short string.
const MIN_TOKEN_LENGTH = 32;

function isActiveGrant(grant: Doc<"shareGrants">): boolean {
	if (grant.revokedAt) return false;
	if (grant.expiresAt && grant.expiresAt <= Date.now()) return false;
	return true;
}

/** Resolve the active grant for a public token, or null. */
async function grantForToken(
	ctx: QueryCtx,
	token: string,
): Promise<Doc<"shareGrants"> | null> {
	if (!token) return null;
	const grant = await ctx.db
		.query("shareGrants")
		.withIndex("by_token", (q) => q.eq("publicToken", token))
		.unique();
	if (!grant || !isActiveGrant(grant)) return null;
	return grant;
}

/** Load a conversation and assert the caller is its owner. Mirrors the
 *  `assertOwnedWorkspace` helper in workspaces.ts. */
async function assertOwnedConversation(
	ctx: MutationCtx | QueryCtx,
	conversationId: Id<"conversations">,
): Promise<Doc<"conversations">> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new Error("Unauthenticated");
	const convo = await ctx.db.get(conversationId);
	if (!convo || convo.userId !== identity.subject) {
		throw new Error("Not found");
	}
	return convo;
}

/** Public-safe projection of a stored message. Per product decision shared
 *  links show the FULL transcript (text + reasoning + tool calls), but never
 *  the owner-private/system fields (userId, workspaceId, usage/cost). */
function publicMessage(msg: Doc<"messages">) {
	return {
		_id: msg._id,
		_creationTime: msg._creationTime,
		role: msg.role,
		content: msg.content,
		reasoning: msg.reasoning,
		toolCalls: msg.toolCalls,
		parts: msg.parts,
		model: msg.model,
		interrupted: msg.interrupted,
		interruptionReason: msg.interruptionReason,
		attachments: msg.attachments,
	};
}

// ── Owner: manage shares ───────────────────────────────────────────────

/**
 * Create the conversation's public link, or return the existing active one.
 * The caller generates the token (CSPRNG in the browser) and passes it in —
 * Convex handlers have no native CSPRNG. Idempotent: a conversation has at
 * most one active public link.
 */
export const ensurePublicLink = mutation({
	args: {
		conversationId: v.id("conversations"),
		role: v.union(v.literal("viewer"), v.literal("editor")),
		token: v.string(),
	},
	handler: async (ctx, args) => {
		const convo = await assertOwnedConversation(ctx, args.conversationId);
		if (args.token.length < MIN_TOKEN_LENGTH) {
			throw new Error("Share token too short");
		}

		const existing = await ctx.db
			.query("shareGrants")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", args.conversationId),
			)
			.collect();
		const activeLink = existing.find(
			(g) => g.publicToken !== undefined && isActiveGrant(g),
		);
		if (activeLink) {
			return {
				token: activeLink.publicToken as string,
				role: activeLink.role,
				grantId: activeLink._id,
			};
		}

		const grantId = await ctx.db.insert("shareGrants", {
			conversationId: args.conversationId,
			ownerUserId: convo.userId,
			role: args.role,
			publicToken: args.token,
			createdAt: Date.now(),
		});
		return { token: args.token, role: args.role, grantId };
	},
});

/** Change a grant's role (viewer ↔ editor). Owner-gated via the grant's convo. */
export const setShareRole = mutation({
	args: {
		grantId: v.id("shareGrants"),
		role: v.union(v.literal("viewer"), v.literal("editor")),
	},
	handler: async (ctx, args) => {
		const grant = await ctx.db.get(args.grantId);
		if (!grant) throw new Error("Not found");
		await assertOwnedConversation(ctx, grant.conversationId);
		await ctx.db.patch(args.grantId, { role: args.role });
	},
});

/**
 * Invalidate the current public link and mint a fresh one (for when a link
 * leaked). Deletes any existing public-link grants for the conversation and
 * inserts a new one with the caller-supplied token.
 */
export const rotatePublicLink = mutation({
	args: {
		conversationId: v.id("conversations"),
		token: v.string(),
		role: v.optional(v.union(v.literal("viewer"), v.literal("editor"))),
	},
	handler: async (ctx, args) => {
		const convo = await assertOwnedConversation(ctx, args.conversationId);
		if (args.token.length < MIN_TOKEN_LENGTH) {
			throw new Error("Share token too short");
		}
		const existing = await ctx.db
			.query("shareGrants")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", args.conversationId),
			)
			.collect();
		let role: "viewer" | "editor" = args.role ?? "viewer";
		for (const g of existing) {
			if (g.publicToken !== undefined) {
				if (args.role === undefined) role = g.role;
				await ctx.db.delete(g._id);
			}
		}
		await ctx.db.insert("shareGrants", {
			conversationId: args.conversationId,
			ownerUserId: convo.userId,
			role,
			publicToken: args.token,
			createdAt: Date.now(),
		});
		return { token: args.token, role };
	},
});

/** Revoke a single grant (public link or per-user). Owner-gated. */
export const revokeShareGrant = mutation({
	args: { grantId: v.id("shareGrants") },
	handler: async (ctx, args) => {
		const grant = await ctx.db.get(args.grantId);
		if (!grant) return; // already gone — idempotent
		await assertOwnedConversation(ctx, grant.conversationId);
		await ctx.db.delete(args.grantId);
	},
});

/** Stop sharing entirely: delete every grant on the conversation. */
export const unshareConversation = mutation({
	args: { conversationId: v.id("conversations") },
	handler: async (ctx, args) => {
		await assertOwnedConversation(ctx, args.conversationId);
		const grants = await ctx.db
			.query("shareGrants")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", args.conversationId),
			)
			.collect();
		for (const g of grants) {
			await ctx.db.delete(g._id);
		}
	},
});

/** All grants on a conversation, for the owner's manage-permissions panel. */
export const listShareGrants = query({
	args: { conversationId: v.id("conversations") },
	handler: async (ctx, args) => {
		// Returns [] (not throw) for non-owners so the manage panel simply
		// shows nothing rather than erroring.
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		const convo = await ctx.db.get(args.conversationId);
		if (!convo || convo.userId !== identity.subject) return [];
		const grants = await ctx.db
			.query("shareGrants")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", args.conversationId),
			)
			.collect();
		return grants
			.filter(isActiveGrant)
			.map((g) => ({
				_id: g._id,
				role: g.role,
				publicToken: g.publicToken ?? null,
				grantedToUserId: g.grantedToUserId ?? null,
				createdAt: g.createdAt,
				lastAccessedAt: g.lastAccessedAt ?? null,
			}));
	},
});

// ── Public: anonymous / shared viewing (NO identity gate) ───────────────

/**
 * Resolve a share token to the minimal conversation header. Returns null for
 * any invalid/expired/revoked token (neutral — never reveals existence).
 * Safe for logged-out callers: never reads identity.
 */
export const getSharedConversation = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const grant = await grantForToken(ctx, args.token);
		if (!grant) return null;
		const convo = await ctx.db.get(grant.conversationId);
		if (!convo) return null;
		return {
			conversationId: convo._id,
			title: convo.title,
			role: grant.role,
		};
	},
});

/**
 * The shared conversation's transcript, public-safe projection. Reactive, so
 * the shared view updates live as the owner continues and flips to [] when
 * the link is revoked. Safe for logged-out callers.
 */
export const listSharedMessages = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const grant = await grantForToken(ctx, args.token);
		if (!grant) return [];
		const messages = await ctx.db
			.query("messages")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", grant.conversationId),
			)
			.collect();
		return messages.map(publicMessage);
	},
});

/**
 * Resolve a signed URL for an attachment in a shared conversation. Guarded:
 * the storageId must actually belong to a message in the token's
 * conversation, so a token can't be used to read arbitrary storage.
 */
export const getSharedFileUrl = query({
	args: { token: v.string(), storageId: v.id("_storage") },
	handler: async (ctx, args) => {
		const grant = await grantForToken(ctx, args.token);
		if (!grant) return null;
		const messages = await ctx.db
			.query("messages")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", grant.conversationId),
			)
			.collect();
		const belongs = messages.some((m) =>
			(m.attachments ?? []).some((a) => a.storageId === args.storageId),
		);
		if (!belongs) return null;
		return await ctx.storage.getUrl(args.storageId);
	},
});

// ── Authenticated: fork a shared chat into your own account ─────────────

/**
 * Copy a token-shared conversation into the caller's own account as a brand
 * new owned conversation (optionally up to a specific message). The copy is
 * cleanly owned by the caller; message rows are re-stamped with the caller's
 * userId so search/attribution stay consistent. `harnessId` (the forker's own
 * harness) is validated as theirs when provided; otherwise the new chat has
 * no harness set and the chat UI will prompt to pick one.
 */
export const forkSharedConversation = mutation({
	args: {
		token: v.string(),
		upToMessageId: v.optional(v.id("messages")),
		harnessId: v.optional(v.id("harnesses")),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		const grant = await grantForToken(ctx, args.token);
		if (!grant) throw new Error("This shared chat is no longer available");
		const source = await ctx.db.get(grant.conversationId);
		if (!source) throw new Error("This shared chat is no longer available");

		if (args.harnessId) {
			const harness = await ctx.db.get(args.harnessId);
			if (!harness || harness.userId !== identity.subject) {
				throw new Error("Harness not found");
			}
		}

		const allMessages = await ctx.db
			.query("messages")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", grant.conversationId),
			)
			.take(8192);

		let messagesToCopy = allMessages;
		if (args.upToMessageId) {
			const idx = allMessages.findIndex((m) => m._id === args.upToMessageId);
			if (idx === -1) throw new Error("Message not found in this conversation");
			messagesToCopy = allMessages.slice(0, idx + 1);
		}

		const newConvoId = await ctx.db.insert("conversations", {
			title: source.title,
			lastHarnessId: args.harnessId,
			userId: identity.subject,
			lastMessageAt: Date.now(),
			forkedFromConversationId: grant.conversationId,
			forkedAtMessageCount: messagesToCopy.length,
		});

		for (const msg of messagesToCopy) {
			// Drop the source owner's per-message token/cost accounting (`usage`)
			// and workspace placement; re-stamp ownership to the forker so the
			// copy is consistently theirs (the search index filters on userId).
			const { _id, _creationTime, conversationId, workspaceId, usage, ...rest } =
				msg;
			await ctx.db.insert("messages", {
				...rest,
				userId: identity.subject,
				conversationId: newConvoId,
			});
		}

		return newConvoId;
	},
});
