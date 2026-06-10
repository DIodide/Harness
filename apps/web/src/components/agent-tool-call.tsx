import {
	Brain,
	ChevronRight,
	FileDiff,
	FileText,
	Globe,
	Search,
	SquareTerminal,
	Trash2,
	Wrench,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { RoseCurveSpinner } from "./rose-curve-spinner";

/**
 * First-class rendering for ACP agent built-in tool calls (Codex, Claude
 * Code, ...). The ACP `kind` field drives the presentation: shell commands
 * render as a terminal, file edits as diffs, reads/searches by their
 * target — no raw call_id/JSON dumps. MCP tools keep ToolCallBlock.
 */

export interface AgentToolDiff {
	path?: string | null;
	oldText?: string | null;
	newText?: string | null;
}

const SHELL_PREFIXES = new Set([
	"/bin/bash",
	"/bin/sh",
	"/bin/zsh",
	"bash",
	"sh",
	"zsh",
]);
const SHELL_FLAGS = new Set(["-lc", "-c", "-l"]);

/** Pull a display command out of adapter-specific rawInput shapes. */
export function extractCommand(
	args: Record<string, unknown>,
	fallback: string,
): string {
	const command = args.command;
	if (typeof command === "string" && command.trim()) return command.trim();
	if (Array.isArray(command) && command.length > 0) {
		const parts = command.map(String);
		while (parts.length > 1 && SHELL_PREFIXES.has(parts[0])) parts.shift();
		while (parts.length > 1 && SHELL_FLAGS.has(parts[0])) parts.shift();
		return parts.join(" ").trim() || fallback;
	}
	return fallback;
}

/** Strip a single wrapping markdown code fence from tool output. */
export function stripFences(text: string): string {
	const match = text.trim().match(/^```[\w-]*\n?([\s\S]*?)\n?```$/);
	return match ? match[1] : text;
}

function firstString(...values: unknown[]): string | null {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return null;
}

export function kindIcon(kind: string, className: string) {
	switch (kind) {
		case "execute":
			return <SquareTerminal size={10} className={className} />;
		case "read":
			return <FileText size={10} className={className} />;
		case "edit":
		case "move":
			return <FileDiff size={10} className={className} />;
		case "delete":
			return <Trash2 size={10} className={className} />;
		case "search":
			return <Search size={10} className={className} />;
		case "fetch":
			return <Globe size={10} className={className} />;
		case "think":
			return <Brain size={10} className={className} />;
		default:
			return <Wrench size={10} className={className} />;
	}
}

function summaryText(
	kind: string,
	title: string,
	args: Record<string, unknown>,
	locations: Array<{ path?: string }> | undefined,
): string {
	const location = locations?.find((l) => l.path)?.path;
	switch (kind) {
		case "execute":
			return extractCommand(args, title);
		case "read":
		case "edit":
		case "delete":
		case "move":
			return firstString(location, args.path, args.file_path) ?? title;
		case "search":
			return firstString(args.query, args.pattern, location) ?? title;
		case "fetch":
			return firstString(args.url) ?? title;
		default:
			return title;
	}
}

function DiffView({ diff }: { diff: AgentToolDiff }) {
	const oldLines = (diff.oldText ?? "")
		.split("\n")
		.filter((l, i, a) => !(i === a.length - 1 && l === ""));
	const newLines = (diff.newText ?? "")
		.split("\n")
		.filter((l, i, a) => !(i === a.length - 1 && l === ""));
	return (
		<div className="overflow-hidden rounded-md border border-border font-mono text-[10px]">
			{diff.path && (
				<div className="border-b border-border bg-muted/50 px-2 py-1 text-muted-foreground">
					{diff.path}
				</div>
			)}
			<div className="max-h-60 overflow-auto">
				{oldLines.slice(0, 200).map((line, idx) => (
					<div
						key={`old-${idx}-${line.slice(0, 16)}`}
						className="whitespace-pre-wrap break-all bg-red-500/10 px-2 text-red-600 dark:text-red-400"
					>
						- {line}
					</div>
				))}
				{newLines.slice(0, 200).map((line, idx) => (
					<div
						key={`new-${idx}-${line.slice(0, 16)}`}
						className="whitespace-pre-wrap break-all bg-green-500/10 px-2 text-green-700 dark:text-green-400"
					>
						+ {line}
					</div>
				))}
			</div>
		</div>
	);
}

function TerminalView({
	command,
	output,
	isStreaming,
}: {
	command: string;
	output: string;
	isStreaming: boolean;
}) {
	return (
		<div className="overflow-hidden rounded-md bg-zinc-900 font-mono text-[10px]">
			<div className="flex gap-1.5 border-b border-zinc-700/60 px-2 py-1 text-zinc-300">
				<span className="select-none text-zinc-500">$</span>
				<span className="whitespace-pre-wrap break-all">{command}</span>
			</div>
			<pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all px-2 py-1.5 text-zinc-100">
				{output || (isStreaming ? "running…" : "(no output)")}
			</pre>
		</div>
	);
}

export function AgentToolCallBlock({
	kind,
	title,
	arguments: args,
	result,
	diff,
	locations,
	isStreaming,
}: {
	kind: string;
	title: string;
	arguments: Record<string, unknown>;
	result?: string;
	diff?: AgentToolDiff | null;
	locations?: Array<{ path?: string }>;
	isStreaming: boolean;
}) {
	// Diffs are the payload of an edit — show them without an extra click.
	const [open, setOpen] = useState(kind === "edit" && Boolean(diff));
	const [showRaw, setShowRaw] = useState(false);
	const summary = summaryText(kind, title, args, locations);
	const output = result ? stripFences(result) : "";

	return (
		<div className="mb-1.5">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="flex max-w-full items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
			>
				<motion.span
					animate={{ rotate: open ? 90 : 0 }}
					transition={{ duration: 0.15 }}
					className="flex shrink-0"
				>
					<ChevronRight size={10} />
				</motion.span>
				{isStreaming ? (
					<RoseCurveSpinner size={10} />
				) : (
					kindIcon(kind, "shrink-0 text-emerald-500")
				)}
				<span className="truncate font-mono">{summary}</span>
				{isStreaming && <span className="shrink-0">…</span>}
			</button>

			<AnimatePresence>
				{open && (
					<motion.div
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.2 }}
						className="overflow-hidden"
					>
						<div className="mt-1.5 ml-4 min-w-0 space-y-2">
							{kind === "execute" ? (
								<TerminalView
									command={summary}
									output={output}
									isStreaming={isStreaming}
								/>
							) : diff ? (
								<DiffView diff={diff} />
							) : (
								<pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 font-mono text-[10px] text-muted-foreground">
									{output || (isStreaming ? "running…" : "(no output)")}
								</pre>
							)}
							<button
								type="button"
								onClick={() => setShowRaw((s) => !s)}
								className="text-[10px] text-muted-foreground/70 transition-colors hover:text-foreground"
							>
								{showRaw ? "Hide raw input" : "Show raw input"}
							</button>
							{showRaw && (
								<pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2 font-mono text-[10px] text-muted-foreground">
									{JSON.stringify(args, null, 2)}
								</pre>
							)}
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
