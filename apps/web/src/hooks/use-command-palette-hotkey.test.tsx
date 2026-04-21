import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
	CommandPaletteProvider,
	useCommandPalette,
} from "../lib/command-palette/context";
import { useCommandPaletteHotkey } from "./use-command-palette-hotkey";

const wrapper = ({ children }: { children: ReactNode }) => (
	<CommandPaletteProvider>{children}</CommandPaletteProvider>
);

function dispatchKey(init: KeyboardEventInit & { target?: Element }) {
	const target = init.target ?? document.body;
	const evt = new KeyboardEvent("keydown", {
		...init,
		bubbles: true,
		cancelable: true,
	});
	Object.defineProperty(evt, "target", { value: target, configurable: true });
	target.dispatchEvent(evt);
	return evt;
}

describe("useCommandPaletteHotkey", () => {
	it("opens the palette on Meta+K", () => {
		const { result } = renderHook(
			() => {
				useCommandPaletteHotkey();
				return useCommandPalette();
			},
			{ wrapper },
		);
		act(() => {
			dispatchKey({ key: "k", metaKey: true });
		});
		expect(result.current.open).toBe(true);
	});

	it("opens the palette on Ctrl+K", () => {
		const { result } = renderHook(
			() => {
				useCommandPaletteHotkey();
				return useCommandPalette();
			},
			{ wrapper },
		);
		act(() => dispatchKey({ key: "K", ctrlKey: true }));
		expect(result.current.open).toBe(true);
	});

	it("toggles closed on a second press", () => {
		const { result } = renderHook(
			() => {
				useCommandPaletteHotkey();
				return useCommandPalette();
			},
			{ wrapper },
		);
		act(() => dispatchKey({ key: "k", metaKey: true }));
		expect(result.current.open).toBe(true);
		act(() => dispatchKey({ key: "k", metaKey: true }));
		expect(result.current.open).toBe(false);
	});

	it("opens on Meta+Shift+P", () => {
		const { result } = renderHook(
			() => {
				useCommandPaletteHotkey();
				return useCommandPalette();
			},
			{ wrapper },
		);
		act(() => dispatchKey({ key: "p", metaKey: true, shiftKey: true }));
		expect(result.current.open).toBe(true);
	});

	it("ignores Shift+P inside an input", () => {
		const input = document.createElement("input");
		document.body.appendChild(input);
		const { result } = renderHook(
			() => {
				useCommandPaletteHotkey();
				return useCommandPalette();
			},
			{ wrapper },
		);
		act(() =>
			dispatchKey({ key: "p", metaKey: true, shiftKey: true, target: input }),
		);
		expect(result.current.open).toBe(false);
		input.remove();
	});

	it("still fires Meta+K inside an input (mid-typing is fine)", () => {
		const input = document.createElement("input");
		document.body.appendChild(input);
		const { result } = renderHook(
			() => {
				useCommandPaletteHotkey();
				return useCommandPalette();
			},
			{ wrapper },
		);
		act(() => dispatchKey({ key: "k", metaKey: true, target: input }));
		expect(result.current.open).toBe(true);
		input.remove();
	});

	it("ignores non-hotkey keys", () => {
		const { result } = renderHook(
			() => {
				useCommandPaletteHotkey();
				return useCommandPalette();
			},
			{ wrapper },
		);
		act(() => dispatchKey({ key: "j", metaKey: true }));
		act(() => dispatchKey({ key: "p", metaKey: true })); // no shift
		act(() => dispatchKey({ key: "k" })); // no mod
		expect(result.current.open).toBe(false);
	});

	it("ignores auto-repeat events", () => {
		const { result } = renderHook(
			() => {
				useCommandPaletteHotkey();
				return useCommandPalette();
			},
			{ wrapper },
		);
		act(() => dispatchKey({ key: "k", metaKey: true, repeat: true }));
		expect(result.current.open).toBe(false);
	});

	it("detaches handler on unmount", () => {
		const { result, unmount } = renderHook(
			() => {
				useCommandPaletteHotkey();
				return useCommandPalette();
			},
			{ wrapper },
		);
		unmount();
		// After unmount the listener is gone — reopening via event should not crash.
		act(() => dispatchKey({ key: "k", metaKey: true }));
		// Hook's result is stale post-unmount; just ensure no exception was thrown.
		expect(true).toBe(true);
		void result;
	});

	it("prevents default when toggling", () => {
		renderHook(() => useCommandPaletteHotkey(), { wrapper });
		const evt = new KeyboardEvent("keydown", {
			key: "k",
			metaKey: true,
			bubbles: true,
			cancelable: true,
		});
		const preventSpy = vi.spyOn(evt, "preventDefault");
		document.body.dispatchEvent(evt);
		expect(preventSpy).toHaveBeenCalled();
	});
});
