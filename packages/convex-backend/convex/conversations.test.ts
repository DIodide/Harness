import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

function makeT() {
	const raw = convexTest(schema, modules);
	return {
		raw,
		asUser: (uid: string) =>
			raw.withIdentity({ subject: uid, issuer: "test" }),
	};
}

const baseHarness = (overrides = {}) => ({
	name: "h",
	model: "m",
	status: "stopped" as const,
	mcpServers: [],
	skills: [],
	...overrides,
});

describe("conversations.list", () => {
	it("returns [] when unauthenticated", async () => {
		const { raw } = makeT();
		expect(await raw.query(api.conversations.list, {})).toEqual([]);
	});

	it("returns only the caller's conversations without a workspace", async () => {
		const { asUser } = makeT();
		const a = asUser("u-a");
		const b = asUser("u-b");
		const aHarness = await a.mutation(api.harnesses.create, baseHarness());
		const bHarness = await b.mutation(api.harnesses.create, baseHarness());
		await a.mutation(api.conversations.create, {
			title: "a-1",
			harnessId: aHarness,
		});
		await b.mutation(api.conversations.create, {
			title: "b-1",
			harnessId: bHarness,
		});
		const aRows = await a.query(api.conversations.list, {});
		expect(aRows.map((c) => c.title)).toEqual(["a-1"]);
	});

	it("returns [] when the requested workspace isn't owned by the user", async () => {
		const { asUser } = makeT();
		const a = asUser("u-a");
		const b = asUser("u-b");
		const wsId = await b.mutation(api.workspaces.create, { name: "w" });
		expect(
			await a.query(api.conversations.list, { workspaceId: wsId }),
		).toEqual([]);
	});

	it("filters out conversations attached to ANY workspace when listing globally", async () => {
		const a = makeT().asUser("u-a");
		const h = await a.mutation(api.harnesses.create, baseHarness());
		const wsId = await a.mutation(api.workspaces.create, { name: "w" });
		await a.mutation(api.conversations.create, {
			title: "ws-conv",
			harnessId: h,
			workspaceId: wsId,
		});
		await a.mutation(api.conversations.create, {
			title: "no-ws-conv",
			harnessId: h,
		});
		const rows = await a.query(api.conversations.list, {});
		expect(rows.map((c) => c.title)).toEqual(["no-ws-conv"]);
	});
});

describe("conversations.create", () => {
	it("requires authentication", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("u-a");
		const harness = await a.mutation(api.harnesses.create, baseHarness());
		await expect(
			raw.mutation(api.conversations.create, {
				title: "c",
				harnessId: harness,
			}),
		).rejects.toThrow(/Unauthenticated/);
	});

	it("rejects a harness owned by a different user", async () => {
		const { asUser } = makeT();
		const a = asUser("u-a");
		const b = asUser("u-b");
		const foreign = await b.mutation(api.harnesses.create, baseHarness());
		await expect(
			a.mutation(api.conversations.create, {
				title: "c",
				harnessId: foreign,
			}),
		).rejects.toThrow(/Harness not found/);
	});

	it("rejects a workspace whose harness differs from the requested harness", async () => {
		const a = makeT().asUser("u-a");
		const [h1, h2] = await Promise.all([
			a.mutation(api.harnesses.create, baseHarness({ name: "h1" })),
			a.mutation(api.harnesses.create, baseHarness({ name: "h2" })),
		]);
		const wsId = await a.mutation(api.workspaces.create, {
			name: "w",
			harnessId: h1,
		});
		await expect(
			a.mutation(api.conversations.create, {
				title: "x",
				harnessId: h2,
				workspaceId: wsId,
			}),
		).rejects.toThrow(/harness mismatch/);
	});
});

describe("conversations.updateTitle", () => {
	it("rejects when the caller doesn't own the conversation", async () => {
		const { asUser } = makeT();
		const a = asUser("u-a");
		const b = asUser("u-b");
		const h = await a.mutation(api.harnesses.create, baseHarness());
		const id = await a.mutation(api.conversations.create, {
			title: "c",
			harnessId: h,
		});
		await expect(
			b.mutation(api.conversations.updateTitle, { id, title: "x" }),
		).rejects.toThrow(/Not found/);
	});
});

