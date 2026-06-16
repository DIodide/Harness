import {
	Bot,
	Brain,
	Check,
	ChevronRight,
	CircleX,
	ClipboardCheck,
	ExternalLink,
	FileDiff,
	FileText,
	Globe,
	Loader2,
	MessageCircleQuestion,
	Search,
	Sparkles,
	SquareTerminal,
	Trash2,
	Waypoints,
	Wrench,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { cn } from "../lib/utils";
import { MarkdownMessage } from "./markdown-message";
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
		case "switch_mode":
			return <ClipboardCheck size={10} className={className} />;
		case "ask_user":
			return <MessageCircleQuestion size={10} className={className} />;
		case "subagent":
			return <Bot size={10} className={className} />;
		case "tool_search":
			return <Sparkles size={10} className={className} />;
		case "workflow":
			return <Waypoints size={10} className={className} />;
		default:
			return <Wrench size={10} className={className} />;
	}
}

/** Human label for the at-a-glance activity strip, keyed by tool kind. */
export const KIND_LABELS: Record<string, string> = {
	execute: "command",
	read: "read",
	edit: "edit",
	move: "edit",
	delete: "delete",
	search: "search",
	fetch: "fetch",
	subagent: "subagent",
	tool_search: "tool search",
	workflow: "workflow",
	think: "step",
};

/** Shape of the parsed Workflow metadata folded into args.workflow. */
export interface WorkflowMeta {
	name?: string;
	description?: string;
	phases?: Array<{ title: string; detail?: string }>;
	script?: string;
}

/** Parse Claude's "Tools found: a, b, c" tool-search result into names. */
export function parseToolSearchResult(result: string): string[] {
	const m = result.match(/tools? found:\s*(.+)/i);
	if (!m) return [];
	return m[1]
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s && s.toLowerCase() !== "none");
}

/** Parse web-fetch/search result lines into {title, url} cards. */
export function parseFetchResult(
	result: string,
): Array<{ title: string; url: string }> {
	const out: Array<{ title: string; url: string }> = [];
	for (const line of result.split("\n")) {
		const m = line.match(/^(.*?)\s*\((https?:\/\/[^)]+)\)\s*$/);
		if (m) {
			out.push({ title: m[1].trim() || m[2], url: m[2] });
			continue;
		}
		const f = line.match(/^(?:Fetched:\s*)?(https?:\/\/\S+)\s*$/);
		if (f) out.push({ title: f[1], url: f[1] });
	}
	return out;
}

/** Q→A rows for an answered agent question (kind "ask_user"). */
function QaView({ qa }: { qa: Array<{ q: string; a: string }> }) {
	return (
		<div className="space-y-1 rounded-md border border-border bg-background px-3 py-2">
			{qa.map((entry) => (
				<div key={`${entry.q}-${entry.a}`} className="text-xs">
					<span className="text-muted-foreground">{entry.q}</span>
					<span className="mx-1.5 text-muted-foreground/60">→</span>
					<span className="font-medium text-foreground">{entry.a}</span>
				</div>
			))}
		</div>
	);
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
		case "subagent": {
			// Prefer the description; else the brief's first line; else title.
			const prompt =
				typeof args.prompt === "string" ? args.prompt.split("\n")[0] : null;
			return (
				firstString(
					args.description,
					title !== "Task" ? title : null,
					prompt,
				) ?? "Subagent"
			);
		}
		case "tool_search":
			return firstString(args.query) ?? "Searching for tools";
		case "workflow":
			return (args.workflow as WorkflowMeta | undefined)?.name ?? title;
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
	exitCode,
}: {
	command: string;
	output: string;
	isStreaming: boolean;
	exitCode?: number | null;
}) {
	const running = isStreaming && exitCode === null;
	return (
		<div className="overflow-hidden rounded-md bg-zinc-900 font-mono text-[10px]">
			<div className="flex items-center gap-1.5 border-b border-zinc-700/60 px-2 py-1 text-zinc-300">
				<span className="select-none text-zinc-500">$</span>
				<span className="min-w-0 flex-1 whitespace-pre-wrap break-all">
					{command}
				</span>
				{exitCode !== null && exitCode !== undefined && (
					<span
						className={cn(
							"shrink-0 rounded px-1 text-[9px] font-semibold",
							exitCode === 0
								? "bg-green-500/20 text-green-400"
								: "bg-red-500/20 text-red-400",
						)}
					>
						exit {exitCode}
					</span>
				)}
			</div>
			<pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all px-2 py-1.5 text-zinc-100">
				{output || (running ? "running…" : "(no output)")}
				{running && output && (
					<span className="ml-0.5 inline-block h-2.5 w-1 animate-pulse bg-zinc-400 align-middle" />
				)}
			</pre>
		</div>
	);
}

