import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

// Helper: create a fresh isolated DB harness per test.
function makeT() {
	const raw = convexTest(schema, modules);
	const asUser = (userId: string) =>
		raw.withIdentity({ subject: userId, issuer: "test" });
	return { raw, asUser };
}

type UserClient = ReturnType<ReturnType<typeof makeT>["asUser"]>;

async function createHarness(
	u: UserClient,
	opts: { agent?: string; sandboxEnabled?: boolean } = {},
): Promise<Id<"harnesses">> {
	return await u.mutation(api.harnesses.create, {
		name: "H",
		model: "gpt-5.5",
		status: "started",
		mcpServers: [],
		skills: [],
		...(opts.agent ? { agent: opts.agent } : {}),
		...(opts.sandboxEnabled !== undefined
			? { sandboxEnabled: opts.sandboxEnabled }
			: {}),
	});
}

// Create a sandbox and link it to the harness (mirrors the real linking path,
// which sets harness.sandboxId + daytonaSandboxId).
async function createSandboxFor(
	u: UserClient,
	harnessId: Id<"harnesses">,
	daytonaSandboxId = "dt-1",
): Promise<Id<"sandboxes">> {
	return await u.mutation(api.sandboxes.create, {
		harnessId,
		daytonaSandboxId,
		name: "box",
		status: "running",
		ephemeral: false,
		resources: { cpu: 2, memoryGB: 4, diskGB: 10 },
	});
}

describe("workspaces.list", () => {
	it("returns an empty array when unauthenticated", async () => {
		const { raw } = makeT();
		const rows = await raw.query(api.workspaces.list, {});
		expect(rows).toEqual([]);
	});

	it("returns only workspaces owned by the caller, newest first", async () => {
		const { asUser } = makeT();
		const a = asUser("user-a");
		const b = asUser("user-b");

		await a.mutation(api.workspaces.create, { name: "first" });
		await new Promise((r) => setTimeout(r, 2));
		await a.mutation(api.workspaces.create, { name: "second" });
		await b.mutation(api.workspaces.create, { name: "other" });

		const rowsA = await a.query(api.workspaces.list, {});
		expect(rowsA.map((r) => r.name)).toEqual(["second", "first"]);
		expect(rowsA.every((r) => r.userId === "user-a")).toBe(true);
	});
});

describe("workspaces.create", () => {
	it("requires authentication", async () => {
		const { raw } = makeT();
		await expect(
			raw.mutation(api.workspaces.create, { name: "x" }),
		).rejects.toThrow(/Unauthenticated/);
	});

	it("trims whitespace and falls back to 'New workspace'", async () => {
		const a = makeT().asUser("user-a");
		const idEmpty = await a.mutation(api.workspaces.create, { name: "  " });
		const idTrimmed = await a.mutation(api.workspaces.create, {
			name: "  hello  ",
		});

		const empty = await a.query(api.workspaces.get, { id: idEmpty });
		const trimmed = await a.query(api.workspaces.get, { id: idTrimmed });
		expect(empty?.name).toBe("New workspace");
		expect(trimmed?.name).toBe("hello");
	});

	it("stores an optional color when provided", async () => {
		const a = makeT().asUser("user-a");
		const id = await a.mutation(api.workspaces.create, {
			name: "w",
			color: "rose",
		});
		const row = await a.query(api.workspaces.get, { id });
		expect(row?.color).toBe("rose");
	});
});

describe("workspaces.get", () => {
	it("returns null when the workspace belongs to a different user", async () => {
		const { asUser } = makeT();
		const a = asUser("user-a");
		const b = asUser("user-b");
		const id = await a.mutation(api.workspaces.create, { name: "w" });
		const row = await b.query(api.workspaces.get, { id });
		expect(row).toBeNull();
	});

	it("returns null when unauthenticated", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("user-a");
		const id = await a.mutation(api.workspaces.create, { name: "w" });
		expect(await raw.query(api.workspaces.get, { id })).toBeNull();
	});
});

describe("workspaces.update", () => {
	it("rejects an empty name after trimming", async () => {
		const a = makeT().asUser("user-a");
		const id = await a.mutation(api.workspaces.create, { name: "w" });
		await expect(
			a.mutation(api.workspaces.update, { id, name: "   " }),
		).rejects.toThrow(/name is required/);
	});

	it("clears the color when given an empty string", async () => {
		const a = makeT().asUser("user-a");
		const id = await a.mutation(api.workspaces.create, {
			name: "w",
			color: "rose",
		});
		await a.mutation(api.workspaces.update, { id, color: "" });
		const row = await a.query(api.workspaces.get, { id });
		expect(row?.color).toBeUndefined();
	});

	it("rejects attempts to update another user's workspace", async () => {
		const { asUser } = makeT();
		const a = asUser("user-a");
		const b = asUser("user-b");
		const id = await a.mutation(api.workspaces.create, { name: "w" });
		await expect(
			b.mutation(api.workspaces.update, { id, name: "hacked" }),
		).rejects.toThrow(/Workspace not found/);
	});
});

