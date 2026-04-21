import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
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

function pickInitial(): number {
	return Math.floor(Math.random() * FLAVOR_MESSAGES.length);
}

export function PendingResponseIndicator({
	className,
}: {
	className?: string;
}) {
	const [idx, setIdx] = useState(pickInitial);

	useEffect(() => {
		const prefersReduced =
			window?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
		if (prefersReduced) return;
		const id = setInterval(() => {
			setIdx((prev) => (prev + 1) % FLAVOR_MESSAGES.length);
		}, ROTATE_MS);
		return () => clearInterval(id);
	}, []);

	const message = FLAVOR_MESSAGES[idx];

	return (
		<div
			className={cn(
				"flex items-center gap-2 text-muted-foreground",
				className,
			)}
			aria-live="polite"
		>
			<RoseCurveSpinner size={14} />
			<AnimatePresence mode="wait">
				<motion.span
					key={idx}
					initial={{ opacity: 0, y: 4 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -4 }}
					transition={{ duration: 0.22 }}
					className="text-xs italic"
				>
					{message}
				</motion.span>
			</AnimatePresence>
		</div>
	);
}