/** Tool-search result: the discovered tool names as chips. */
function ToolSearchView({
	result,
	isStreaming,
}: {
	result: string;
	isStreaming: boolean;
}) {
	const tools = parseToolSearchResult(result);
	if (tools.length === 0) {
		return (
			<p className="text-[11px] text-muted-foreground">
				{isStreaming ? "Discovering tools…" : "No tools found"}
			</p>
		);
	}
	return (
		<div className="flex flex-wrap gap-1">
			{tools.map((t) => (
				<span
					key={t}
					className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-foreground"
				>
					{t}
				</span>
			))}
		</div>
	);
}

/** Web fetch/search result: clickable source cards. */
function FetchView({ result }: { result: string }) {
	const sources = parseFetchResult(result);
	if (sources.length === 0) {
		return (
			<pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 font-mono text-[10px] text-muted-foreground">
				{result || "(no result)"}
			</pre>
		);
	}
	return (
		<div className="space-y-1">
			{sources.map((s) => (
				<a
					key={s.url}
					href={s.url}
					target="_blank"
					rel="noreferrer"
					className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground transition-colors hover:border-foreground/40"
				>
					<ExternalLink size={11} className="shrink-0 text-muted-foreground" />
					<span className="min-w-0 flex-1 truncate">{s.title}</span>
				</a>
			))}
		</div>
	);
}

/**
 * Inspectable rendering of a Claude Workflow (multi-agent orchestration,
 * triggered by the "ultracode" keyword). Shows the workflow's name +
 * description, its DECLARED phases (from meta.phases) as a static ordinal
 * timeline, one whole-workflow status, and the final synthesis.
 *
 * Honesty constraint: claude-agent-acp drops the SDK's per-task/per-phase
 * events, so we can NOT show live per-phase progress — the phases are the
 * declared plan, and there is exactly ONE running/completed/failed status.
 */
