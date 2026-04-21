import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	ariaKeyShortcut,
	formatShortcut,
	getIsMac,
	useIsMac,
} from "./platform";

const origNavigator = globalThis.navigator;

afterEach(() => {
	Object.defineProperty(globalThis, "navigator", {
		value: origNavigator,
		configurable: true,
	});
});

describe("getIsMac", () => {
	it("returns true when userAgentData.platform says mac", () => {
		Object.defineProperty(globalThis, "navigator", {
			value: {
				userAgentData: { platform: "macOS" },
				platform: "",
				userAgent: "",
			},
			configurable: true,
		});
		expect(getIsMac()).toBe(true);
	});

	it("returns false when userAgentData.platform is Windows", () => {
		Object.defineProperty(globalThis, "navigator", {
			value: {
				userAgentData: { platform: "Windows" },
				platform: "",
				userAgent: "",
			},
			configurable: true,
		});
		expect(getIsMac()).toBe(false);
	});

	it("falls back to navigator.platform", () => {
		Object.defineProperty(globalThis, "navigator", {
			value: { platform: "MacIntel", userAgent: "" },
			configurable: true,
		});
		expect(getIsMac()).toBe(true);
	});

	it("falls back to userAgent", () => {
		Object.defineProperty(globalThis, "navigator", {
			value: { platform: "", userAgent: "Mozilla/5.0 (Macintosh)" },
			configurable: true,
		});
		expect(getIsMac()).toBe(true);
	});

	it("returns false when navigator is undefined", () => {
		const originalDescriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			"navigator",
		);
		// @ts-expect-error — intentionally deleting for SSR simulation
		delete globalThis.navigator;
		expect(getIsMac()).toBe(false);
		if (originalDescriptor) {
			Object.defineProperty(globalThis, "navigator", originalDescriptor);
		}
	});
});

describe("formatShortcut", () => {
	it("uses mac glyphs when isMac", () => {
		expect(formatShortcut(1, true)).toBe("⌘⌥1");
	});

	it("uses Ctrl+Alt when not mac", () => {
		expect(formatShortcut(3, false)).toBe("Ctrl+Alt+3");
	});
});

describe("ariaKeyShortcut", () => {
	it("returns Meta+Alt form on mac", () => {
		expect(ariaKeyShortcut(1, true)).toBe("Meta+Alt+1");
	});

	it("returns Control+Alt form off mac", () => {
		expect(ariaKeyShortcut(2, false)).toBe("Control+Alt+2");
	});
});

describe("useIsMac", () => {
	it("reports mac correctly after effect runs", () => {
		Object.defineProperty(globalThis, "navigator", {
			value: {
				userAgentData: { platform: "macOS" },
				platform: "",
				userAgent: "",
			},
			configurable: true,
		});
		const { result } = renderHook(() => useIsMac());
		expect(result.current).toBe(true);
	});

	it("returns false on non-mac", () => {
		Object.defineProperty(globalThis, "navigator", {
			value: {
				userAgentData: { platform: "Windows" },
				platform: "",
				userAgent: "",
			},
			configurable: true,
		});
		const { result } = renderHook(() => useIsMac());
		expect(result.current).toBe(false);
	});
});
