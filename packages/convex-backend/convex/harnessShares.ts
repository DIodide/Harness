import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
	type MutationCtx,
	type QueryCtx,
	internalMutation,
	mutation,
	query,
} from "./_generated/server";
import { assertSystemPromptLength } from "./harnesses";
import {
	ALLOWED_AVATAR_HOSTS,
	MIN_TOKEN_LENGTH,
	clampAuthorImageUrl,
	clampAuthorName,
	isActiveGrant,
} from "./shares";

// re-export so a reader of this module sees the shared allowlist origin.
export { ALLOWED_AVATAR_HOSTS };

/**
 * Harness sharing. Mirrors conversation sharing (`shares.ts`) 1:1, for
 * harnesses:
 *   - public copyable link, OR an email invite (bound on first verified
 *     sign-in), OR a bound per-user grant.
 *   - a chromeless public VIEW of a REDACTED harness config (no secrets), and
 *     "Clone to my harnesses" into the recipient's own account.
 *   - an optional LOCK (owner) that prevents editor-recipients from editing the
 *     harness in place (clone is always allowed).
 *
 * Security model (identical to shares.ts):
 *   - Access is ALWAYS decided by an ACTIVE `harnessShareGrants` row — never by
 *     a denormalized field. Active = not revoked and not expired.
 *   - The browser NEVER sees a harness secret. `publicHarnessProjection` is the
 *     single browser-facing boundary and redacts mcpServers[].authToken /
 *     mcpServers[].url / agentCredentialId / sandbox ids / ownerUserId. The
 *     ONLY function returning the unredacted harness is an internalQuery
 *     (deploy-key only) — not in this file (it ships with the live-run feature).
 *   - `granteeEmail` is an INVITE POINTER, never an authorization key: it is
 *     bound to a `grantedToUserId` only after the recipient's email is
 *     server-verified (FastAPI /api/harness-shares/claim → bindHarnessGrantsInternal).
 */

type HarnessRole = "owner" | "editor" | "viewer" | "none";

/** Resolve the active grant for a public token, or null (never leaks existence). */
async function harnessGrantForToken(
	ctx: QueryCtx,
	token: string,
): Promise<Doc<"harnessShareGrants"> | null> {
	if (!token) return null;
	const grant = await ctx.db
		.query("harnessShareGrants")
		.withIndex("by_token", (q) => q.eq("publicToken", token))
		.unique();
	if (!grant || !isActiveGrant(grant)) return null;
	return grant;
}

/** Load a harness and assert the caller owns it (opaque "Not found" otherwise). */
async function assertOwnedHarness(
	ctx: MutationCtx | QueryCtx,
	harnessId: Id<"harnesses">,
): Promise<Doc<"harnesses">> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new Error("Unauthenticated");
	const harness = await ctx.db.get(harnessId);
	if (!harness || harness.userId !== identity.subject) {
		throw new Error("Not found");
	}
	return harness;
}

/**
 * The caller's role on a harness — owner / editor / viewer / none. Mirrors
 * resolveConversationRole: owner wins; then a public token on THIS harness
 * (link-first); then a bound per-user grant. Authorization NEVER trusts a
 * denormalized field — always an active grant.
 */
async function resolveHarnessRole(
	ctx: QueryCtx,
	userId: string | null,
	harnessId: Id<"harnesses">,
	token?: string,
): Promise<HarnessRole> {
	const harness = await ctx.db.get(harnessId);
	if (!harness) return "none";
	if (userId && harness.userId === userId) return "owner";

	let best: HarnessRole = "none";
	if (token) {
		const grant = await harnessGrantForToken(ctx, token);
		if (grant && grant.harnessId === harnessId) {
			if (grant.role === "editor") return "editor";
			best = "viewer";
		}
	}
	if (userId) {
		const grants = await ctx.db
			.query("harnessShareGrants")
			.withIndex("by_harness", (q) => q.eq("harnessId", harnessId))
			.collect();
		for (const g of grants) {
			if (!isActiveGrant(g) || g.grantedToUserId !== userId) continue;
			if (g.role === "editor") return "editor";
			best = "viewer";
		}
	}
	return best;
}

