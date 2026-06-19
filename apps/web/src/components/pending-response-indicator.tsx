import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { RoseCurveSpinner } from "./rose-curve-spinner";

const FLAVOR_MESSAGES = [
	"Thinking…",
	"Warming up…",
	"Consulting the tools…",
	"Wiring up neurons…",
	"Querying the oracle…",
	"Reticulating splines…",
	"Gathering thoughts…",
	"Brewing a response…",
	"Summoning tokens…",
	"Sharpening the quill…",
	"Reading the room…",
	"Chasing down sources…",
	"Following the thread…",
	"Picking the right words…",
	"Double-checking the math…",
	"Aligning the stars…",
];

const ROTATE_MS = 2600;
// Once a turn runs longer than this, surface elapsed time so a slow response
// reads as "still working" rather than a frozen app.
const ELAPSED_HINT_S = 5;

function pickInitial(): number {
	return Math.floor(Math.random() * FLAVOR_MESSAGES.length);
}

function formatElapsed(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}m ${s}s`;
}

/**
 * Seconds since mount, ticking once per second. Lives in this small component
 * so the 1s re-render never touches the (large) message list above it.
 */
function useElapsedSeconds(): number {
	const [elapsed, setElapsed] = useState(0);
	const startRef = useRef<number>(Date.now());
	useEffect(() => {
		const id = setInterval(() => {
			setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
		}, 1000);
		return () => clearInterval(id);
	}, []);
	return elapsed;
}

/**
 * Liveness indicator for an in-flight assistant turn.
 *
 * - `full` (default): the spinner + rotating flavor text shown before the
 *   first token arrives. After {@link ELAPSED_HINT_S} it also shows elapsed
 *   time so a slow first token doesn't look frozen.
 * - `compact`: a subtle, breathing "Working…" heartbeat pinned to the bottom
 *   of a streaming bubble so the turn never looks frozen once content has
 *   started rendering and the agent goes quiet between steps.
 */
export function PendingResponseIndicator({
	className,
	message: messageOverride,
	variant = "full",
}: {
	className?: string;
	/** Real status (e.g. "Starting Codex sandbox…") instead of flavor text. */
	message?: string | null;
	variant?: "full" | "compact";
}) {
	const [idx, setIdx] = useState(pickInitial);
	const elapsed = useElapsedSeconds();

	useEffect(() => {
		if (messageOverride || variant === "compact") return;
		const prefersReduced =
			window?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
		if (prefersReduced) return;
		const id = setInterval(() => {
			setIdx((prev) => (prev + 1) % FLAVOR_MESSAGES.length);
		}, ROTATE_MS);
		return () => clearInterval(id);
	}, [messageOverride, variant]);

	const showElapsed = elapsed >= ELAPSED_HINT_S;

	if (variant === "compact") {
		const label = messageOverride ?? "Working…";
		return (
			<div
				className={cn(
					"mt-1.5 flex items-center gap-2 text-muted-foreground",
					className,
				)}
				aria-live="polite"
			>
				<RoseCurveSpinner size={11} />
				<motion.span
					// Gentle "breathing" so the row reads as alive even when the
					// visible content above it is momentarily static.
					animate={{ opacity: [0.55, 1, 0.55] }}
					transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY }}
					className="text-[11px]"
				>
					{label}
				</motion.span>
				{showElapsed && (
					<span className="font-mono text-[10px] text-muted-foreground/60 tabular-nums">
						{formatElapsed(elapsed)}
					</span>
				)}
			</div>
		);
	}

	const message = messageOverride ?? FLAVOR_MESSAGES[idx];

	return (
		<div
			className={cn("flex items-center gap-2 text-muted-foreground", className)}
			aria-live="polite"
		>
			<RoseCurveSpinner size={14} />
			<AnimatePresence mode="wait">
				<motion.span
					key={messageOverride ?? idx}
					initial={{ opacity: 0, y: 4 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -4 }}
					transition={{ duration: 0.22 }}
					className="text-xs italic"
				>
					{message}
				</motion.span>
			</AnimatePresence>
			{showElapsed && (
				<span className="font-mono text-[10px] text-muted-foreground/50 tabular-nums">
					{formatElapsed(elapsed)}
				</span>
			)}
		</div>
	);
}
