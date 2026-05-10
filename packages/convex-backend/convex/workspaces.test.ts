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
});
