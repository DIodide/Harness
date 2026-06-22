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
 * The user's Claude-account rate-limit snapshot, parsed from the upstream
 * `_meta._claude/rateLimit` — which is the SDK's `rate_limit_info`:
 *   { rateLimitType, status, resetsAt, utilization?, isUsingOverage, … }
 * It describes the single most-restrictive window. `utilization` is omitted in
 * the normal "allowed" low-usage state, so we may have only a status + reset.
 * Defensive: returns null when the shape is unrecognizable.
 */
interface AccountUsage {
	id: string; // stable window key (e.g. "five_hour") — React key, not the label
	label: string; // human window name (e.g. "Current session")
	status: "allowed" | "warning" | "rejected";
	utilization?: number; // 0–100, when the snapshot includes it
	resetsAtMs?: number; // window reset, normalized to ms
}

const RATE_LIMIT_LABELS: Record<string, string> = {
	five_hour: "Current session",
	seven_day: "Current week",
	seven_day_opus: "Current week (Opus)",
	seven_day_sonnet: "Current week (Sonnet)",
	overage: "Overage",
};

/** Normalize a possibly-seconds or possibly-ms reset timestamp to ms. */
function toResetMs(raw: unknown): number | undefined {
	if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
		return undefined;
	}
	// < ~year 2286 in seconds ⇒ treat as seconds; otherwise already ms.
	return raw < 1e12 ? raw * 1000 : raw;
}

export function accountUsageFromRateLimit(
	rateLimit: unknown,
): AccountUsage | null {
	if (!rateLimit || typeof rateLimit !== "object") return null;
	const rl = rateLimit as Record<string, unknown>;
	const rawStatus = typeof rl.status === "string" ? rl.status : "allowed";
	const status: AccountUsage["status"] =
		rawStatus === "rejected"
			? "rejected"
			: rawStatus.includes("warning")
				? "warning"
				: "allowed";
	const type = typeof rl.rateLimitType === "string" ? rl.rateLimitType : "";
	const u = rl.utilization;
	const utilization =
		typeof u === "number" && Number.isFinite(u)
			? Math.max(0, Math.min(100, u))
			: undefined;
	const resetsAtMs = toResetMs(rl.resetsAt);
	// The snapshot only updates on a status change, and a window that elapses
	// passively emits no new event — so once its reset time is in the past the
	// stored value is stale. Drop it (self-heal) rather than keep showing a
	// "limit reached" banner for a window that already reset.
	if (resetsAtMs !== undefined && resetsAtMs <= Date.now()) {
		return null;
	}
	// Nothing actionable to show: normal, no number, no reset.
	if (
		status === "allowed" &&
		utilization === undefined &&
		resetsAtMs === undefined
	) {
		return null;
	}
	return {
		id: type || "account",
		label: RATE_LIMIT_LABELS[type] ?? "Claude account",
		status,
		utilization,
		resetsAtMs,
	};
}

// Window ordering for the bars: short rolling window first, then weekly caps.
const WINDOW_ORDER = [
	"five_hour",
	"seven_day",
	"seven_day_opus",
	"seven_day_sonnet",
	"overage",
];

/** Parse one window of the multi-window `buckets` snapshot (the live 5h/weekly
 *  utilization Harness fetches from Anthropic's rate-limit headers). */
function parseWindow(type: string, w: unknown): AccountUsage | null {
	if (!w || typeof w !== "object") return null;
	const o = w as Record<string, unknown>;
	const rawStatus = typeof o.status === "string" ? o.status : "allowed";
	const status: AccountUsage["status"] =
		rawStatus === "rejected"
			? "rejected"
			: rawStatus.includes("warning")
				? "warning"
				: "allowed";
	let utilization: number | undefined;
	if (typeof o.utilization === "number" && Number.isFinite(o.utilization)) {
		// Anthropic's unified headers report a 0–1 fraction; legacy flat
		// snapshots used 0–100. Normalize both to a 0–100 percentage.
		const u = o.utilization <= 1 ? o.utilization * 100 : o.utilization;
		utilization = Math.max(0, Math.min(100, u));
	}
	const resetsAtMs = toResetMs(o.resetsAt);
	// A window whose reset already passed carries a stale number — drop it.
	if (resetsAtMs !== undefined && resetsAtMs <= Date.now()) return null;
	if (
		status === "allowed" &&
		utilization === undefined &&
		resetsAtMs === undefined
	) {
		return null;
	}
	return {
		id: type || "account",
		label: RATE_LIMIT_LABELS[type] ?? "Claude account",
		status,
		utilization,
		resetsAtMs,
	};
}

