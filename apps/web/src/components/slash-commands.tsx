import { Bot, Wrench } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import type { McpServerCommand } from "../lib/mcp";
import { cn } from "../lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * A slash-menu entry. Two sources with different send semantics:
 * - "mcp" (default): intercepted client-side and sent as forced_tool with
 *   the command prefix stripped.
 * - "agent": an ACP agent built-in (/compact, /review, ...) — sent through
 *   verbatim as prompt text; the agent parses it itself. Args optional.
 */
export type SlashCommand = McpServerCommand & {
	source?: "mcp" | "agent";
	inputHint?: string;
};

/** Outcome of trySend for a "/"-prefixed message. */
export type SlashSendResult =
	| { kind: "mcp"; forcedTool: string; message: string }
	| { kind: "agent" }
	| { kind: "invalid" };

// ─── Internal helpers ────────────────────────────────────────────────────────

function parseSlashCommand(
	text: string,
	commands: SlashCommand[],
): { cmd: SlashCommand; message: string } | null {
	if (!text.startsWith("/")) return null;

	const afterSlash = text.slice(1).trim();
	if (!afterSlash) return null;

	const sorted = [...commands].sort((a, b) => b.name.length - a.name.length);

	for (const cmd of sorted) {
		if (afterSlash === cmd.name || afterSlash.startsWith(`${cmd.name} `)) {
			return {
				cmd,
				message: afterSlash.slice(cmd.name.length).trim(),
			};
		}
		if (afterSlash === cmd.tool || afterSlash.startsWith(`${cmd.tool} `)) {
			return {
				cmd,
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
	// Classifies a "/"-prefixed message. MCP commands are intercepted (send
	// the stripped message with forced_tool); agent commands pass through
	// verbatim as prompt text (args optional — /compact alone is valid).

	const trySend = useCallback(
		(content: string): SlashSendResult | null => {
			const parsed = parseSlashCommand(content, commands);
			if (!parsed) return null;

			setMenuOpen(false);
			if (parsed.cmd.source === "agent") {
				return { kind: "agent" };
			}

			if (!parsed.message) {
				toast.error(
					"Add a message after the command, e.g. /tool describe what you want",
				);
				return { kind: "invalid" };
			}

			return {
				kind: "mcp",
				forcedTool: parsed.cmd.name,
				message: parsed.message,
			};
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
	/** Copy when no commands exist at all (varies by agent vs MCP mode). */
	emptyLabel?: string;
}

export function SlashCommandMenu({
	isOpen,
	commands,
	filtered,
	selectedIndex,
	onSelect,
	emptyLabel = "No MCP tools available",
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
							? emptyLabel
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
							{cmd.source === "agent" ? (
								<Bot
									size={14}
									className="mt-0.5 shrink-0 text-muted-foreground"
								/>
							) : (
								<Wrench
									size={14}
									className="mt-0.5 shrink-0 text-muted-foreground"
								/>
							)}
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-1.5">
									<span className="font-medium">/{cmd.tool}</span>
									{cmd.inputHint && (
										<span className="truncate text-xs italic text-muted-foreground/70">
											{cmd.inputHint}
										</span>
									)}
									<span className="ml-auto shrink-0 text-xs text-muted-foreground">
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
