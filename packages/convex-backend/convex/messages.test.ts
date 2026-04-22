import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
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

const baseHarness = (o = {}) => ({
	name: "h",
	model: "m",
	status: "stopped" as const,
	mcpServers: [],
	skills: [],
	...o,
});

async function seedConversation(
	t: ReturnType<typeof makeT>,
	userId: string,
) {
	const u = t.asUser(userId);
	const h = await u.mutation(api.harnesses.create, baseHarness());
	const c = await u.mutation(api.conversations.create, {
		title: "c",
		harnessId: h,
	});
	return { user: u, conversationId: c, harnessId: h };
}

describe("messages.list", () => {
	it("returns [] when unauthenticated", async () => {
		const t = makeT();
		const { conversationId } = await seedConversation(t, "u-a");
		expect(
			await t.raw.query(api.messages.list, { conversationId }),
		).toEqual([]);
	});

	it("returns [] for a conversation owned by another user", async () => {
		const t = makeT();
		const { conversationId } = await seedConversation(t, "u-a");
		const b = t.asUser("u-b");
		expect(await b.query(api.messages.list, { conversationId })).toEqual([]);
	});
});

describe("messages.send", () => {
	it("requires authentication", async () => {
		const t = makeT();
		const { conversationId } = await seedConversation(t, "u-a");
		await expect(
			t.raw.mutation(api.messages.send, {
				conversationId,
				role: "user",
				content: "hi",
			}),
		).rejects.toThrow(/Unauthenticated/);
	});

	it("rejects a conversation owned by a different user", async () => {
		const t = makeT();
		const { conversationId } = await seedConversation(t, "u-a");
		const b = t.asUser("u-b");
		await expect(
			b.mutation(api.messages.send, {
				conversationId,
				role: "user",
				content: "hi",
			}),
		).rejects.toThrow(/Not found/);
	});

	it("persists message content and bumps lastMessageAt", async () => {
		const t = makeT();
		const { user, conversationId } = await seedConversation(t, "u-a");
		const before = await user.query(api.conversations.get, {
			id: conversationId,
		});
		await new Promise((r) => setTimeout(r, 2));
		await user.mutation(api.messages.send, {
			conversationId,
			role: "user",
			content: "hi",
		});
		const after = await user.query(api.conversations.get, {
			id: conversationId,
		});
		expect(after!.lastMessageAt).toBeGreaterThan(before!.lastMessageAt);
		const msgs = await user.query(api.messages.list, { conversationId });
		expect(msgs).toHaveLength(1);
		expect(msgs[0].content).toBe("hi");
	});

	it("swaps lastHarnessId when harnessId is passed", async () => {
		const t = makeT();
		const { user, conversationId } = await seedConversation(t, "u-a");
		const other = await user.mutation(
			api.harnesses.create,
			baseHarness({ name: "other" }),
		);
		await user.mutation(api.messages.send, {
			conversationId,
			role: "user",
			content: "hi",
			harnessId: other,
		});
		const convo = await user.query(api.conversations.get, {
			id: conversationId,
		});
		expect(convo!.lastHarnessId).toBe(other);
	});

	it("omits attachments field when the array is empty", async () => {
		const t = makeT();
		const { user, conversationId } = await seedConversation(t, "u-a");
		await user.mutation(api.messages.send, {
			conversationId,
			role: "user",
			content: "hi",
			attachments: [],
		});
		const [msg] = await user.query(api.messages.list, { conversationId });
		expect(msg.attachments).toBeUndefined();
	});
});

describe("messages.remove", () => {
	it("rejects when the conversation isn't owned by the caller", async () => {
		const t = makeT();
		const { user, conversationId } = await seedConversation(t, "u-a");
		const msgId = await user.mutation(api.messages.send, {
			conversationId,
			role: "user",
			content: "hi",
		});
		const b = t.asUser("u-b");
		await expect(
			b.mutation(api.messages.remove, { id: msgId }),
		).rejects.toThrow(/Not found/);
	});
});

describe("messages.patchMessageUsage (internal)", () => {
	it("patches usage on the last assistant message", async () => {
		const t = makeT();
		const { user, conversationId } = await seedConversation(t, "u-a");
		await t.raw.run(async (ctx) => {
			await ctx.db.insert("messages", {
				conversationId,
				role: "user",
				content: "q",
				userId: "u-a",
			});
			await ctx.db.insert("messages", {
				conversationId,
				role: "assistant",
				content: "r",
				userId: "u-a",
			});
		});
		await t.raw.mutation(internal.messages.patchMessageUsage, {
			conversationId,
			usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
			model: "claude-opus-4-7",
		});
		const msgs = await user.query(api.messages.list, { conversationId });
		const last = msgs[msgs.length - 1];
		expect(last.usage).toEqual({
			promptTokens: 1,
			completionTokens: 2,
			totalTokens: 3,
		});
		expect(last.model).toBe("claude-opus-4-7");
	});

	it("does nothing when the last message is from the user", async () => {
		const t = makeT();
		const { user, conversationId } = await seedConversation(t, "u-a");
		await t.raw.run(async (ctx) => {
			await ctx.db.insert("messages", {
				conversationId,
				role: "user",
				content: "lonely",
				userId: "u-a",
			});
		});
		await t.raw.mutation(internal.messages.patchMessageUsage, {
			conversationId,
			usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
		});
		const [msg] = await user.query(api.messages.list, { conversationId });
		expect(msg.usage).toBeUndefined();
	});
});
