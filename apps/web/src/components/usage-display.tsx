import { convexQuery } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import { useQuery } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Best-effort extraction of the user's Claude-account quota utilization from the
 * opaque upstream `_meta._claude/rateLimit` snapshot. The shape is upstream-
 * defined (claude-agent-acp) and may change, so this scans the most likely field
 * names and degrades to {} on no match — the UI then simply omits the section.
 */
interface AccountUsage {
	session?: number; // 5-hour window %
	week?: number; // 7-day window %
	weekSonnet?: number; // 7-day Sonnet-only window %
}

function bucketPct(bucket: unknown): number | undefined {
	if (!bucket || typeof bucket !== "object") return undefined;
	const b = bucket as Record<string, unknown>;
	const u =
		b.utilization_pct ??
		b.utilizationPct ??
		b.utilization ??
		b.used_pct ??
		b.usedPct ??
		b.percent ??
		b.pct;
	if (typeof u === "number") return u <= 1 ? u * 100 : u; // accept 0–1 or 0–100
	if (
		typeof b.used === "number" &&
		typeof b.limit === "number" &&
		b.limit > 0
	) {
		return (b.used / b.limit) * 100;
	}
	return undefined;
}

function accountUsageFromRateLimit(rateLimit: unknown): AccountUsage {
	if (!rateLimit || typeof rateLimit !== "object") return {};
	const rl = rateLimit as Record<string, unknown>;
	const src = (
		rl.buckets && typeof rl.buckets === "object" ? rl.buckets : rl
	) as Record<string, unknown>;
	const pick = (...keys: string[]) => {
		for (const k of keys) {
			const p = bucketPct(src[k]);
			if (p !== undefined) return p;
		}
		return undefined;
	};
	return {
		session: pick("five_hour", "fiveHour", "session", "5h", "primary"),
		week: pick("seven_day", "sevenDay", "week", "7d"),
		weekSonnet: pick("seven_day_sonnet", "sevenDaySonnet"),
	};
}

/** The freshest non-empty account utilization across the user's agent rows. */
function latestAccountUsage(rows: AgentUsageRow[] | undefined): AccountUsage {
	for (const r of rows ?? []) {
		const a = accountUsageFromRateLimit(r.rateLimit);
		if (
			a.session !== undefined ||
			a.week !== undefined ||
			a.weekSonnet !== undefined
		) {
			return a;
		}
	}
	return {};
}

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

// Display names for the usage panel. claude-code is shown as "Claude Agent".
const AGENT_LABELS: Record<string, string> = {
	"claude-code": "Claude Agent",
	codex: "Codex",
	cursor: "Cursor",
};
// Agent sections render in this order; Claude Agent + Codex always get a place
// (shown with a placeholder even before any account/usage exists).
const AGENT_ORDER = ["claude-code", "codex", "cursor"];
const ALWAYS_SHOW = new Set(["claude-code", "codex"]);

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
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheCreationTokens?: number;
	turns: number;
	todayCostUsd: number;
	weekCostUsd: number;
	lastModel: string | null;
	rateLimit?: unknown;
}

function AgentCredentialRow({ r }: { r: AgentUsageRow }) {
	// "Work" tokens = input+output (what the user recognizes); cache read/write
	// is shown separately because it dominates raw counts but is cheap. Falls
	// back to the legacy total when the per-category fields are absent.
	const work = (r.inputTokens ?? 0) + (r.outputTokens ?? 0) || r.totalTokens;
	const cache = (r.cacheReadTokens ?? 0) + (r.cacheCreationTokens ?? 0);
	return (
		<div className="flex items-center gap-2 rounded-md bg-white/[0.03] px-2.5 py-2">
			<div className="min-w-0 flex-1">
				<span className="truncate text-[11px] text-foreground/80">
					{r.label || "Default account"}
				</span>
				<div className="mt-0.5 text-[10px] text-foreground/40">
					{r.turns === 0
						? "No usage yet"
						: `${formatTokens(work)} tokens${
								cache > 0 ? ` · ${formatTokens(cache)} cached` : ""
							} · ${r.turns} turn${r.turns === 1 ? "" : "s"}${
								r.lastModel ? ` · ${r.lastModel}` : ""
							}`}
				</div>
			</div>
			<div className="shrink-0 text-right">
				<div className="text-xs font-medium tabular-nums text-foreground/80">
					{formatCost(r.totalCostUsd)}
				</div>
				{(r.todayCostUsd > 0 || r.weekCostUsd > 0) && (
					<div className="text-[10px] tabular-nums text-foreground/40">
						{formatCost(r.todayCostUsd)} today · {formatCost(r.weekCostUsd)} wk
					</div>
				)}
			</div>
		</div>
	);
}