describe("workspaces.touch", () => {
	it("bumps lastUsedAt", async () => {
		const a = makeT().asUser("user-a");
		const id = await a.mutation(api.workspaces.create, { name: "w" });
		const before = await a.query(api.workspaces.get, { id });
		await new Promise((r) => setTimeout(r, 2));
		await a.mutation(api.workspaces.touch, { id });
		const after = await a.query(api.workspaces.get, { id });
		expect(after!.lastUsedAt).toBeGreaterThan(before!.lastUsedAt);
	});
});

describe("workspaces.remove", () => {
	it("cascades delete to conversations and messages in that workspace", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("user-a");
		const workspaceId = await a.mutation(api.workspaces.create, { name: "w" });

		const convId = await raw.run(async (ctx) => {
			const convId = await ctx.db.insert("conversations", {
				title: "c",
				userId: "user-a",
				workspaceId,
				lastMessageAt: Date.now(),
			});
			await ctx.db.insert("messages", {
				conversationId: convId,
				role: "user",
				content: "hi",
				workspaceId,
				userId: "user-a",
			});
			return convId;
		});

		await a.mutation(api.workspaces.remove, { id: workspaceId });

		await raw.run(async (ctx) => {
			expect(await ctx.db.get(workspaceId)).toBeNull();
			expect(await ctx.db.get(convId)).toBeNull();
			const remaining = await ctx.db
				.query("messages")
				.withIndex("by_conversation", (q) => q.eq("conversationId", convId))
				.collect();
			expect(remaining).toEqual([]);
		});
	});

	it("rejects remove on another user's workspace", async () => {
		const { asUser } = makeT();
		const a = asUser("user-a");
		const b = asUser("user-b");
		const id = await a.mutation(api.workspaces.create, { name: "w" });
		await expect(b.mutation(api.workspaces.remove, { id })).rejects.toThrow(
			/Workspace not found/,
		);
	});

	it("refuses to delete the Default workspace", async () => {
		const { asUser } = makeT();
		const a = asUser("user-a");
		const defaultId = await a.mutation(api.workspaces.ensureDefault, {});
		await expect(
			a.mutation(api.workspaces.remove, { id: defaultId }),
		).rejects.toThrow(/Default workspace can't be deleted/);
	});
});

describe("workspaces.ensureDefault", () => {
	it("creates a single flagged Default and is idempotent", async () => {
		const { asUser } = makeT();
		const a = asUser("user-a");
		const first = await a.mutation(api.workspaces.ensureDefault, {});
		const second = await a.mutation(api.workspaces.ensureDefault, {});
		expect(second).toBe(first);
		const rows = await a.query(api.workspaces.list, {});
		const defaults = rows.filter((w) => w.isDefault);
		expect(defaults).toHaveLength(1);
		expect(defaults[0]._id).toBe(first);
		expect(defaults[0].name).toBe("Default");
	});

	it("backfills an existing account by adopting its 'Default'-named workspace", async () => {
		const { asUser } = makeT();
		const a = asUser("user-a");
		// Pre-flag account: a "Default" workspace + another, neither flagged.
		const legacyDefault = await a.mutation(api.workspaces.create, {
			name: "Default",
		});
		await a.mutation(api.workspaces.create, { name: "Side project" });
		const resolved = await a.mutation(api.workspaces.ensureDefault, {});
		// Adopts the existing "Default" rather than spawning a duplicate.
		expect(resolved).toBe(legacyDefault);
		const rows = await a.query(api.workspaces.list, {});
		expect(rows.filter((w) => w.isDefault).map((w) => w._id)).toEqual([
			legacyDefault,
		]);
	});

	it("creates a fresh Default without flagging existing custom-named workspaces", async () => {
		const { asUser } = makeT();
		const a = asUser("user-a");
		// An account whose workspaces are all custom-named (no "Default").
		const prod = await a.mutation(api.workspaces.create, {
			name: "Production",
		});
		const scratch = await a.mutation(api.workspaces.create, {
			name: "Scratch",
		});
		const resolved = await a.mutation(api.workspaces.ensureDefault, {});
		const rows = await a.query(api.workspaces.list, {});
		// A brand-new "Default" was created; the custom ones are untouched and
		// remain deletable (not flagged).
		const def = rows.find((w) => w._id === resolved);
		expect(def?.name).toBe("Default");
		expect(def?.isDefault).toBe(true);
		expect(rows.find((w) => w._id === prod)?.isDefault).toBeUndefined();
		expect(rows.find((w) => w._id === scratch)?.isDefault).toBeUndefined();
		// The custom workspaces stay deletable.
		await a.mutation(api.workspaces.remove, { id: prod });
		expect(await a.query(api.workspaces.get, { id: prod })).toBeNull();
	});

	it("keeps the Default's harness/sandbox editable", async () => {
		const { asUser, raw } = makeT();
		const a = asUser("user-a");
		const defaultId = await a.mutation(api.workspaces.ensureDefault, {});
		const harnessId = await raw.run((ctx) =>
			ctx.db.insert("harnesses", {
				name: "h",
				model: "m",
				status: "stopped",
				mcpServers: [],
				skills: [],
				userId: "user-a",
			}),
		);
		await a.mutation(api.workspaces.update, { id: defaultId, harnessId });
		const ws = await a.query(api.workspaces.get, { id: defaultId });
		expect(ws?.harnessId).toBe(harnessId);
		expect(ws?.isDefault).toBe(true);
	});
});

