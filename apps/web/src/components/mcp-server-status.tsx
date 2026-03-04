import { useAuth } from "@clerk/tanstack-react-start";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Server, Shield } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { env } from "../env";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const API_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";

type McpServer = {
	name: string;
	url: string;
	authType: "none" | "bearer" | "oauth";
	authToken?: string;
};

type ServerStatus = "connected" | "expired" | "disconnected" | "checking";

function getServerStatus(
	server: McpServer,
	oauthStatuses: Array<{
		mcpServerUrl: string;
		connected: boolean;
		expiresAt: number;
		scopes: string;
	}>,
): ServerStatus {
	if (server.authType !== "oauth") return "connected";

	const tokenStatus = oauthStatuses.find((s) => s.mcpServerUrl === server.url);
	if (!tokenStatus) return "disconnected";
	if (!tokenStatus.connected) return "disconnected";

	// Check if token is expired or expiring within 60s
	if (tokenStatus.expiresAt < Date.now() / 1000 + 60) return "expired";
	return "connected";
}

const STATUS_DOT: Record<ServerStatus, string> = {
	connected: "bg-emerald-500",
	expired: "bg-amber-400",
	disconnected: "bg-red-400",
	checking: "bg-muted-foreground/40",
};

const STATUS_LABEL: Record<ServerStatus, string> = {
	connected: "Connected",
	expired: "Token expired",
	disconnected: "Not connected",
	checking: "Checking…",
};

export function McpServerStatus({ servers }: { servers: McpServer[] }) {
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
			? getServerStatus(s, oauthStatuses)
			: ("checking" as ServerStatus),
	}));

	const allConnected = statuses.every((s) => s.status === "connected");
	const hasIssue = statuses.some(
		(s) => s.status === "expired" || s.status === "disconnected",
	);

	const summaryColor = allConnected
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
							<Server size={10} />
							<div
								className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ${summaryColor}`}
							/>
						</div>
						{servers.length} MCP{servers.length !== 1 && "s"}
					</button>
				</TooltipTrigger>
				<TooltipContent>MCP server status</TooltipContent>
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
									onReconnected={() => {}}
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
	onReconnected: () => void;
}) {
	const { getToken } = useAuth();
	const [connecting, setConnecting] = useState(false);

	const handleReconnect = useCallback(async () => {
		setConnecting(true);
		try {
			const token = await getToken();
			const res = await fetch(
				`${API_URL}/api/mcp/oauth/start?server_url=${encodeURIComponent(server.url)}`,
				{
					headers: { Authorization: `Bearer ${token}` },
				},
			);
			if (!res.ok) throw new Error("Failed to start OAuth");
			const data = await res.json();

			const popup = window.open(
				data.authorization_url,
				"mcp-oauth",
				"width=600,height=700",
			);

			const handler = (event: MessageEvent) => {
				if (event.data?.type === "mcp-oauth-callback") {
					window.removeEventListener("message", handler);
					if (event.data.success) {
						toast.success(`Reconnected to ${server.name}`);
						onReconnected();
					} else {
						toast.error(event.data.error || "OAuth connection failed");
					}
					setConnecting(false);
					popup?.close();
				}
			};
			window.addEventListener("message", handler);

			const interval = setInterval(() => {
				if (popup?.closed) {
					clearInterval(interval);
					window.removeEventListener("message", handler);
					setConnecting(false);
				}
			}, 500);
		} catch {
			toast.error("Failed to start OAuth flow");
			setConnecting(false);
		}
	}, [getToken, server.url, server.name, onReconnected]);

	const needsReconnect =
		server.authType === "oauth" &&
		(status === "expired" || status === "disconnected");

	return (
		<div className="flex items-center gap-2 px-3 py-1.5">
			<div
				className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[status]}`}
			/>
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
					{connecting ? (
						<Loader2 size={8} className="animate-spin" />
					) : (
						<Shield size={8} />
					)}
					Reconnect
				</Button>
			)}
			{server.authType !== "oauth" && status === "connected" && (
				<Badge variant="secondary" className="shrink-0 text-[9px]">
					{server.authType === "bearer" ? "Key" : "Open"}
				</Badge>
			)}
			{server.authType === "oauth" && status === "connected" && (
				<Badge variant="secondary" className="shrink-0 gap-1 text-[9px]">
					<div className="h-1 w-1 rounded-full bg-emerald-500" />
					OAuth
				</Badge>
			)}
		</div>
	);
}
