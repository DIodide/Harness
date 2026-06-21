import { ChevronRight, Minimize2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { MarkdownMessage } from "../markdown-message";

export interface CompactionRow {
	_id: string;
	summary: string;
	trigger: "manual" | "auto";
	preTokens?: number;
	postTokens?: number;
	atMessageCount?: number;
	createdAt: number;
}

function formatTokens(n: number): string {
	if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
	return String(n);
}

/** One compaction event — collapsed; expands to the full summary prose. */
function CompactionBlock({ compaction }: { compaction: CompactionRow }) {
	const [open, setOpen] = useState(false);
	const { summary, trigger, preTokens, postTokens, atMessageCount } =
		compaction;
	const reclaimed =
		preTokens != null && postTokens != null ? preTokens - postTokens : null;

	return (
		<div className="rounded-sm border border-border bg-muted/20">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
			>
				<motion.span
					animate={{ rotate: open ? 90 : 0 }}
					transition={{ duration: 0.15 }}
					className="flex shrink-0"
				>
					<ChevronRight size={11} className="text-muted-foreground" />
				</motion.span>
				<Minimize2 size={11} className="shrink-0 text-muted-foreground" />
				<span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
					Context compacted
				</span>
				<span className="rounded-sm bg-foreground/10 px-1 font-mono text-[9px] text-muted-foreground">
					{trigger === "manual" ? "/compact" : "auto"}
				</span>
				{reclaimed != null && reclaimed > 0 && (
					<span className="font-mono text-[9px] text-muted-foreground/70">
						~{formatTokens(reclaimed)} tokens reclaimed
					</span>
				)}
				{atMessageCount != null && (
					<span className="ml-auto shrink-0 font-mono text-[9px] text-muted-foreground/50">
						after {atMessageCount} msgs
					</span>
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
						<div className="border-t border-border px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
							{summary ? (
								<MarkdownMessage content={summary} />
							) : (
								<span className="italic">No summary text was captured.</span>
							)}
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

/**
 * Renders a conversation's compaction history (observability) plus a one-time
 * "continue the full chat vs. start a fresh session from the latest summary"
 * choice — giving the developer both visibility into compaction and agency
 * over how to proceed.
 */
export function CompactionPanel({
	compactions,
	onStartFromSummary,
	isStartingClone,
	isStreaming,
}: {
	compactions: CompactionRow[];
	onStartFromSummary?: (compactionId: string) => void;
	isStartingClone?: boolean;
	isStreaming?: boolean;
}) {
	const [dismissed, setDismissed] = useState(false);
	if (compactions.length === 0) return null;
	// listByConversation returns oldest-first; the latest drives the clone.
	const latest = compactions[compactions.length - 1];

	return (
		<div className="mx-auto mb-6 max-w-3xl space-y-1.5">
			{compactions.map((c) => (
				<CompactionBlock key={c._id} compaction={c} />
			))}
			{/* Hide the continue-vs-clone choice mid-turn — starting a clone would
			    navigate away from the in-flight response. The cards still show. */}
			{!dismissed && !isStreaming && onStartFromSummary && (
				<div className="flex flex-col items-center gap-2 border-t border-border pt-3 text-center">
					<p className="font-mono text-[11px] text-muted-foreground">
						This conversation was compacted. Continue with the full history, or
						start a fresh session seeded from the latest summary.
					</p>
					<div className="flex flex-wrap items-center justify-center gap-2">
						<button
							type="button"
							onClick={() => setDismissed(true)}
							className="rounded-sm border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
						>
							Continue full chat
						</button>
						<button
							type="button"
							disabled={isStartingClone}
							onClick={() => onStartFromSummary(latest._id)}
							className="rounded-sm border border-foreground bg-foreground px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-background transition-opacity hover:opacity-90 disabled:opacity-50"
						>
							{isStartingClone ? "Starting…" : "New session from summary"}
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
