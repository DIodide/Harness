import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { AlertTriangle, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useSandboxPanel } from "../../lib/sandbox-panel-context";
import { RoseCurveSpinner } from "../rose-curve-spinner";
import { SandboxPanel } from "../sandbox/sandbox-panel";
import { ThinkingFiveSpinner } from "../thinking-five-spinner";
import { Skeleton } from "../ui/skeleton";

const SUGGESTED_PROMPTS = [
	"Help me write a Python script to process CSV files",
	"Explain how WebSockets work in simple terms",
	"Review my API design and suggest improvements",
	"Create a deployment checklist for production",
];

export function HighlightText({
	text,
	query,
}: {
	text: string;
	query: string;
}) {
	if (!query) return <>{text}</>;

	const lowerText = text.toLowerCase();
	const lowerQuery = query.toLowerCase();
	const parts: React.ReactNode[] = [];
	let lastIndex = 0;

	let index = lowerText.indexOf(lowerQuery, lastIndex);
	while (index !== -1) {
		if (index > lastIndex) {
			parts.push(text.slice(lastIndex, index));
		}
		parts.push(
			<mark
				key={index}
				className="bg-yellow-200 dark:bg-yellow-800 text-inherit rounded-sm"
			>
				{text.slice(index, index + query.length)}
			</mark>,
		);
		lastIndex = index + query.length;
		index = lowerText.indexOf(lowerQuery, lastIndex);
	}

	if (lastIndex < text.length) {
		parts.push(text.slice(lastIndex));
	}

	return <>{parts}</>;
}

export function McpFailureBanner({
	failures,
	onDismiss,
	onDismissAll,
}: {
	failures: Array<{
		id: number;
		serverName: string;
		serverUrl: string;
		reason: string;
	}>;
	onDismiss: (id: number) => void;
	onDismissAll: () => void;
}) {
	if (failures.length === 0) return null;

	return (
		<AnimatePresence>
			<motion.div
				initial={{ height: 0, opacity: 0 }}
				animate={{ height: "auto", opacity: 1 }}
				exit={{ height: 0, opacity: 0 }}
				transition={{ duration: 0.2 }}
				className="border-b border-amber-500/20 bg-amber-500/5"
			>
				<div className="flex items-start gap-3 px-4 py-2.5">
					<AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
					<div className="min-w-0 flex-1">
						<p className="text-xs font-medium text-amber-600 dark:text-amber-400">
							{failures.length === 1
								? "An MCP server failed to connect"
								: `${failures.length} MCP servers failed to connect`}
						</p>
						<div className="mt-1 flex flex-wrap gap-1.5">
							{failures.map((f) => (
								<span
									key={f.id}
									className="inline-flex items-center gap-1.5 rounded-sm bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300"
								>
									<span
										className={`h-1 w-1 rounded-full ${f.reason === "auth_required" ? "bg-red-400" : "bg-amber-400"}`}
									/>
									{f.serverName}
									{f.reason === "auth_required" && (
										<span className="text-amber-500/70">— OAuth required</span>
									)}
									<button
										type="button"
										className="ml-0.5 opacity-50 transition-opacity hover:opacity-100"
										onClick={() => onDismiss(f.id)}
									>
										<X size={8} />
									</button>
								</span>
							))}
						</div>
						<p className="mt-1 text-[10px] text-amber-600/60 dark:text-amber-400/50">
							Tools from these servers won't be available. Reconnect from the
							MCP status menu above.
						</p>
					</div>
					<button
						type="button"
						className="shrink-0 rounded-sm p-0.5 text-amber-500/50 transition-colors hover:bg-amber-500/10 hover:text-amber-500"
						onClick={onDismissAll}
					>
						<X size={12} />
					</button>
				</div>
			</motion.div>
		</AnimatePresence>
	);
}

export function EmptyChat({
	suggestedPrompts,
	onPromptClick,
}: {
	suggestedPrompts?: string[];
	onPromptClick: (text: string) => void;
}) {
	const prompts =
		suggestedPrompts && suggestedPrompts.length > 0
			? suggestedPrompts
			: SUGGESTED_PROMPTS;

	return (
		<div className="flex flex-1 flex-col items-center justify-center px-4">
			<motion.div
				initial={{ opacity: 0, y: 12 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.4 }}
				className="text-center"
			>
				<div className="mx-auto mb-6 flex items-center justify-center">
					<ThinkingFiveSpinner size={96} className="text-foreground" />
				</div>
				<h2 className="mb-2 text-lg font-medium text-foreground">
					Start a conversation
				</h2>
				<p className="mb-8 text-sm text-muted-foreground">
					Ask anything — your agent is equipped and ready.
				</p>
				<div className="grid max-w-lg gap-2 sm:grid-cols-2">
					{prompts.slice(0, 4).map((prompt) => (
						<button
							key={prompt}
							type="button"
							onClick={() => onPromptClick(prompt)}
							className="border border-border p-3 text-left text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-muted hover:text-foreground"
						>
							{prompt}
						</button>
					))}
				</div>
			</motion.div>
		</div>
	);
}

export function ChatSkeleton() {
	return (
		<div className="flex h-full bg-background">
			<div className="w-[280px] border-r border-border p-3">
				<Skeleton className="mb-4 h-6 w-24" />
				<div className="space-y-2">
					{["s1", "s2", "s3", "s4", "s5"].map((key) => (
						<Skeleton key={key} className="h-7 w-full" />
					))}
				</div>
			</div>
			<div className="flex flex-1 flex-col">
				<div className="border-b border-border px-4 py-2.5">
					<Skeleton className="h-6 w-40" />
				</div>
				<div className="flex flex-1 items-center justify-center">
					<RoseCurveSpinner size={48} className="text-foreground" />
				</div>
			</div>
		</div>
	);
}

export function SandboxPanelToggle() {
	const panel = useSandboxPanel();
	if (!panel?.panelOpen) return null;
	return <SandboxPanel />;
}

export function groupByDate<
	T extends {
		_id: Id<"conversations">;
		title: string;
		lastMessageAt: number;
		lastHarnessId?: Id<"harnesses">;
	},
>(conversations: T[]) {
	const now = Date.now();
	const dayMs = 86400000;
	const todayStart = now - (now % dayMs);

	const groups: { label: string; items: typeof conversations }[] = [];
	const today: typeof conversations = [];
	const yesterday: typeof conversations = [];
	const week: typeof conversations = [];
	const older: typeof conversations = [];

	for (const c of conversations) {
		if (c.lastMessageAt >= todayStart) today.push(c);
		else if (c.lastMessageAt >= todayStart - dayMs) yesterday.push(c);
		else if (c.lastMessageAt >= todayStart - 7 * dayMs) week.push(c);
		else older.push(c);
	}

	if (today.length) groups.push({ label: "Today", items: today });
	if (yesterday.length) groups.push({ label: "Yesterday", items: yesterday });
	if (week.length) groups.push({ label: "Previous 7 Days", items: week });
	if (older.length) groups.push({ label: "Older", items: older });

	return groups;
}
