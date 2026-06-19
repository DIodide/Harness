import { convexQuery } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

function ProgressBar({
	pct,
	label,
	sublabel,
}: {
	pct: number;
	label: string;
	sublabel?: string;
}) {
	const color =
		pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-yellow-500" : "bg-emerald-500";

	return (
		<div className="space-y-1.5">
			<div className="flex items-center justify-between text-xs">
				<span className="text-foreground/80">{label}</span>
				<span
					className={cn(
						"font-medium",
						pct >= 90
							? "text-red-400"
							: pct >= 70
								? "text-yellow-400"
								: "text-foreground/60",
					)}
				>
					{Math.round(pct)}%
				</span>
			</div>
			<div className="h-1.5 w-full rounded-full bg-white/10">
				<div
					className={cn(
						"h-full rounded-full transition-all duration-500",
						color,
					)}
					style={{ width: `${Math.min(pct, 100)}%` }}
				/>
			</div>
			{sublabel && <p className="text-[10px] text-foreground/40">{sublabel}</p>}
		</div>
	);
}

function ModelBreakdown({
	items,
}: {
	items: Array<{ model: string; pct: number; tokensUsed: number }>;
}) {
	if (items.length === 0) return null;

	const sorted = [...items].sort((a, b) => b.pct - a.pct);

	return (
		<div className="space-y-2">
			<h4 className="text-xs font-medium text-foreground/60 uppercase tracking-wider">
				By Model
			</h4>
			<div className="space-y-1.5">
				{sorted.map((item) => (
					<div key={item.model} className="flex items-center gap-2">
						<span className="text-[11px] text-foreground/70 w-28 truncate">
							{item.model}
						</span>
						<div className="flex-1 h-1 rounded-full bg-white/10">
							<div
								className="h-full rounded-full bg-blue-400/60 transition-all duration-500"
								style={{ width: `${Math.min(item.pct, 100)}%` }}
							/>
						</div>
						<span className="text-[10px] text-foreground/40 w-10 text-right">
							{Math.round(item.pct)}%
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

function HarnessBreakdown({
	items,
}: {
	items: Array<{
		harnessId: string;
		harnessName: string;
		pct: number;
		tokensUsed: number;
	}>;
}) {
	if (items.length === 0) return null;

	const sorted = [...items].sort((a, b) => b.pct - a.pct);

	return (
		<div className="space-y-2">
			<h4 className="text-xs font-medium text-foreground/60 uppercase tracking-wider">
				By Harness
			</h4>
			<div className="space-y-1.5">
				{sorted.map((item) => (
					<div key={item.harnessId} className="flex items-center gap-2">
						<span className="text-[11px] text-foreground/70 w-28 truncate">
							{item.harnessName}
						</span>
						<div className="flex-1 h-1 rounded-full bg-white/10">
							<div
								className="h-full rounded-full bg-violet-400/60 transition-all duration-500"
								style={{ width: `${Math.min(item.pct, 100)}%` }}
							/>
						</div>
						<span className="text-[10px] text-foreground/40 w-10 text-right">
							{Math.round(item.pct)}%
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

const AGENT_LABELS: Record<string, string> = {
	"claude-code": "Claude Code",
	codex: "Codex",
	cursor: "Cursor",
};

function formatCost(usd: number): string {
	if (usd <= 0) return "$0.00";
	if (usd < 0.01) return "<$0.01";
	return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

interface AgentUsageRow {
	credentialId: string;
	agent: string;
	label: string | null;
	totalCostUsd: number;
	totalTokens: number;
	turns: number;
	todayCostUsd: number;
	lastModel: string | null;
}

/**
 * Per-credential usage for ACP agents (Claude Code, etc.). Distinct from the
 * OpenRouter budget bars above: this cost bills to the user's OWN agent
 * account, so it's shown as plain informational totals (estimated, no cap).
 */
function AgentUsageSection() {
	const { data } = useQuery(convexQuery(api.agentUsage.getMyAgentUsage, {}));
	const rows = (data ?? []) as AgentUsageRow[];
	if (rows.length === 0) return null;

	return (
		<div className="space-y-2 border-t border-white/10 pt-4">
			<div className="flex items-baseline justify-between">
				<h4 className="text-xs font-medium uppercase tracking-wider text-foreground/60">
					Agent usage
				</h4>
				<span className="text-[10px] text-foreground/40">
					estimated · your account
				</span>
			</div>
			<div className="space-y-1.5">
				{rows.map((r) => (
					<div
						key={r.credentialId}
						className="flex items-center gap-2 rounded-md bg-white/[0.03] px-2.5 py-2"
					>
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-1.5">
								<span className="truncate text-[11px] text-foreground/80">
									{r.label || AGENT_LABELS[r.agent] || r.agent}
								</span>
								{r.label && (
									<span className="shrink-0 rounded bg-white/10 px-1 text-[9px] text-foreground/50">
										{AGENT_LABELS[r.agent] || r.agent}
									</span>
								)}
							</div>
							<div className="mt-0.5 text-[10px] text-foreground/40">
								{formatTokens(r.totalTokens)} tokens · {r.turns} turn
								{r.turns === 1 ? "" : "s"}
								{r.lastModel ? ` · ${r.lastModel}` : ""}
							</div>
						</div>
						<div className="shrink-0 text-right">
							<div className="text-xs font-medium tabular-nums text-foreground/80">
								{formatCost(r.totalCostUsd)}
							</div>
							{r.todayCostUsd > 0 && (
								<div className="text-[10px] text-foreground/40">
									{formatCost(r.todayCostUsd)} today
								</div>
							)}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

export function formatResetTime(isoString: string): string {
	const reset = new Date(isoString);
	const now = new Date();
	const diffMs = reset.getTime() - now.getTime();
	if (diffMs <= 0) return "now";

	const hours = Math.floor(diffMs / (1000 * 60 * 60));
	const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

	if (hours > 24) {
		const days = Math.floor(hours / 24);
		return `${days}d ${hours % 24}h`;
	}
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

export function UsageDisplay() {
	const { data: usage, error } = useQuery(
		convexQuery(api.usage.getUserUsage, {}),
	);

	if (error) {
		return (
			<p className="px-4 py-2 text-xs text-destructive">
				Could not load usage.
			</p>
		);
	}

	if (!usage) {
		return (
			<div className="space-y-4 p-4">
				<div className="h-4 w-32 animate-pulse rounded bg-white/10" />
				<div className="h-2 w-full animate-pulse rounded bg-white/10" />
				<div className="h-2 w-full animate-pulse rounded bg-white/10" />
			</div>
		);
	}

	return (
		<div className="space-y-5">
			<ProgressBar
				pct={usage.dailyPctUsed}
				label="Daily usage"
				sublabel={`Resets in ${formatResetTime(usage.dailyResetAt)}`}
			/>

			<ProgressBar
				pct={usage.weeklyPctUsed}
				label="Weekly usage"
				sublabel={`Resets in ${formatResetTime(usage.weeklyResetAt)}`}
			/>

			{(usage.dailyLimitReached || usage.weeklyLimitReached) && (
				<div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
					{usage.dailyLimitReached
						? "Daily usage limit reached."
						: "Weekly usage limit reached."}{" "}
					Your limit will reset soon.
				</div>
			)}

			<ModelBreakdown items={usage.perModelPct} />
			<HarnessBreakdown items={usage.perHarnessPct} />
			<AgentUsageSection />
		</div>
	);
}

/**
 * Compact usage badge for the sidebar/header.
 * Shows the higher of daily/weekly percentage with a color indicator.
 */
export function UsageBadge({ onClick }: { onClick?: () => void }) {
	const { data: usage } = useQuery(convexQuery(api.usage.getUserUsage, {}));

	if (!usage) return null;

	const pct = Math.max(usage.dailyPctUsed, usage.weeklyPctUsed);
	const color =
		pct >= 90
			? "text-red-400"
			: pct >= 70
				? "text-yellow-400"
				: "text-foreground/50";
	const dotColor =
		pct >= 90 ? "bg-red-400" : pct >= 70 ? "bg-yellow-400" : "bg-emerald-400";

	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-white/5",
				color,
			)}
		>
			<span className={cn("h-1.5 w-1.5 rounded-full", dotColor)} />
			<span>{Math.round(pct)}% used</span>
		</button>
	);
}
