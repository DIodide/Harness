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

const TOKEN = "htok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // ≥32

/** Seed a harness owned by `owner` with a SECRET-bearing MCP server + creds. */
async function seedHarness(
	raw: ReturnType<typeof convexTest>,
	owner: string,
): Promise<Id<"harnesses">> {
	return await raw.run(async (ctx) => {
		const credId = await ctx.db.insert("agentCredentials", {
			userId: owner,
			agent: "claude-code",
			kind: "oauth_token" as const,
			ciphertext: "sealed",
			createdAt: 1,
		});
		return await ctx.db.insert("harnesses", {
			name: "Owner Harness",
			model: "claude-opus-4-8",
			status: "started",
			mcpServers: [
				{
					name: "Secret API",
					url: "https://internal.example.com/mcp",
					authType: "bearer" as const,
					authToken: "sk-SUPER-SECRET",
				},
				{
					name: "Public",
					url: "https://pub.example.com",
					authType: "none" as const,
				},
			],
			skills: [{ name: "skill", description: "does things" }],
			systemPrompt: "be helpful",
			userId: owner,
			agent: "claude-code",
			agentCredentialId: credId,
			daytonaSandboxId: "owner-sandbox-123",
			sandboxEnabled: true,
		});
	});
}

describe("getSharedHarness — redaction boundary", () => {
	it("returns a REDACTED projection with no secret keys", async () => {
		const { raw, asUser } = makeT();
		const h = await seedHarness(raw, "owner");
		await asUser("owner").mutation(api.harnessShares.ensureHarnessPublicLink, {
			harnessId: h,
			role: "viewer",
			token: TOKEN,
		});
		// Anonymous viewer.
		const view = await raw.query(api.harnessShares.getSharedHarness, {
			token: TOKEN,
		});
		expect(view).not.toBeNull();
		const json = JSON.stringify(view);
		// HARD denylist — none of these may appear anywhere in the payload.
		expect(json).not.toContain("sk-SUPER-SECRET");
		expect(json).not.toContain("authToken");
		expect(json).not.toContain("internal.example.com"); // mcp url withheld
		expect(json).not.toContain("agentCredentialId");
		expect(json).not.toContain("owner-sandbox-123");
		expect(json).not.toContain("ownerUserId");
		// Allowlist present.
		expect(view?.name).toBe("Owner Harness");
		expect(view?.model).toBe("claude-opus-4-8");
		expect(view?.mcpServers).toEqual([
			{ name: "Secret API", authType: "bearer", hasAuth: true },
			{ name: "Public", authType: "none", hasAuth: false },
		]);
		expect(view?.role).toBe("viewer");
		expect(view?.sandboxEnabled).toBe(true);
	});

	it("returns null for an invalid / revoked token (never leaks existence)", async () => {
		const { raw, asUser } = makeT();
		const h = await seedHarness(raw, "owner");
		expect(
			await raw.query(api.harnessShares.getSharedHarness, { token: "nope" }),
		).toBeNull();
		const { grantId } = await asUser("owner").mutation(
			api.harnessShares.ensureHarnessPublicLink,
			{ harnessId: h, role: "viewer", token: TOKEN },
		);
		await asUser("owner").mutation(api.harnessShares.revokeHarnessShareGrant, {
			grantId,
		});
		expect(
			await raw.query(api.harnessShares.getSharedHarness, { token: TOKEN }),
		).toBeNull();
	});
});

