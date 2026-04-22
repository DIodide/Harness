import type { UserResource } from "@clerk/types";
import { describe, expect, it, vi } from "vitest";
import {
	fetchCommandsFromApi,
	getPrincetonNetid,
	hasTigerJunctionServers,
	type McpServerEntry,
	PRESET_MCPS,
	presetIdsToServerEntries,
	sanitizeServerName,
	toMcpServerPayload,
} from "./mcp";

describe("PRESET_MCPS", () => {
	it("exposes a non-empty preset catalog", () => {
		expect(PRESET_MCPS.length).toBeGreaterThan(0);
	});

	it("ids are unique", () => {
		const ids = PRESET_MCPS.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("each preset has a server URL and auth type", () => {
		for (const p of PRESET_MCPS) {
			expect(p.server.url).toMatch(/^https?:\/\//);
			expect(["none", "bearer", "oauth", "tiger_junction"]).toContain(
				p.server.authType,
			);
		}
	});
});

describe("sanitizeServerName", () => {
	it("keeps alphanumerics, underscores, hyphens", () => {
		expect(sanitizeServerName("github-copilot_v2")).toBe("github-copilot_v2");
	});

	it("replaces spaces and punctuation with underscores", () => {
		expect(sanitizeServerName("Princeton Courses!")).toBe("Princeton_Courses_");
	});

	it("handles empty string", () => {
		expect(sanitizeServerName("")).toBe("");
	});
});

describe("toMcpServerPayload", () => {
	it("snake-cases authType and omits missing tokens", () => {
		const servers: McpServerEntry[] = [
			{ name: "A", url: "https://a", authType: "none" },
			{ name: "B", url: "https://b", authType: "bearer", authToken: "tok" },
		];
		expect(toMcpServerPayload(servers)).toEqual([
			{ name: "A", url: "https://a", auth_type: "none" },
			{ name: "B", url: "https://b", auth_type: "bearer", auth_token: "tok" },
		]);
	});

	it("returns empty array for empty input", () => {
		expect(toMcpServerPayload([])).toEqual([]);
	});
});

describe("presetIdsToServerEntries", () => {
	it("resolves known preset ids", () => {
		const entries = presetIdsToServerEntries(["github", "notion"]);
		expect(entries).toHaveLength(2);
		expect(entries[0].name).toBe("GitHub");
		expect(entries[1].name).toBe("Notion");
	});

	it("skips unknown ids silently", () => {
		const entries = presetIdsToServerEntries(["github", "nonexistent-preset"]);
		expect(entries).toHaveLength(1);
		expect(entries[0].name).toBe("GitHub");
	});

	it("handles empty input", () => {
		expect(presetIdsToServerEntries([])).toEqual([]);
	});
});

describe("hasTigerJunctionServers", () => {
	it("true when any server has tiger_junction auth", () => {
		expect(
			hasTigerJunctionServers([
				{ name: "x", url: "https://x", authType: "none" },
				{ name: "pc", url: "https://pc", authType: "tiger_junction" },
			]),
		).toBe(true);
	});

	it("false otherwise", () => {
		expect(
			hasTigerJunctionServers([
				{ name: "x", url: "https://x", authType: "none" },
				{ name: "y", url: "https://y", authType: "oauth" },
			]),
		).toBe(false);
	});

	it("false for empty list", () => {
		expect(hasTigerJunctionServers([])).toBe(false);
	});
});

describe("getPrincetonNetid", () => {
	it("returns null for null/undefined user", () => {
		expect(getPrincetonNetid(null)).toBeNull();
		expect(getPrincetonNetid(undefined)).toBeNull();
	});

	it("extracts netid from primary email", () => {
		const user = {
			primaryEmailAddress: { emailAddress: "abc123@princeton.edu" },
			emailAddresses: [],
			externalAccounts: [],
		} as unknown as UserResource;
		expect(getPrincetonNetid(user)).toBe("abc123");
	});

	it("falls through to verified email addresses", () => {
		const user = {
			primaryEmailAddress: { emailAddress: "me@gmail.com" },
			emailAddresses: [
				{
					emailAddress: "me@gmail.com",
					verification: { status: "verified" },
				},
				{
					emailAddress: "xyz789@princeton.edu",
					verification: { status: "verified" },
				},
			],
			externalAccounts: [],
		} as unknown as UserResource;
		expect(getPrincetonNetid(user)).toBe("xyz789");
	});

	it("ignores unverified princeton emails", () => {
		const user = {
			primaryEmailAddress: { emailAddress: "me@gmail.com" },
			emailAddresses: [
				{
					emailAddress: "xyz789@princeton.edu",
					verification: { status: "unverified" },
				},
			],
			externalAccounts: [],
		} as unknown as UserResource;
		expect(getPrincetonNetid(user)).toBeNull();
	});

	it("checks external accounts as final fallback", () => {
		const user = {
			primaryEmailAddress: { emailAddress: "me@gmail.com" },
			emailAddresses: [],
			externalAccounts: [
				{
					emailAddress: "netid9@princeton.edu",
					verification: { status: "verified" },
				},
			],
		} as unknown as UserResource;
		expect(getPrincetonNetid(user)).toBe("netid9");
	});

	it("returns null when nothing matches", () => {
		const user = {
			primaryEmailAddress: { emailAddress: "me@gmail.com" },
			emailAddresses: [],
			externalAccounts: [],
		} as unknown as UserResource;
		expect(getPrincetonNetid(user)).toBeNull();
	});
});

describe("fetchCommandsFromApi", () => {
	it("returns commands array on 200", async () => {
		const servers: McpServerEntry[] = [
			{ name: "x", url: "https://x", authType: "none" },
		];
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					commands: [
						{
							name: "foo",
							server: "x",
							tool: "bar",
							description: "d",
							parameters: { foo: "bar" },
						},
					],
				}),
				{ status: 200 },
			),
		);
		const result = await fetchCommandsFromApi(
			"https://api.example",
			servers,
			"tok",
		);
		expect(result).toHaveLength(1);
		expect(result?.[0].name).toBe("foo");
		expect(fetchSpy).toHaveBeenCalledWith(
			"https://api.example/api/commands/list",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					Authorization: "Bearer tok",
				}),
			}),
		);
		fetchSpy.mockRestore();
	});

	it("omits Authorization header when no token", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(
				new Response(JSON.stringify({ commands: [] }), { status: 200 }),
			);
		await fetchCommandsFromApi("https://api.example", [], null);
		const headers = (fetchSpy.mock.calls[0][1]?.headers ?? {}) as Record<
			string,
			string
		>;
		expect(headers.Authorization).toBeUndefined();
		fetchSpy.mockRestore();
	});

	it("returns null on non-ok response", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("nope", { status: 500 }));
		expect(await fetchCommandsFromApi("https://api", [], null)).toBeNull();
		fetchSpy.mockRestore();
	});

	it("returns null on thrown error", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("net"));
		expect(await fetchCommandsFromApi("https://api", [], null)).toBeNull();
		fetchSpy.mockRestore();
	});

	it("returns empty array when response has no commands key", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
		expect(await fetchCommandsFromApi("https://api", [], null)).toEqual([]);
		fetchSpy.mockRestore();
	});
});
