import { ShieldQuestion } from "lucide-react";
import { useState } from "react";
import type { AgentPermissionRequest } from "../lib/agent-mode";
import { extractCommand, kindIcon } from "./agent-tool-call";
import { Button } from "./ui/button";

/**
 * Blocking approval card shown while an ACP agent waits on
 * session/request_permission. Rendered first-class by tool kind — shell
 * commands as a terminal line, file edits by path — with the raw input
 * behind a toggle. Options come straight from the agent.
 */

const KIND_VERBS: Record<string, string> = {
	execute: "run a command",
	read: "read a file",
	edit: "edit a file",
	delete: "delete a file",
	move: "move a file",
	search: "search",
	fetch: "fetch a URL",
};

interface PermissionToolCall {
	title?: string;
	kind?: string;
	rawInput?: Record<string, unknown>;
	locations?: Array<{ path?: string }>;
}

function subject(toolCall: PermissionToolCall): string {
	const kind = toolCall.kind ?? "other";
	const args = toolCall.rawInput ?? {};
	const title = toolCall.title ?? "tool call";
	if (kind === "execute") return extractCommand(args, title);
	const location = toolCall.locations?.find((l) => l.path)?.path;
	if (typeof location === "string" && location) return location;
	if (typeof args.path === "string" && args.path) return args.path;
	if (typeof args.url === "string" && args.url) return args.url;
	return title;
}

export function AgentPermissionCard({
	request,
	onAnswer,
}: {
	request: AgentPermissionRequest;
	onAnswer: (optionId: string | null) => void;
}) {
	const [showRaw, setShowRaw] = useState(false);
	const toolCall = request.tool_call as PermissionToolCall;
	const kind = toolCall.kind ?? "other";
	const verb = KIND_VERBS[kind] ?? "use a tool";
	const detail = subject(toolCall);
	const rawInput = toolCall.rawInput
		? JSON.stringify(toolCall.rawInput, null, 2)
		: null;

	return (
		<div className="mb-2 min-w-0 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
			<div className="flex items-center gap-2 text-xs font-medium text-foreground">
				<ShieldQuestion size={14} className="shrink-0 text-amber-500" />
				<span>The agent wants to {verb}</span>
			</div>

			{kind === "execute" ? (
				<div className="mt-2 flex gap-1.5 overflow-hidden rounded-md bg-zinc-900 px-2 py-1.5 font-mono text-[11px] text-zinc-100">
					<span className="select-none text-zinc-500">$</span>
					<span className="max-h-24 overflow-auto whitespace-pre-wrap break-all">
						{detail}
					</span>
				</div>
			) : (
				<div className="mt-2 flex min-w-0 items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1.5 font-mono text-[11px] text-foreground">
					{kindIcon(kind, "shrink-0 text-muted-foreground")}
					<span className="truncate">{detail}</span>
				</div>
			)}

			<div className="mt-2 flex flex-wrap gap-2">
				{request.options.map((option) => (
					<Button
						key={option.optionId}
						size="sm"
						variant={option.kind?.startsWith("allow") ? "default" : "outline"}
						className="h-7 text-xs"
						onClick={() => onAnswer(option.optionId)}
					>
						{option.name}
					</Button>
				))}
				<Button
					size="sm"
					variant="ghost"
					className="h-7 text-xs text-muted-foreground"
					onClick={() => onAnswer(null)}
				>
					Dismiss
				</Button>
			</div>

			<button
				type="button"
				onClick={() => setShowRaw((s) => !s)}
				className="mt-2 text-[10px] text-muted-foreground/70 transition-colors hover:text-foreground"
			>
				{showRaw ? "Hide raw input" : "Show raw input"}
			</button>
			{showRaw && rawInput && (
				<pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 text-[10px] text-muted-foreground">
					{rawInput}
				</pre>
			)}
		</div>
	);
}