describe("conversations.remove", () => {
	it("cascades delete to messages in the conversation", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("u-a");
		const h = await a.mutation(api.harnesses.create, baseHarness());
		const id = await a.mutation(api.conversations.create, {
			title: "c",
			harnessId: h,
		});
		await raw.run(async (ctx) => {
			await ctx.db.insert("messages", {
				conversationId: id,
				role: "user",
				content: "hi",
				userId: "u-a",
			});
		});
		await a.mutation(api.conversations.remove, { id });
		await raw.run(async (ctx) => {
			expect(await ctx.db.get(id)).toBeNull();
			const msgs = await ctx.db
				.query("messages")
				.withIndex("by_conversation", (q) => q.eq("conversationId", id))
				.collect();
			expect(msgs).toEqual([]);
		});
	});
});

describe("conversations.fork", () => {
	it("copies messages up-to-and-including the target", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("u-a");
		const h = await a.mutation(api.harnesses.create, baseHarness());
		const id = await a.mutation(api.conversations.create, {
			title: "c",
			harnessId: h,
		});
		const msgIds = await raw.run(async (ctx) => {
			const m1 = await ctx.db.insert("messages", {
				conversationId: id,
				role: "user",
				content: "one",
				userId: "u-a",
			});
			const m2 = await ctx.db.insert("messages", {
				conversationId: id,
				role: "assistant",
				content: "two",
				userId: "u-a",
			});
			const m3 = await ctx.db.insert("messages", {
				conversationId: id,
				role: "user",
				content: "three",
				userId: "u-a",
			});
			return [m1, m2, m3];
		});

		const newConvId = await a.mutation(api.conversations.fork, {
			conversationId: id,
			upToMessageId: msgIds[1],
		});
		await raw.run(async (ctx) => {
			const copied = await ctx.db
				.query("messages")
				.withIndex("by_conversation", (q) =>
					q.eq("conversationId", newConvId),
				)
				.collect();
			expect(copied.map((m) => m.content)).toEqual(["one", "two"]);
		});
	});

	it("throws when the target message isn't in the conversation", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("u-a");
		const h = await a.mutation(api.harnesses.create, baseHarness());
		const id = await a.mutation(api.conversations.create, {
			title: "c",
			harnessId: h,
		});
		const strayId = await raw.run(async (ctx) => {
			const other = await ctx.db.insert("conversations", {
				title: "other",
				userId: "u-a",
				lastMessageAt: Date.now(),
			});
			return await ctx.db.insert("messages", {
				conversationId: other,
				role: "user",
				content: "stray",
				userId: "u-a",
			});
		});
		await expect(
			a.mutation(api.conversations.fork, {
				conversationId: id,
				upToMessageId: strayId,
			}),
		).rejects.toThrow(/Message not found/);
	});
});

describe("conversations.editForkAndSend", () => {
	it("copies prefix messages and appends the edited user message", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("u-a");
		const h = await a.mutation(api.harnesses.create, baseHarness());
		const id = await a.mutation(api.conversations.create, {
			title: "c",
			harnessId: h,
		});
		await raw.run(async (ctx) => {
			await ctx.db.insert("messages", {
				conversationId: id,
				role: "user",
				content: "one",
				userId: "u-a",
			});
			await ctx.db.insert("messages", {
				conversationId: id,
				role: "assistant",
				content: "two",
				userId: "u-a",
			});
		});

		const newId = await a.mutation(api.conversations.editForkAndSend, {
			conversationId: id,
			upToMessageCount: 1,
			newContent: "EDITED",
		});
		await raw.run(async (ctx) => {
			const msgs = await ctx.db
				.query("messages")
				.withIndex("by_conversation", (q) => q.eq("conversationId", newId))
				.collect();
			expect(msgs.map((m) => m.content)).toEqual(["one", "EDITED"]);
		});
	});

	it("rejects an out-of-range upToMessageCount", async () => {
		const a = makeT().asUser("u-a");
		const h = await a.mutation(api.harnesses.create, baseHarness());
		const id = await a.mutation(api.conversations.create, {
			title: "c",
			harnessId: h,
		});
		await expect(
			a.mutation(api.conversations.editForkAndSend, {
				conversationId: id,
				upToMessageCount: 999,
				newContent: "x",
			}),
		).rejects.toThrow(/Invalid message count/);
	});
});

describe("conversations.searchTitlesCount", () => {
	it("returns 0 when unauthenticated", async () => {
		const { raw } = makeT();
		expect(
			await raw.query(api.conversations.searchTitlesCount, { query: "x" }),
		).toBe(0);
	});
});
