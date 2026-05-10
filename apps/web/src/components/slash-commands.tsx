import { Wrench } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import type { McpServerCommand } from "../lib/mcp";
import { cn } from "../lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SlashCommand = McpServerCommand;

// ─── Internal helpers ────────────────────────────────────────────────────────

function parseSlashCommand(
	text: string,
	commands: SlashCommand[],
): { toolName: string; message: string } | null {
	if (!text.startsWith("/")) return null;

	const afterSlash = text.slice(1).trim();
	if (!afterSlash) return null;

	const sorted = [...commands].sort((a, b) => b.name.length - a.name.length);

	for (const cmd of sorted) {
		if (afterSlash === cmd.name || afterSlash.startsWith(`${cmd.name} `)) {
			return {
				toolName: cmd.name,
				message: afterSlash.slice(cmd.name.length).trim(),
			};
		}
		if (afterSlash === cmd.tool || afterSlash.startsWith(`${cmd.tool} `)) {
			return {
				toolName: cmd.name,
				message: afterSlash.slice(cmd.tool.length).trim(),
			};
		}
	}

	return null;
}

function filterCommands(
	commands: SlashCommand[],
	query: string,
): SlashCommand[] {
	if (!query) return commands;
	const q = query.toLowerCase();
	return commands.filter(
		(cmd) =>
			cmd.tool.toLowerCase().includes(q) ||
			cmd.server.toLowerCase().includes(q) ||
			cmd.name.toLowerCase().includes(q) ||
			cmd.description.toLowerCase().includes(q),
	);
}

function extractQuery(text: string): string {
	if (!text.startsWith("/")) return "";
	const afterSlash = text.slice(1);
	const spaceIdx = afterSlash.indexOf(" ");
	return spaceIdx === -1
		? afterSlash.toLowerCase()
		: afterSlash.slice(0, spaceIdx).toLowerCase();
}

// ─── Main hook: useSlashCommandInput ─────────────────────────────────────────

interface UseSlashCommandInputOptions {
	storedCommands: SlashCommand[];
	text: string;
	setText: (text: string) => void;
	textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function useSlashCommandInput({
	storedCommands,
	text,
	setText,
	textareaRef,
}: UseSlashCommandInputOptions) {
	const commands = storedCommands;
	const [menuOpen, setMenuOpen] = useState(false);
	const [selectedIndex, setSelectedIndex] = useState(0);

	// ── Menu open/close based on text ──────────────────────────────────────────

	useEffect(() => {
		if (text.startsWith("/") && !text.includes("\n")) {
			const parsed = parseSlashCommand(text, commands);
			setMenuOpen(!parsed);
		} else {
			setMenuOpen(false);
		}
	}, [text, commands]);

	// ── Derived state ──────────────────────────────────────────────────────────

	const query = useMemo(() => extractQuery(text), [text]);
	const filtered = useMemo(
		() => filterCommands(commands, query),
		[commands, query],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: query is intentionally used to reset selection when search changes
	useEffect(() => {
		setSelectedIndex(0);
	}, [query]);

	// ── Select a command from the menu ─────────────────────────────────────────

	const selectCommand = useCallback(
		(cmd: SlashCommand) => {
			setText(`/${cmd.tool} `);
			setMenuOpen(false);
			textareaRef.current?.focus();
		},
		[setText, textareaRef],
	);

	// ── Keyboard handler ──────────────────────────────────────────────────────

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
			if (!menuOpen) return false;

			if (e.key === "Escape") {
				e.preventDefault();
				setMenuOpen(false);
				return true;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
				return true;
			}
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setSelectedIndex((prev) =>
					prev < filtered.length - 1 ? prev + 1 : prev,
				);
				return true;
			}
			if (e.key === "Tab" || e.key === "Enter") {
				e.preventDefault();
				const selected = filtered[selectedIndex];
				if (selected) selectCommand(selected);
				return true;
			}
			return false;
		},
		[menuOpen, filtered, selectedIndex, selectCommand],
	);

	// ── trySend ────────────────────────────────────────────────────────────────
	// Returns { forcedTool, message } if this is a slash command, or null if not.
	// The caller should strip the command prefix and send the message through the
	// normal chat stream with forced_tool set.

	const trySend = useCallback(
		(content: string): { forcedTool: string; message: string } | null => {
			const parsed = parseSlashCommand(content, commands);
			if (!parsed) return null;

			if (!parsed.message) {
				toast.error(
					"Add a message after the command, e.g. /tool describe what you want",
				);
				return { forcedTool: "", message: "" }; // signal "handled but don't send"
			}

			setMenuOpen(false);
			return { forcedTool: parsed.toolName, message: parsed.message };
		},
		[commands],
	);

	// ── Public API ─────────────────────────────────────────────────────────────

	return {
		menuOpen,
		commands,
		filtered,
		selectedIndex,
		selectCommand,
		handleKeyDown,
		trySend,
	};
}

// ─── Component: SlashCommandMenu ─────────────────────────────────────────────

interface SlashCommandMenuProps {
	isOpen: boolean;
	commands: SlashCommand[];
	filtered: SlashCommand[];
	selectedIndex: number;
	onSelect: (command: SlashCommand) => void;
}

export function SlashCommandMenu({
	isOpen,
	commands,
	filtered,
	selectedIndex,
	onSelect,
}: SlashCommandMenuProps) {
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!listRef.current) return;
		const items = listRef.current.querySelectorAll("[data-command-item]");
		items[selectedIndex]?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex]);

	if (!isOpen) return null;

	return (
		<div className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
			<div ref={listRef}>
				{filtered.length === 0 ? (
					<div className="px-3 py-4 text-sm text-muted-foreground">
						{commands.length === 0
							? "No MCP tools available"
							: "No commands match your search"}
					</div>
				) : (
					filtered.map((cmd, idx) => (
						<button
							key={cmd.name}
							type="button"
							data-command-item
							onMouseDown={(e) => {
								e.preventDefault();
								onSelect(cmd);
							}}
							className={cn(
								"flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm transition-colors",
								idx === selectedIndex
									? "bg-accent text-accent-foreground"
									: "text-foreground hover:bg-accent/50",
							)}
						>
							<Wrench
								size={14}
								className="mt-0.5 shrink-0 text-muted-foreground"
							/>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-1.5">
									<span className="font-medium">/{cmd.tool}</span>
									<span className="text-xs text-muted-foreground">
										{cmd.server}
									</span>
								</div>
								{cmd.description && (
									<p className="mt-0.5 truncate text-xs text-muted-foreground">
										{cmd.description}
									</p>
								)}
							</div>
						</button>
					))
				)}
			</div>
		</div>
	);
}
