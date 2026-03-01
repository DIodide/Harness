import { Check, Copy, RefreshCw } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { UsageData } from "../lib/use-chat-stream";

export type DisplayMode = "zen" | "standard" | "developer";

interface MessageActionsProps {
	content: string;
	role: "user" | "assistant";
	displayMode: DisplayMode;
	onRegenerate?: () => void;
	isStreaming?: boolean;
	usage?: UsageData;
	model?: string;
}

export function MessageActions({
	content,
	role,
	displayMode,
	onRegenerate,
	isStreaming,
	usage,
	model,
}: MessageActionsProps) {
	if (displayMode === "zen" || isStreaming) return null;

	const showCopy = displayMode === "standard" || displayMode === "developer";
	const showRegenerate =
		displayMode === "developer" && role === "assistant" && onRegenerate;
	const showUsage =
		displayMode === "developer" && role === "assistant" && usage;

	return (
		<div className="flex items-center gap-3 pt-1 opacity-0 transition-opacity group-hover:opacity-100">
			{showCopy && <CopyMessageButton text={content} />}
			{showRegenerate && <RegenerateButton onClick={onRegenerate} />}
			{showUsage && <UsageInfo usage={usage} model={model} />}
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

function UsageInfo({ usage, model }: { usage: UsageData; model?: string }) {
	const parts: string[] = [];

	if (model) {
		parts.push(model);
	}

	parts.push(`${usage.promptTokens} in / ${usage.completionTokens} out`);

	if (usage.cost != null) {
		parts.push(`$${usage.cost.toFixed(4)}`);
	}

	return (
		<span className="text-[10px] text-muted-foreground">
			{parts.join(" · ")}
		</span>
	);
}