describe("workspaces.reorder", () => {
	it("requires authentication", async () => {
		const { raw } = makeT();
		await expect(
			raw.mutation(api.workspaces.reorder, { orderedIds: [] }),
		).rejects.toThrow(/Unauthenticated/);
	});

	it("stamps each owned workspace with its index and list reflects it", async () => {
		const { asUser } = makeT();
		const a = asUser("user-a");
		const w1 = await a.mutation(api.workspaces.create, { name: "one" });
		const w2 = await a.mutation(api.workspaces.create, { name: "two" });
		const w3 = await a.mutation(api.workspaces.create, { name: "three" });
		// Reorder to three, one, two.
		await a.mutation(api.workspaces.reorder, { orderedIds: [w3, w1, w2] });
		const rows = await a.query(api.workspaces.list, {});
		expect(rows.map((r) => r._id)).toEqual([w3, w1, w2]);
		expect(rows.map((r) => r.order)).toEqual([0, 1, 2]);
	});

	it("falls back to most-recently-used when order is unset", async () => {
		const { asUser } = makeT();
		const a = asUser("user-a");
		await a.mutation(api.workspaces.create, { name: "older" });
		await new Promise((r) => setTimeout(r, 2));
		await a.mutation(api.workspaces.create, { name: "newer" });
		const rows = await a.query(api.workspaces.list, {});
		// No order set anywhere → most-recently-used first (unchanged behavior).
		expect(rows.map((r) => r.name)).toEqual(["newer", "older"]);
	});

	it("appends owned workspaces omitted from the payload (full reconcile)", async () => {
		const { asUser } = makeT();
		const a = asUser("user-a");
		const w1 = await a.mutation(api.workspaces.create, { name: "first" });
		await a.mutation(api.workspaces.create, { name: "omitted" });
		// Client sends only w1; the omitted one is reconciled to the end with a
		// contiguous order (no stale/undefined outlier).
		await a.mutation(api.workspaces.reorder, { orderedIds: [w1] });
		const rows = await a.query(api.workspaces.list, {});
		expect(rows.map((r) => r.name)).toEqual(["first", "omitted"]);
		expect(rows.map((r) => r.order)).toEqual([0, 1]);
	});

	it("places a workspace created after reordering at the top", async () => {
		const { asUser } = makeT();
		const a = asUser("user-a");
		const w1 = await a.mutation(api.workspaces.create, { name: "one" });
		const w2 = await a.mutation(api.workspaces.create, { name: "two" });
		await a.mutation(api.workspaces.reorder, { orderedIds: [w1, w2] });
		// Now every existing workspace has a finite order; a fresh one must still
		// surface at the top, not sink below the ordered ones.
		const fresh = await a.mutation(api.workspaces.create, { name: "fresh" });
		const rows = await a.query(api.workspaces.list, {});
		expect(rows.map((r) => r.name)).toEqual(["fresh", "one", "two"]);
		expect(rows[0]._id).toBe(fresh);
	});

	it("ignores ids the caller does not own (can't reorder others' workspaces)", async () => {
		const { asUser } = makeT();
		const a = asUser("user-a");
		const b = asUser("user-b");
		const mine = await a.mutation(api.workspaces.create, { name: "mine" });
		const theirs = await b.mutation(api.workspaces.create, { name: "theirs" });
		await a.mutation(api.workspaces.reorder, { orderedIds: [theirs, mine] });
		// `theirs` is skipped, so `mine` gets index 0; theirs stays untouched.
		expect((await a.query(api.workspaces.get, { id: mine }))?.order).toBe(0);
		expect(
			(await b.query(api.workspaces.get, { id: theirs }))?.order,
		).toBeUndefined();
	});
});