describe("owner link management", () => {
	it("ensureHarnessPublicLink is idempotent; non-owner can't mint", async () => {
		const { raw, asUser } = makeT();
		const h = await seedHarness(raw, "owner");
		const a = await asUser("owner").mutation(
			api.harnessShares.ensureHarnessPublicLink,
			{ harnessId: h, role: "editor", token: TOKEN },
		);
		const b = await asUser("owner").mutation(
			api.harnessShares.ensureHarnessPublicLink,
			{
				harnessId: h,
				role: "editor",
				token: "htok_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			},
		);
		expect(b.grantId).toBe(a.grantId); // same active link reused
		await expect(
			asUser("intruder").mutation(api.harnessShares.ensureHarnessPublicLink, {
				harnessId: h,
				role: "viewer",
				token: TOKEN,
			}),
		).rejects.toThrow("Not found");
	});

	it("setHarnessLock + listHarnessShareGrants are owner-gated", async () => {
		const { raw, asUser } = makeT();
		const h = await seedHarness(raw, "owner");
		await asUser("owner").mutation(api.harnessShares.ensureHarnessPublicLink, {
			harnessId: h,
			role: "viewer",
			token: TOKEN,
		});
		await asUser("owner").mutation(api.harnessShares.setHarnessLock, {
			harnessId: h,
			locked: true,
		});
		const list = await asUser("owner").query(
			api.harnessShares.listHarnessShareGrants,
			{ harnessId: h },
		);
		expect(list?.locked).toBe(true);
		expect(list?.grants.length).toBe(1);
		// Non-owner gets null.
		expect(
			await asUser("intruder").query(api.harnessShares.listHarnessShareGrants, {
				harnessId: h,
			}),
		).toBeNull();
	});

	it("revoking the LAST grant one-by-one clears the lock (re-share starts unlocked)", async () => {
		const { raw, asUser } = makeT();
		const h = await seedHarness(raw, "owner");
		const link = await asUser("owner").mutation(
			api.harnessShares.ensureHarnessPublicLink,
			{ harnessId: h, role: "editor", token: TOKEN },
		);
		await asUser("owner").mutation(api.harnessShares.setHarnessLock, {
			harnessId: h,
			locked: true,
		});
		// Remove the only grant via per-recipient revoke (NOT unshareHarness).
		await asUser("owner").mutation(api.harnessShares.revokeHarnessShareGrant, {
			grantId: link.grantId,
		});
		const list = await asUser("owner").query(
			api.harnessShares.listHarnessShareGrants,
			{ harnessId: h },
		);
		expect(list?.grants.length).toBe(0);
		// Lock cleared, so a later re-share doesn't silently start locked.
		expect(list?.locked).toBe(false);
	});
});

describe("cloneSharedHarness — secrets dropped", () => {
	it("clones into the caller's account with NO authToken/credential/sandbox", async () => {
		const { raw, asUser } = makeT();
		const h = await seedHarness(raw, "owner");
		await asUser("owner").mutation(api.harnessShares.ensureHarnessPublicLink, {
			harnessId: h,
			role: "viewer",
			token: TOKEN,
		});
		const cloneId = await asUser("bob").mutation(
			api.harnessShares.cloneSharedHarness,
			{ token: TOKEN },
		);
		const clone = await raw.run(async (ctx) => ctx.db.get(cloneId));
		expect(clone?.userId).toBe("bob");
		expect(clone?.name).toBe("Copy of Owner Harness");
		expect(clone?.agentCredentialId).toBeUndefined();
		expect(clone?.daytonaSandboxId).toBeUndefined();
		expect(clone?.sandboxEnabled).toBeUndefined();
		// MCP server kept by name/url/type but authToken dropped.
		expect(clone?.mcpServers[0].authToken).toBeUndefined();
		expect(clone?.mcpServers[0].url).toBe("https://internal.example.com/mcp");
		expect(clone?.mcpServers[0].authType).toBe("bearer");
	});
});

describe("editSharedHarness — lock + role gating", () => {
	async function shareToUser(
		raw: ReturnType<typeof convexTest>,
		asUser: (
			u: string,
		) => ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
		h: Id<"harnesses">,
		grantee: string,
		role: "viewer" | "editor",
	) {
		await asUser("owner").mutation(api.harnessShares.inviteHarnessByEmail, {
			harnessId: h,
			email: "bob@x.com",
			role,
		});
		// Bind the email grant to the grantee (server-verified path).
		await raw.mutation(internal.harnessShares.bindHarnessGrantsInternal, {
			userId: grantee,
			verifiedEmails: ["bob@x.com"],
		});
	}

	it("an editor can edit safe fields while unlocked; locked blocks it", async () => {
		const { raw, asUser } = makeT();
		const h = await seedHarness(raw, "owner");
		await shareToUser(raw, asUser, h, "bob", "editor");
		await asUser("bob").mutation(api.harnessShares.editSharedHarness, {
			harnessId: h,
			patch: { name: "Edited by bob", systemPrompt: "new prompt" },
		});
		let row = await raw.run(async (ctx) => ctx.db.get(h));
		expect(row?.name).toBe("Edited by bob");
		// Lock it → editor can no longer edit.
		await asUser("owner").mutation(api.harnessShares.setHarnessLock, {
			harnessId: h,
			locked: true,
		});
		await expect(
			asUser("bob").mutation(api.harnessShares.editSharedHarness, {
				harnessId: h,
				patch: { name: "blocked" },
			}),
		).rejects.toThrow("locked");
		row = await raw.run(async (ctx) => ctx.db.get(h));
		expect(row?.name).toBe("Edited by bob"); // unchanged
	});

	it("editSharedHarness enforces the owner's systemPrompt length cap", async () => {
		const { raw, asUser } = makeT();
		const h = await seedHarness(raw, "owner");
		await shareToUser(raw, asUser, h, "bob", "editor");
		await expect(
			asUser("bob").mutation(api.harnessShares.editSharedHarness, {
				harnessId: h,
				patch: { systemPrompt: "x".repeat(4001) },
			}),
		).rejects.toThrow("at most");
	});

	it("a viewer can never edit", async () => {
		const { raw, asUser } = makeT();
		const h = await seedHarness(raw, "owner");
		await shareToUser(raw, asUser, h, "bob", "viewer");
		await expect(
			asUser("bob").mutation(api.harnessShares.editSharedHarness, {
				harnessId: h,
				patch: { name: "nope" },
			}),
		).rejects.toThrow("Not found");
	});

	it("editSharedHarness ignores secret/structural fields (only safe patch keys apply)", async () => {
		const { raw, asUser } = makeT();
		const h = await seedHarness(raw, "owner");
		await shareToUser(raw, asUser, h, "bob", "editor");
		await asUser("bob").mutation(api.harnessShares.editSharedHarness, {
			harnessId: h,
			patch: { model: "claude-haiku-4-5" },
		});
		const row = await raw.run(async (ctx) => ctx.db.get(h));
		expect(row?.model).toBe("claude-haiku-4-5");
		// mcpServers/credentials/sandbox untouched (not editable via this path).
		expect(row?.mcpServers[0].authToken).toBe("sk-SUPER-SECRET");
		expect(row?.agentCredentialId).toBeDefined();
	});

	it("never blanks the owner's name/model with an empty/whitespace value", async () => {
		const { raw, asUser } = makeT();
		const h = await seedHarness(raw, "owner");
		await shareToUser(raw, asUser, h, "bob", "editor");
		// An editor clears Name and Model then saves: empty values must be IGNORED
		// (not written), so the owner's core fields survive.
		await asUser("bob").mutation(api.harnessShares.editSharedHarness, {
			harnessId: h,
			patch: { name: "   ", model: "" },
		});
		const row = await raw.run(async (ctx) => ctx.db.get(h));
		expect(row?.name).toBe("Owner Harness");
		expect(row?.model).toBe("claude-opus-4-8");
	});
});

describe("harnesses.remove — cascades share-grant cleanup", () => {
	it("deletes the harness's grants so none are orphaned", async () => {
		const { raw, asUser } = makeT();
		const h = await seedHarness(raw, "owner");
		await asUser("owner").mutation(api.harnessShares.ensureHarnessPublicLink, {
			harnessId: h,
			role: "viewer",
			token: TOKEN,
		});
		await asUser("owner").mutation(api.harnessShares.inviteHarnessByEmail, {
			harnessId: h,
			email: "bob@x.com",
			role: "editor",
		});
		const before = await raw.run(async (ctx) =>
			ctx.db
				.query("harnessShareGrants")
				.withIndex("by_harness", (q) => q.eq("harnessId", h))
				.collect(),
		);
		expect(before.length).toBe(2);
		await asUser("owner").mutation(api.harnesses.remove, { id: h });
		const after = await raw.run(async (ctx) =>
			ctx.db
				.query("harnessShareGrants")
				.withIndex("by_harness", (q) => q.eq("harnessId", h))
				.collect(),
		);
		expect(after.length).toBe(0);
		// The public token no longer resolves to anything.
		expect(
			await raw.query(api.harnessShares.getSharedHarness, { token: TOKEN }),
		).toBeNull();
	});
});

describe("email invite → bind-later", () => {
	it("invite stores granteeEmail; bind moves it to grantedToUserId; shows in incoming", async () => {
		const { raw, asUser } = makeT();
		const h = await seedHarness(raw, "owner");
		await asUser("owner").mutation(api.harnessShares.inviteHarnessByEmail, {
			harnessId: h,
			email: "  Bob@X.com ",
			role: "editor",
		});
		// Not yet visible to bob (unbound).
		expect(
			await asUser("bob").query(
				api.harnessShares.listIncomingSharedHarnesses,
				{},
			),
		).toEqual([]);
		// Server-verified bind.
		const res = await raw.mutation(
			internal.harnessShares.bindHarnessGrantsInternal,
			{ userId: "bob", verifiedEmails: ["bob@x.com"] },
		);
		expect(res.bound).toBe(1);
		const incoming = await asUser("bob").query(
			api.harnessShares.listIncomingSharedHarnesses,
			{},
		);
		expect(incoming.length).toBe(1);
		expect(incoming[0].role).toBe("editor");
		expect(incoming[0].name).toBe("Owner Harness");
		// Idempotent re-bind doesn't double-grant.
		const again = await raw.mutation(
			internal.harnessShares.bindHarnessGrantsInternal,
			{ userId: "bob", verifiedEmails: ["bob@x.com"] },
		);
		expect(again.bound).toBe(0);
	});

	it("a viewer+editor pair for the same harness surfaces as editor (no shadowing), merged to one grant", async () => {
		const { raw, asUser } = makeT();
		const h = await seedHarness(raw, "owner");
		// Viewer invite created FIRST, editor second — same recipient, two emails.
		await asUser("owner").mutation(api.harnessShares.inviteHarnessByEmail, {
			harnessId: h,
			email: "viewer@x.com",
			role: "viewer",
		});
		await asUser("owner").mutation(api.harnessShares.inviteHarnessByEmail, {
			harnessId: h,
			email: "editor@x.com",
			role: "editor",
		});
		await raw.mutation(internal.harnessShares.bindHarnessGrantsInternal, {
			userId: "bob",
			verifiedEmails: ["viewer@x.com", "editor@x.com"],
		});
		const incoming = await asUser("bob").query(
			api.harnessShares.listIncomingSharedHarnesses,
			{},
		);
		expect(incoming.length).toBe(1); // one card per harness
		expect(incoming[0].role).toBe("editor"); // strongest grant wins
		// Merged: the user holds exactly one bound grant on this harness.
		const bound = await raw.run(async (ctx) =>
			ctx.db
				.query("harnessShareGrants")
				.withIndex("by_grantee", (q) => q.eq("grantedToUserId", "bob"))
				.collect(),
		);
		expect(bound.length).toBe(1);
		expect(bound[0].role).toBe("editor");
	});

	it("an unverified email never binds (only the server-verified list is honored)", async () => {
		const { raw, asUser } = makeT();
		const h = await seedHarness(raw, "owner");
		await asUser("owner").mutation(api.harnessShares.inviteHarnessByEmail, {
			harnessId: h,
			email: "bob@x.com",
			role: "viewer",
		});
		// Bind with a DIFFERENT verified email → no match.
		const res = await raw.mutation(
			internal.harnessShares.bindHarnessGrantsInternal,
			{ userId: "bob", verifiedEmails: ["someone-else@y.com"] },
		);
		expect(res.bound).toBe(0);
		expect(
			await asUser("bob").query(
				api.harnessShares.listIncomingSharedHarnesses,
				{},
			),
		).toEqual([]);
	});
});

describe("listMySharedHarnesses", () => {
	it("groups the owner's shares; excludes other users", async () => {
		const { raw, asUser } = makeT();
		const h = await seedHarness(raw, "owner");
		await asUser("owner").mutation(api.harnessShares.ensureHarnessPublicLink, {
			harnessId: h,
			role: "viewer",
			token: TOKEN,
		});
		await asUser("owner").mutation(api.harnessShares.inviteHarnessByEmail, {
			harnessId: h,
			email: "bob@x.com",
			role: "editor",
		});
		const mine = await asUser("owner").query(
			api.harnessShares.listMySharedHarnesses,
			{},
		);
		expect(mine.length).toBe(1);
		expect(mine[0].recipients.length).toBe(2);
		expect(mine[0].recipients.map((r) => r.kind).sort()).toEqual([
			"email",
			"link",
		]);
		expect(
			await asUser("intruder").query(
				api.harnessShares.listMySharedHarnesses,
				{},
			),
		).toEqual([]);
	});
});
