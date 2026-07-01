import {
	Check,
	Copy,
	GitBranch,
	GitFork,
	Pencil,
	RefreshCw,
	RotateCcw,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { UsageData } from "../lib/use-chat-stream";
import { cn } from "../lib/utils";

export type DisplayMode = "zen" | "standard" | "developer";

interface MessageActionsProps {
	content: string;
	role: "user" | "assistant";
	displayMode: DisplayMode;
	onRegenerate?: () => void;
	onFork?: () => void;
	onEditPrompt?: () => void;
	/** Rewind the thread to this user message (truncate everything after it). */
	onRewind?: () => void;
	/** Branch a new conversation at this user message, leaving the original. */
	onRewindFork?: () => void;
	isStreaming?: boolean;
	usage?: UsageData;
	model?: string;
}

export function MessageActions({
	content,
	role,
	displayMode,
	onRegenerate,
	onFork,
	onEditPrompt,
	onRewind,
	onRewindFork,
	isStreaming,
	usage,
	model,
}: MessageActionsProps) {
	if (displayMode === "zen" || isStreaming) return null;

	const visible = displayMode === "standard" || displayMode === "developer";
	const showCopy = visible;
	const showEditPrompt = visible && role === "user" && onEditPrompt;
	// Rewind appears under EVERY user message (no last-message restriction).
	const showRewind = visible && role === "user" && onRewind;
	const showRewindFork = visible && role === "user" && onRewindFork;
	const showFork = visible && role === "assistant" && onFork;
	const showRegenerate =
		displayMode === "developer" && role === "assistant" && onRegenerate;
	const showInfo =
		displayMode === "developer" && role === "assistant" && (usage || model);

	return (
		<div className="flex items-center gap-3 pt-1 opacity-0 transition-opacity group-hover:opacity-100">
			{showCopy && <CopyMessageButton text={content} />}
			{showEditPrompt && <EditPromptButton onClick={onEditPrompt} />}
			{showRewind && <RewindButton onClick={onRewind} />}
			{showRewindFork && <RewindForkButton onClick={onRewindFork} />}
			{showFork && <ForkButton onClick={onFork} />}
			{showRegenerate && <RegenerateButton onClick={onRegenerate} />}
			{showInfo && <UsageInfo usage={usage} model={model} />}
		</div>
	);
}

function CopyMessageButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(text);
		setCopied(true);
		clearTimeout(timeoutRef.current);
		timeoutRef.current = setTimeout(() => setCopied(false), 2000);
	}, [text]);

	return (
		<button
			type="button"
			onClick={handleCopy}
			className="flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
		>
			{copied ? (
				<>
					<Check size={12} />
					Copied
				</>
			) : (
				<>
					<Copy size={12} />
					Copy
				</>
			)}
		</button>
	);
}

function EditPromptButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
		>
			<Pencil size={12} />
			Edit
		</button>
	);
}

function ForkButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
		>
			<GitFork size={12} />
			Fork
		</button>
	);
}

/** Rewind is destructive (deletes the conversation below), so it confirms
 *  inline on first click rather than firing immediately. */
function RewindButton({ onClick }: { onClick: () => void }) {
	const [confirming, setConfirming] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	const reset = useCallback(() => {
		clearTimeout(timeoutRef.current);
		setConfirming(false);
	}, []);

	const handleClick = useCallback(() => {
		if (confirming) {
			reset();
			onClick();
			return;
		}
		setConfirming(true);
		clearTimeout(timeoutRef.current);
		timeoutRef.current = setTimeout(() => setConfirming(false), 3000);
	}, [confirming, onClick, reset]);

	return (
		<button
			type="button"
			onClick={handleClick}
			onBlur={reset}
			className={cn(
				"flex items-center gap-1 text-[10px] transition-colors",
				confirming
					? "text-destructive"
					: "text-muted-foreground hover:text-foreground",
			)}
		>
			<RotateCcw size={12} />
			{confirming ? "Delete below — confirm?" : "Rewind"}
		</button>
	);
}

function RewindForkButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
		>
			<GitBranch size={12} />
			Rewind &amp; fork
		</button>
	);
}

function RegenerateButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
		>
			<RefreshCw size={12} />
			Regenerate
		</button>
	);
}

function UsageInfo({ usage, model }: { usage?: UsageData; model?: string }) {
	const parts: string[] = [];

	if (model) {
		parts.push(model);
	}

	if (usage) {
		parts.push(`${usage.promptTokens} in / ${usage.completionTokens} out`);

		if (usage.cost != null) {
			parts.push(`$${usage.cost.toFixed(4)}`);
		}
	}

	return (
		<span className="text-[10px] text-muted-foreground">
			{parts.join(" · ")}
		</span>
	);
}
