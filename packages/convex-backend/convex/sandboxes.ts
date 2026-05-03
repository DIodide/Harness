import { v } from "convex/values";
import {
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";

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
		const { harnessId, ...rest } = args;
		const id = await ctx.db.insert("sandboxes", {
			...rest,
			harnessId,
			createdAt: Date.now(),
			lastAccessedAt: Date.now(),
		});
		// Link to harness if provided
		if (harnessId) {
			const harness = await ctx.db.get(harnessId);
			if (harness) {
				await ctx.db.patch(harness._id, {
					sandboxId: id,
					daytonaSandboxId: args.daytonaSandboxId,
				});
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

/**
 * Internal query used by FastAPI's `_ensure_running` to read user intent
 * before auto-starting a stopped sandbox. Convex represents what the user
 * has explicitly set; if they stopped/archived via the dashboard, the
 * inference path must honor that instead of silently re-launching.
 */
export const getStatusByDaytonaId = internalQuery({
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
		return sandbox.status;
	},
});

/**
 * Internal query used by FastAPI's LRU evictor. Returns the same user's
 * other sandboxes ordered by `lastAccessedAt` ascending (oldest first), so
 * the evictor can stop the least-recently-used one when Daytona refuses to
 * start a new sandbox due to its concurrency limit.
 *
 * Excludes the target sandbox itself and any sandbox the user has already
 * stopped/archived (those wouldn't free a started slot).
 */
export const listSiblingsByLastAccessed = internalQuery({
	args: { daytonaSandboxId: v.string() },
	handler: async (ctx, args) => {
		const targets = await ctx.db
			.query("sandboxes")
			.withIndex("by_daytona_id", (q) =>
				q.eq("daytonaSandboxId", args.daytonaSandboxId),
			)
			.collect();
		const target = targets[0];
		if (!target) return [];
		const siblings = await ctx.db
			.query("sandboxes")
			.withIndex("by_user", (q) => q.eq("userId", target.userId))
			.collect();
		return siblings
			.filter(
				(s) =>
					s.daytonaSandboxId !== args.daytonaSandboxId &&
					s.status !== "stopped" &&
					s.status !== "stopping" &&
					s.status !== "archived",
			)
			.sort((a, b) => (a.lastAccessedAt ?? 0) - (b.lastAccessedAt ?? 0))
			.map((s) => ({
				daytonaSandboxId: s.daytonaSandboxId,
				lastAccessedAt: s.lastAccessedAt ?? 0,
			}));
	},
});

/**
 * Internal mutation called by FastAPI's `_ensure_running` to record that
 * the agent just touched a sandbox. Updates `lastAccessedAt` only — no
 * state mutation. This is a metric, not user intent, so it does not
 * conflict with the rule that only the browser CRUD path writes status.
 */
export const touchSandboxInternal = internalMutation({
	args: { daytonaSandboxId: v.string() },
	handler: async (ctx, args) => {
		const sandboxes = await ctx.db
			.query("sandboxes")
			.withIndex("by_daytona_id", (q) =>
				q.eq("daytonaSandboxId", args.daytonaSandboxId),
			)
			.collect();
		const sandbox = sandboxes[0];
		if (!sandbox) return;
		await ctx.db.patch(sandbox._id, { lastAccessedAt: Date.now() });
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
		} else if (args.status !== "error") {
			// Clear stale error message on a successful transition.
			patch.errorMessage = undefined;
		}
		await ctx.db.patch(sandbox._id, patch);
	},
});

/**
 * Internal mutation called by FastAPI to update sandbox metadata
 * (currently just the user-facing name). Looked up by Daytona ID.
 */
export const updateMetadataInternal = internalMutation({
	args: {
		daytonaSandboxId: v.string(),
		name: v.optional(v.string()),
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
		const patch: Record<string, unknown> = {};
		if (args.name !== undefined) patch.name = args.name;
		if (Object.keys(patch).length === 0) return;
		await ctx.db.patch(sandbox._id, patch);
	},
});

/**
 * Internal mutation called by FastAPI after deleting a sandbox in Daytona.
 * Removes the Convex record and unlinks any harnesses referencing it.
 */
export const removeByDaytonaIdInternal = internalMutation({
	args: { daytonaSandboxId: v.string() },
	handler: async (ctx, args) => {
		const sandboxes = await ctx.db
			.query("sandboxes")
			.withIndex("by_daytona_id", (q) =>
				q.eq("daytonaSandboxId", args.daytonaSandboxId),
			)
			.collect();
		const sandbox = sandboxes[0];
		if (!sandbox) return;
		const harnesses = await ctx.db
			.query("harnesses")
			.withIndex("by_user", (q) => q.eq("userId", sandbox.userId))
			.collect();
		await Promise.all(
			harnesses
				.filter(
					(harness) =>
						harness.sandboxId === sandbox._id ||
						harness.daytonaSandboxId === args.daytonaSandboxId,
				)
				.map((harness) =>
					ctx.db.patch(harness._id, {
						sandboxEnabled: false,
						sandboxId: undefined,
						daytonaSandboxId: undefined,
					}),
				),
		);
		await ctx.db.delete(sandbox._id);
	},
});
