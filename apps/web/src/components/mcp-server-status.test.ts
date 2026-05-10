import { describe, expect, it, vi } from "vitest";

// The module pulls in Clerk + convex query hooks at import time; mock the
// heavier deps so the pure helper can be imported in isolation.
vi.mock("@clerk/tanstack-react-start", () => ({
	useAuth: () => ({ getToken: async () => null }),
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: () => ({}),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: undefined }),
}));
vi.mock("react-hot-toast", () => ({
	default: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("motion/react", () => ({
	AnimatePresence: ({ children }: { children: unknown }) => children,
	motion: new Proxy({}, { get: () => (props: unknown) => props }),
}));

import { parseAuthRequiredError } from "./mcp-server-status";

describe("parseAuthRequiredError", () => {
	it("returns { serverUrl, error } for an auth_required JSON payload", () => {
		const payload = JSON.stringify({
			auth_required: true,
			server_url: "https://mcp.example.com",
			error: "token expired",
		});
		expect(parseAuthRequiredError(payload)).toEqual({
			serverUrl: "https://mcp.example.com",
			error: "token expired",
		});
	});

	it("defaults error to empty string when not provided", () => {
		const payload = JSON.stringify({
			auth_required: true,
			server_url: "https://mcp.example.com",
		});
		expect(parseAuthRequiredError(payload)).toEqual({
			serverUrl: "https://mcp.example.com",
			error: "",
		});
	});

	it("returns null when auth_required is false", () => {
		const payload = JSON.stringify({
			auth_required: false,
			server_url: "https://mcp.example.com",
		});
		expect(parseAuthRequiredError(payload)).toBeNull();
	});

	it("returns null when server_url is missing", () => {
		const payload = JSON.stringify({ auth_required: true });
		expect(parseAuthRequiredError(payload)).toBeNull();
	});

	it("returns null for non-JSON input", () => {
		expect(parseAuthRequiredError("not json")).toBeNull();
	});

	it("returns null for JSON with unrelated shape", () => {
		expect(parseAuthRequiredError(JSON.stringify({ ok: true }))).toBeNull();
	});

	it("returns null for an empty string", () => {
		expect(parseAuthRequiredError("")).toBeNull();
	});
});
