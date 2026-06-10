import { ArrowLeft, Check, MessageCircleQuestion } from "lucide-react";
import { useMemo, useState } from "react";
import type {
	AgentQuestionAction,
	AgentQuestionField,
	AgentQuestionRequest,
} from "../lib/agent-mode";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/**
 * First-class rendering for agent questions (Claude Code's AskUserQuestion,
 * MCP form elicitations), presented ONE QUESTION AT A TIME so a multi-part
 * form never takes over the screen. Tapping a single-select option answers
 * and advances; the last answer submits everything. "Skip" tells the agent
 * the user passed (the turn continues) — only Dismiss aborts the tool.
 */

type AnswerValue = string | string[] | boolean;

interface Step {
	field: AgentQuestionField;
	/** boolean fields are presented as Yes/No selects */
	options: Array<{ value: string; label: string }>;
	multi: boolean;
}

function OptionButtons({
	step,
	selected,
	onToggle,
}: {
	step: Step;
	selected: Set<string>;
	onToggle: (value: string) => void;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			{step.options.map((option) => {
				const isOn = selected.has(option.value);
				return (
					<button
						key={option.value}
						type="button"
						onClick={() => onToggle(option.value)}
						className={cn(
							"flex w-full items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
							isOn
								? "border-foreground bg-foreground text-background"
								: "border-border bg-background text-foreground hover:border-foreground/40",
						)}
					>
						<span className="mt-0.5 w-3 shrink-0">
							{isOn && <Check size={11} />}
						</span>
						<span className="min-w-0">{option.label}</span>
					</button>
				);
			})}
		</div>
	);
}

