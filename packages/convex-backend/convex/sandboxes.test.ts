import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

function makeT() {
	const raw = convexTest(schema, modules);
	const asUser = (userId: string) =>
		raw.withIdentity({ subject: userId, issuer: "test" });
	return { raw, asUser };
}

const RESOURCES = { cpu: 2, memoryGB: 4, diskGB: 10 };

async function createHarness(
	u: ReturnType<ReturnType<typeof makeT>["asUser"]>,
): Promise<Id<"harnesses">> {
	return await u.mutation(api.harnesses.create, {
		name: "H",
		model: "gpt-5.5",
		status: "started",
		mcpServers: [],
		skills: [],
		agent: "claude-code",
	});
}

describe("sandboxes.createInternal (gateway-created unified sandbox)", () => {
	it("links the new sandbox to both the harness and the workspace", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("user-a");
		const harnessId = await createHarness(a);
		const workspaceId = await a.mutation(api.workspaces.create, {
			name: "w",
			harnessId,
		});

		const sandboxId = await raw.mutation(internal.sandboxes.createInternal, {
			userId: "user-a",
			harnessId,
			workspaceId,
			daytonaSandboxId: "dt-new",
			name: "Claude Code · H",
			status: "running",
			language: "python",
			ephemeral: false,
			resources: RESOURCES,
		});

		const { harness, workspace } = await raw.run(async (ctx) => ({
			harness: await ctx.db.get(harnessId),
			workspace: await ctx.db.get(workspaceId),
		}));
		expect(workspace?.sandboxId).toBe(sandboxId);
		expect(harness?.sandboxEnabled).toBe(true);
		expect(harness?.sandboxId).toBe(sandboxId);
		expect(harness?.daytonaSandboxId).toBe("dt-new");
	});

	it("declines (returns null, creates no row) when the workspace already links one — lost race", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("user-a");
		const existing = await a.mutation(api.sandboxes.create, {
			daytonaSandboxId: "dt-existing",
			name: "existing",
			status: "running",
			ephemeral: false,
			resources: RESOURCES,
		});
		const workspaceId = await a.mutation(api.workspaces.create, {
			name: "w",
			sandboxId: existing,
		});

		const result = await raw.mutation(internal.sandboxes.createInternal, {
			userId: "user-a",
			workspaceId,
			daytonaSandboxId: "dt-new",
			name: "n",
			status: "running",
			ephemeral: false,
			resources: RESOURCES,
		});

		// Lost the race: no doc id, workspace untouched, no duplicate row.
		expect(result).toBeNull();
		const ws = await a.query(api.workspaces.get, { id: workspaceId });
		expect(ws?.sandboxId).toBe(existing);
		const rows = await raw.run(async (ctx) =>
			ctx.db
				.query("sandboxes")
				.withIndex("by_user", (q) => q.eq("userId", "user-a"))
				.collect(),
		);
		expect(rows.map((r) => r.daytonaSandboxId)).toEqual(["dt-existing"]);
	});

	it("ignores a workspace owned by another user", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("user-a");
		const workspaceId = await a.mutation(api.workspaces.create, { name: "w" });
		// Mismatched owner: the record is created but the workspace is untouched.
		await raw.mutation(internal.sandboxes.createInternal, {
			userId: "user-b",
			workspaceId,
			daytonaSandboxId: "dt-x",
			name: "n",
			status: "running",
			ephemeral: false,
			resources: RESOURCES,
		});
		const ws = await a.query(api.workspaces.get, { id: workspaceId });
		expect(ws?.sandboxId).toBeUndefined();
	});

	it("does not touch a harness owned by another user", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("user-a");
		const harnessId = await createHarness(a); // owned by user-a
		// A gateway call under the WRONG user must not link user-a's harness.
		await raw.mutation(internal.sandboxes.createInternal, {
			userId: "user-b",
			harnessId,
			daytonaSandboxId: "dt-x",
			name: "n",
			status: "running",
			ephemeral: false,
			resources: RESOURCES,
		});
		const harness = await raw.run(async (ctx) => ctx.db.get(harnessId));
		expect(harness?.sandboxId).toBeUndefined();
		expect(harness?.sandboxEnabled).toBeUndefined();
		expect(harness?.daytonaSandboxId).toBeUndefined();
	});
});

describe("sandboxes.remove", () => {
	it("clears the link from any workspace that adopted the sandbox", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("user-a");
		const harnessId = await createHarness(a);
		const sandboxId = await a.mutation(api.sandboxes.create, {
			harnessId,
			daytonaSandboxId: "dt-1",
			name: "box",
			status: "running",
			ephemeral: false,
			resources: RESOURCES,
		});
		const workspaceId = await a.mutation(api.workspaces.create, {
			name: "w",
			harnessId,
		});
		// Sanity: the workspace adopted the harness's sandbox.
		expect(
			(await a.query(api.workspaces.get, { id: workspaceId }))?.sandboxId,
		).toBe(sandboxId);

		await a.mutation(api.sandboxes.remove, { id: sandboxId });

		const { workspace, harness } = await raw.run(async (ctx) => ({
			workspace: await ctx.db.get(workspaceId),
			harness: await ctx.db.get(harnessId),
		}));
		expect(workspace?.sandboxId).toBeUndefined();
		expect(harness?.sandboxId).toBeUndefined();
		expect(harness?.sandboxEnabled).toBe(false);
	});
});

describe("sandboxes.removeByDaytonaId (gateway teardown)", () => {
	it("clears workspace + harness links before deleting the row", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("user-a");
		const harnessId = await createHarness(a);
		const workspaceId = await a.mutation(api.workspaces.create, { name: "w" });
		// Gateway-style unified box: links harness + workspace.
		await raw.mutation(internal.sandboxes.createInternal, {
			userId: "user-a",
			harnessId,
			workspaceId,
			daytonaSandboxId: "dt-unified",
			name: "Claude Code · H",
			status: "running",
			ephemeral: false,
			resources: RESOURCES,
		});

		await raw.mutation(internal.sandboxes.removeByDaytonaId, {
			daytonaSandboxId: "dt-unified",
		});

		const { workspace, harness, rows } = await raw.run(async (ctx) => ({
			workspace: await ctx.db.get(workspaceId),
			harness: await ctx.db.get(harnessId),
			rows: await ctx.db
				.query("sandboxes")
				.withIndex("by_user", (q) => q.eq("userId", "user-a"))
				.collect(),
		}));
		expect(workspace?.sandboxId).toBeUndefined();
		expect(harness?.sandboxId).toBeUndefined();
		expect(harness?.daytonaSandboxId).toBeUndefined();
		expect(harness?.sandboxEnabled).toBe(false);
		expect(rows).toHaveLength(0);
	});
});