/**
 * Agent usage, broken up by agent (Claude Agent, Codex, …) then per credential.
 * Distinct from the OpenRouter budget bars above: this cost bills to the user's
 * OWN agent account, so it's plain informational totals (estimated, no cap).
 */
function AgentUsageSection() {
	const { data } = useQuery(convexQuery(api.agentUsage.getMyAgentUsage, {}));
	const rows = (data ?? []) as AgentUsageRow[];
	if (rows.length === 0) return null;

	const byAgent = new Map<string, AgentUsageRow[]>();
	for (const r of rows) {
		const list = byAgent.get(r.agent);
		if (list) list.push(r);
		else byAgent.set(r.agent, [r]);
	}
	const extra = [...byAgent.keys()].filter((a) => !AGENT_ORDER.includes(a));
	const agents = [...AGENT_ORDER, ...extra].filter(
		(a) => byAgent.has(a) || ALWAYS_SHOW.has(a),
	);

	return (
		<div className="space-y-3 border-t border-white/10 pt-4">
			<div className="flex items-baseline justify-between">
				<h4 className="text-xs font-medium uppercase tracking-wider text-foreground/60">
					Agent usage
				</h4>
				<span className="text-[10px] text-foreground/40">
					estimated · your account
				</span>
			</div>
			{agents.map((agent) => {
				const agentRows = (byAgent.get(agent) ?? [])
					.slice()
					.sort((a, b) => b.totalCostUsd - a.totalCostUsd);
				const name = AGENT_LABELS[agent] ?? agent;
				const total = agentRows.reduce((s, r) => s + r.totalCostUsd, 0);
				return (
					<div key={agent} className="space-y-1.5">
						<div className="flex items-baseline justify-between">
							<span className="text-[11px] font-medium text-foreground/70">
								{name}
							</span>
							{agentRows.length > 0 && (
								<span className="text-[10px] tabular-nums text-foreground/50">
									{formatCost(total)}
								</span>
							)}
						</div>
						{agentRows.length === 0 ? (
							<p className="rounded-md bg-white/[0.02] px-2.5 py-2 text-[10px] text-foreground/35">
								No {name} account connected yet.
							</p>
						) : (
							agentRows.map((r) => (
								<AgentCredentialRow key={r.credentialId} r={r} />
							))
						)}
					</div>
				);
			})}
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
			<div className="space-y-3">
				<div className="flex items-baseline justify-between">
					<h4 className="text-xs font-medium uppercase tracking-wider text-foreground/60">
						Harness budget
					</h4>
					<span className="text-[10px] text-foreground/40">
						default loop · billed to Harness
					</span>
				</div>
				<ProgressBar
					pct={usage.dailyPctUsed}
					label="Today"
					sublabel={`Resets in ${formatResetTime(usage.dailyResetAt)}`}
				/>
				<ProgressBar
					pct={usage.weeklyPctUsed}
					label="This week"
					sublabel={`Resets in ${formatResetTime(usage.weeklyResetAt)}`}
				/>
				<p className="text-[10px] text-foreground/35">
					Harness's spend cap for the built-in model loop. Agents you run on
					your own account (below) don't count toward this.
				</p>
			</div>

			{(usage.dailyLimitReached || usage.weeklyLimitReached) && (
				<div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
					{usage.dailyLimitReached
						? "Daily budget reached."
						: "Weekly budget reached."}{" "}
					Your Harness budget will reset soon.
				</div>
			)}

			<AccountLimitsSection />
			<ModelBreakdown items={usage.perModelPct} />
			<HarnessBreakdown items={usage.perHarnessPct} />
			<AgentUsageSection />
		</div>
	);
}

