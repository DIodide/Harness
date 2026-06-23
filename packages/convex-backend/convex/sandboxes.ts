import { ConvexError, v } from "convex/values";
import {
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";

// Per-user sandbox cap. Mirrored on the frontend in
// apps/web/src/lib/sandbox.ts and in the FastAPI gateway
// (session_manager.MAX_SANDBOXES_PER_USER) — keep all three in sync. Headroom
// is generous because each workspace now keeps ONE persistent unified agent
// sandbox (auto-stopped when idle), so the cap scales with workspaces.
const MAX_SANDBOXES_PER_USER = 20;
const SANDBOX_LIMIT_ERROR = "sandbox_limit_reached";

const sandboxLimitError = () =>
	new ConvexError({
		code: SANDBOX_LIMIT_ERROR,
		message: `You've reached the limit of ${MAX_SANDBOXES_PER_USER} sandboxes. Delete an existing sandbox before creating a new one.`,
	});

export const list = query({
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		return await ctx.db
			.query("sandboxes")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.collect();
	},
});

export const get = query({
	args: { id: v.id("sandboxes") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const sandbox = await ctx.db.get(args.id);
		if (!sandbox || sandbox.userId !== identity.subject) return null;
		return sandbox;
	},
});

export const getByHarness = query({
	args: { harnessId: v.id("harnesses") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const sandboxes = await ctx.db
			.query("sandboxes")
			.withIndex("by_harness", (q) => q.eq("harnessId", args.harnessId))
			.collect();
		const sandbox = sandboxes[0];
		if (!sandbox || sandbox.userId !== identity.subject) return null;
		return sandbox;
	},
});

export const create = mutation({
	args: {
		harnessId: v.optional(v.id("harnesses")),
		daytonaSandboxId: v.string(),
		name: v.string(),
		status: v.union(
			v.literal("creating"),
			v.literal("starting"),
			v.literal("running"),
			v.literal("stopping"),
			v.literal("stopped"),
			v.literal("archived"),
			v.literal("error"),
		),
		language: v.optional(v.string()),
		ephemeral: v.boolean(),
		resources: v.object({
			cpu: v.number(),
			memoryGB: v.number(),
			diskGB: v.number(),
		}),
		snapshotId: v.optional(v.string()),
		gitRepo: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const existing = await ctx.db
			.query("sandboxes")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.collect();
		if (existing.length >= MAX_SANDBOXES_PER_USER) {
			throw sandboxLimitError();
		}
		const id = await ctx.db.insert("sandboxes", {
			...args,
			userId: identity.subject,
			createdAt: Date.now(),
			lastAccessedAt: Date.now(),
		});
		// Link to harness if provided
		if (args.harnessId) {
			const harness = await ctx.db.get(args.harnessId);
			if (harness && harness.userId === identity.subject) {
				await ctx.db.patch(args.harnessId, {
					sandboxId: id,
					daytonaSandboxId: args.daytonaSandboxId,
				});
			}
		}
		return id;
	},
});

export const update = mutation({
	args: {
		id: v.id("sandboxes"),
		status: v.optional(
			v.union(
				v.literal("creating"),
				v.literal("starting"),
				v.literal("running"),
				v.literal("stopping"),
				v.literal("stopped"),
				v.literal("archived"),
				v.literal("error"),
			),
		),
		name: v.optional(v.string()),
		errorMessage: v.optional(v.string()),
		lastAccessedAt: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const sandbox = await ctx.db.get(args.id);
		if (!sandbox || sandbox.userId !== identity.subject) {
			throw new Error("Not found");
		}
		const { id, ...updates } = args;
		const filtered = Object.fromEntries(
			Object.entries(updates).filter(([, v]) => v !== undefined),
		);
		await ctx.db.patch(id, filtered);
	},
});

