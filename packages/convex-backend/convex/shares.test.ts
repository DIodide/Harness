import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
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
		// Anonymous viewer is never the owner.
		expect(header?.viewerIsOwner).toBe(false);
	});

	it("reports viewerIsOwner only for the owner, and exposes author name+avatar (no email)", async () => {
		const { raw, asUser } = makeT();
		const convoId = await seedConvo(raw, "u-owner");
		await asUser("u-owner").mutation(api.shares.ensurePublicLink, {
			conversationId: convoId,
			role: "viewer",
			token: TOKEN,
			ownerName: "Ada Lovelace",
			ownerImageUrl: "https://img.example/ada.png",
		});
		const asOwner = await asUser("u-owner").query(
			api.shares.getSharedConversation,
			{ token: TOKEN },
		);
		expect(asOwner?.viewerIsOwner).toBe(true);
		const asOther = await asUser("u-other").query(
			api.shares.getSharedConversation,
			{ token: TOKEN },
		);
		expect(asOther?.viewerIsOwner).toBe(false);
		// Author attribution is present; email is never part of the projection.
		expect(asOther?.ownerName).toBe("Ada Lovelace");
		expect(asOther?.ownerImageUrl).toBe("https://img.example/ada.png");
		expect("ownerEmail" in (asOther ?? {})).toBe(false);
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

// ── Phase 2: editor-grant collaboration ─────────────────────────────────

/** Mint a public link of the given role for `convoId`, owned by u-owner. */
async function mintLink(
	asUser: (uid: string) => ReturnType<ReturnType<typeof makeT>["asUser"]>,
	convoId: Id<"conversations">,
	role: "viewer" | "editor",
	token = TOKEN,
) {
	return asUser("u-owner").mutation(api.shares.ensurePublicLink, {
		conversationId: convoId,
		role,
		token,
	});
}

describe("shares.checkConversationAccess (internal access oracle)", () => {
	it("classifies owner, editor-link holder, viewer-link holder, and none", async () => {
		const { raw, asUser } = makeT();
		const convoId = await seedConvo(raw, "u-owner");
		await mintLink(asUser, convoId, "editor");

		// Owner — no token needed.
		expect(
			await raw.query(internal.shares.checkConversationAccess, {
				conversationId: convoId,
				userId: "u-owner",
			}),
		).toBe("owner");

		// Signed-in holder of an active editor link → editor (link-first).
		expect(
			await raw.query(internal.shares.checkConversationAccess, {
				conversationId: convoId,
				userId: "u-collab",
				token: TOKEN,
			}),
		).toBe("editor");

		// Same person without the token → none (no per-user grant exists).
		expect(
			await raw.query(internal.shares.checkConversationAccess, {
				conversationId: convoId,
				userId: "u-collab",
			}),
		).toBe("none");
	});

	it("a viewer link never confers editor; a token for another convo confers nothing", async () => {
		const { raw, asUser } = makeT();
		const convoA = await seedConvo(raw, "u-owner");
		const convoB = await seedConvo(raw, "u-owner");
		await mintLink(asUser, convoA, "viewer", TOKEN);
		const OTHER = "tok_dddddddddddddddddddddddddddddddddddddddd";
		await mintLink(asUser, convoB, "editor", OTHER);

		// Viewer link → viewer (not editor).
		expect(
			await raw.query(internal.shares.checkConversationAccess, {
				conversationId: convoA,
				userId: "u-collab",
				token: TOKEN,
			}),
		).toBe("viewer");

		// convoB's editor token presented against convoA → confers nothing.
		expect(
			await raw.query(internal.shares.checkConversationAccess, {
				conversationId: convoA,
				userId: "u-collab",
				token: OTHER,
			}),
		).toBe("none");
	});

	it("revoking the editor link immediately drops access to none", async () => {
		const { raw, asUser } = makeT();
		const convoId = await seedConvo(raw, "u-owner");
		const { grantId } = await mintLink(asUser, convoId, "editor");
		await asUser("u-owner").mutation(api.shares.revokeShareGrant, { grantId });
		expect(
			await raw.query(internal.shares.checkConversationAccess, {
				conversationId: convoId,
				userId: "u-collab",
				token: TOKEN,
			}),
		).toBe("none");
	});
});

describe("shares.sendShared (collaborator user message)", () => {
	it("an editor-link holder sends, attributed to themselves with a name/avatar snapshot", async () => {
		const { raw, asUser } = makeT();
		const convoId = await seedConvo(raw, "u-owner");
		await mintLink(asUser, convoId, "editor");

		await asUser("u-collab").mutation(api.shares.sendShared, {
			token: TOKEN,
			conversationId: convoId,
			content: "hi from a collaborator",
			authorName: "Grace Hopper",
			authorImageUrl: "https://img.example/grace.png",
		});

		// The owner sees it in their owner-gated list, attributed to the sender.
		const ownerView = await asUser("u-owner").query(api.messages.list, {
			conversationId: convoId,
		});
		const collabMsg = ownerView.find(
			(m) => m.content === "hi from a collaborator",
		);
		expect(collabMsg?.userId).toBe("u-collab");
		expect(collabMsg?.authorName).toBe("Grace Hopper");

		// The public projection shows name+avatar but never userId/email.
		const shared = await raw.query(api.shares.listSharedMessages, {
			token: TOKEN,
		});
		const pub = shared.find((m) => m.content === "hi from a collaborator");
		expect(pub?.authorName).toBe("Grace Hopper");
		expect(pub?.authorImageUrl).toBe("https://img.example/grace.png");
		expect("userId" in (pub ?? {})).toBe(false);
	});

	it("a viewer-link holder cannot send", async () => {
		const { raw, asUser } = makeT();
		const convoId = await seedConvo(raw, "u-owner");
		await mintLink(asUser, convoId, "viewer");
		await expect(
			asUser("u-collab").mutation(api.shares.sendShared, {
				token: TOKEN,
				conversationId: convoId,
				content: "nope",
			}),
		).rejects.toThrow(/Not found/);
	});

	it("drops a non-https avatar URL but keeps the message", async () => {
		const { raw, asUser } = makeT();
		const convoId = await seedConvo(raw, "u-owner");
		await mintLink(asUser, convoId, "editor");
		await asUser("u-collab").mutation(api.shares.sendShared, {
			token: TOKEN,
			conversationId: convoId,
			content: "with a bad avatar",
			authorName: "X",
			authorImageUrl: "javascript:alert(1)",
		});
		const shared = await raw.query(api.shares.listSharedMessages, {
			token: TOKEN,
		});
		const pub = shared.find((m) => m.content === "with a bad avatar");
		expect(pub).toBeTruthy();
		expect(pub?.authorImageUrl).toBeUndefined();
	});
});

describe("shares editor delete/regenerate", () => {
	it("an editor can removeFrom (regenerate) via the token; a viewer cannot", async () => {
		const { raw, asUser } = makeT();
		const convoId = await seedConvo(raw, "u-owner");
		const { grantId } = await mintLink(asUser, convoId, "editor");
		const msgs = await raw.query(api.shares.listSharedMessages, { token: TOKEN });
		const lastId = msgs[msgs.length - 1]._id as Id<"messages">;

		// Downgrade to viewer → cannot delete.
		await asUser("u-owner").mutation(api.shares.setShareRole, {
			grantId,
			role: "viewer",
		});
		await expect(
			asUser("u-collab").mutation(api.messages.removeFrom, {
				id: lastId,
				token: TOKEN,
			}),
		).rejects.toThrow(/Not found/);

		// Back to editor → can delete from.
		await asUser("u-owner").mutation(api.shares.setShareRole, {
			grantId,
			role: "editor",
		});
		await asUser("u-collab").mutation(api.messages.removeFrom, {
			id: lastId,
			token: TOKEN,
		});
		const after = await raw.query(api.shares.listSharedMessages, { token: TOKEN });
		expect(after).toHaveLength(1);
	});
});

describe("harnesses.resolveForCollab (server-side owner harness)", () => {
	async function seedConvoWithHarness(
		raw: ReturnType<typeof convexTest>,
		owner: string,
	) {
		return raw.run(async (ctx) => {
			const harnessId = await ctx.db.insert("harnesses", {
				name: "Owner Harness",
				model: "anthropic/claude-fable-5",
				status: "started",
				mcpServers: [
					{
						name: "GitHub",
						url: "https://mcp.example/github",
						authType: "bearer" as const,
						authToken: "secret-bearer-xyz",
					},
				],
				skills: [{ name: "deploy", description: "ship it" }],
				agent: "claude-code",
				userId: owner,
			});
			const convoId = await ctx.db.insert("conversations", {
				title: "Agent chat",
				userId: owner,
				lastMessageAt: 1,
				lastHarnessId: harnessId,
			});
			return { harnessId, convoId };
		});
	}

	it("returns the owner's full harness (incl. agent + MCP token) for an editor", async () => {
		const { raw, asUser } = makeT();
		const { convoId } = await seedConvoWithHarness(raw, "u-owner");
		await mintLink(asUser, convoId, "editor");

		const resolved = await raw.query(internal.harnesses.resolveForCollab, {
			conversationId: convoId,
			requesterUserId: "u-collab",
			token: TOKEN,
		});
		expect(resolved?.ownerUserId).toBe("u-owner");
		expect(resolved?.agent).toBe("claude-code");
		// Server-side resolution carries the owner's MCP bearer token (the
		// browser never calls this internalQuery).
		expect(resolved?.mcpServers[0].authToken).toBe("secret-bearer-xyz");
	});

	it("returns null for a viewer (fail closed)", async () => {
		const { raw, asUser } = makeT();
		const { convoId } = await seedConvoWithHarness(raw, "u-owner");
		await mintLink(asUser, convoId, "viewer");
		expect(
			await raw.query(internal.harnesses.resolveForCollab, {
				conversationId: convoId,
				requesterUserId: "u-collab",
				token: TOKEN,
			}),
		).toBeNull();
	});
});

describe("messages.saveAssistantMessage defense-in-depth", () => {
	it("rejects a non-owner requester without an editor grant", async () => {
		const { raw } = makeT();
		const convoId = await seedConvo(raw, "u-owner");
		await expect(
			raw.mutation(internal.messages.saveAssistantMessage, {
				conversationId: convoId,
				content: "injected",
				requesterUserId: "u-intruder",
			}),
		).rejects.toThrow(/Not authorized/);
	});

	it("allows an editor-grant collaborator (with token) and owner-attributes the message", async () => {
		const { raw, asUser } = makeT();
		const convoId = await seedConvo(raw, "u-owner");
		await mintLink(asUser, convoId, "editor");
		await raw.mutation(internal.messages.saveAssistantMessage, {
			conversationId: convoId,
			content: "collab-triggered reply",
			requesterUserId: "u-collab",
			requesterToken: TOKEN,
		});
		const ownerView = await asUser("u-owner").query(api.messages.list, {
			conversationId: convoId,
		});
		const reply = ownerView.find((m) => m.content === "collab-triggered reply");
		// Assistant message stays owner-attributed regardless of who triggered.
		expect(reply?.userId).toBe("u-owner");
	});
});
