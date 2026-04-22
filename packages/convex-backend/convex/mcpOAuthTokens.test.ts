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

const SERVER = "https://mcp.example.com";

describe("mcpOAuthTokens.getStatus", () => {
	it("returns null when unauthenticated", async () => {
		const { raw } = makeT();
		expect(
			await raw.query(api.mcpOAuthTokens.getStatus, { mcpServerUrl: SERVER }),
		).toBeNull();
	});

	it("returns { connected: false } when no token row exists", async () => {
		const a = makeT().asUser("u-a");
		const res = await a.query(api.mcpOAuthTokens.getStatus, {
			mcpServerUrl: SERVER,
		});
		expect(res).toEqual({ connected: false });
	});

	it("exposes expiresAt + scopes but not tokens once stored", async () => {
		const { raw, asUser } = makeT();
		await raw.mutation(internal.mcpOAuthTokens.storeTokens, {
			userId: "u-a",
			mcpServerUrl: SERVER,
			accessToken: "secret-access",
			refreshToken: "secret-refresh",
			expiresAt: 9999,
			scopes: "read write",
			authServerUrl: "https://auth.example.com",
		});
		const res = await asUser("u-a").query(api.mcpOAuthTokens.getStatus, {
			mcpServerUrl: SERVER,
		});
		expect(res).toEqual({
			connected: true,
			expiresAt: 9999,
			scopes: "read write",
		});
		expect(JSON.stringify(res)).not.toContain("secret-access");
	});
});

describe("mcpOAuthTokens.listStatuses", () => {
	it("lists only tokens owned by the caller", async () => {
		const { raw, asUser } = makeT();
		await raw.mutation(internal.mcpOAuthTokens.storeTokens, {
			userId: "u-a",
			mcpServerUrl: SERVER,
			accessToken: "t1",
			expiresAt: 1,
			scopes: "",
			authServerUrl: "https://auth",
		});
		await raw.mutation(internal.mcpOAuthTokens.storeTokens, {
			userId: "u-b",
			mcpServerUrl: "https://other",
			accessToken: "t2",
			expiresAt: 2,
			scopes: "",
			authServerUrl: "https://auth",
		});
		const aList = await asUser("u-a").query(api.mcpOAuthTokens.listStatuses, {});
		expect(aList).toEqual([
			{ mcpServerUrl: SERVER, connected: true, expiresAt: 1, scopes: "" },
		]);
	});
});

describe("mcpOAuthTokens.storeTokens (internal)", () => {
	it("patches an existing row rather than inserting a duplicate", async () => {
		const { raw, asUser } = makeT();
		await raw.mutation(internal.mcpOAuthTokens.storeTokens, {
			userId: "u-a",
			mcpServerUrl: SERVER,
			accessToken: "old",
			expiresAt: 1000,
			scopes: "read",
			authServerUrl: "https://auth",
		});
		await raw.mutation(internal.mcpOAuthTokens.storeTokens, {
			userId: "u-a",
			mcpServerUrl: SERVER,
			accessToken: "new",
			expiresAt: 2000,
			scopes: "read write",
			authServerUrl: "https://auth",
		});
		const res = await asUser("u-a").query(api.mcpOAuthTokens.listStatuses, {});
		expect(res).toHaveLength(1);
		expect(res[0].expiresAt).toBe(2000);
	});
});

describe("mcpOAuthTokens.deleteTokens", () => {
	it("requires authentication", async () => {
		const { raw } = makeT();
		await expect(
			raw.mutation(api.mcpOAuthTokens.deleteTokens, { mcpServerUrl: SERVER }),
		).rejects.toThrow(/Unauthenticated/);
	});

	it("removes the token row for the caller only", async () => {
		const { raw, asUser } = makeT();
		await raw.mutation(internal.mcpOAuthTokens.storeTokens, {
			userId: "u-a",
			mcpServerUrl: SERVER,
			accessToken: "t",
			expiresAt: 1,
			scopes: "",
			authServerUrl: "https://auth",
		});
		await asUser("u-a").mutation(api.mcpOAuthTokens.deleteTokens, {
			mcpServerUrl: SERVER,
		});
		const res = await asUser("u-a").query(api.mcpOAuthTokens.getStatus, {
			mcpServerUrl: SERVER,
		});
		expect(res).toEqual({ connected: false });
	});

	it("is a no-op when no matching token exists", async () => {
		const a = makeT().asUser("u-a");
		await expect(
			a.mutation(api.mcpOAuthTokens.deleteTokens, { mcpServerUrl: SERVER }),
		).resolves.not.toThrow();
	});
});
