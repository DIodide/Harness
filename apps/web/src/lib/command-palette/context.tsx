import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";
import type { Command } from "./types";

interface CommandPaletteContextValue {
	open: boolean;
	setOpen: (value: boolean) => void;
	toggle: () => void;
	register: (commands: Command[]) => void;
	unregister: (ids: string[]) => void;
	/** Snapshot of all currently-registered commands. Stable while palette is closed. */
	snapshot: () => Command[];
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(
	null,
);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
	const commandsRef = useRef<Map<string, Command>>(new Map());
	const openRef = useRef(false);
	const [open, setOpenState] = useState(false);

	const setOpen = useCallback((value: boolean) => {
		openRef.current = value;
		setOpenState(value);
	}, []);

	const toggle = useCallback(() => {
		setOpen(!openRef.current);
	}, [setOpen]);

	const register = useCallback((commands: Command[]) => {
		for (const command of commands) {
			commandsRef.current.set(command.id, command);
		}
	}, []);

	const unregister = useCallback((ids: string[]) => {
		for (const id of ids) commandsRef.current.delete(id);
	}, []);

	const snapshot = useCallback(() => {
		return Array.from(commandsRef.current.values());
	}, []);

	const value = useMemo<CommandPaletteContextValue>(
		() => ({ open, setOpen, toggle, register, unregister, snapshot }),
		[open, setOpen, toggle, register, unregister, snapshot],
	);

	return (
		<CommandPaletteContext.Provider value={value}>
			{children}
		</CommandPaletteContext.Provider>
	);
}

export function useCommandPalette(): CommandPaletteContextValue {
	const ctx = useContext(CommandPaletteContext);
	if (!ctx) {
		throw new Error(
			"useCommandPalette must be used within a CommandPaletteProvider",
		);
	}
	return ctx;
}
