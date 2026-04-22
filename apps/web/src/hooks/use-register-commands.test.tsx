import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
	CommandPaletteProvider,
	useCommandPalette,
} from "../lib/command-palette/context";
import type { Command } from "../lib/command-palette/types";
import { useRegisterCommands } from "./use-register-commands";

const wrapper = ({ children }: { children: ReactNode }) => (
	<CommandPaletteProvider>{children}</CommandPaletteProvider>
);

function cmd(id: string): Command {
	return { id, title: id, group: "chat", perform: vi.fn() };
}

describe("useRegisterCommands", () => {
	it("registers commands on mount", () => {
		const initial = [cmd("a"), cmd("b")];
		const { result } = renderHook(
			() => {
				useRegisterCommands(initial);
				return useCommandPalette();
			},
			{ wrapper },
		);
		const ids = result.current
			.snapshot()
			.map((c) => c.id)
			.sort();
		expect(ids).toEqual(["a", "b"]);
	});

	it("skips effect when commands array is empty", () => {
		const { result } = renderHook(
			() => {
				useRegisterCommands([]);
				return useCommandPalette();
			},
			{ wrapper },
		);
		expect(result.current.snapshot()).toEqual([]);
	});

	it("unregisters on unmount", () => {
		const initial = [cmd("x")];
		const { result, unmount } = renderHook(
			() => {
				useRegisterCommands(initial);
				return useCommandPalette();
			},
			{ wrapper },
		);
		expect(result.current.snapshot().map((c) => c.id)).toContain("x");
		unmount();
		// Re-mount a peek hook to check registry is empty.
		const peek = renderHook(() => useCommandPalette(), { wrapper });
		expect(peek.result.current.snapshot()).toEqual([]);
	});

	it("replaces stale ids when the commands array changes", () => {
		const a = cmd("a");
		const b = cmd("b");
		const { result, rerender } = renderHook(
			({ cmds }: { cmds: Command[] }) => {
				useRegisterCommands(cmds);
				return useCommandPalette();
			},
			{ wrapper, initialProps: { cmds: [a] } },
		);
		expect(result.current.snapshot().map((c) => c.id)).toEqual(["a"]);
		act(() => rerender({ cmds: [b] }));
		expect(result.current.snapshot().map((c) => c.id)).toEqual(["b"]);
	});
});