describe("workspace ⇄ agent sandbox unification", () => {
	it("create auto-adopts an ACP harness's sandbox", async () => {
		const a = makeT().asUser("user-a");
		const harnessId = await createHarness(a, { agent: "claude-code" });
		const sandboxId = await createSandboxFor(a, harnessId);
		const workspaceId = await a.mutation(api.workspaces.create, {
			name: "w",
			harnessId,
		});
		const ws = await a.query(api.workspaces.get, { id: workspaceId });
		expect(ws?.sandboxId).toBe(sandboxId);
	});

	it("create respects an explicit sandbox over the harness's", async () => {
		const a = makeT().asUser("user-a");
		const harnessId = await createHarness(a, { agent: "claude-code" });
		await createSandboxFor(a, harnessId, "dt-harness");
		// A second, standalone sandbox the user explicitly picks.
		const explicit = await a.mutation(api.sandboxes.create, {
			daytonaSandboxId: "dt-explicit",
			name: "explicit",
			status: "running",
			ephemeral: false,
			resources: { cpu: 2, memoryGB: 4, diskGB: 10 },
		});
		const workspaceId = await a.mutation(api.workspaces.create, {
			name: "w",
			harnessId,
			sandboxId: explicit,
		});
		const ws = await a.query(api.workspaces.get, { id: workspaceId });
		expect(ws?.sandboxId).toBe(explicit);
	});

	it("create leaves sandbox empty for an ACP harness with none yet", async () => {
		const a = makeT().asUser("user-a");
		const harnessId = await createHarness(a, { agent: "claude-code" });
		const workspaceId = await a.mutation(api.workspaces.create, {
			name: "w",
			harnessId,
		});
		const ws = await a.query(api.workspaces.get, { id: workspaceId });
		expect(ws?.sandboxId).toBeUndefined();
	});

	it("create does NOT auto-adopt for a non-agent harness", async () => {
		const a = makeT().asUser("user-a");
		const harnessId = await createHarness(a); // no agent, no sandboxEnabled
		await createSandboxFor(a, harnessId);
		const workspaceId = await a.mutation(api.workspaces.create, {
			name: "w",
			harnessId,
		});
		const ws = await a.query(api.workspaces.get, { id: workspaceId });
		expect(ws?.sandboxId).toBeUndefined();
	});

	it("update auto-links the harness's sandbox when assigning it", async () => {
		const a = makeT().asUser("user-a");
		const harnessId = await createHarness(a, { agent: "codex" });
		const sandboxId = await createSandboxFor(a, harnessId);
		const workspaceId = await a.mutation(api.workspaces.create, { name: "w" });
		await a.mutation(api.workspaces.update, { id: workspaceId, harnessId });
		const ws = await a.query(api.workspaces.get, { id: workspaceId });
		expect(ws?.sandboxId).toBe(sandboxId);
	});

	it("update with an explicit sandbox wins over auto-link", async () => {
		const a = makeT().asUser("user-a");
		const harnessId = await createHarness(a, { agent: "codex" });
		await createSandboxFor(a, harnessId, "dt-harness");
		const explicit = await a.mutation(api.sandboxes.create, {
			daytonaSandboxId: "dt-explicit",
			name: "explicit",
			status: "running",
			ephemeral: false,
			resources: { cpu: 2, memoryGB: 4, diskGB: 10 },
		});
		const workspaceId = await a.mutation(api.workspaces.create, { name: "w" });
		await a.mutation(api.workspaces.update, {
			id: workspaceId,
			harnessId,
			sandboxId: explicit,
		});
		const ws = await a.query(api.workspaces.get, { id: workspaceId });
		expect(ws?.sandboxId).toBe(explicit);
	});

	it("resolveSandboxInternal returns the linked sandbox or null", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("user-a");
		const harnessId = await createHarness(a, { agent: "claude-code" });
		await createSandboxFor(a, harnessId, "dt-xyz");
		const linked = await a.mutation(api.workspaces.create, {
			name: "w",
			harnessId,
		});
		const empty = await a.mutation(api.workspaces.create, { name: "empty" });

		const r = await raw.query(internal.workspaces.resolveSandboxInternal, {
			workspaceId: linked,
		});
		expect(r).toMatchObject({ daytonaSandboxId: "dt-xyz", status: "running" });
		expect(
			await raw.query(internal.workspaces.resolveSandboxInternal, {
				workspaceId: empty,
			}),
		).toBeNull();
	});
});
