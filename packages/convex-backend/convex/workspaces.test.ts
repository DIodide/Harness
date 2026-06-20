import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

// Helper: create a fresh isolated DB harness per test.
function makeT() {
	const raw = convexTest(schema, modules);
	const asUser = (userId: string) =>
		raw.withIdentity({ subject: userId, issuer: "test" });
	return { raw, asUser };
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