/**
 * The user's Claude-account rate-limit utilization (the "Current session / week"
 * percentages they also see in Claude Code), surfaced from the captured
 * `_meta._claude/rateLimit` snapshot. Best-effort: renders nothing when the
 * upstream shape can't be parsed. This is the quota that actually applies to an
 * agent turn — distinct from the Harness budget above.
 */
function AccountLimitsSection() {
	const { data } = useQuery(convexQuery(api.agentUsage.getMyAgentUsage, {}));
	const acct = latestAccountUsage(data as AgentUsageRow[] | undefined);
	const bars: Array<{ label: string; pct: number }> = [];
	if (acct.session !== undefined) {
		bars.push({ label: "Current session (5h)", pct: acct.session });
	}
	if (acct.week !== undefined) {
		bars.push({ label: "Current week", pct: acct.week });
	}
	if (acct.weekSonnet !== undefined) {
		bars.push({ label: "Current week (Sonnet)", pct: acct.weekSonnet });
	}
	if (bars.length === 0) return null;

	return (
		<div className="space-y-3 border-t border-white/10 pt-4">
			<div className="flex items-baseline justify-between">
				<h4 className="text-xs font-medium uppercase tracking-wider text-foreground/60">
					Claude account limits
				</h4>
				<span className="text-[10px] text-foreground/40">
					your subscription
				</span>
			</div>
			{bars.map((b) => (
				<ProgressBar key={b.label} pct={b.pct} label={b.label} />
			))}
		</div>
	);
}

/**
 * Compact usage indicator for the sidebar rail: a gauge icon whose color
 * reflects the most relevant signal — the user's Claude account quota % when
 * known, else the Harness budget %. Opens the full usage dialog on click; the
 * exact numbers live there. Renders as an icon to match the rail's other items.
 */
export function UsageBadge({ onClick }: { onClick?: () => void }) {
	const { data: budget } = useQuery(convexQuery(api.usage.getUserUsage, {}));
	const { data: agentRows } = useQuery(
		convexQuery(api.agentUsage.getMyAgentUsage, {}),
	);
	const acct = latestAccountUsage(agentRows as AgentUsageRow[] | undefined);
	const budgetPct = budget
		? Math.max(budget.dailyPctUsed, budget.weeklyPctUsed)
		: 0;
	// Prefer the real account quota (what actually limits an agent turn); fall
	// back to the Harness budget.
	const level = acct.session ?? acct.week ?? budgetPct;
	const color =
		level >= 90
			? "text-red-400"
			: level >= 70
				? "text-yellow-400"
				: "text-muted-foreground";
	const tip = level > 0 ? `Usage — ${Math.round(level)}% used` : "Usage";

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onClick}
					aria-haspopup="dialog"
					aria-label={tip}
					className={cn("hover:text-foreground", color)}
				>
					<Gauge size={14} />
				</Button>
			</TooltipTrigger>
			<TooltipContent side="top">{tip}</TooltipContent>
		</Tooltip>
	);
}

/**
 * Usage section for the compact sidebar footer rail: a leading vertical divider
 * plus the UsageBadge gauge icon. The icon always renders (neutral when there's
 * no data), so the divider is never left dangling.
 */
export function UsageRailSection({ onOpenUsage }: { onOpenUsage: () => void }) {
	return (
		<>
			<Separator
				orientation="vertical"
				className="mx-1 data-[orientation=vertical]:h-4"
			/>
			<UsageBadge onClick={onOpenUsage} />
		</>
	);
}
