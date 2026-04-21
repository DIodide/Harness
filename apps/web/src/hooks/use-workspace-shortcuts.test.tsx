import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	useModifierHeld,
	useWorkspaceShortcuts,
} from "./use-workspace-shortcuts";

type Item = { _id: string };

function dispatchKey(
	type: "keydown" | "keyup",
	init: KeyboardEventInit & { target?: Element },
) {
	const target = init.target ?? document.body;
	const evt = new KeyboardEvent(type, {
		...init,
		bubbles: true,
		cancelable: true,
	});
	Object.defineProperty(evt, "target", { value: target, configurable: true });
	target.dispatchEvent(evt);
	return evt;
}

describe("useWorkspaceShortcuts", () => {
	it("fires onSelect for ⌘⌥1 on mac", () => {
		const onSelect = vi.fn();
		const items: Item[] = [{ _id: "ws-1" }, { _id: "ws-2" }];
		renderHook(() => useWorkspaceShortcuts(items, onSelect, true));
		act(() => {
			dispatchKey("keydown", { code: "Digit1", metaKey: true, altKey: true });
		});
		expect(onSelect).toHaveBeenCalledWith("ws-1");
	});

	it("fires onSelect for Ctrl+Alt+2 on non-mac", () => {
		const onSelect = vi.fn();
		const items: Item[] = [{ _id: "a" }, { _id: "b" }, { _id: "c" }];
		renderHook(() => useWorkspaceShortcuts(items, onSelect, false));
		act(() => {
			dispatchKey("keydown", { code: "Digit2", ctrlKey: true, altKey: true });
		});
		expect(onSelect).toHaveBeenCalledWith("b");
	});

	it("ignores when modifier combo is wrong", () => {
		const onSelect = vi.fn();
		renderHook(() => useWorkspaceShortcuts([{ _id: "a" }], onSelect, true));
		act(() => {
			dispatchKey("keydown", { code: "Digit1", metaKey: true }); // no alt
		});
		expect(onSelect).not.toHaveBeenCalled();
	});

	it("ignores when digit exceeds workspace count", () => {
		const onSelect = vi.fn();
		renderHook(() => useWorkspaceShortcuts([{ _id: "only" }], onSelect, true));
		act(() => {
			dispatchKey("keydown", { code: "Digit5", metaKey: true, altKey: true });
		});
		expect(onSelect).not.toHaveBeenCalled();
	});

	it("ignores when target is editable", () => {
		const onSelect = vi.fn();
		const input = document.createElement("input");
		document.body.appendChild(input);
		renderHook(() => useWorkspaceShortcuts([{ _id: "a" }], onSelect, true));
		act(() => {
			dispatchKey("keydown", {
				code: "Digit1",
				metaKey: true,
				altKey: true,
				target: input,
			});
		});
		expect(onSelect).not.toHaveBeenCalled();
		input.remove();
	});

	it("ignores when a modal dialog is open", () => {
		const onSelect = vi.fn();
		const dialog = document.createElement("div");
		dialog.setAttribute("role", "dialog");
		dialog.setAttribute("aria-modal", "true");
		document.body.appendChild(dialog);
		renderHook(() => useWorkspaceShortcuts([{ _id: "a" }], onSelect, true));
		act(() => {
			dispatchKey("keydown", { code: "Digit1", metaKey: true, altKey: true });
		});
		expect(onSelect).not.toHaveBeenCalled();
		dialog.remove();
	});

	it("tolerates undefined workspaces", () => {
		const onSelect = vi.fn();
		renderHook(() => useWorkspaceShortcuts(undefined, onSelect, true));
		act(() => {
			dispatchKey("keydown", { code: "Digit1", metaKey: true, altKey: true });
		});
		expect(onSelect).not.toHaveBeenCalled();
	});

	it("uses latest workspaces after re-render without rebinding", () => {
		const onSelect = vi.fn();
		let items: Item[] = [{ _id: "first" }];
		const { rerender } = renderHook(
			({ list }: { list: Item[] }) =>
				useWorkspaceShortcuts(list, onSelect, true),
			{ initialProps: { list: items } },
		);
		items = [{ _id: "second" }];
		rerender({ list: items });
		act(() => {
			dispatchKey("keydown", { code: "Digit1", metaKey: true, altKey: true });
		});
		expect(onSelect).toHaveBeenCalledWith("second");
	});
});

describe("useModifierHeld", () => {
	it("reports held when mac combo is active", () => {
		const { result } = renderHook(() => useModifierHeld(true));
		expect(result.current).toBe(false);
		act(() => {
			dispatchKey("keydown", { key: "Meta", metaKey: true, altKey: true });
		});
		expect(result.current).toBe(true);
	});

	it("reports held when non-mac combo is active", () => {
		const { result } = renderHook(() => useModifierHeld(false));
		act(() => {
			dispatchKey("keydown", { key: "Control", ctrlKey: true, altKey: true });
		});
		expect(result.current).toBe(true);
	});

	it("drops to false when combo releases", () => {
		const { result } = renderHook(() => useModifierHeld(true));
		act(() => {
			dispatchKey("keydown", { key: "Meta", metaKey: true, altKey: true });
		});
		expect(result.current).toBe(true);
		act(() => {
			dispatchKey("keyup", { key: "Meta", metaKey: false, altKey: false });
		});
		expect(result.current).toBe(false);
	});

	it("resets on window blur", () => {
		const { result } = renderHook(() => useModifierHeld(true));
		act(() => {
			dispatchKey("keydown", { key: "Meta", metaKey: true, altKey: true });
		});
		expect(result.current).toBe(true);
		act(() => {
			window.dispatchEvent(new Event("blur"));
		});
		expect(result.current).toBe(false);
	});

	it("resets when document becomes hidden", () => {
		const { result } = renderHook(() => useModifierHeld(true));
		act(() => {
			dispatchKey("keydown", { key: "Meta", metaKey: true, altKey: true });
		});
		expect(result.current).toBe(true);
		Object.defineProperty(document, "hidden", {
			value: true,
			configurable: true,
		});
		act(() => {
			document.dispatchEvent(new Event("visibilitychange"));
		});
		expect(result.current).toBe(false);
		Object.defineProperty(document, "hidden", {
			value: false,
			configurable: true,
		});
	});
});