/**
 * The SINGLE browser-facing redacted projection of a shared harness. Mirrors
 * getSharedConversation's discipline (NOT resolveForCollab). Returns ONLY the
 * allowlist below — a test asserts no secret key is present.
 */
function publicHarnessProjection(harness: Doc<"harnesses">) {
	return {
		name: harness.name,
		model: harness.model,
		agent: harness.agent ?? "default",
		agentMode: harness.agentMode ?? null,
		reasoningEffort: harness.reasoningEffort ?? null,
		skills: harness.skills.map((s) => ({
			name: s.name,
			description: s.description,
		})),
		systemPrompt: harness.systemPrompt ?? null,
		suggestedPrompts: harness.suggestedPrompts ?? null,
		sandboxEnabled: harness.sandboxEnabled === true,
		// NAME + authType + a "needs auth" flag ONLY — never the url or authToken.
		mcpServers: harness.mcpServers.map((m) => ({
			name: m.name,
			authType: m.authType,
			hasAuth: Boolean(m.authToken),
		})),
		locked: harness.sharedLocked === true,
	};
}

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Owner: link / invite / role / lock management ───────────────────────

/** Create (idempotent) the single active public link for a harness. */
export const ensureHarnessPublicLink = mutation({
	args: {
		harnessId: v.id("harnesses"),
		role: v.union(v.literal("viewer"), v.literal("editor")),
		token: v.string(),
		ownerName: v.optional(v.string()),
		ownerImageUrl: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const harness = await assertOwnedHarness(ctx, args.harnessId);
		if (args.token.length < MIN_TOKEN_LENGTH) {
			throw new Error("Share token too short");
		}
		const existing = await ctx.db
			.query("harnessShareGrants")
			.withIndex("by_harness", (q) => q.eq("harnessId", args.harnessId))
			.collect();
		const activeLink = existing.find(
			(g) => g.publicToken !== undefined && isActiveGrant(g),
		);
		if (activeLink) {
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
		const grantId = await ctx.db.insert("harnessShareGrants", {
			harnessId: args.harnessId,
			ownerUserId: harness.userId,
			ownerName: clampAuthorName(args.ownerName),
			ownerImageUrl: clampAuthorImageUrl(args.ownerImageUrl),
			role: args.role,
			publicToken: args.token,
			createdAt: Date.now(),
		});
		return { token: args.token, role: args.role, grantId };
	},
});

/** Invite a specific email (bind-later). Accepts any address. */
export const inviteHarnessByEmail = mutation({
	args: {
		harnessId: v.id("harnesses"),
		email: v.string(),
		role: v.union(v.literal("viewer"), v.literal("editor")),
		ownerName: v.optional(v.string()),
		ownerImageUrl: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const harness = await assertOwnedHarness(ctx, args.harnessId);
		const email = normalizeEmail(args.email);
		if (!EMAIL_RE.test(email)) throw new Error("Enter a valid email address");
		// Re-use an existing active invite for this email on this harness (an
		// owner self-invite is harmlessly dropped at bind time).
		const existing = await ctx.db
			.query("harnessShareGrants")
			.withIndex("by_harness", (q) => q.eq("harnessId", args.harnessId))
			.collect();
		const dupe = existing.find(
			(g) => isActiveGrant(g) && g.granteeEmail === email,
		);
		if (dupe) {
			await ctx.db.patch(dupe._id, {
				role: args.role,
				ownerName: clampAuthorName(args.ownerName),
				ownerImageUrl: clampAuthorImageUrl(args.ownerImageUrl),
			});
			return { grantId: dupe._id };
		}
		const grantId = await ctx.db.insert("harnessShareGrants", {
			harnessId: args.harnessId,
			ownerUserId: harness.userId,
			ownerName: clampAuthorName(args.ownerName),
			ownerImageUrl: clampAuthorImageUrl(args.ownerImageUrl),
			role: args.role,
			granteeEmail: email,
			createdAt: Date.now(),
		});
		return { grantId };
	},
});

/** Change a grant's role (viewer ↔ editor). Owner-gated via the grant's harness. */
export const setHarnessShareRole = mutation({
	args: {
		grantId: v.id("harnessShareGrants"),
		role: v.union(v.literal("viewer"), v.literal("editor")),
	},
	handler: async (ctx, args) => {
		const grant = await ctx.db.get(args.grantId);
		if (!grant) throw new Error("Not found");
		await assertOwnedHarness(ctx, grant.harnessId);
		await ctx.db.patch(args.grantId, { role: args.role });
	},
});

/** Lock/unlock the harness (owner). Single source of truth for the lock. */
export const setHarnessLock = mutation({
	args: { harnessId: v.id("harnesses"), locked: v.boolean() },
	handler: async (ctx, args) => {
		await assertOwnedHarness(ctx, args.harnessId);
		await ctx.db.patch(args.harnessId, { sharedLocked: args.locked });
	},
});

/** Rotate the public link (mint fresh, delete old public-token grants). */
export const rotateHarnessPublicLink = mutation({
	args: {
		harnessId: v.id("harnesses"),
		token: v.string(),
		role: v.optional(v.union(v.literal("viewer"), v.literal("editor"))),
		ownerName: v.optional(v.string()),
		ownerImageUrl: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const harness = await assertOwnedHarness(ctx, args.harnessId);
		if (args.token.length < MIN_TOKEN_LENGTH) {
			throw new Error("Share token too short");
		}
		const existing = await ctx.db
			.query("harnessShareGrants")
			.withIndex("by_harness", (q) => q.eq("harnessId", args.harnessId))
			.collect();
		let role: "viewer" | "editor" = args.role ?? "viewer";
		for (const g of existing) {
			if (g.publicToken !== undefined) {
				if (args.role === undefined) role = g.role;
				await ctx.db.delete(g._id);
			}
		}
		await ctx.db.insert("harnessShareGrants", {
			harnessId: args.harnessId,
			ownerUserId: harness.userId,
			ownerName: clampAuthorName(args.ownerName),
			ownerImageUrl: clampAuthorImageUrl(args.ownerImageUrl),
			role,
			publicToken: args.token,
			createdAt: Date.now(),
		});
		return { token: args.token, role };
	},
});

/** Revoke a single grant (public link, invite, or bound user). Idempotent. */
export const revokeHarnessShareGrant = mutation({
	args: { grantId: v.id("harnessShareGrants") },
	handler: async (ctx, args) => {
		const grant = await ctx.db.get(args.grantId);
		if (!grant) return; // already gone — idempotent
		await assertOwnedHarness(ctx, grant.harnessId);
		await ctx.db.delete(args.grantId);
	},
});

/** Stop sharing entirely: delete every grant on the harness, and clear the
 *  lock so a later re-share doesn't silently start locked. */
export const unshareHarness = mutation({
	args: { harnessId: v.id("harnesses") },
	handler: async (ctx, args) => {
		await assertOwnedHarness(ctx, args.harnessId);
		const grants = await ctx.db
			.query("harnessShareGrants")
			.withIndex("by_harness", (q) => q.eq("harnessId", args.harnessId))
			.collect();
		for (const g of grants) await ctx.db.delete(g._id);
		await ctx.db.patch(args.harnessId, { sharedLocked: undefined });
	},
});

// ── Owner: listings ─────────────────────────────────────────────────────

/** All active grants on a harness + the lock flag (owner's manage panel). */
export const listHarnessShareGrants = query({
	args: { harnessId: v.id("harnesses") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const harness = await ctx.db.get(args.harnessId);
		if (!harness || harness.userId !== identity.subject) return null;
		const grants = await ctx.db
			.query("harnessShareGrants")
			.withIndex("by_harness", (q) => q.eq("harnessId", args.harnessId))
			.collect();
		return {
			locked: harness.sharedLocked === true,
			grants: grants.filter(isActiveGrant).map((g) => ({
				_id: g._id,
				role: g.role,
				publicToken: g.publicToken ?? null,
				grantedToUserId: g.grantedToUserId ?? null,
				granteeEmail: g.granteeEmail ?? null,
				createdAt: g.createdAt,
				lastAccessedAt: g.lastAccessedAt ?? null,
			})),
		};
	},
});

/** Every harness the current user has shared, grouped (Manage Sharing). */
export const listMySharedHarnesses = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		let grants: Doc<"harnessShareGrants">[];
		try {
			grants = await ctx.db
				.query("harnessShareGrants")
				.withIndex("by_owner", (q) => q.eq("ownerUserId", identity.subject))
				.collect();
		} catch (e) {
			if (e instanceof Error && e.message.includes("backfilling")) return [];
			throw e;
		}
		const byHarness = new Map<
			string,
			{
				harnessId: Id<"harnesses">;
				name: string;
				locked: boolean;
				recipients: {
					_id: Id<"harnessShareGrants">;
					role: "viewer" | "editor";
					kind: "link" | "email" | "user";
					label: string | null;
					createdAt: number;
				}[];
			}
		>();
		for (const g of grants.filter(isActiveGrant)) {
			const key = g.harnessId as string;
			let entry = byHarness.get(key);
			if (!entry) {
				const harness = await ctx.db.get(g.harnessId);
				if (!harness || harness.userId !== identity.subject) continue;
				entry = {
					harnessId: g.harnessId,
					name: harness.name,
					locked: harness.sharedLocked === true,
					recipients: [],
				};
				byHarness.set(key, entry);
			}
			entry.recipients.push({
				_id: g._id,
				role: g.role,
				kind: g.publicToken ? "link" : g.granteeEmail ? "email" : "user",
				label: g.granteeEmail ?? null,
				createdAt: g.createdAt,
			});
		}
		return [...byHarness.values()];
	},
});

