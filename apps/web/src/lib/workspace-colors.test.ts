import { describe, expect, it } from "vitest";
import { getWorkspaceColorHex, WORKSPACE_COLORS } from "./workspace-colors";

describe("WORKSPACE_COLORS", () => {
	it("exposes 8 color entries", () => {
		expect(WORKSPACE_COLORS).toHaveLength(8);
	});

	it("each entry has key, label, hex", () => {
		for (const color of WORKSPACE_COLORS) {
			expect(color.key).toMatch(/^[a-z]+$/);
			expect(color.label).toMatch(/^[A-Z]/);
			expect(color.hex).toMatch(/^#[0-9A-F]{6}$/);
		}
	});

	it("keys are unique", () => {
		const keys = WORKSPACE_COLORS.map((c) => c.key);
		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe("getWorkspaceColorHex", () => {
	it("returns hex for known key", () => {
		expect(getWorkspaceColorHex("rose")).toBe("#FFD9DE");
		expect(getWorkspaceColorHex("mint")).toBe("#D4EEDB");
	});

	it("returns null for unknown key", () => {
		expect(getWorkspaceColorHex("fuchsia")).toBeNull();
	});

	it("returns null for null / undefined / empty", () => {
		expect(getWorkspaceColorHex(null)).toBeNull();
		expect(getWorkspaceColorHex(undefined)).toBeNull();
		expect(getWorkspaceColorHex("")).toBeNull();
	});
});