export function AgentQuestionCard({
	request,
	onAnswer,
}: {
	request: AgentQuestionRequest;
	onAnswer: (
		action: AgentQuestionAction,
		content?: Record<string, AnswerValue>,
	) => void;
}) {
	const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
	const [stepIndex, setStepIndex] = useState(0);
	const [showOther, setShowOther] = useState(false);
	const [otherText, setOtherText] = useState("");

	// Choice questions become wizard steps; free-text fields (Claude's
	// trailing "customAnswer") stay form-global behind the "Other…" toggle.
	const steps = useMemo<Step[]>(
		() =>
			request.fields
				.filter((f) => f.kind !== "text")
				.map((field) => ({
					field,
					multi: field.kind === "multiselect",
					options:
						field.kind === "boolean"
							? [
									{ value: "true", label: "Yes" },
									{ value: "false", label: "No" },
								]
							: (field.options ?? []),
				})),
		[request.fields],
	);
	const textFields = useMemo(
		() => request.fields.filter((f) => f.kind === "text"),
		[request.fields],
	);
	const step = steps[stepIndex];
	const isLastStep = stepIndex >= steps.length - 1;

	const buildContent = (
		current: Record<string, AnswerValue>,
	): Record<string, AnswerValue> => {
		const content: Record<string, AnswerValue> = {};
		for (const [key, value] of Object.entries(current)) {
			if (typeof value === "string" && !value.trim()) continue;
			if (Array.isArray(value) && value.length === 0) continue;
			content[key] = value;
		}
		// Free text goes to the first text field (Claude has exactly one).
		const textKey = textFields[0]?.key;
		if (textKey && otherText.trim()) content[textKey] = otherText.trim();
		return content;
	};

	const submit = (current: Record<string, AnswerValue>) =>
		onAnswer("accept", buildContent(current));

	const answerStep = (value: AnswerValue) => {
		if (!step) return;
		const next = { ...answers, [step.field.key]: value };
		setAnswers(next);
		if (isLastStep) {
			submit(next);
		} else {
			setStepIndex((i) => i + 1);
			setShowOther(false);
		}
	};

	const selectedInStep = new Set<string>(
		step
			? step.field.kind === "boolean"
				? answers[step.field.key] === undefined
					? []
					: [String(answers[step.field.key])]
				: step.multi
					? ((answers[step.field.key] as string[]) ?? [])
					: answers[step.field.key]
						? [answers[step.field.key] as string]
						: []
			: [],
	);

	const multiSelections = (answers[step?.field.key ?? ""] as string[]) ?? [];

	return (
		<div className="mb-2 min-w-0 rounded-lg border border-border bg-muted/30 p-3">
			<div className="flex items-center gap-2 text-xs font-medium text-foreground">
				<MessageCircleQuestion size={14} className="shrink-0" />
				<span className="min-w-0 flex-1 truncate">
					{request.message || "The agent has a question"}
				</span>
				{steps.length > 1 && (
					<span className="shrink-0 text-[10px] text-muted-foreground">
						{Math.min(stepIndex + 1, steps.length)} of {steps.length}
					</span>
				)}
			</div>

			<div className="mt-2 max-h-[40vh] min-w-0 space-y-2 overflow-y-auto">
				{step ? (
					<>
						{(step.field.title || step.field.description) && (
							<p className="text-[11px] text-muted-foreground">
								{step.field.title && (
									<span className="font-medium text-foreground">
										{step.field.title}
									</span>
								)}
								{step.field.title && step.field.description && " — "}
								{step.field.description}
							</p>
						)}
						<OptionButtons
							step={step}
							selected={selectedInStep}
							onToggle={(value) => {
								if (step.field.kind === "boolean") {
									answerStep(value === "true");
								} else if (step.multi) {
									const next = new Set(multiSelections);
									if (next.has(value)) next.delete(value);
									else next.add(value);
									setAnswers((prev) => ({
										...prev,
										[step.field.key]: [...next],
									}));
								} else {
									answerStep(value);
								}
							}}
						/>
					</>
				) : (
					// No choice questions (pure text elicitation).
					textFields.length === 0 && (
						<p className="text-[11px] text-muted-foreground">
							No structured options — type an answer below.
						</p>
					)
				)}

				{(showOther || !step) && (
					<Input
						autoFocus={showOther}
						value={otherText}
						onChange={(e) => setOtherText(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && otherText.trim()) submit(answers);
						}}
						placeholder="Type your own answer…"
						className="h-8 text-xs"
					/>
				)}
			</div>

			<div className="mt-2.5 flex flex-wrap items-center gap-2">
				{stepIndex > 0 && (
					<Button
						size="sm"
						variant="ghost"
						className="h-7 px-2 text-xs text-muted-foreground"
						onClick={() => {
							setStepIndex((i) => Math.max(0, i - 1));
							setShowOther(false);
						}}
					>
						<ArrowLeft size={11} />
						Back
					</Button>
				)}
				{step?.multi && (
					<Button
						size="sm"
						className="h-7 text-xs"
						disabled={multiSelections.length === 0 && !otherText.trim()}
						onClick={() => answerStep(multiSelections)}
					>
						{isLastStep ? "Submit" : "Next"}
					</Button>
				)}
				{!step && (
					<Button
						size="sm"
						className="h-7 text-xs"
						disabled={!otherText.trim()}
						onClick={() => submit(answers)}
					>
						Submit
					</Button>
				)}
				{step && !showOther && textFields.length > 0 && (
					<Button
						size="sm"
						variant="outline"
						className="h-7 text-xs"
						onClick={() => setShowOther(true)}
					>
						Other…
					</Button>
				)}
				{step && showOther && (
					<Button
						size="sm"
						className="h-7 text-xs"
						disabled={!otherText.trim()}
						onClick={() => submit(answers)}
					>
						Submit
					</Button>
				)}
				<div className="flex-1" />
				<Button
					size="sm"
					variant="outline"
					className="h-7 text-xs"
					onClick={() => onAnswer("decline")}
				>
					Skip
				</Button>
				<Button
					size="sm"
					variant="ghost"
					className="h-7 text-xs text-muted-foreground"
					onClick={() => onAnswer("cancel")}
				>
					Dismiss
				</Button>
			</div>
		</div>
	);
}