// ── Public / recipient: viewing, incoming, clone ────────────────────────

/**
 * Resolve a share token to the REDACTED harness header. null for any
 * invalid/expired/revoked token (neutral). Safe for logged-out callers
 * (identity is optional → query stays public).
 */
export const getSharedHarness = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const grant = await harnessGrantForToken(ctx, args.token);
		if (!grant) return null;
		const harness = await ctx.db.get(grant.harnessId);
		if (!harness) return null;
		const identity = await ctx.auth.getUserIdentity();
		const viewerIsOwner =
			identity != null && harness.userId === identity.subject;
		return {
			harnessId: harness._id,
			...publicHarnessProjection(harness),
			role: grant.role,
			viewerIsOwner,
			ownerName: grant.ownerName ?? null,
			ownerImageUrl: grant.ownerImageUrl ?? null,
		};
	},
});

/**
 * Harnesses shared TO the current user (bound per-user grants). Drives the
 * "Shared Harnesses" section on /harnesses. Redacted; carries the grantId so
 * the UI can clone/edit without a token.
 */
export const listIncomingSharedHarnesses = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		let grants: Doc<"harnessShareGrants">[];
		try {
			grants = await ctx.db
				.query("harnessShareGrants")
				.withIndex("by_grantee", (q) =>
					q.eq("grantedToUserId", identity.subject),
				)
				.collect();
		} catch (e) {
			if (e instanceof Error && e.message.includes("backfilling")) return [];
			throw e;
		}
		const out: Array<
			ReturnType<typeof publicHarnessProjection> & {
				harnessId: Id<"harnesses">;
				grantId: Id<"harnessShareGrants">;
				role: "viewer" | "editor";
				ownerName: string | null;
				ownerImageUrl: string | null;
			}
		> = [];
		const seen = new Set<string>();
		// Editor-first so the single card per harness reflects the STRONGEST
		// active grant (matches resolveHarnessRole's max-wins) — a user can hold
		// both a viewer and an editor grant on the same harness (two invites).
		const ranked = grants
			.filter(isActiveGrant)
			.sort(
				(a, b) =>
					(a.role === "editor" ? 0 : 1) - (b.role === "editor" ? 0 : 1),
			);
		for (const g of ranked) {
			const key = g.harnessId as string;
			if (seen.has(key)) continue;
			const harness = await ctx.db.get(g.harnessId);
			if (!harness) continue;
			seen.add(key);
			out.push({
				harnessId: harness._id,
				grantId: g._id,
				...publicHarnessProjection(harness),
				role: g.role,
				ownerName: g.ownerName ?? null,
				ownerImageUrl: g.ownerImageUrl ?? null,
			});
		}
		return out;
	},
});

