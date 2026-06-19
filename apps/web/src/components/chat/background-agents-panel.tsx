import { Bot, Check, CircleX, Loader2 } from "lucide-react";
import type { StreamPart } from "../../lib/use-chat-stream";
import { AgentToolCallBlock, KIND_LABELS, kindIcon } from "../agent-tool-call";

/** Tool-call kinds that represent a backgroundable unit of agent work. */
const AGENT_KINDS = new Set(["subagent", "workflow", "execute"]);

interface AgentTask extends StreamPart {
	children: StreamPart[];
}

function partFinished(p: StreamPart): boolean {
	return (
		p.status === "completed" ||
		p.status === "failed" ||
		p.exitCode != null ||
		(Boolean(p.result) && p.status == null && p.kind !== "execute")
	);
}

type TaskState = "running" | "failed" | "done";

function taskState(p: StreamPart, isStreaming: boolean): TaskState {
	if (p.status === "failed" || (p.exitCode != null && p.exitCode !== 0)) {
		return "failed";
	}
	if (partFinished(p)) return "done";
	return isStreaming ? "running" : "done";
}

/** Group parts into top-level agent tasks with their nested child steps
 *  (subagent children carry the parent's call_id in parentId). */
function organizeTasks(parts: StreamPart[]): AgentTask[] {
	const byCallId = new Map<string, AgentTask>();
	const top: AgentTask[] = [];
	for (const part of parts) {
		const task: AgentTask = { ...part, children: [] };
		if (part.type === "tool_call" && part.call_id) {
			byCallId.set(part.call_id, task);
		}
		const parentId = part.parentId ?? null;
		const parent = parentId ? byCallId.get(parentId) : undefined;
		if (parent) parent.children.push(task);
		else top.push(task);
	}
	return top.filter(
		(t) =>
			t.type === "tool_call" &&
			(AGENT_KINDS.has(t.kind ?? "") || t.children.length > 0),
	);
}

/** How many agent tasks are currently running — drives the toolbar badge. */
export function countActiveAgents(
	parts: StreamPart[],
	isStreaming: boolean,
): number {
	return organizeTasks(parts).filter(
		(t) => taskState(t, isStreaming) === "running",
	).length;
}

function agentBlockProps(part: StreamPart, isStreaming: boolean) {
	return {
		kind: part.kind ?? "other",
		title: part.tool ?? "",
		arguments: (part.arguments ?? {}) as Record<string, unknown>,
		result: part.result,
		diff: part.diff,
		locations: part.locations,
		status: part.status,
		exitCode: part.exitCode ?? null,
		serverName: part.serverName ?? null,
		isStreaming: isStreaming && !partFinished(part),
	};
}

function StateChip({ state }: { state: TaskState }) {
	if (state === "running") {
		return (
			<span className="flex items-center gap-1 rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
				<Loader2 size={9} className="animate-spin" />
				running
			</span>
		);
	}
	if (state === "failed") {
		return (
			<span className="flex items-center gap-1 rounded-full border border-destructive/40 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-destructive">
				<CircleX size={9} />
				failed
			</span>
		);
	}
	return (
		<span className="flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-emerald-500">
			<Check size={9} />
			done
		</span>
	);
}

function TaskRow({
	task,
	isStreaming,
}: {
	task: AgentTask;
	isStreaming: boolean;
}) {
	const state = taskState(task, isStreaming);
	const label = KIND_LABELS[task.kind ?? ""] ?? "task";
	return (
		<div className="rounded-md border border-border bg-background/60 p-2">
			<div className="mb-1 flex items-center gap-1.5">
				{kindIcon(task.kind ?? "other", "shrink-0 text-muted-foreground")}
				<span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
					{label}
				</span>
				{task.children.length > 0 && (
					<span className="rounded bg-foreground/10 px-1 text-[9px] font-medium text-muted-foreground">
						{task.children.length} steps
					</span>
				)}
				<span className="ml-auto">
					<StateChip state={state} />
				</span>
			</div>
			<AgentToolCallBlock {...agentBlockProps(task, isStreaming)} />
			{task.children.length > 0 && (
				<div className="mt-1 ml-1 space-y-1 border-l-2 border-muted-foreground/15 pl-2">
					{task.children.map((child, idx) =>
						child.type === "tool_call" && child.tool ? (
							<AgentToolCallBlock
								key={child.call_id ?? `child-${idx}`}
								{...agentBlockProps(child, isStreaming)}
							/>
						) : null,
					)}
				</div>
			)}
		</div>
	);
}

/**
 * Background-agents content for the right sandbox panel's "Agents" tab —
 * every background task (subagents, workflows, long-running commands) for the
 * active turn, with live statuses and expandable detail. Fills its container.
 */
export function BackgroundAgentsContent({
	parts,
	isStreaming,
}: {
	parts: StreamPart[];
	isStreaming: boolean;
}) {
	const tasks = organizeTasks(parts);
	const running = tasks.filter(
		(t) => taskState(t, isStreaming) === "running",
	).length;
	const failed = tasks.filter(
		(t) => taskState(t, isStreaming) === "failed",
	).length;
	const done = tasks.length - running - failed;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border px-2.5">
				<Bot size={12} strokeWidth={1.5} className="text-muted-foreground/70" />
				<span className="font-mono text-[10.5px] text-muted-foreground">
					Background agents
				</span>
				<div className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
					{running > 0 && (
						<span className="flex items-center gap-1">
							<Loader2 size={9} className="animate-spin" />
							{running} running
						</span>
					)}
					{done > 0 && <span>{done} done</span>}
					{failed > 0 && (
						<span className="text-destructive">{failed} failed</span>
					)}
				</div>
			</div>
			<div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2.5">
				{tasks.length === 0 ? (
					<p className="px-1 py-8 text-center text-[11px] text-muted-foreground">
						No background agents yet. Subagents, workflows, and long-running
						commands appear here while the agent works.
					</p>
				) : (
					tasks.map((task, idx) => (
						<TaskRow
							key={task.call_id ?? `task-${idx}`}
							task={task}
							isStreaming={isStreaming}
						/>
					))
				)}
			</div>
		</div>
	);
}
