import { Gauge, Waypoints } from "lucide-react";
import { useMemo, useState } from "react";
import {
	type AgentConfigOption,
	flattenConfigChoices,
} from "../../lib/agent-mode";
import { cn } from "../../lib/utils";
import { Slider } from "../ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

const ULTRACODE = "__ultracode__";

/** Short labels for the canonical effort levels (falls back to the live
 *  choice name / raw value when a model exposes its own). */
const EFFORT_LABELS: Record<string, string> = {
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "xHigh",
	max: "Max",
	default: "Default",
};

const ULTRACODE_RE = /\bultracode\b/i;

export function hasUltracode(text: string): boolean {
	return ULTRACODE_RE.test(text);
}

/**
 * Reasoning-effort as a single slider whose discrete stops are the agent's
 * effort levels, with "Ultracode" as a distinct rightmost stop. Effort stops
 * persist via the ACP session config; the Ultracode stop is a per-turn keyword
 * seeded into the draft (it also bumps effort to max) — so the active stop is
 * derived from the draft text, snapping back to the effort level once sent.
 */
export function EffortSlider({
	effortOption,
	onSetEffort,
	text,
	onSetText,
}: {
	effortOption?: AgentConfigOption;
	onSetEffort: (value: string) => void;
	text: string;
	onSetText: (updater: (prev: string) => string) => void;
}) {
	// Local drag position so the thumb tracks the pointer; the actual config
	// mutation / keyword change only fires once on release (onValueCommit).
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const choices = useMemo(
		() => (effortOption ? flattenConfigChoices(effortOption) : []),
		[effortOption],
	);
	if (!effortOption || choices.length === 0) return null;

	const ultracodeActive = hasUltracode(text);
	// effort levels in order, then a synthetic ultracode end-cap.
	const stops = [...choices.map((c) => c.value), ULTRACODE];
	const maxEffort = choices[choices.length - 1]?.value;
	const currentEffortIdx = Math.max(
		0,
		choices.findIndex((c) => c.value === effortOption.currentValue),
	);
	const settledIndex = ultracodeActive ? stops.length - 1 : currentEffortIdx;
	const displayIndex = dragIndex ?? settledIndex;
	const atUltracode = stops[displayIndex] === ULTRACODE;

	const labelFor = (i: number) => {
		const v = stops[i];
		if (v === ULTRACODE) return "Ultracode";
		return choices[i]?.name ?? EFFORT_LABELS[v] ?? v;
	};

	const addUltracode = () =>
		onSetText((t) =>
			ULTRACODE_RE.test(t) ? t : t ? `ultracode ${t}` : "ultracode ",
		);
	// Strip every occurrence (+ surrounding whitespace) so a drag-off can't get
	// stuck when the word appears more than once in the draft.
	const removeUltracode = () =>
		onSetText((t) => t.replace(/\s*\bultracode\b\s*/gi, " ").trim());

	function commit(next: number) {
		if (stops[next] === ULTRACODE) {
			addUltracode();
			if (maxEffort && effortOption?.currentValue !== maxEffort) {
				onSetEffort(maxEffort);
			}
		} else {
			if (ultracodeActive) removeUltracode();
			onSetEffort(stops[next]);
		}
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-muted/20 px-2.5 py-1.5">
					<Gauge size={12} className="shrink-0 text-muted-foreground" />
					<span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
						Effort
					</span>
					<Slider
						min={0}
						max={stops.length - 1}
						step={1}
						value={[displayIndex]}
						onValueChange={(v) => setDragIndex(v[0] ?? 0)}
						onValueCommit={(v) => {
							commit(v[0] ?? 0);
							setDragIndex(null);
						}}
						aria-label="Reasoning effort"
						className="mx-1 min-w-[100px] flex-1"
					/>
					<span
						className={cn(
							"flex w-[68px] shrink-0 items-center justify-end gap-1 text-right text-[11px] font-medium tabular-nums",
							atUltracode ? "text-primary" : "text-foreground",
						)}
					>
						{atUltracode && <Waypoints size={11} className="shrink-0" />}
						<span className="truncate">{labelFor(displayIndex)}</span>
					</span>
				</div>
			</TooltipTrigger>
			<TooltipContent>
				Reasoning effort. Rightmost = Ultracode — plan this turn as a
				multi-agent Workflow (sets effort to max).
			</TooltipContent>
		</Tooltip>
	);
}