/** Resolve a grant the caller may act on, from a token OR a bound grantId. */
async function activeGrantForCaller(
	ctx: QueryCtx,
	userId: string,
	token?: string,
	grantId?: Id<"harnessShareGrants">,
): Promise<Doc<"harnessShareGrants"> | null> {
	if (token) return await harnessGrantForToken(ctx, token);
	if (grantId) {
		const grant = await ctx.db.get(grantId);
		if (!grant || !isActiveGrant(grant)) return null;
		if (grant.grantedToUserId !== userId) return null;
		return grant;
	}
	return null;
}

/**
 * Clone a shared harness into the caller's own account. ALWAYS allowed
 * regardless of lock. Drops ALL secrets: never copies authToken (recipient
 * re-auths), agentCredentialId, or any sandbox binding.
 */
export const cloneSharedHarness = mutation({
	args: {
		token: v.optional(v.string()),
		grantId: v.optional(v.id("harnessShareGrants")),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const grant = await activeGrantForCaller(
			ctx,
			identity.subject,
			args.token,
			args.grantId,
		);
		if (!grant) throw new Error("Not found");
		const src = await ctx.db.get(grant.harnessId);
		if (!src) throw new Error("Not found");
		// Best-effort touch of last-accessed so the owner sees activity.
		await ctx.db.patch(grant._id, { lastAccessedAt: Date.now() });
		return await ctx.db.insert("harnesses", {
			name: `Copy of ${src.name}`,
			model: src.model,
			status: "stopped",
			// Keep server name/url/authType so the clone is usable, but DROP every
			// authToken — bearer/tiger_junction/oauth secrets are the owner's.
			mcpServers: src.mcpServers.map((m) => ({
				name: m.name,
				url: m.url,
				authType: m.authType,
				// authToken intentionally omitted (recipient must re-auth)
				// commandIds intentionally omitted (owner's command refs)
			})),
			skills: src.skills,
			systemPrompt: src.systemPrompt,
			suggestedPrompts: src.suggestedPrompts,
			agent: src.agent,
			// NEVER copy agentCredentialId / sandbox bindings — owner's account.
			agentMode: src.agentMode,
			reasoningEffort: src.reasoningEffort,
			userId: identity.subject,
			lastUsedAt: Date.now(),
		});
	},
});

