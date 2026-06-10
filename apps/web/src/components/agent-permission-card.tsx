import { ShieldQuestion } from "lucide-react";
import type { AgentPermissionRequest } from "../lib/agent-mode";
import { Button } from "./ui/button";

/**
 * Blocking approval card shown while an ACP agent waits on
 * session/request_permission (e.g. before running a shell command or
 * calling an MCP tool). Options come straight from the agent.
 */
export function AgentPermissionCard({
	request,
	onAnswer,
}: {
	request: AgentPermissionRequest;
	onAnswer: (optionId: string | null) => void;
}) {
	const toolCall = request.tool_call as {
		title?: string;
		kind?: string;
		rawInput?: Record<string, unknown>;
	};
	const title = toolCall.title ?? toolCall.kind ?? "Tool call";
	const rawInput = toolCall.rawInput
		? JSON.stringify(toolCall.rawInput, null, 2)
		: null;

	return (
		<div className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
			<div className="flex items-center gap-2 text-xs font-medium text-foreground">
				<ShieldQuestion size={14} className="shrink-0 text-amber-500" />
				<span>The agent wants to run:</span>
				<code className="truncate rounded bg-foreground/10 px-1.5 py-0.5">
					{title}
				</code>
			</div>
			{rawInput && (
				<pre className="mt-2 max-h-32 overflow-auto rounded bg-background/60 p-2 text-[10px] whitespace-pre-wrap break-all text-muted-foreground">
					{rawInput}
				</pre>
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
		</div>
	);
}
