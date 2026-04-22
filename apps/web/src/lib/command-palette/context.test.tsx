import { act, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { CommandPaletteProvider, useCommandPalette } from "./context";
import {
	COMMAND_GROUP_LABELS,
	COMMAND_GROUP_ORDER,
	type Command,
} from "./types";

const wrapper = ({ children }: { children: ReactNode }) => (
	<CommandPaletteProvider>{children}</CommandPaletteProvider>
);

function cmd(partial: Partial<Command> & { id: string }): Command {
	return {
		id: partial.id,
		title: partial.title ?? partial.id,
		group: partial.group ?? "chat",
		perform: partial.perform ?? vi.fn(),
		...partial,
	};
}

describe("CommandPaletteProvider", () => {
	it("throws if useCommandPalette is called outside provider", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(() => renderHook(() => useCommandPalette())).toThrow(
			/must be used within a CommandPaletteProvider/,
		);
		spy.mockRestore();
	});

	it("starts closed", () => {
		const { result } = renderHook(() => useCommandPalette(), { wrapper });
		expect(result.current.open).toBe(false);
	});

	it("setOpen flips state", () => {
		const { result } = renderHook(() => useCommandPalette(), { wrapper });
		act(() => result.current.setOpen(true));
		expect(result.current.open).toBe(true);
		act(() => result.current.setOpen(false));
		expect(result.current.open).toBe(false);
	});

	it("toggle flips state", () => {
		const { result } = renderHook(() => useCommandPalette(), { wrapper });
		act(() => result.current.toggle());
		expect(result.current.open).toBe(true);
		act(() => result.current.toggle());
		expect(result.current.open).toBe(false);
	});

	it("register stores commands, snapshot returns them", () => {
		const { result } = renderHook(() => useCommandPalette(), { wrapper });
		const a = cmd({ id: "a" });
		const b = cmd({ id: "b", group: "harness" });
		act(() => result.current.register([a, b]));
		const snap = result.current.snapshot();
		expect(snap.map((c) => c.id).sort()).toEqual(["a", "b"]);
	});

	it("register overwrites by id (latest wins)", () => {
		const { result } = renderHook(() => useCommandPalette(), { wrapper });
		act(() => result.current.register([cmd({ id: "a", title: "first" })]));
		act(() => result.current.register([cmd({ id: "a", title: "second" })]));
		const snap = result.current.snapshot();
		expect(snap).toHaveLength(1);
		expect(snap[0].title).toBe("second");
	});

	it("unregister removes commands", () => {
		const { result } = renderHook(() => useCommandPalette(), { wrapper });
		act(() => result.current.register([cmd({ id: "a" }), cmd({ id: "b" })]));
		act(() => result.current.unregister(["a"]));
		const snap = result.current.snapshot();
		expect(snap.map((c) => c.id)).toEqual(["b"]);
	});

	it("unregister on missing id is a no-op", () => {
		const { result } = renderHook(() => useCommandPalette(), { wrapper });
		act(() => result.current.register([cmd({ id: "a" })]));
		act(() => result.current.unregister(["missing"]));
		expect(result.current.snapshot()).toHaveLength(1);
	});
});

describe("command group constants", () => {
	it("order and labels align", () => {
		for (const group of COMMAND_GROUP_ORDER) {
			expect(COMMAND_GROUP_LABELS[group]).toBeTruthy();
		}
	});

	it("order has no duplicates", () => {
		expect(new Set(COMMAND_GROUP_ORDER).size).toBe(COMMAND_GROUP_ORDER.length);
	});
});

describe("CommandPaletteProvider rendering", () => {
	it("renders children", () => {
		const { getByText } = render(
			<CommandPaletteProvider>
				<span>child-marker</span>
			</CommandPaletteProvider>,
		);
		expect(getByText("child-marker")).toBeInTheDocument();
	});
});