/**
 * Edit a shared harness IN PLACE — editor-recipients only, and only while the
 * owner has NOT locked it. Restricted to non-secret config fields; mcpServers,
 * credentials, and sandbox bindings are NEVER editable through this path (those
 * touch the owner's secrets/infra and stay owner-only). The owner edits via the
 * normal harnesses.update.
 */
export const editSharedHarness = mutation({
	args: {
		harnessId: v.id("harnesses"),
		grantId: v.optional(v.id("harnessShareGrants")),
		token: v.optional(v.string()),
		patch: v.object({
			name: v.optional(v.string()),
			model: v.optional(v.string()),
			systemPrompt: v.optional(v.string()),
			suggestedPrompts: v.optional(v.array(v.string())),
			skills: v.optional(
				v.array(v.object({ name: v.string(), description: v.string() })),
			),
			agentMode: v.optional(v.string()),
			reasoningEffort: v.optional(v.string()),
		}),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const harness = await ctx.db.get(args.harnessId);
		if (!harness) throw new Error("Not found");
		// Owner never needs this path (they use harnesses.update); editors only,
		// and only while unlocked.
		const role = await resolveHarnessRole(
			ctx,
			identity.subject,
			args.harnessId,
			args.token,
		);
		if (role !== "editor") throw new Error("Not found");
		if (harness.sharedLocked === true) {
			throw new Error("This harness is locked by its owner");
		}
		// Only the explicitly-allowed, non-secret fields. Hold the editor to the
		// SAME bounds the owner's harnesses.update enforces (a less-trusted editor
		// must not write unbounded data into the owner's document).
		assertSystemPromptLength(args.patch.systemPrompt);
		const patch: Record<string, unknown> = {};
		const p = args.patch;
		if (p.name !== undefined) patch.name = p.name.slice(0, 200);
		if (p.model !== undefined) patch.model = p.model;
		if (p.systemPrompt !== undefined) patch.systemPrompt = p.systemPrompt;
		if (p.suggestedPrompts !== undefined) {
			patch.suggestedPrompts = p.suggestedPrompts;
		}
		if (p.skills !== undefined) patch.skills = p.skills;
		if (p.agentMode !== undefined) patch.agentMode = p.agentMode;
		if (p.reasoningEffort !== undefined) {
			patch.reasoningEffort = p.reasoningEffort;
		}
		await ctx.db.patch(args.harnessId, patch);
	},
});

