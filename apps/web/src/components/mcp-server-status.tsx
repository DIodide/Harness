import { useAuth } from "@clerk/tanstack-react-start";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, GraduationCap, Server, Shield } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { env } from "../env";
import { RoseCurveSpinner } from "./rose-curve-spinner";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const API_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";
const BACKEND_ORIGIN = new URL(API_URL).origin;

/**
 * Start an OAuth popup flow for an MCP server.
 * Returns a cleanup function. Calls onSuccess/onError when done.
 */
function startOAuthPopup(
	getToken: () => Promise<string | null>,
	serverUrl: string,
	opts: {
		onSuccess?: () => void;
		onError?: (msg: string) => void;
		onDone?: () => void;
	},
) {
	let cancelled = false;
	let intervalId: ReturnType<typeof setInterval> | undefined;

	const run = async () => {
		try {
			const token = await getToken();
			if (cancelled) return;
			const res = await fetch(
				`${API_URL}/api/mcp/oauth/start?server_url=${encodeURIComponent(serverUrl)}`,
				{ headers: { Authorization: `Bearer ${token}` } },
			);
			if (!res.ok) throw new Error("Failed to start OAuth");
			const data = await res.json();

			const popup = window.open(
				data.authorization_url,
				"mcp-oauth",
				"width=600,height=700",
			);

			const handler = (event: MessageEvent) => {
				if (event.origin !== BACKEND_ORIGIN) return;
				if (popup && event.source !== popup) return;
				if (event.data?.type === "mcp-oauth-callback") {
					window.removeEventListener("message", handler);
					if (event.data.success) {
						opts.onSuccess?.();
					} else {
						opts.onError?.(event.data.error || "OAuth connection failed");
					}
					opts.onDone?.();
					popup?.close();
				}
			};
			window.addEventListener("message", handler);

			intervalId = setInterval(() => {
				if (popup?.closed) {
					clearInterval(intervalId);
					window.removeEventListener("message", handler);
					opts.onDone?.();
				}
			}, 500);
		} catch {
			opts.onError?.("Failed to start OAuth flow");
			opts.onDone?.();
		}
	};

	run();

	return () => {
		cancelled = true;
		if (intervalId) clearInterval(intervalId);
	};
}

type McpServer = {
	name: string;
	url: string;
	authType: "none" | "bearer" | "oauth" | "tiger_junction";
	authToken?: string;
};

export type HealthStatus =
	| "checking"
	| "reachable"
	| "unreachable"
	| "auth_required";

type ServerStatus =
	| "connected"
	| "expired"
	| "disconnected"
	| "checking"
	| "needs_verification";

function getServerStatus(
	server: McpServer,
	oauthStatuses: Array<{
		mcpServerUrl: string;
		connected: boolean;
		expiresAt: number;
		scopes: string;
	}>,
	healthStatus?: HealthStatus,
): ServerStatus {
	// If health check is running, show checking state
	if (healthStatus === "checking") return "checking";

	// For OAuth servers: combine token status with health check
	if (server.authType === "oauth") {
		const tokenStatus = oauthStatuses.find(
			(s) => s.mcpServerUrl === server.url,
		);
		if (!tokenStatus || !tokenStatus.connected) return "disconnected";
		if (tokenStatus.expiresAt < Date.now() / 1000 + 60) return "expired";
		// Token valid — also check health if available
		if (healthStatus === "unreachable") return "disconnected";
		if (healthStatus === "auth_required") return "expired";
		return "connected";
	}

	// For Princeton servers: auth_required means no verified netid on the account
	if (server.authType === "tiger_junction") {
		if (healthStatus === "auth_required") return "needs_verification";
		if (healthStatus === "unreachable") return "disconnected";
		if (healthStatus === "reachable") return "connected";
		return "checking";
	}

	// For bearer / none servers: use health check result
	if (healthStatus === "unreachable") return "disconnected";
	if (healthStatus === "auth_required") return "disconnected";
	if (healthStatus === "reachable") return "connected";
	// No health data yet → checking
	return "checking";
}

