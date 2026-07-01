import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

function makeT() {
	const raw = convexTest(schema, modules);
	return {
		raw,
		asUser: (uid: string) => raw.withIdentity({ subject: uid, issuer: "test" }),
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

	it("includes workspace-assigned conversations when listing globally (tinted client-side)", async () => {
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
		expect(rows.map((c) => c.title).sort()).toEqual(["no-ws-conv", "ws-conv"]);
	});

	it("sorts pinned conversations to the top, newest-pin first", async () => {
		const a = makeT().asUser("u-a");
		const h = await a.mutation(api.harnesses.create, baseHarness());
		const c1 = await a.mutation(api.conversations.create, {
			title: "c1",
			harnessId: h,
		});
		await a.mutation(api.conversations.create, {
			title: "c2",
			harnessId: h,
		});
		const c3 = await a.mutation(api.conversations.create, {
			title: "c3",
			harnessId: h,
		});
		// Pin c1 then c3 — both should sort above the unpinned c2, c3 first
		// (most-recently-pinned on top).
		await a.mutation(api.conversations.setPinned, { id: c1, pinned: true });
		await a.mutation(api.conversations.setPinned, { id: c3, pinned: true });
		const rows = await a.query(api.conversations.list, {});
		expect(rows.map((c) => c.title)).toEqual(["c3", "c1", "c2"]);
		// Unpin c3 — it drops back into recency order.
		await a.mutation(api.conversations.setPinned, { id: c3, pinned: false });
		const rows2 = await a.query(api.conversations.list, {});
		expect(rows2[0].title).toBe("c1");
	});

	it("keeps a pinned chat visible even when it's far outside the recency window", async () => {
		const a = makeT().asUser("u-a");
		const h = await a.mutation(api.harnesses.create, baseHarness());
		// Oldest conversation — pin it, then bury it under 110 newer ones (past
		// the 100-row recency cap). The separate pinned fetch must still surface it.
		const old = await a.mutation(api.conversations.create, {
			title: "old-pinned",
			harnessId: h,
		});
		await a.mutation(api.conversations.setPinned, { id: old, pinned: true });
		for (let i = 0; i < 110; i++) {
			await a.mutation(api.conversations.create, {
				title: `filler-${i}`,
				harnessId: h,
			});
		}
		const rows = await a.query(api.conversations.list, {});
		expect(rows[0].title).toBe("old-pinned");
		expect(rows.some((c) => c.title === "old-pinned")).toBe(true);
	});

	it("doesn't let edit-fork siblings crowd visible chats out of the window", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("u-a");
		const h = await a.mutation(api.harnesses.create, baseHarness());
		const real = await a.mutation(api.conversations.create, {
			title: "real-chat",
			harnessId: h,
		});
		// Bury it under 120 edit-fork siblings (fresh lastMessageAt, NOT
		// user-visible). They must be filtered during the scan, not after take().
		await raw.run(async (ctx) => {
			for (let i = 0; i < 120; i++) {
				await ctx.db.insert("conversations", {
					title: `edit-${i}`,
					userId: "u-a",
					lastMessageAt: Date.now() + 1000 + i,
					editParentConversationId: real,
				});
			}
		});
		const rows = await a.query(api.conversations.list, {});
		expect(rows.some((c) => c.title === "real-chat")).toBe(true);
		expect(rows.some((c) => c.title.startsWith("edit-"))).toBe(false);
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
				.withIndex("by_conversation", (q) => q.eq("conversationId", newConvId))
				.collect();
			expect(copied.map((m) => m.content)).toEqual(["one", "two"]);
		});
	});

	it("names forks 'X (fork)' then 'X (fork 2)', stripping an existing suffix from the base", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("u-a");
		const h = await a.mutation(api.harnesses.create, baseHarness());
		const id = await a.mutation(api.conversations.create, {
			title: "Recipes",
			harnessId: h,
		});
		const msg = await raw.run(async (ctx) =>
			ctx.db.insert("messages", {
				conversationId: id,
				role: "user",
				content: "x",
				userId: "u-a",
			}),
		);
		const f1 = await a.mutation(api.conversations.fork, {
			conversationId: id,
			upToMessageId: msg,
		});
		expect((await a.query(api.conversations.get, { id: f1 }))?.title).toBe(
			"Recipes (fork)",
		);
		const f2 = await a.mutation(api.conversations.fork, {
			conversationId: id,
			upToMessageId: msg,
		});
		expect((await a.query(api.conversations.get, { id: f2 }))?.title).toBe(
			"Recipes (fork 2)",
		);
		// Forking the fork (titled "Recipes (fork)") strips the suffix and
		// continues the sequence instead of nesting "(fork) (fork)".
		const f1msg = await raw.run(async (ctx) => {
			const m = await ctx.db
				.query("messages")
				.withIndex("by_conversation", (q) => q.eq("conversationId", f1))
				.first();
			return m?._id as Id<"messages">;
		});
		const f3 = await a.mutation(api.conversations.fork, {
			conversationId: f1,
			upToMessageId: f1msg,
		});
		expect((await a.query(api.conversations.get, { id: f3 }))?.title).toBe(
			"Recipes (fork 3)",
		);
	});

	it("fork-naming prefix scan doesn't false-match a different, longer title", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("u-a");
		const h = await a.mutation(api.harnesses.create, baseHarness());
		// "Doc" and "Document" share a prefix; a fork of "Doc" must not treat
		// "Document" as a sibling (nextForkTitle requires an exact base match).
		const doc = await a.mutation(api.conversations.create, {
			title: "Doc",
			harnessId: h,
		});
		await a.mutation(api.conversations.create, {
			title: "Document",
			harnessId: h,
		});
		const msg = await raw.run(async (ctx) =>
			ctx.db.insert("messages", {
				conversationId: doc,
				role: "user",
				content: "x",
				userId: "u-a",
			}),
		);
		const f = await a.mutation(api.conversations.fork, {
			conversationId: doc,
			upToMessageId: msg,
		});
		expect((await a.query(api.conversations.get, { id: f }))?.title).toBe(
			"Doc (fork)",
		);
	});

	it("truncates the boundary assistant message when truncateLastPartCount is set, leaving the original intact", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("u-a");
		const h = await a.mutation(api.harnesses.create, baseHarness());
		const id = await a.mutation(api.conversations.create, {
			title: "c",
			harnessId: h,
		});
		const ids = await raw.run(async (ctx) => {
			const m1 = await ctx.db.insert("messages", {
				conversationId: id,
				role: "user",
				content: "q1",
				userId: "u-a",
			});
			const m2 = await ctx.db.insert("messages", {
				conversationId: id,
				role: "assistant",
				content: "AB",
				userId: "u-a",
				parts: [
					{ type: "text" as const, content: "A" },
					{ type: "tool_call" as const, tool: "Read", call_id: "c1" },
					{ type: "text" as const, content: "B" },
				],
			});
			return [m1, m2];
		});

		const newConvId = await a.mutation(api.conversations.fork, {
			conversationId: id,
			upToMessageId: ids[1],
			truncateLastPartCount: 1,
		});
		await raw.run(async (ctx) => {
			const copied = await ctx.db
				.query("messages")
				.withIndex("by_conversation", (q) => q.eq("conversationId", newConvId))
				.collect();
			expect(copied.map((m) => m.content)).toEqual(["q1", "A"]);
			expect(copied[1].parts?.length).toBe(1);
			// Original conversation must be untouched.
			const orig = await ctx.db
				.query("messages")
				.withIndex("by_conversation", (q) => q.eq("conversationId", id))
				.collect();
			expect(orig.map((m) => m.content)).toEqual(["q1", "AB"]);
			expect(orig[1].parts?.length).toBe(3);
		});
	});

	it("ignores truncateLastPartCount when out of range (copies the full message)", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("u-a");
		const h = await a.mutation(api.harnesses.create, baseHarness());
		const id = await a.mutation(api.conversations.create, {
			title: "c",
			harnessId: h,
		});
		const ids = await raw.run(async (ctx) => {
			const m1 = await ctx.db.insert("messages", {
				conversationId: id,
				role: "assistant",
				content: "AB",
				userId: "u-a",
				parts: [
					{ type: "text" as const, content: "A" },
					{ type: "text" as const, content: "B" },
				],
			});
			return [m1];
		});
		const newConvId = await a.mutation(api.conversations.fork, {
			conversationId: id,
			upToMessageId: ids[0],
			truncateLastPartCount: 5, // >= parts.length → no truncation
		});
		await raw.run(async (ctx) => {
			const copied = await ctx.db
				.query("messages")
				.withIndex("by_conversation", (q) => q.eq("conversationId", newConvId))
				.collect();
			expect(copied[0].content).toBe("AB");
			expect(copied[0].parts?.length).toBe(2);
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

describe("conversations.ensureInWorkspace", () => {
	it("returns the existing workspace when the convo already has one", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("u-owner");
		const wsId = await a.mutation(api.workspaces.create, { name: "W" });
		const convoId = await raw.run((ctx) =>
			ctx.db.insert("conversations", {
				title: "t",
				userId: "u-owner",
				workspaceId: wsId,
				lastMessageAt: 1,
			}),
		);
		const out = await a.mutation(api.conversations.ensureInWorkspace, {
			conversationId: convoId,
		});
		expect(out).toBe(wsId);
	});

	it("adopts a workspace-less (legacy) convo into the owner's Default and re-stamps its messages", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("u-owner");
		const { convoId, msgIds } = await raw.run(async (ctx) => {
			const convoId = await ctx.db.insert("conversations", {
				title: "legacy",
				userId: "u-owner",
				lastMessageAt: 1,
			});
			const m1 = await ctx.db.insert("messages", {
				conversationId: convoId,
				userId: "u-owner",
				role: "user",
				content: "hi",
			});
			const m2 = await ctx.db.insert("messages", {
				conversationId: convoId,
				userId: "u-owner",
				role: "assistant",
				content: "hello",
			});
			return { convoId, msgIds: [m1, m2] };
		});
		const wsId = await a.mutation(api.conversations.ensureInWorkspace, {
			conversationId: convoId,
		});
		const ws = await a.query(api.workspaces.get, { id: wsId });
		expect(ws?.isDefault).toBe(true);
		const convo = await raw.run((ctx) => ctx.db.get(convoId));
		expect(convo?.workspaceId).toBe(wsId);
		// Every message row is re-stamped so workspace-scoped content search finds
		// the adopted conversation's history.
		await raw.run(async (ctx) => {
			for (const id of msgIds) {
				const m = await ctx.db.get(id);
				expect(m?.workspaceId).toBe(wsId);
			}
		});
	});

	it("rejects a non-owner", async () => {
		const { raw, asUser } = makeT();
		const convoId = await raw.run((ctx) =>
			ctx.db.insert("conversations", {
				title: "t",
				userId: "u-owner",
				lastMessageAt: 1,
			}),
		);
		await expect(
			asUser("u-intruder").mutation(api.conversations.ensureInWorkspace, {
				conversationId: convoId,
			}),
		).rejects.toThrow(/Not found/);
	});
});

describe("conversations.moveToWorkspace", () => {
	it("moves a conversation and re-stamps its messages' workspaceId", async () => {
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
				content: "m",
				userId: "u-a",
			});
		});
		const wsId = await a.mutation(api.workspaces.create, { name: "W" });
		await a.mutation(api.conversations.moveToWorkspace, {
			id,
			workspaceId: wsId,
		});
		expect((await a.query(api.conversations.get, { id }))?.workspaceId).toBe(
			wsId,
		);
		await raw.run(async (ctx) => {
			const msgs = await ctx.db
				.query("messages")
				.withIndex("by_conversation", (q) => q.eq("conversationId", id))
				.collect();
			expect(msgs.every((m) => m.workspaceId === wsId)).toBe(true);
		});
	});

	it("rejects moving to a workspace the caller doesn't own", async () => {
		const { asUser } = makeT();
		const a = asUser("u-a");
		const b = asUser("u-b");
		const h = await a.mutation(api.harnesses.create, baseHarness());
		const id = await a.mutation(api.conversations.create, {
			title: "c",
			harnessId: h,
		});
		const bws = await b.mutation(api.workspaces.create, { name: "bw" });
		await expect(
			a.mutation(api.conversations.moveToWorkspace, {
				id,
				workspaceId: bws,
			}),
		).rejects.toThrow();
	});
});
