import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalQuery, mutation, query } from "./_generated/server";
import { getOrCreateDefaultWorkspace } from "./workspaces";

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
		// Author attribution for collaborator-sent messages (name + avatar only,
		// never email/userId). Absent on the owner's own messages.
		authorName: msg.authorName,
		authorImageUrl: msg.authorImageUrl,
	};
}

// ── Phase 2: editor-grant collaboration authorization ───────────────────

export type ConversationRole = "owner" | "editor" | "viewer" | "none";

/**
 * Resolve a (user, conversation) pair to a role. Honors the link-first model
 * (a signed-in holder of an active editor public token for THIS conversation
 * is an editor) and per-user grants. Authorization for collaboration is ALWAYS
 * decided here through an active grant — never by trusting a denormalized field
 * on the conversation/message. `token` is the share link the caller arrived
 * through, when any.
 */
export async function resolveConversationRole(
	ctx: QueryCtx | MutationCtx,
	userId: string,
	conversationId: Id<"conversations">,
	token?: string,
): Promise<ConversationRole> {
	const convo = await ctx.db.get(conversationId);
	if (!convo) return "none";
	if (convo.userId === userId) return "owner";

	let best: "viewer" | "none" = "none";

	// A token only grants anything if it resolves to an active grant on THIS
	// conversation (a token for another conversation confers nothing here).
	if (token) {
		const grant = await grantForToken(ctx, token);
		if (grant && grant.conversationId === conversationId) {
			if (grant.role === "editor") return "editor";
			best = "viewer";
		}
	}

	// Per-user grants addressed directly to this user.
	const grants = await ctx.db
		.query("shareGrants")
		.withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
		.collect();
	for (const g of grants) {
		if (!isActiveGrant(g)) continue;
		if (g.grantedToUserId !== userId) continue;
		if (g.role === "editor") return "editor";
		best = "viewer";
	}
	return best;
}

/**
 * Deploy-key-only access oracle for the FastAPI backend. Returns the caller's
 * role for a conversation so the backend can authorize a chat/agent run BEFORE
 * any write or spend. internalQuery (never public) — exactly like
 * sandboxes.getOwnerByDaytonaId — so clients can never enumerate access for
 * arbitrary userIds.
 */
export const checkConversationAccess = internalQuery({
	args: {
		conversationId: v.id("conversations"),
		userId: v.string(),
		token: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<ConversationRole> =>
		resolveConversationRole(ctx, args.userId, args.conversationId, args.token),
});

/**
 * Authorize an authenticated mutation to WRITE to a conversation: the owner,
 * or an active editor grant (link or per-user). Throws the same opaque "Not
 * found" used everywhere else for viewers / expired / revoked / none, so a
 * caller can never tell whether a conversation exists. Returns the conversation
 * so the caller can reuse it.
 */
export async function authorizeConversationWrite(
	ctx: MutationCtx,
	userId: string,
	conversationId: Id<"conversations">,
	token?: string,
): Promise<Doc<"conversations">> {
	const role = await resolveConversationRole(
		ctx,
		userId,
		conversationId,
		token,
	);
	if (role !== "owner" && role !== "editor") {
		throw new Error("Not found");
	}
	const convo = await ctx.db.get(conversationId);
	if (!convo) throw new Error("Not found");
	return convo;
}

// Mirror the FastAPI USER_MESSAGE_MAX_LENGTH so an editor-grant collaborator
// can't write an oversized message straight to Convex (the FastAPI cap only
// gates the model turn, not this persistence path).
export const MAX_MESSAGE_CONTENT_CHARS = 16000;

// Avatar URLs are rendered as <img src> to every viewer of a shared chat, so an
// arbitrary host would be a tracking-pixel beacon. Restrict to the hosts our
// auth provider actually serves avatars from (Clerk proxies OAuth avatars
// through img.clerk.com). A disallowed/garbage URL just falls back to initials.
const ALLOWED_AVATAR_HOSTS = new Set([
	"img.clerk.com",
	"images.clerk.dev",
	"www.gravatar.com",
]);

// A client-supplied author/owner snapshot is untrusted, so clamp the name and
// accept only an https avatar URL on a known host. Name + avatar ONLY — never
// email (locked product decision).
function clampAuthorName(name?: string): string | undefined {
	if (!name) return undefined;
	const trimmed = name.trim().slice(0, 80);
	return trimmed || undefined;
}
function clampAuthorImageUrl(url?: string): string | undefined {
	if (!url || url.length > 2048) return undefined;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}
	if (parsed.protocol !== "https:") return undefined;
	if (!ALLOWED_AVATAR_HOSTS.has(parsed.hostname)) return undefined;
	return url;
}

/**
 * Collaborator (editor grant) sends a user message into someone else's shared
 * conversation. Authenticated; authorization is the active editor grant for
 * `token`. The message is attributed to the SENDER (userId = identity.subject)
 * with a client-captured name/avatar snapshot. Mirrors `messages.send` but
 * gated by the grant rather than ownership. The owner's own sends keep using
 * `messages.send`; this path is exclusively for collaborators.
 */