export const remove = mutation({
	args: { id: v.id("sandboxes") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const sandbox = await ctx.db.get(args.id);
		if (!sandbox || sandbox.userId !== identity.subject) {
			throw new Error("Not found");
		}
		const userHarnesses = await ctx.db
			.query("harnesses")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.collect();
		await Promise.all(
			userHarnesses
				.filter(
					(harness) =>
						harness.sandboxId === args.id ||
						harness.daytonaSandboxId === sandbox.daytonaSandboxId,
				)
				.map((harness) =>
					ctx.db.patch(harness._id, {
						sandboxEnabled: false,
						sandboxId: undefined,
						daytonaSandboxId: undefined,
					}),
				),
		);
		// Clear the link from any workspace that adopted this sandbox, so a
		// deleted box doesn't leave a dangling workspace.sandboxId (the gateway
		// then creates a fresh unified sandbox on the next session).
		const userWorkspaces = await ctx.db
			.query("workspaces")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.collect();
		await Promise.all(
			userWorkspaces
				.filter((workspace) => workspace.sandboxId === args.id)
				.map((workspace) =>
					ctx.db.patch(workspace._id, { sandboxId: undefined }),
				),
		);
		await ctx.db.delete(args.id);
	},
});

/**
 * Internal mutation called by the FastAPI backend to create a sandbox record
 * and link it to a harness. Uses deploy key auth — not callable from the frontend.
 */
export const createInternal = internalMutation({
	args: {
		userId: v.string(),
		harnessId: v.optional(v.id("harnesses")),
		// When set, point this workspace at the new sandbox (unless it already
		// links one) so a workspace's box unifies with the agent's.
		workspaceId: v.optional(v.id("workspaces")),
		daytonaSandboxId: v.string(),
		name: v.string(),
		status: v.union(
			v.literal("creating"),
			v.literal("starting"),
			v.literal("running"),
			v.literal("stopping"),
			v.literal("stopped"),
			v.literal("archived"),
			v.literal("error"),
		),
		language: v.optional(v.string()),
		ephemeral: v.boolean(),
		resources: v.object({
			cpu: v.number(),
			memoryGB: v.number(),
			diskGB: v.number(),
		}),
	},
	handler: async (ctx, args) => {
		const { harnessId, workspaceId, ...rest } = args;
		// Lost-race guard: if a workspace box was requested but the workspace
		// already links one (a sibling session won the race to create it), do
		// NOT create a duplicate row or relink — return null so the gateway
		// reclaims its now-redundant Daytona box on teardown. Convex mutations
		// are serializable, so two concurrent callers can't both pass this: the
		// second re-executes against the committed sandboxId and bails here.
		if (workspaceId) {
			const workspace = await ctx.db.get(workspaceId);
			if (
				workspace &&
				workspace.userId === args.userId &&
				workspace.sandboxId
			) {
				return null;
			}
		}
		const existing = await ctx.db
			.query("sandboxes")
			.withIndex("by_user", (q) => q.eq("userId", args.userId))
			.collect();
		if (existing.length >= MAX_SANDBOXES_PER_USER) {
			throw sandboxLimitError();
		}
		const id = await ctx.db.insert("sandboxes", {
			...rest,
			harnessId,
			createdAt: Date.now(),
			lastAccessedAt: Date.now(),
		});
		// Link to harness if provided
		if (harnessId) {
			const harness = await ctx.db.get(harnessId);
			if (harness && harness.userId === args.userId) {
				await ctx.db.patch(harness._id, {
					// Only flip the toggle for an agent harness: the gateway only
					// creates unified boxes for ACP agents, but guard anyway so a
					// broadened call site can't silently sandbox-enable a harness
					// the user deliberately left off.
					...(harness.agent ? { sandboxEnabled: true } : {}),
					sandboxId: id,
					daytonaSandboxId: args.daytonaSandboxId,
				});
			}
		}
		// Link to workspace if provided (the guard above proved it has none).
		if (workspaceId) {
			const workspace = await ctx.db.get(workspaceId);
			if (
				workspace &&
				workspace.userId === args.userId &&
				!workspace.sandboxId
			) {
				await ctx.db.patch(workspaceId, { sandboxId: id });
			}
		}
		return id;
	},
});