const STATUS_DOT: Record<ServerStatus, string> = {
	connected: "bg-emerald-500",
	expired: "bg-amber-400",
	disconnected: "bg-red-400",
	checking: "bg-muted-foreground/40",
	needs_verification: "bg-amber-400",
};

const STATUS_LABEL: Record<ServerStatus, string> = {
	connected: "Connected",
	expired: "Token expired",
	disconnected: "Unreachable",
	checking: "Checking…",
	needs_verification: "Verify Princeton account",
};

export function McpServerStatus({
	servers,
	healthStatuses = {},
	onReconnected,
}: {
	servers: McpServer[];
	healthStatuses?: Record<string, HealthStatus>;
	onReconnected?: () => void;
}) {
	const { data: oauthStatuses } = useQuery(
		convexQuery(api.mcpOAuthTokens.listStatuses, {}),
	);
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	// Close on outside click
	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);

	if (servers.length === 0) return null;

	const statuses = servers.map((s) => ({
		server: s,
		status: oauthStatuses
			? getServerStatus(s, oauthStatuses, healthStatuses[s.url])
			: ("checking" as ServerStatus),
	}));

	const allConnected = statuses.every((s) => s.status === "connected");
	const hasIssue = statuses.some(
		(s) =>
			s.status === "expired" ||
			s.status === "disconnected" ||
			s.status === "needs_verification",
	);

	const anyChecking = statuses.some((s) => s.status === "checking");

	const summaryColor = anyChecking
		? "bg-muted-foreground/40"
		: allConnected
			? "bg-emerald-500"
			: hasIssue
				? "bg-amber-400"
				: "bg-muted-foreground/40";

	return (
		<div ref={ref} className="relative">
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						onClick={() => setOpen((prev) => !prev)}
						className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<div className="relative">
							{anyChecking ? (
								<RoseCurveSpinner size={10} />
							) : (
								<Server size={10} />
							)}
							<div
								className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ${summaryColor} ${anyChecking ? "animate-pulse" : ""}`}
							/>
						</div>
						{servers.length} MCP{servers.length !== 1 && "s"}
					</button>
				</TooltipTrigger>
				<TooltipContent>
					{anyChecking ? "Checking MCP servers..." : "MCP server status"}
				</TooltipContent>
			</Tooltip>

			<AnimatePresence>
				{open && (
					<motion.div
						initial={{ opacity: 0, y: -4, scale: 0.97 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, y: -4, scale: 0.97 }}
						transition={{ duration: 0.15 }}
						className="absolute left-0 top-full z-50 mt-1 w-64 border border-border bg-background shadow-lg"
					>
						<div className="border-b border-border px-3 py-2">
							<span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
								MCP Servers
							</span>
						</div>
						<div className="max-h-48 overflow-y-auto py-1">
							{statuses.map(({ server, status }) => (
								<McpServerRow
									key={server.url}
									server={server}
									status={status}
									onReconnected={onReconnected}
								/>
							))}
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

function McpServerRow({
	server,
	status,
	onReconnected,
}: {
	server: McpServer;
	status: ServerStatus;
	onReconnected?: () => void;
}) {
	const { getToken } = useAuth();
	const [connecting, setConnecting] = useState(false);

	const handleReconnect = useCallback(() => {
		setConnecting(true);
		startOAuthPopup(getToken, server.url, {
			onSuccess: () => {
				toast.success(`Reconnected to ${server.name}`);
				onReconnected?.();
			},
			onError: (msg) => toast.error(msg),
			onDone: () => setConnecting(false),
		});
	}, [getToken, server.url, server.name, onReconnected]);

	const needsReconnect =
		server.authType === "oauth" &&
		(status === "expired" || status === "disconnected");

	return (
		<div className="flex items-center gap-2 px-3 py-1.5">
			{status === "checking" ? (
				<RoseCurveSpinner
					size={10}
					className="shrink-0 text-muted-foreground"
				/>
			) : (
				<div
					className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[status]}`}
				/>
			)}
			<div className="min-w-0 flex-1">
				<div className="truncate text-xs font-medium">{server.name}</div>
				<div className="text-[10px] text-muted-foreground">
					{STATUS_LABEL[status]}
				</div>
			</div>
			{needsReconnect && (
				<Button
					variant="outline"
					size="sm"
					className="h-5 shrink-0 gap-1 px-1.5 text-[10px]"
					onClick={handleReconnect}
					disabled={connecting}
				>
					{connecting ? <RoseCurveSpinner size={8} /> : <Shield size={8} />}
					Reconnect
				</Button>
			)}
			{status === "connected" && server.authType === "bearer" && (
				<Badge variant="secondary" className="shrink-0 text-[9px]">
					Key
				</Badge>
			)}
			{status === "connected" && server.authType === "none" && (
				<Badge variant="secondary" className="shrink-0 text-[9px]">
					Public
				</Badge>
			)}
			{status === "connected" && server.authType === "tiger_junction" && (
				<Badge variant="secondary" className="shrink-0 gap-1 text-[9px]">
					<GraduationCap size={8} />
					Princeton
				</Badge>
			)}
			{status === "connected" && server.authType === "oauth" && (
				<Badge variant="secondary" className="shrink-0 gap-1 text-[9px]">
					<div className="h-1 w-1 rounded-full bg-emerald-500" />
					OAuth
				</Badge>
			)}
			{status === "needs_verification" && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Badge
							variant="secondary"
							className="shrink-0 gap-1 border border-amber-400/40 bg-amber-500/10 text-[9px] text-amber-700 dark:text-amber-400"
						>
							<GraduationCap size={8} />
							Verify
						</Badge>
					</TooltipTrigger>
					<TooltipContent>
						Open this harness's settings to verify your Princeton account.
					</TooltipContent>
				</Tooltip>
			)}
		</div>
	);
}

