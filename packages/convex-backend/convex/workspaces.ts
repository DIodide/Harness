import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalQuery, mutation, query } from "./_generated/server";
import { getIdentity } from "./authDev";

async function assertOwnedWorkspace(
	ctx: MutationCtx,
	workspaceId: Id<"workspaces">,
	userId: string,
) {
	const workspace = await ctx.db.get(workspaceId);
	if (!workspace || workspace.userId !== userId) {
		throw new Error("Workspace not found");
	}
	return workspace;
}

/**
 * The sandbox a workspace should adopt when an ACP / sandbox harness is
 * assigned to it: the harness's OWN sandbox. Returns undefined unless the
 * harness runs an ACP agent (or has sandbox enabled) and already has a
 * sandbox linked — a harness with no sandbox yet gets one lazily, created and
 * linked by the gateway on its first session. Used so a workspace's sandbox
 * unifies with the agent's instead of the agent spinning a separate one.
 */
function harnessSandboxToAdopt(
	harness: Doc<"harnesses"> | null,
): Id<"sandboxes"> | undefined {
	if (!harness) return undefined;
	const isAgentSandbox = Boolean(harness.agent) || harness.sandboxEnabled;
	return isAgentSandbox && harness.sandboxId ? harness.sandboxId : undefined;
}

export const list = query({
	handler: async (ctx) => {
		const identity = await getIdentity(ctx);
		if (!identity) return [];

		const all = await ctx.db
			.query("workspaces")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.collect();

		// Manual order (ascending) takes precedence; workspaces never reordered
		// (order undefined) fall back to most-recently-used, after the ordered ones.
		return all.sort((a, b) => {
			const ao = a.order ?? Number.POSITIVE_INFINITY;
			const bo = b.order ?? Number.POSITIVE_INFINITY;
			if (ao !== bo) return ao - bo;
			return b.lastUsedAt - a.lastUsedAt;
		});
	},
});

/**
 * Persist the user's manual workspace ordering. `orderedIds` is the sidebar
 * order; ALL of the caller's owned workspaces are re-stamped with a contiguous
 * 0..n-1 — the requested ids first, then any owned workspace the client omitted
 * (appended in its current relative order). Ids that aren't the caller's are
 * ignored, so a stale client can't reorder someone else's workspaces.
 */
export const reorder = mutation({
	args: { orderedIds: v.array(v.id("workspaces")) },
	handler: async (ctx, args) => {
		const identity = await getIdentity(ctx);
		if (!identity) throw new Error("Unauthenticated");
		// Defensive bound — a real account has a handful of workspaces.
		if (args.orderedIds.length > 1000) {
			throw new Error("Too many workspaces to reorder");
		}

		const owned = await ctx.db
			.query("workspaces")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.collect();
		const ownedById = new Map(owned.map((w) => [w._id, w]));

		// The caller's requested order, restricted to workspaces they own.
		const requested = args.orderedIds.filter((id) => ownedById.has(id));
		const requestedSet = new Set(requested);
		// Any owned workspace the client didn't include (e.g. one created
		// concurrently in another tab) is appended after — keeping its current
		// relative order — so the persisted order is always a clean contiguous
		// 0..n-1 with no stale/colliding outliers.
		const remaining = owned
			.filter((w) => !requestedSet.has(w._id))
			.sort(
				(a, b) =>
					(a.order ?? Number.POSITIVE_INFINITY) -
						(b.order ?? Number.POSITIVE_INFINITY) ||
					b.lastUsedAt - a.lastUsedAt,
			)
			.map((w) => w._id);

		const finalOrder = [...requested, ...remaining];
		for (let i = 0; i < finalOrder.length; i++) {
			await ctx.db.patch(finalOrder[i], { order: i });
		}
	},
});

export const get = query({
	args: { id: v.id("workspaces") },
	handler: async (ctx, args) => {
		const identity = await getIdentity(ctx);
		if (!identity) return null;

		const workspace = await ctx.db.get(args.id);
		if (!workspace || workspace.userId !== identity.subject) return null;
		return workspace;
	},
});

/**
 * Resolve the user's Default workspace, creating/backfilling it so EXACTLY ONE
 * exists and is flagged `isDefault`. Idempotent. Backfill for accounts predating
 * the flag: adopt an existing "Default"-named workspace if present, else create a
 * fresh one (never flag an arbitrarily-named existing workspace). Returns its id.
 */
