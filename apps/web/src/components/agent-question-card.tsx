import { Check, MessageCircleQuestion } from "lucide-react";
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
 * MCP form elicitations). Single-question prompts answer on tap; multi-part
 * forms collect everything and submit together. "Skip" tells the agent the
 * user passed (the turn continues) — only Dismiss aborts the asking tool.
 */

type AnswerValue = string | string[] | boolean;

function SelectField({
	field,
	value,
	onChange,
}: {
	field: AgentQuestionField;
	value: AnswerValue | undefined;
	onChange: (value: AnswerValue) => void;
}) {
	const multi = field.kind === "multiselect";
	const selected = new Set(
		multi ? ((value as string[]) ?? []) : value ? [value as string] : [],
	);
	return (
		<div className="flex flex-wrap gap-1.5">
			{(field.options ?? []).map((option) => {
				const isOn = selected.has(option.value);
				return (
					<button
						key={option.value}
						type="button"
						onClick={() => {
							if (multi) {
								const next = new Set(selected);
								if (isOn) next.delete(option.value);
								else next.add(option.value);
								onChange([...next]);
							} else {
								onChange(isOn ? "" : option.value);
							}
						}}
						className={cn(
							"flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
							isOn
								? "border-foreground bg-foreground text-background"
								: "border-border bg-background text-foreground hover:border-foreground/40",
						)}
					>
						{isOn && <Check size={11} className="shrink-0" />}
						<span className="max-w-[340px]">{option.label}</span>
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

	const selectFields = useMemo(
		() =>
			request.fields.filter(
				(f) => f.kind === "select" || f.kind === "multiselect",
			),
		[request.fields],
	);
	const textFields = useMemo(
		() => request.fields.filter((f) => f.kind === "text"),
		[request.fields],
	);
	const booleanFields = useMemo(
		() => request.fields.filter((f) => f.kind === "boolean"),
		[request.fields],
	);

	// One single-select question and no typed text → answering on tap feels
	// like the CLI; otherwise collect and submit.
	const hasTypedText = textFields.some(
		(f) =>
			typeof answers[f.key] === "string" && (answers[f.key] as string).trim(),
	);
	const tapToAnswer =
		selectFields.length === 1 &&
		selectFields[0].kind === "select" &&
		booleanFields.length === 0 &&
		!hasTypedText;

	const submit = (content: Record<string, AnswerValue>) => {
		const clean: Record<string, AnswerValue> = {};
		for (const [key, value] of Object.entries(content)) {
			if (typeof value === "string" && !value.trim()) continue;
			if (Array.isArray(value) && value.length === 0) continue;
			clean[key] = value;
		}
		onAnswer("accept", clean);
	};

	const hasAnyAnswer = Object.entries(answers).some(([, value]) =>
		typeof value === "string"
			? value.trim() !== ""
			: Array.isArray(value)
				? value.length > 0
				: true,
	);

	return (
		<div className="mb-2 min-w-0 rounded-lg border border-border bg-muted/30 p-3">
			<div className="flex items-center gap-2 text-xs font-medium text-foreground">
				<MessageCircleQuestion size={14} className="shrink-0" />
				<span>{request.message || "The agent has a question"}</span>
			</div>

			<div className="mt-2 space-y-3">
				{request.fields.map((field) => {
					if (field.kind === "select" || field.kind === "multiselect") {
						return (
							<div key={field.key} className="min-w-0">
								{(field.title || field.description) && (
									<p className="mb-1.5 text-[11px] text-muted-foreground">
										{field.title && (
											<span className="font-medium text-foreground">
												{field.title}
											</span>
										)}
										{field.title && field.description && " — "}
										{field.description}
									</p>
								)}
								<SelectField
									field={field}
									value={answers[field.key]}
									onChange={(value) => {
										if (tapToAnswer && typeof value === "string" && value) {
											submit({ ...answers, [field.key]: value });
											return;
										}
										setAnswers((prev) => ({ ...prev, [field.key]: value }));
									}}
								/>
							</div>
						);
					}
					if (field.kind === "boolean") {
						return (
							<div key={field.key} className="min-w-0">
								<p className="mb-1.5 text-[11px] font-medium text-foreground">
									{field.title ?? field.key}
								</p>
								<SelectField
									field={{
										...field,
										kind: "select",
										options: [
											{ value: "true", label: "Yes" },
											{ value: "false", label: "No" },
										],
									}}
									value={
										answers[field.key] === undefined
											? undefined
											: String(answers[field.key])
									}
									onChange={(value) =>
										setAnswers((prev) => ({
											...prev,
											[field.key]: value === "true",
										}))
									}
								/>
							</div>
						);
					}
					return (
						<div key={field.key} className="min-w-0">
							<Input
								value={(answers[field.key] as string) ?? ""}
								onChange={(e) =>
									setAnswers((prev) => ({
										...prev,
										[field.key]: e.target.value,
									}))
								}
								onKeyDown={(e) => {
									if (e.key === "Enter" && hasAnyAnswer) submit(answers);
								}}
								placeholder={
									field.title === "Other"
										? "Or type your own answer…"
										: (field.title ?? field.description ?? "Your answer…")
								}
								className="h-8 text-xs"
							/>
						</div>
					);
				})}
			</div>

			<div className="mt-3 flex flex-wrap items-center gap-2">
				{!tapToAnswer && (
					<Button
						size="sm"
						className="h-7 text-xs"
						disabled={!hasAnyAnswer}
						onClick={() => submit(answers)}
					>
						Submit
					</Button>
				)}
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