export const sendShared = mutation({
	args: {
		token: v.string(),
		conversationId: v.id("conversations"),
		content: v.string(),
		authorName: v.optional(v.string()),
		authorImageUrl: v.optional(v.string()),
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
		const convo = await authorizeConversationWrite(
			ctx,
			identity.subject,
			args.conversationId,
			args.token,
		);
		const id = await ctx.db.insert("messages", {
			conversationId: args.conversationId,
			workspaceId: convo.workspaceId,
			userId: identity.subject,
			...(clampAuthorName(args.authorName)
				? { authorName: clampAuthorName(args.authorName) }
				: {}),
			...(clampAuthorImageUrl(args.authorImageUrl)
				? { authorImageUrl: clampAuthorImageUrl(args.authorImageUrl) }
				: {}),
			role: "user",
			content: args.content,
			...(args.attachments && args.attachments.length > 0
				? { attachments: args.attachments }
				: {}),
		});
		await ctx.db.patch(args.conversationId, { lastMessageAt: Date.now() });
		return id;
	},
});

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
		// Owner's public profile (name + avatar only) for author attribution,
		// captured client-side from Clerk. Refreshed on each call so it stays
		// current.
		ownerName: v.optional(v.string()),
		ownerImageUrl: v.optional(v.string()),
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
			// Keep the owner profile snapshot fresh on re-open.
			await ctx.db.patch(activeLink._id, {
				ownerName: clampAuthorName(args.ownerName),
				ownerImageUrl: clampAuthorImageUrl(args.ownerImageUrl),
			});
			return {
				token: activeLink.publicToken as string,
				role: activeLink.role,
				grantId: activeLink._id,
			};
		}

		const grantId = await ctx.db.insert("shareGrants", {
			conversationId: args.conversationId,
			ownerUserId: convo.userId,
			ownerName: clampAuthorName(args.ownerName),
			ownerImageUrl: clampAuthorImageUrl(args.ownerImageUrl),
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
		ownerName: v.optional(v.string()),
		ownerImageUrl: v.optional(v.string()),
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
			ownerName: clampAuthorName(args.ownerName),
			ownerImageUrl: clampAuthorImageUrl(args.ownerImageUrl),
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
		return grants.filter(isActiveGrant).map((g) => ({
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
		// Reading identity here is fine — it's optional (null for anonymous),
		// so this stays a public query. viewerIsOwner lets the UI send the
		// owner to their own editable chat instead of the read-only view.
		const identity = await ctx.auth.getUserIdentity();
		// Surface the agent loop the conversation's current harness runs on so an
		// editor's composer picks the default-loop vs ACP-agent send path. Just
		// the agent id (a non-secret label) — no harness internals leak.
		let agent: string | null = null;
		let sandboxId: string | null = null;
		if (convo.lastHarnessId) {
			const harness = await ctx.db.get(convo.lastHarnessId);
			agent = harness?.agent ?? "default";
			// The owner's Daytona sandbox id, ONLY for a signed-in editor (so the
			// read-only file panel can name it in its URL path). It's not a
			// capability — every sandbox route independently re-gates ownership /
			// the editor grant — but expose it minimally regardless. NEVER the MCP
			// authToken / agentCredentialId, which stay server-side.
			if (
				identity != null &&
				grant.role === "editor" &&
				harness?.daytonaSandboxId
			) {
				sandboxId = harness.daytonaSandboxId;
			}
		}
		const viewerIsOwner =
			identity != null && convo.userId === identity.subject;
		return {
			conversationId: convo._id,
			title: convo.title,
			role: grant.role,
			viewerIsOwner,
			// Author attribution (name + avatar only — never email).
			ownerName: grant.ownerName ?? null,
			ownerImageUrl: grant.ownerImageUrl ?? null,
			// "default" | "claude-code" | "codex" | ... | null (no harness yet).
			agent,
			// Owner's Daytona sandbox id for the read-only file panel (signed-in
			// editor only; null otherwise).
			sandboxId,
			// The conversation's workspace — only for the OWNER (their own convo),
			// so the share page can route them to it in workspaces mode. null when
			// the legacy convo has no workspace yet (the page adopts it into Default).
			workspaceId: viewerIsOwner ? (convo.workspaceId ?? null) : null,
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
		// Which of the FORKER's workspaces to fork into (the sharee picks). When
		// omitted, lands in their Default workspace so the fork always has a home.
		workspaceId: v.optional(v.id("workspaces")),
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

		// Resolve the target workspace: the forker's chosen one (must be theirs),
		// else their Default. The copy always lands in a workspace they own.
		let workspaceId = args.workspaceId;
		if (workspaceId) {
			const workspace = await ctx.db.get(workspaceId);
			if (!workspace || workspace.userId !== identity.subject) {
				throw new Error("Workspace not found");
			}
		} else {
			workspaceId = await getOrCreateDefaultWorkspace(ctx, identity.subject);
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
			workspaceId,
			lastMessageAt: Date.now(),
			forkedFromConversationId: grant.conversationId,
			forkedAtMessageCount: messagesToCopy.length,
			// Remember the share link so "jump to original" can return the forker
			// to the SHARED page (they don't own the original — navigating to it in
			// /chat would show an empty owner-gated conversation). Only public-link
			// grants carry a token; per-user grants don't.
			...(grant.publicToken
				? { forkedFromShareToken: grant.publicToken }
				: {}),
		});

		for (const msg of messagesToCopy) {
			// Drop the source owner's per-message token/cost accounting (`usage`)
			// and workspace placement; re-stamp ownership + workspace to the forker
			// so the copy is consistently theirs (search index filters on
			// userId/workspaceId).
			const {
				_id,
				_creationTime,
				conversationId,
				workspaceId: _srcWorkspaceId,
				usage,
				...rest
			} = msg;
			await ctx.db.insert("messages", {
				...rest,
				userId: identity.subject,
				workspaceId,
				conversationId: newConvoId,
			});
		}

		return newConvoId;
	},
});