function WorkflowView({
	workflow,
	phases,
	result,
	status,
	isStreaming,
}: {
	workflow: WorkflowMeta;
	phases: Array<{ title: string; detail?: string }>;
	result: string;
	status?: string | null;
	isStreaming: boolean;
}) {
	const running = isStreaming && status !== "completed" && status !== "failed";
	return (
		<div className="space-y-2">
			{workflow.description && (
				<p className="text-[11px] text-muted-foreground">
					{workflow.description}
				</p>
			)}

			{phases.length > 0 && (
				<div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
					<div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
						<Waypoints size={11} />
						Phases
						<span className="ml-auto flex items-center gap-1 normal-case tracking-normal">
							{phases.length}
							{status === "completed" ? (
								<Check size={11} className="text-green-500" />
							) : status === "failed" ? (
								<CircleX size={11} className="text-destructive" />
							) : running ? (
								<Loader2 size={11} className="animate-spin" />
							) : null}
						</span>
					</div>
					<ol className="space-y-1">
						{phases.map((phase, idx) => (
							<li
								key={`${idx}-${phase.title}`}
								className="flex items-start gap-2 text-xs"
							>
								<span className="mt-0.5 w-4 shrink-0 text-center font-mono text-[10px] text-muted-foreground/70">
									{idx + 1}
								</span>
								<div className="min-w-0">
									<span className="text-foreground">{phase.title}</span>
									{phase.detail && (
										<span className="block text-[11px] text-muted-foreground line-clamp-2">
											{phase.detail}
										</span>
									)}
								</div>
							</li>
						))}
					</ol>
					{running && (
						<p
							className="mt-1.5 text-[10px] text-muted-foreground/70"
							title="The agent doesn't report per-phase status; these are the declared plan, not live progress."
						>
							ⓘ declared plan — runs in the agent's sandbox; per-phase progress
							isn't reported
						</p>
					)}
				</div>
			)}

			{(result || isStreaming) && (
				<div className="max-h-80 min-w-0 overflow-y-auto rounded-md border border-border bg-background px-3 py-2 text-sm">
					{result ? (
						<MarkdownMessage content={stripFences(result)} />
					) : (
						<span className="text-[11px] text-muted-foreground">
							Launching in the background…
						</span>
					)}
				</div>
			)}
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
	status,
	exitCode,
	serverName,
}: {
	kind: string;
	title: string;
	arguments: Record<string, unknown>;
	result?: string;
	diff?: AgentToolDiff | null;
	locations?: Array<{ path?: string }>;
	isStreaming: boolean;
	status?: string | null;
	exitCode?: number | null;
	serverName?: string | null;
}) {
	// Diffs, answered questions, and tool-search results are their own
	// payload — show them without an extra click.
	const [open, setOpen] = useState(
		(kind === "edit" && Boolean(diff)) ||
			kind === "ask_user" ||
			kind === "tool_search",
	);
	const [showRaw, setShowRaw] = useState(false);
	const [showScript, setShowScript] = useState(false);
	const summary = summaryText(kind, title, args, locations);
	const output = result ? stripFences(result) : "";
	// ExitPlanMode-style calls carry the plan document as input — render it
	// as markdown, not a JSON/mono blob.
	const plan = typeof args.plan === "string" ? args.plan : null;
	const qa = Array.isArray(args.qa)
		? (args.qa as Array<{ q: string; a: string }>)
		: null;
	// A subagent's brief — the actual instructions it was spawned with.
	const brief = typeof args.prompt === "string" ? args.prompt : null;
	// Workflow orchestration: structured metadata folded into args.workflow.
	const workflow =
		kind === "workflow"
			? (args.workflow as WorkflowMeta | undefined)
			: undefined;
	const phases = workflow?.phases ?? [];
	const failed = status === "failed" || (exitCode != null && exitCode !== 0);

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
				{isStreaming && !failed ? (
					<RoseCurveSpinner size={10} />
				) : failed ? (
					<CircleX size={10} className="shrink-0 text-destructive" />
				) : (
					kindIcon(kind, "shrink-0 text-emerald-500")
				)}
				{serverName && (
					<span className="shrink-0 rounded bg-foreground/10 px-1 text-[9px] font-medium text-muted-foreground">
						{serverName}
					</span>
				)}
				<span
					className={cn("truncate font-mono", failed && "text-destructive")}
				>
					{summary}
				</span>
				{kind === "workflow" && phases.length > 0 && (
					<span className="shrink-0 rounded bg-foreground/10 px-1 text-[9px] font-medium text-muted-foreground">
						{phases.length} phases
					</span>
				)}
				{exitCode != null && exitCode !== 0 && (
					<span className="shrink-0 text-[9px] font-semibold text-destructive">
						exit {exitCode}
					</span>
				)}
				{failed && exitCode == null && (
					<span className="shrink-0 text-[9px] font-medium text-destructive">
						failed
					</span>
				)}
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
							{kind === "workflow" && workflow ? (
								<WorkflowView
									workflow={workflow}
									phases={phases}
									result={output}
									status={status}
									isStreaming={isStreaming}
								/>
							) : kind === "ask_user" && qa && qa.length > 0 ? (
								<QaView qa={qa} />
							) : plan !== null ? (
								<div className="max-h-80 min-w-0 overflow-y-auto rounded-md border border-border bg-background px-3 py-2 text-sm">
									<MarkdownMessage content={plan} />
								</div>
							) : kind === "subagent" ? (
								<div className="space-y-1.5">
									{brief && (
										<div className="rounded-md border border-border bg-background px-3 py-2 text-[11px]">
											<p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
												Brief
											</p>
											<MarkdownMessage content={brief} />
										</div>
									)}
									{output && (
										<pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 font-mono text-[10px] text-muted-foreground">
											{output}
										</pre>
									)}
								</div>
							) : kind === "tool_search" ? (
								<ToolSearchView result={output} isStreaming={isStreaming} />
							) : kind === "fetch" ? (
								<FetchView result={output} />
							) : kind === "execute" ? (
								<TerminalView
									command={summary}
									output={output}
									isStreaming={isStreaming}
									exitCode={exitCode}
								/>
							) : diff ? (
								<DiffView diff={diff} />
							) : (
								<pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 font-mono text-[10px] text-muted-foreground">
									{output || (isStreaming ? "running…" : "(no output)")}
								</pre>
							)}
							<div className="flex flex-wrap gap-3">
								<button
									type="button"
									onClick={() => setShowRaw((s) => !s)}
									className="text-[10px] text-muted-foreground/70 transition-colors hover:text-foreground"
								>
									{showRaw ? "Hide raw input" : "Show raw input"}
								</button>
								{kind === "workflow" && workflow?.script && (
									<button
										type="button"
										onClick={() => setShowScript((s) => !s)}
										className="text-[10px] text-muted-foreground/70 transition-colors hover:text-foreground"
									>
										{showScript
											? "Hide generated script"
											: "Show generated script"}
									</button>
								)}
							</div>
							{showRaw && (
								<pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2 font-mono text-[10px] text-muted-foreground">
									{JSON.stringify(args, null, 2)}
								</pre>
							)}
							{showScript && workflow?.script && (
								<pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2 font-mono text-[10px] text-muted-foreground">
									{workflow.script}
								</pre>
							)}
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