// ── Internal: email bind-later (deploy-key only) ────────────────────────

/**
 * Bind pending email invites to a user, given the user's SERVER-VERIFIED
 * emails (FastAPI /api/harness-shares/claim sources these from the Clerk
 * Backend API — the client never supplies a bindable email). Idempotent; never
 * throws on zero matches.
 */
export const bindHarnessGrantsInternal = internalMutation({
	args: { userId: v.string(), verifiedEmails: v.array(v.string()) },
	handler: async (ctx, args) => {
		let bound = 0;
		for (const raw of args.verifiedEmails) {
			const email = normalizeEmail(raw);
			if (!email) continue;
			const rows = await ctx.db
				.query("harnessShareGrants")
				.withIndex("by_grantee_email", (q) => q.eq("granteeEmail", email))
				.collect();
			for (const g of rows) {
				if (!isActiveGrant(g)) continue;
				// Don't bind the owner's own invite to themselves.
				if (g.ownerUserId === args.userId) {
					await ctx.db.delete(g._id);
					continue;
				}
				// Merge instead of duplicating: if this user already holds a bound
				// grant on this harness, keep the stronger role on the existing row
				// and drop the invite — never leave two grants for one (harness,user).
				const existing = (
					await ctx.db
						.query("harnessShareGrants")
						.withIndex("by_harness", (q) => q.eq("harnessId", g.harnessId))
						.collect()
				).find((x) => isActiveGrant(x) && x.grantedToUserId === args.userId);
				if (existing) {
					if (g.role === "editor" && existing.role !== "editor") {
						await ctx.db.patch(existing._id, { role: "editor" });
					}
					await ctx.db.delete(g._id);
					continue;
				}
				await ctx.db.patch(g._id, {
					grantedToUserId: args.userId,
					granteeEmail: undefined,
				});
				bound += 1;
			}
		}
		return { bound };
	},
});