/**
 * Parse a tool result string to check if it's an auth_required error.
 * Returns { serverUrl, error } if so, null otherwise.
 */
export function parseAuthRequiredError(
	result: string,
): { serverUrl: string; error: string } | null {
	try {
		const parsed = JSON.parse(result);
		if (parsed?.auth_required === true && parsed?.server_url) {
			return { serverUrl: parsed.server_url, error: parsed.error ?? "" };
		}
	} catch {
		// Not JSON or not the right shape
	}
	return null;
}

/**
 * Inline prompt shown inside a tool call result when OAuth re-auth is needed.
 */
export function OAuthReconnectPrompt({
	serverUrl,
	errorMessage,
	onReconnected,
}: {
	serverUrl: string;
	errorMessage: string;
	onReconnected?: () => void;
}) {
	const { getToken } = useAuth();
	const [connecting, setConnecting] = useState(false);
	const [reconnected, setReconnected] = useState(false);

	const handleReconnect = useCallback(() => {
		setConnecting(true);
		startOAuthPopup(getToken, serverUrl, {
			onSuccess: () => {
				toast.success("Reconnected — you can retry the message");
				setReconnected(true);
				onReconnected?.();
			},
			onError: (msg) => toast.error(msg),
			onDone: () => setConnecting(false),
		});
	}, [getToken, serverUrl, onReconnected]);

	if (reconnected) {
		return (
			<div className="flex items-center gap-2 rounded bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-700 dark:text-emerald-400">
				<Shield size={12} />
				<span>Reconnected. Retry your message to use this tool.</span>
			</div>
		);
	}

	return (
		<div className="flex items-center gap-2 rounded bg-destructive/10 px-3 py-2">
			<AlertTriangle size={12} className="shrink-0 text-destructive" />
			<span className="flex-1 text-[11px] text-destructive">
				{errorMessage || "OAuth authorization required for this MCP server."}
			</span>
			<Button
				variant="outline"
				size="sm"
				className="h-6 shrink-0 gap-1 px-2 text-[10px]"
				onClick={handleReconnect}
				disabled={connecting}
			>
				{connecting ? <RoseCurveSpinner size={10} /> : <Shield size={10} />}
				Reconnect
			</Button>
		</div>
	);
}
