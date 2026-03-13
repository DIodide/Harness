import { Brain, ChevronRight, Loader2, Wrench } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { MarkdownMessage } from "./markdown-message";
import {
	OAuthReconnectPrompt,
	parseAuthRequiredError,
} from "./mcp-server-status";

export function ThinkingBlock({
	content,
	isStreaming,
}: {
	content: string;
	isStreaming: boolean;
}) {
	const [open, setOpen] = useState(true);
	const [userToggled, setUserToggled] = useState(false);

	// Auto-collapse when thinking finishes, unless the user manually toggled
	useEffect(() => {
		if (!isStreaming && !userToggled) {
			setOpen(false);
		}
	}, [isStreaming, userToggled]);

	return (
		<div className="mb-2">
			<button
				type="button"
				onClick={() => {
					setUserToggled(true);
					setOpen((o) => !o);
				}}
				className="flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
			>
				<motion.span
					animate={{ rotate: open ? 90 : 0 }}
					transition={{ duration: 0.15 }}
					className="flex"
				>
					<ChevronRight size={10} />
				</motion.span>
				<Brain size={10} />
				{isStreaming ? (
					<span className="flex items-center gap-1">
						Thinking
						<Loader2 size={8} className="animate-spin" />
					</span>
				) : (
					<span>Thought process</span>
				)}
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
						<div className="mt-1.5 border-l-2 border-muted-foreground/20 pl-3 text-[11px] leading-relaxed text-muted-foreground">
							<MarkdownMessage content={content} />
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

export function ToolCallBlock({
	tool,
	arguments: args,
	result,
	isStreaming,
}: {
	tool: string;
	arguments: Record<string, unknown>;
	result?: string;
	isStreaming: boolean;
}) {
	const [open, setOpen] = useState(false);
	const displayName = tool.includes("__") ? tool.replace("__", " / ") : tool;
	const authError = result ? parseAuthRequiredError(result) : null;

	return (
		<div className="mb-1.5">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
			>
				<motion.span
					animate={{ rotate: open ? 90 : 0 }}
					transition={{ duration: 0.15 }}
					className="flex"
				>
					<ChevronRight size={10} />
				</motion.span>
				{isStreaming ? (
					<Loader2 size={10} className="animate-spin" />
				) : authError ? (
					<Wrench size={10} className="text-destructive" />
				) : (
					<Wrench size={10} className="text-emerald-500" />
				)}
				<span>
					{displayName}
					{isStreaming ? "..." : ""}
				</span>
				{authError && (
					<span className="text-[10px] text-destructive">— auth required</span>
				)}
			</button>

			{authError && (
				<div className="mt-1.5 ml-4">
					<OAuthReconnectPrompt
						serverUrl={authError.serverUrl}
						errorMessage={authError.error}
					/>
				</div>
			)}

			<AnimatePresence>
				{open && (
					<motion.div
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.2 }}
						className="overflow-hidden"
					>
						<div className="mt-1.5 space-y-2 border-l-2 border-muted-foreground/20 pl-3 text-[11px] leading-relaxed text-muted-foreground">
							<div>
								<p className="mb-0.5 font-medium text-foreground/70">
									Arguments
								</p>
								<pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2 font-mono text-[10px]">
									{JSON.stringify(args, null, 2)}
								</pre>
							</div>
							{result && !authError && (
								<div>
									<p className="mb-0.5 font-medium text-foreground/70">
										Result
									</p>
									<pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2 font-mono text-[10px]">
										{result}
									</pre>
								</div>
							)}
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