/**
 * Internal mutation called by the FastAPI backend to update sandbox status.
 * Uses deploy key auth — not callable from the frontend.
 */
/**
 * Internal mutation: remove the record for a deleted Daytona sandbox.
 * Used by the ACP agent gateway when it tears down an agent session.
 */
export const removeByDaytonaId = internalMutation({
	args: { daytonaSandboxId: v.string() },
	handler: async (ctx, args) => {
		// collect(), not unique(): the index is non-unique and siblings
		// (getOwnerByDaytonaId, updateStatus) tolerate duplicate rows —
		// unique() would throw and strand the records forever.
		const rows = await ctx.db
			.query("sandboxes")
			.withIndex("by_daytona_id", (q) =>
				q.eq("daytonaSandboxId", args.daytonaSandboxId),
			)
			.collect();
		for (const row of rows) {
			// Clear any harness/workspace links to this row before deleting it,
			// so teardown of a unified box never leaves a dangling reference
			// (mirrors the user-facing remove()). Scoped to the row's owner.
			const harnesses = await ctx.db
				.query("harnesses")
				.withIndex("by_user", (q) => q.eq("userId", row.userId))
				.collect();
			await Promise.all(
				harnesses
					.filter(
						(h) =>
							h.sandboxId === row._id ||
							h.daytonaSandboxId === row.daytonaSandboxId,
					)
					.map((h) =>
						ctx.db.patch(h._id, {
							sandboxEnabled: false,
							sandboxId: undefined,
							daytonaSandboxId: undefined,
						}),
					),
			);
			const workspaces = await ctx.db
				.query("workspaces")
				.withIndex("by_user", (q) => q.eq("userId", row.userId))
				.collect();
			await Promise.all(
				workspaces
					.filter((w) => w.sandboxId === row._id)
					.map((w) => ctx.db.patch(w._id, { sandboxId: undefined })),
			);
			await ctx.db.delete(row._id);
		}
		return { removed: rows.length > 0 };
	},
});

/** Per-user sandbox count — lets FastAPI enforce the cap BEFORE creating a
 *  Daytona sandbox (createInternal's check fires only at registration). */
export const countForUser = internalQuery({
	args: { userId: v.string() },
	handler: async (ctx, args) => {
		const rows = await ctx.db
			.query("sandboxes")
			.withIndex("by_user", (q) => q.eq("userId", args.userId))
			.collect();
		return rows.length;
	},
});

/**
 * Internal query used by FastAPI to verify sandbox ownership.
 * Returns the userId of the sandbox owner, or null if not found.
 */
export const getOwnerByDaytonaId = internalQuery({
	args: { daytonaSandboxId: v.string() },
	handler: async (ctx, args) => {
		const sandboxes = await ctx.db
			.query("sandboxes")
			.withIndex("by_daytona_id", (q) =>
				q.eq("daytonaSandboxId", args.daytonaSandboxId),
			)
			.collect();
		const sandbox = sandboxes[0];
		if (!sandbox) return null;
		return sandbox.userId;
	},
});

export const updateStatus = internalMutation({
	args: {
		daytonaSandboxId: v.string(),
		status: v.union(
			v.literal("creating"),
			v.literal("starting"),
			v.literal("running"),
			v.literal("stopping"),
			v.literal("stopped"),
			v.literal("archived"),
			v.literal("error"),
		),
		errorMessage: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const sandboxes = await ctx.db
			.query("sandboxes")
			.withIndex("by_daytona_id", (q) =>
				q.eq("daytonaSandboxId", args.daytonaSandboxId),
			)
			.collect();
		const sandbox = sandboxes[0];
		if (!sandbox) return;
		const patch: Record<string, unknown> = {
			status: args.status,
			lastAccessedAt: Date.now(),
		};
		if (args.errorMessage !== undefined) {
			patch.errorMessage = args.errorMessage;
		}
		await ctx.db.patch(sandbox._id, patch);
	},
});
