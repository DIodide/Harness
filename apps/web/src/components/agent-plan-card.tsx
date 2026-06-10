import { Check, Circle, ListTodo, Loader2 } from "lucide-react";
import type { AgentPlanEntry } from "../lib/agent-mode";

function StatusIcon({ status }: { status: AgentPlanEntry["status"] }) {
	if (status === "completed") {
		return <Check size={11} className="shrink-0 text-green-500" />;
	}
	if (status === "in_progress") {
		return (
			<Loader2 size={11} className="shrink-0 animate-spin text-foreground" />
		);
	}
	return <Circle size={9} className="shrink-0 text-muted-foreground/50" />;
}

/**
 * Live checklist of the ACP agent's plan (session/update "plan" snapshots).
 * Shown while a turn streams; the plan is not persisted with the message.
 */
export function AgentPlanCard({ entries }: { entries: AgentPlanEntry[] }) {
	if (entries.length === 0) return null;
	const done = entries.filter((entry) => entry.status === "completed").length;

	return (
		<div className="mb-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
			<div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
				<ListTodo size={11} />
				Plan
				<span className="ml-auto normal-case tracking-normal">
					{done}/{entries.length}
				</span>
			</div>
			<ul className="space-y-1">
				{entries.map((entry, idx) => (
					<li
						key={`${idx}-${entry.content.slice(0, 24)}`}
						className="flex items-start gap-2 text-xs"
					>
						<span className="mt-0.5">
							<StatusIcon status={entry.status} />
						</span>
						<span
							className={
								entry.status === "completed"
									? "text-muted-foreground line-through"
									: "text-foreground"
							}
						>
							{entry.content}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}