/** All renderable windows from a credential's snapshot. Handles the multi-window
 *  `{ buckets: { five_hour, seven_day, … } }` shape (subscription usage) and the
 *  legacy flat single-window shape. */
export function accountUsagesFromRateLimit(rateLimit: unknown): AccountUsage[] {
	if (!rateLimit || typeof rateLimit !== "object") return [];
	const rl = rateLimit as Record<string, unknown>;
	const buckets = rl.buckets;
	if (buckets && typeof buckets === "object") {
		return Object.entries(buckets as Record<string, unknown>)
			.map(([type, w]) => ({ type, a: parseWindow(type, w) }))
			.filter((x): x is { type: string; a: AccountUsage } => x.a !== null)
			.sort((x, y) => {
				const ix = WINDOW_ORDER.indexOf(x.type);
				const iy = WINDOW_ORDER.indexOf(y.type);
				return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy);
			})
			.map((x) => x.a);
	}
	const a = accountUsageFromRateLimit(rl);
	return a ? [a] : [];
}

/** The freshest credential's window list (rows carry the account-level snapshot;
 *  pick the most recently active credential that has one). */
function latestAccountUsages(
	rows: AgentUsageRow[] | undefined,
): AccountUsage[] {
	const byRecency = [...(rows ?? [])].sort(
		(a, b) => (b.lastTurnAt ?? 0) - (a.lastTurnAt ?? 0),
	);
	for (const r of byRecency) {
		const windows = accountUsagesFromRateLimit(r.rateLimit);
		if (windows.length) return windows;
	}
	return [];
}

/** The single most-restrictive window (a hit limit, else the highest %) — used
 *  for the compact badge color. */
function latestAccountUsage(
	rows: AgentUsageRow[] | undefined,
): AccountUsage | null {
	const windows = latestAccountUsages(rows);
	if (!windows.length) return null;
	const rejected = windows.find((w) => w.status === "rejected");
	if (rejected) return rejected;
	return windows.reduce(
		(m, w) => ((w.utilization ?? 0) > (m.utilization ?? 0) ? w : m),
		windows[0],
	);
}

/** "in 5h 12m" until a reset timestamp (ms), or undefined when past/absent. */
function resetsInLabel(resetsAtMs: number | undefined): string | undefined {
	if (resetsAtMs === undefined) return undefined;
	const diffMs = resetsAtMs - Date.now();
	if (diffMs <= 0) return undefined;
	const hours = Math.floor(diffMs / 3_600_000);
	const minutes = Math.floor((diffMs % 3_600_000) / 60_000);
	if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
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
	lastTurnAt?: number;
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
	const windows = latestAccountUsages(data as AgentUsageRow[] | undefined);
	if (windows.length === 0) return null;

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
			<div className="space-y-3">
				{windows.map((w) => {
					const resetsIn = resetsInLabel(w.resetsAtMs);
					const resetSub = resetsIn ? `Resets in ${resetsIn}` : undefined;
					if (w.status === "rejected") {
						return (
							<div
								key={w.id}
								className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
							>
								{w.label} limit reached
								{resetsIn ? ` · resets in ${resetsIn}` : ""}. Agent turns are
								paused until it resets.
							</div>
						);
					}
					if (w.utilization !== undefined) {
						return (
							<ProgressBar
								key={w.id}
								pct={w.utilization}
								label={w.label}
								sublabel={resetSub}
							/>
						);
					}
					return (
						<p key={w.id} className="text-[11px] text-foreground/50">
							{w.label}
							{w.status === "warning" ? " · approaching limit" : ""}
							{resetsIn ? ` · resets in ${resetsIn}` : ""}
						</p>
					);
				})}
			</div>
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
	// A hit account limit is the loudest signal; otherwise prefer the real
	// account quota % (what actually limits an agent turn), else the Harness
	// budget.
	const limited = acct?.status === "rejected";
	// `||` not `??`: a 0% account utilization shouldn't hide a real budget %.
	const level = acct?.utilization || budgetPct;
	const color = limited
		? "text-red-400"
		: level >= 90
			? "text-red-400"
			: level >= 70
				? "text-yellow-400"
				: "text-muted-foreground";
	const tip = limited
		? `${acct?.label ?? "Account"} limit reached`
		: acct?.utilization !== undefined
			? `${acct.label} — ${Math.round(acct.utilization)}% used`
			: level > 0
				? `Usage — ${Math.round(level)}% used`
				: "Usage";

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
