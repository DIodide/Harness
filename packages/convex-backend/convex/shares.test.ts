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

const TOKEN = "tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // ≥32 chars

/** Seed a conversation owned by `owner` with a couple of messages. */
async function seedConvo(
	raw: ReturnType<typeof convexTest>,
	owner: string,
): Promise<Id<"conversations">> {
	return await raw.run(async (ctx) => {
		const convoId = await ctx.db.insert("conversations", {
			title: "Shared chat",
			userId: owner,
			lastMessageAt: 1,
		});
		await ctx.db.insert("messages", {
			conversationId: convoId,
			userId: owner,
			role: "user",
			content: "hello there",
		});
		await ctx.db.insert("messages", {
			conversationId: convoId,
			userId: owner,
			role: "assistant",
			content: "general kenobi",
			model: "gpt-5.5",
			usage: {
				promptTokens: 10,
				completionTokens: 5,
				totalTokens: 15,
				cost: 0.001,
			},
		});
		return convoId;
	});
}

describe("shares.ensurePublicLink", () => {
	it("owner mints a link and the call is idempotent", async () => {
		const { raw, asUser } = makeT();
		const convoId = await seedConvo(raw, "u-owner");
		const a = asUser("u-owner");
		const first = await a.mutation(api.shares.ensurePublicLink, {
			conversationId: convoId,
			role: "viewer",
			token: TOKEN,
		});
		expect(first.token).toBe(TOKEN);
		expect(first.role).toBe("viewer");
		// Second call returns the SAME link, doesn't mint a duplicate.
		const second = await a.mutation(api.shares.ensurePublicLink, {
			conversationId: convoId,
			role: "viewer",
			token: "tok_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		});
		expect(second.token).toBe(TOKEN);
		const grants = await a.query(api.shares.listShareGrants, {
			conversationId: convoId,
		});
		expect(grants).toHaveLength(1);
	});

	it("rejects a non-owner", async () => {
		const { raw, asUser } = makeT();
		const convoId = await seedConvo(raw, "u-owner");
		await expect(
			asUser("u-intruder").mutation(api.shares.ensurePublicLink, {
				conversationId: convoId,
				role: "viewer",
				token: TOKEN,
			}),
		).rejects.toThrow(/Not found/);
	});

	it("rejects a too-short token", async () => {
		const { raw, asUser } = makeT();
		const convoId = await seedConvo(raw, "u-owner");
		await expect(
			asUser("u-owner").mutation(api.shares.ensurePublicLink, {
				conversationId: convoId,
				role: "viewer",
				token: "short",
			}),
		).rejects.toThrow(/too short/);
	});
});

describe("shares public viewing", () => {
	it("anonymous caller resolves a valid token to title + role", async () => {
		const { raw, asUser } = makeT();
		const convoId = await seedConvo(raw, "u-owner");
		await asUser("u-owner").mutation(api.shares.ensurePublicLink, {
			conversationId: convoId,
			role: "viewer",
			token: TOKEN,
		});
		// raw.query runs with NO identity (logged-out visitor).
		const header = await raw.query(api.shares.getSharedConversation, {
			token: TOKEN,
		});
		expect(header).not.toBeNull();
		expect(header?.title).toBe("Shared chat");
		expect(header?.role).toBe("viewer");
	});

	it("returns the full transcript but strips owner-private fields", async () => {
		const { raw, asUser } = makeT();
		const convoId = await seedConvo(raw, "u-owner");
		await asUser("u-owner").mutation(api.shares.ensurePublicLink, {
			conversationId: convoId,
			role: "viewer",
			token: TOKEN,
		});
		const msgs = await raw.query(api.shares.listSharedMessages, {
			token: TOKEN,
		});
		expect(msgs).toHaveLength(2);
		expect(msgs[0].content).toBe("hello there");
		expect(msgs[1].model).toBe("gpt-5.5");
		// Never leak userId/usage/workspaceId in the public projection.
		for (const m of msgs) {
			expect("userId" in m).toBe(false);
			expect("usage" in m).toBe(false);
			expect("workspaceId" in m).toBe(false);
		}
	});

	it("returns null/[] for an invalid token (no existence leak)", async () => {
		const { raw } = makeT();
		expect(
			await raw.query(api.shares.getSharedConversation, { token: "nope-nope-nope-nope-nope-nope-xx" }),
		).toBeNull();
		expect(
			await raw.query(api.shares.listSharedMessages, { token: "nope-nope-nope-nope-nope-nope-xx" }),
		).toEqual([]);
	});
});

describe("shares revocation", () => {
	it("revokeShareGrant makes the link return null", async () => {
		const { raw, asUser } = makeT();
		const convoId = await seedConvo(raw, "u-owner");
		const a = asUser("u-owner");
		const { grantId } = await a.mutation(api.shares.ensurePublicLink, {
			conversationId: convoId,
			role: "viewer",
			token: TOKEN,
		});
		await a.mutation(api.shares.revokeShareGrant, { grantId });
		expect(
			await raw.query(api.shares.getSharedConversation, { token: TOKEN }),
		).toBeNull();
	});

	it("non-owner cannot revoke", async () => {
		const { raw, asUser } = makeT();
		const convoId = await seedConvo(raw, "u-owner");
		const { grantId } = await asUser("u-owner").mutation(
			api.shares.ensurePublicLink,
			{ conversationId: convoId, role: "viewer", token: TOKEN },
		);
		await expect(
			asUser("u-intruder").mutation(api.shares.revokeShareGrant, { grantId }),
		).rejects.toThrow(/Not found/);
	});

	it("rotatePublicLink invalidates the old token and issues a new one", async () => {
		const { raw, asUser } = makeT();
		const convoId = await seedConvo(raw, "u-owner");
		const a = asUser("u-owner");
		await a.mutation(api.shares.ensurePublicLink, {
			conversationId: convoId,
			role: "editor",
			token: TOKEN,
		});
		const NEW = "tok_cccccccccccccccccccccccccccccccccccccccc";
		const res = await a.mutation(api.shares.rotatePublicLink, {
			conversationId: convoId,
			token: NEW,
		});
		expect(res.role).toBe("editor"); // role preserved across rotation
		expect(
			await raw.query(api.shares.getSharedConversation, { token: TOKEN }),
		).toBeNull();
		expect(
			await raw.query(api.shares.getSharedConversation, { token: NEW }),
		).not.toBeNull();
	});

	it("unshareConversation removes every grant", async () => {
		const { raw, asUser } = makeT();
		const convoId = await seedConvo(raw, "u-owner");
		const a = asUser("u-owner");
		await a.mutation(api.shares.ensurePublicLink, {
			conversationId: convoId,
			role: "viewer",
			token: TOKEN,
		});
		await a.mutation(api.shares.unshareConversation, { conversationId: convoId });
		expect(
			await a.query(api.shares.listShareGrants, { conversationId: convoId }),
		).toEqual([]);
	});
});

describe("shares.setShareRole", () => {
	it("owner flips viewer ↔ editor", async () => {
		const { raw, asUser } = makeT();
		const convoId = await seedConvo(raw, "u-owner");
		const a = asUser("u-owner");
		const { grantId } = await a.mutation(api.shares.ensurePublicLink, {
			conversationId: convoId,
			role: "viewer",
			token: TOKEN,
		});
		await a.mutation(api.shares.setShareRole, { grantId, role: "editor" });
		const header = await raw.query(api.shares.getSharedConversation, {
			token: TOKEN,
		});
		expect(header?.role).toBe("editor");
	});
});

describe("shares.forkSharedConversation", () => {
	it("an authed grantee forks the chat into their own account", async () => {
		const { raw, asUser } = makeT();
		const convoId = await seedConvo(raw, "u-owner");
		await asUser("u-owner").mutation(api.shares.ensurePublicLink, {
			conversationId: convoId,
			role: "viewer",
			token: TOKEN,
		});
		const newId = await asUser("u-forker").mutation(
			api.shares.forkSharedConversation,
			{ token: TOKEN },
		);
		// New conversation is owned by the forker, links back to the source.
		const { convo, msgs } = await raw.run(async (ctx) => {
			const convo = await ctx.db.get(newId);
			const msgs = await ctx.db
				.query("messages")
				.withIndex("by_conversation", (q) => q.eq("conversationId", newId))
				.collect();
			return { convo, msgs };
		});
		expect(convo?.userId).toBe("u-forker");
		expect(convo?.forkedFromConversationId).toBe(convoId);
		expect(msgs).toHaveLength(2);
		// Copied messages are re-stamped to the forker.
		expect(msgs.every((m) => m.userId === "u-forker")).toBe(true);
	});

	it("rejects forking an invalid/revoked token", async () => {
		const { asUser } = makeT();
		await expect(
			asUser("u-forker").mutation(api.shares.forkSharedConversation, {
				token: "nope-nope-nope-nope-nope-nope-xx",
			}),
		).rejects.toThrow(/no longer available/);
	});

	it("rejects a harnessId the forker does not own", async () => {
		const { raw, asUser } = makeT();
		const convoId = await seedConvo(raw, "u-owner");
		await asUser("u-owner").mutation(api.shares.ensurePublicLink, {
			conversationId: convoId,
			role: "viewer",
			token: TOKEN,
		});
		const otherHarness = await raw.run((ctx) =>
			ctx.db.insert("harnesses", {
				name: "owner harness",
				model: "gpt-5.5",
				status: "stopped",
				mcpServers: [],
				skills: [],
				userId: "u-owner",
			}),
		);
		await expect(
			asUser("u-forker").mutation(api.shares.forkSharedConversation, {
				token: TOKEN,
				harnessId: otherHarness,
			}),
		).rejects.toThrow(/Harness not found/);
	});
});