export async function getOrCreateDefaultWorkspace(
	ctx: MutationCtx,
	userId: string,
	harnessId?: Id<"harnesses">,
): Promise<Id<"workspaces">> {
	const all = await ctx.db
		.query("workspaces")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.collect();

	const flagged = all.find((w) => w.isDefault);
	if (flagged) return flagged._id;

	// Backfill an account predating the flag: adopt ONLY a workspace
	// conventionally named "Default" (what old onboarding created). Never flag an
	// arbitrarily-named workspace (e.g. "Production") — that would silently make a
	// workspace the user could previously delete permanently undeletable. If
	// there's no "Default", fall through and create a fresh one.
	const adopt = all.find((w) => w.name === "Default");
	if (adopt) {
		await ctx.db.patch(adopt._id, { isDefault: true });
		return adopt._id;
	}

	let linkHarness = harnessId;
	if (linkHarness) {
		const harness = await ctx.db.get(linkHarness);
		if (!harness || harness.userId !== userId) linkHarness = undefined;
	}
	const now = Date.now();
	return await ctx.db.insert("workspaces", {
		userId,
		name: "Default",
		isDefault: true,
		...(linkHarness ? { harnessId: linkHarness } : {}),
		createdAt: now,
		lastUsedAt: now,
	});
}

/**
 * Every user gets an undeletable "Default" workspace so conversations always
 * have a home. Idempotent; returns the Default workspace id (creating or
 * backfilling it). `harnessId` links the harness onboarding just created when
 * the Default is first created.
 */
export const ensureDefault = mutation({
	args: { harnessId: v.optional(v.id("harnesses")) },
	handler: async (ctx, args) => {
		const identity = await getIdentity(ctx);
		if (!identity) throw new Error("Unauthenticated");
		return await getOrCreateDefaultWorkspace(
			ctx,
			identity.subject,
			args.harnessId,
		);
	},
});

export const create = mutation({
	args: {
		name: v.optional(v.string()),
		harnessId: v.optional(v.id("harnesses")),
		sandboxId: v.optional(v.id("sandboxes")),
		color: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const identity = await getIdentity(ctx);
		if (!identity) throw new Error("Unauthenticated");

		const [harness, sandbox] = await Promise.all([
			args.harnessId ? ctx.db.get(args.harnessId) : Promise.resolve(null),
			args.sandboxId ? ctx.db.get(args.sandboxId) : Promise.resolve(null),
		]);

		if (args.harnessId && (!harness || harness.userId !== identity.subject)) {
			throw new Error("Harness not found");
		}
		if (args.sandboxId && (!sandbox || sandbox.userId !== identity.subject)) {
			throw new Error("Sandbox not found");
		}

		// Place new workspaces at the TOP of the sidebar (matching the prior
		// newest-first behavior). For accounts that have manually reordered, every
		// workspace has a finite order, so undefined would sink the new one to the
		// bottom; give it one less than the current minimum instead.
		const existing = await ctx.db
			.query("workspaces")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.collect();
		const minOrder = existing.reduce(
			(m, w) => (w.order !== undefined && w.order < m ? w.order : m),
			Number.POSITIVE_INFINITY,
		);
		const order = Number.isFinite(minOrder) ? minOrder - 1 : undefined;

		// Respect an explicit sandbox; otherwise an ACP/sandbox harness auto-adopts
		// its own sandbox so the workspace and agent share one box.
		const effectiveSandboxId = args.sandboxId ?? harnessSandboxToAdopt(harness);

		const now = Date.now();
		return await ctx.db.insert("workspaces", {
			userId: identity.subject,
			name: args.name?.trim() || harness?.name || "New workspace",
			...(args.harnessId ? { harnessId: args.harnessId } : {}),
			...(effectiveSandboxId ? { sandboxId: effectiveSandboxId } : {}),
			...(args.color ? { color: args.color } : {}),
			...(order !== undefined ? { order } : {}),
			createdAt: now,
			lastUsedAt: now,
		});
	},
});

