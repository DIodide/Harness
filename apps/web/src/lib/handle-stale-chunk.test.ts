import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	isChunkLoadError,
	reloadOnceForStaleChunk,
} from "./handle-stale-chunk";

describe("isChunkLoadError", () => {
	it("matches dynamic-import / chunk-load failures across browsers", () => {
		const messages = [
			"Failed to fetch dynamically imported module: https://x/assets/terminal-9kjA_xFH.js",
			"error loading dynamically imported module",
			"Importing a module script failed.",
			"Loading chunk 42 failed",
		];
		for (const m of messages) {
			expect(isChunkLoadError(new Error(m))).toBe(true);
		}
		const named = new Error("boom");
		named.name = "ChunkLoadError";
		expect(isChunkLoadError(named)).toBe(true);
		// string errors too
		expect(
			isChunkLoadError("Failed to fetch dynamically imported module: a"),
		).toBe(true);
	});

	it("ignores unrelated errors", () => {
		expect(isChunkLoadError(new Error("NoAuthProvider"))).toBe(false);
		expect(isChunkLoadError(new Error("Network request failed"))).toBe(false);
		expect(isChunkLoadError(null)).toBe(false);
		expect(isChunkLoadError(undefined)).toBe(false);
		expect(isChunkLoadError({})).toBe(false);
	});
});

describe("reloadOnceForStaleChunk", () => {
	const original = window.location;
	let reload: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		reload = vi.fn();
		// jsdom won't let location.reload be redefined directly — swap the whole
		// location object (the helper only ever calls window.location.reload()).
		Object.defineProperty(window, "location", {
			configurable: true,
			value: { ...original, reload },
		});
		sessionStorage.clear();
	});

	afterEach(() => {
		Object.defineProperty(window, "location", {
			configurable: true,
			value: original,
		});
		vi.restoreAllMocks();
	});

	it("reloads once, then respects the cooldown (no loop)", () => {
		expect(reloadOnceForStaleChunk()).toBe(true);
		expect(reload).toHaveBeenCalledTimes(1);

		// A second call within the cooldown must NOT reload again.
		expect(reloadOnceForStaleChunk()).toBe(false);
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it("does not reload when a reload happened recently", () => {
		sessionStorage.setItem("harness:chunk-reload-at", String(Date.now()));
		expect(reloadOnceForStaleChunk()).toBe(false);
		expect(reload).not.toHaveBeenCalled();
	});
});
