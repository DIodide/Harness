import { useEffect } from "react";
import { useCommandPalette } from "../lib/command-palette/context";
import type { Command } from "../lib/command-palette/types";

/**
 * Register a set of commands for the lifetime of the calling component.
 * Pass a memoized `commands` array (e.g. via `useMemo`) to avoid churn.
 * Commands are keyed by `id`; re-registering with the same id replaces the entry.
 */
export function useRegisterCommands(commands: Command[]): void {
	const { register, unregister } = useCommandPalette();

	useEffect(() => {
		if (commands.length === 0) return;
		register(commands);
		const ids = commands.map((c) => c.id);
		return () => unregister(ids);
	}, [commands, register, unregister]);
}