export const update = mutation({
	args: {
		id: v.id("workspaces"),
		name: v.optional(v.string()),
		harnessId: v.optional(v.union(v.id("harnesses"), v.null())),
		sandboxId: v.optional(v.union(v.id("sandboxes"), v.null())),
		color: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const identity = await getIdentity(ctx);
		if (!identity) throw new Error("Unauthenticated");

		await assertOwnedWorkspace(ctx, args.id, identity.subject);
		const updates: {
			name?: string;
			harnessId?: Id<"harnesses"> | undefined;
			sandboxId?: Id<"sandboxes"> | undefined;
			color?: string;
			lastUsedAt: number;
		} = {
			lastUsedAt: Date.now(),
		};
		if (args.name !== undefined) {
			const name = args.name.trim();
			if (!name) throw new Error("Workspace name is required");
			updates.name = name;
		}
		let assignedHarness: Doc<"harnesses"> | null = null;
		if (args.harnessId !== undefined) {
			if (args.harnessId === null) {
				updates.harnessId = undefined;
			} else {
				const harness = await ctx.db.get(args.harnessId);
				if (!harness || harness.userId !== identity.subject) {
					throw new Error("Harness not found");
				}
				updates.harnessId = args.harnessId;
				assignedHarness = harness;
			}
		}
		if (args.sandboxId !== undefined) {
			if (args.sandboxId === null) {
				updates.sandboxId = undefined;
			} else {
				const sandbox = await ctx.db.get(args.sandboxId);
				if (!sandbox || sandbox.userId !== identity.subject) {
					throw new Error("Sandbox not found");
				}
				updates.sandboxId = args.sandboxId;
			}
		} else if (assignedHarness) {
			// Assigning an ACP/sandbox harness (without an explicit sandbox) makes
			// the workspace adopt that harness's sandbox, so the agent runs in the
			// workspace's box rather than a separate one. A harness with no sandbox
			// yet is linked lazily by the gateway on its first session.
			const adopt = harnessSandboxToAdopt(assignedHarness);
			if (adopt) updates.sandboxId = adopt;
		}
		if (args.color !== undefined) {
			// Empty string clears the color field (patch with undefined deletes it).
			updates.color = args.color || undefined;
		}
		await ctx.db.patch(args.id, updates);
	},
});

export const touch = mutation({
	args: { id: v.id("workspaces") },
	handler: async (ctx, args) => {
		const identity = await getIdentity(ctx);
		if (!identity) throw new Error("Unauthenticated");

		await assertOwnedWorkspace(ctx, args.id, identity.subject);
		await ctx.db.patch(args.id, { lastUsedAt: Date.now() });
	},
});

/**
 * Internal (deploy-key) query used by the ACP gateway to resolve a workspace's
 * unified sandbox. Returns the linked sandbox's Daytona id + status, or null
 * when the workspace has none — the gateway then creates and links one. The
 * caller still re-checks ownership via getOwnerByDaytonaId before attaching.
 */
export const resolveSandboxInternal = internalQuery({
	args: { workspaceId: v.id("workspaces") },
	handler: async (ctx, args) => {
		const workspace = await ctx.db.get(args.workspaceId);
		if (!workspace?.sandboxId) return null;
		const sandbox = await ctx.db.get(workspace.sandboxId);
		if (!sandbox || sandbox.userId !== workspace.userId) return null;
		return {
			daytonaSandboxId: sandbox.daytonaSandboxId,
			status: sandbox.status,
		};
	},
});

export const remove = mutation({
	args: { id: v.id("workspaces") },
	handler: async (ctx, args) => {
		const identity = await getIdentity(ctx);
		if (!identity) throw new Error("Unauthenticated");

		const workspace = await assertOwnedWorkspace(
			ctx,
			args.id,
			identity.subject,
		);
		// The Default workspace is permanent — it's every conversation's fallback
		// home. Its harness/sandbox stay editable via `update`.
		if (workspace.isDefault) {
			throw new Error("The Default workspace can't be deleted");
		}

		const conversations = await ctx.db
			.query("conversations")
			.withIndex("by_workspace_last_message", (q) =>
				q.eq("workspaceId", args.id),
			)
			.collect();

		for (const conversation of conversations) {
			const messages = await ctx.db
				.query("messages")
				.withIndex("by_conversation", (q) =>
					q.eq("conversationId", conversation._id),
				)
				.collect();

			await Promise.all(messages.map((m) => ctx.db.delete(m._id)));

			await ctx.db.delete(conversation._id);
		}

		await ctx.db.delete(args.id);
	},
});
