import { useAuth } from "@clerk/tanstack-react-start";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	AlertTriangle,
	ArrowLeft,
	Eye,
	EyeOff,
	GraduationCap,
	Plus,
	Server,
	Shield,
	Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { env } from "../env";
import {
	fetchCommandsFromApi,
	type McpAuthType,
	type McpServerEntry,
	PRESET_MCPS,
	sanitizeServerName,
	validateMcpUrl,
} from "../lib/mcp";
import { RoseCurveSpinner } from "./rose-curve-spinner";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "./ui/select";
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
	harnessId,
	healthStatuses = {},
	onReconnected,
	onChanged,
}: {
	servers: McpServer[];
	harnessId?: Id<"harnesses">;
	healthStatuses?: Record<string, HealthStatus>;
	onReconnected?: () => void;
	onChanged?: () => void;
}) {
	const { data: oauthStatuses } = useQuery(
		convexQuery(api.mcpOAuthTokens.listStatuses, {}),
	);
	const { getToken } = useAuth();
	const updateHarnessFn = useConvexMutation(api.harnesses.update);
	const upsertCommandsFn = useConvexMutation(api.commands.upsert);
	const [open, setOpen] = useState(false);
	const [mode, setMode] = useState<"list" | "add">("list");
	const [removingUrl, setRemovingUrl] = useState<string | null>(null);
	const ref = useRef<HTMLDivElement>(null);

	const removeServer = useCallback(
		async (url: string) => {
			if (!harnessId) return;
			const target = servers.find((s) => s.url === url);
			if (!target) return;
			setRemovingUrl(url);
			const next = servers
				.filter((s) => s.url !== url)
				.map((s) => ({
					name: s.name,
					url: s.url,
					authType: s.authType,
					...(s.authToken ? { authToken: s.authToken } : {}),
				}));
			try {
				await updateHarnessFn({ id: harnessId, mcpServers: next });
				toast.success(`Removed ${target.name}`);
				onChanged?.();
			} catch (err) {
				toast.error(
					err instanceof Error ? err.message : "Failed to remove MCP server",
				);
				setRemovingUrl(null);
				return;
			}

			// Fire-and-forget: rebuild commandIds for the remaining servers so
			// orphaned slash commands from the removed server stop appearing.
			(async () => {
				try {
					if (next.length === 0) return;
					const token = await getToken();
					const cmds = await fetchCommandsFromApi(API_URL, next, token);
					if (!cmds || cmds.length === 0) return;

					const ids = await upsertCommandsFn({
						commands: cmds.map((c) => ({
							name: c.name,
							server: c.server,
							tool: c.tool,
							description: c.description,
							parametersJson: JSON.stringify(c.parameters),
						})),
					});

					const idByName = new Map(cmds.map((c, i) => [c.name, ids[i]]));
					const enriched = next.map((s) => ({
						name: s.name,
						url: s.url,
						authType: s.authType,
						...(s.authToken ? { authToken: s.authToken } : {}),
						commandIds: [...idByName.entries()]
							.filter(([name]) =>
								name.startsWith(`${sanitizeServerName(s.name)}__`),
							)
							.map(([, cmdId]) => cmdId),
					}));

					await updateHarnessFn({ id: harnessId, mcpServers: enriched });
				} catch {
					// Non-blocking
				} finally {
					setRemovingUrl(null);
				}
			})();
		},
		[
			harnessId,
			servers,
			updateHarnessFn,
			upsertCommandsFn,
			getToken,
			onChanged,
		],
	);

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

	// Reset to list view whenever the popover closes
	useEffect(() => {
		if (!open) setMode("list");
	}, [open]);

	// Render nothing if there's no harness context AND no servers — there's
	// nothing to show or add.
	if (servers.length === 0 && !harnessId) return null;

	const statuses = servers.map((s) => ({
		server: s,
		status: oauthStatuses
			? getServerStatus(s, oauthStatuses, healthStatuses[s.url])
			: ("checking" as ServerStatus),
	}));

	const allConnected =
		statuses.length > 0 && statuses.every((s) => s.status === "connected");
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

	const canAdd = !!harnessId;
	const panelWidth = mode === "add" ? "w-[360px]" : "w-64";

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
							{servers.length > 0 && (
								<div
									className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ${summaryColor} ${anyChecking ? "animate-pulse" : ""}`}
								/>
							)}
						</div>
						{servers.length > 0
							? `${servers.length} MCP${servers.length !== 1 ? "s" : ""}`
							: "Add MCP"}
					</button>
				</TooltipTrigger>
				<TooltipContent>
					{anyChecking ? "Checking MCP servers..." : "MCP servers"}
				</TooltipContent>
			</Tooltip>

			<AnimatePresence>
				{open && (
					<motion.div
						initial={{ opacity: 0, y: -4, scale: 0.97 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, y: -4, scale: 0.97 }}
						transition={{ duration: 0.15 }}
						className={`absolute left-0 top-full z-50 mt-1 ${panelWidth} border border-border bg-background shadow-lg`}
					>
						<div className="flex items-center gap-2 border-b border-border px-3 py-2">
							{mode === "add" && (
								<button
									type="button"
									onClick={() => setMode("list")}
									className="-ml-1 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
									aria-label="Back to MCP list"
								>
									<ArrowLeft size={11} />
								</button>
							)}
							<span className="flex-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
								{mode === "add" ? "Add MCP Server" : "MCP Servers"}
							</span>
							{mode === "list" && canAdd && (
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											type="button"
											onClick={() => setMode("add")}
											className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
											aria-label="Add MCP server"
										>
											<Plus size={12} />
										</button>
									</TooltipTrigger>
									<TooltipContent>Add MCP server</TooltipContent>
								</Tooltip>
							)}
						</div>
						{mode === "list" ? (
							servers.length > 0 ? (
								<div className="max-h-48 overflow-y-auto py-1">
									{statuses.map(({ server, status }) => (
										<McpServerRow
											key={server.url}
											server={server}
											status={status}
											onReconnected={onReconnected}
											onRemove={
												canAdd ? () => removeServer(server.url) : undefined
											}
											removing={removingUrl === server.url}
										/>
									))}
								</div>
							) : (
								<div className="px-3 py-4 text-center">
									<p className="text-[11px] text-muted-foreground">
										No MCP servers yet.
									</p>
									{canAdd && (
										<Button
											variant="outline"
											size="sm"
											className="mt-2 h-7 gap-1 text-[11px]"
											onClick={() => setMode("add")}
										>
											<Plus size={11} />
											Add one
										</Button>
									)}
								</div>
							)
						) : (
							harnessId && (
								<AddMcpPanel
									harnessId={harnessId}
									existingServers={servers}
									onAdded={() => {
										setMode("list");
										onChanged?.();
									}}
								/>
							)
						)}
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
	onRemove,
	removing = false,
}: {
	server: McpServer;
	status: ServerStatus;
	onReconnected?: () => void;
	onRemove?: () => void;
	removing?: boolean;
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

	const showBadges = !needsReconnect;

	return (
		<div
			className={`group flex items-center gap-2 px-3 py-1.5 transition-opacity ${removing ? "opacity-50" : ""}`}
		>
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
			{showBadges && (
				<div
					className={`flex shrink-0 items-center ${onRemove ? "group-hover:hidden" : ""}`}
				>
					{status === "connected" && server.authType === "bearer" && (
						<Badge variant="secondary" className="text-[9px]">
							Key
						</Badge>
					)}
					{status === "connected" && server.authType === "none" && (
						<Badge variant="secondary" className="text-[9px]">
							Public
						</Badge>
					)}
					{status === "connected" && server.authType === "tiger_junction" && (
						<Badge variant="secondary" className="gap-1 text-[9px]">
							<GraduationCap size={8} />
							Princeton
						</Badge>
					)}
					{status === "connected" && server.authType === "oauth" && (
						<Badge variant="secondary" className="gap-1 text-[9px]">
							<div className="h-1 w-1 rounded-full bg-emerald-500" />
							OAuth
						</Badge>
					)}
					{status === "needs_verification" && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Badge
									variant="secondary"
									className="gap-1 border border-amber-400/40 bg-amber-500/10 text-[9px] text-amber-700 dark:text-amber-400"
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
			)}
			{onRemove && (
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={onRemove}
							disabled={removing}
							className="hidden shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:block disabled:opacity-30"
							aria-label={`Remove ${server.name}`}
						>
							{removing ? <RoseCurveSpinner size={10} /> : <Trash2 size={11} />}
						</button>
					</TooltipTrigger>
					<TooltipContent>Remove from harness</TooltipContent>
				</Tooltip>
			)}
		</div>
	);
}

/* ---------- Add MCP panel ---------- */

function AddMcpPanel({
	harnessId,
	existingServers,
	onAdded,
}: {
	harnessId: Id<"harnesses">;
	existingServers: McpServer[];
	onAdded: () => void;
}) {
	const [tab, setTab] = useState<"presets" | "custom">("presets");
	const { getToken } = useAuth();
	const updateHarnessFn = useConvexMutation(api.harnesses.update);
	const upsertCommandsFn = useConvexMutation(api.commands.upsert);
	const [pendingId, setPendingId] = useState<string | null>(null);

	const existingUrls = useMemo(
		() => new Set(existingServers.map((s) => s.url)),
		[existingServers],
	);

	const availablePresets = useMemo(
		() => PRESET_MCPS.filter((p) => !existingUrls.has(p.server.url)),
		[existingUrls],
	);

	const addServerEntry = useCallback(
		async (entry: McpServerEntry, label: string) => {
			// Build the new mcpServers array. We don't preserve commandIds here
			// because the prop shape doesn't carry them — the post-add sync below
			// will refetch and re-link commands for all servers in this harness.
			const next = [
				...existingServers.map((s) => ({
					name: s.name,
					url: s.url,
					authType: s.authType,
					...(s.authToken ? { authToken: s.authToken } : {}),
				})),
				{
					name: entry.name,
					url: entry.url,
					authType: entry.authType,
					...(entry.authToken ? { authToken: entry.authToken } : {}),
				},
			];

			try {
				await updateHarnessFn({
					id: harnessId,
					mcpServers: next,
				});
				toast.success(`Added ${label}`);
			} catch (err) {
				toast.error(
					err instanceof Error ? err.message : "Failed to add MCP server",
				);
				return;
			}

			// Fire-and-forget: fetch slash commands for the new server set,
			// upsert, then enrich the harness with commandIds. Mirrors the
			// post-save logic in the harness editor page.
			(async () => {
				try {
					const token = await getToken();
					const cmds = await fetchCommandsFromApi(API_URL, next, token);
					if (!cmds || cmds.length === 0) return;

					const ids = await upsertCommandsFn({
						commands: cmds.map((c) => ({
							name: c.name,
							server: c.server,
							tool: c.tool,
							description: c.description,
							parametersJson: JSON.stringify(c.parameters),
						})),
					});

					const idByName = new Map(cmds.map((c, i) => [c.name, ids[i]]));
					const enriched = next.map((s) => ({
						name: s.name,
						url: s.url,
						authType: s.authType,
						...(s.authToken ? { authToken: s.authToken } : {}),
						commandIds: [...idByName.entries()]
							.filter(([name]) =>
								name.startsWith(`${sanitizeServerName(s.name)}__`),
							)
							.map(([, cmdId]) => cmdId),
					}));

					await updateHarnessFn({
						id: harnessId,
						mcpServers: enriched,
					});
				} catch {
					// Non-blocking — the server is already added; just no commands linked.
				}
			})();

			// For OAuth servers, immediately kick off the connect popup so the
			// user doesn't have to navigate elsewhere.
			if (entry.authType === "oauth") {
				startOAuthPopup(getToken, entry.url, {
					onSuccess: () => toast.success(`Connected ${label}`),
					onError: (msg) => toast.error(msg),
				});
			}

			onAdded();
		},
		[
			existingServers,
			harnessId,
			updateHarnessFn,
			upsertCommandsFn,
			getToken,
			onAdded,
		],
	);

	const addPresetMutation = useMutation({
		mutationFn: async ({
			id,
			entry,
			label,
		}: {
			id: string;
			entry: McpServerEntry;
			label: string;
		}) => {
			setPendingId(id);
			try {
				await addServerEntry(entry, label);
			} finally {
				setPendingId(null);
			}
		},
	});

	return (
		<div className="flex flex-col">
			<div className="flex border-b border-border text-[10px]">
				<TabBtn active={tab === "presets"} onClick={() => setTab("presets")}>
					Presets
				</TabBtn>
				<TabBtn active={tab === "custom"} onClick={() => setTab("custom")}>
					Custom URL
				</TabBtn>
			</div>

			{tab === "presets" ? (
				<div className="max-h-72 overflow-y-auto py-1">
					{availablePresets.length === 0 ? (
						<p className="px-3 py-4 text-center text-[11px] text-muted-foreground">
							All presets already added.
						</p>
					) : (
						availablePresets.map((preset) => {
							const adding =
								addPresetMutation.isPending && pendingId === preset.id;
							return (
								<button
									key={preset.id}
									type="button"
									disabled={addPresetMutation.isPending}
									onClick={() =>
										addPresetMutation.mutate({
											id: preset.id,
											entry: preset.server,
											label: preset.server.name,
										})
									}
									className="group flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
								>
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-1.5">
											<span className="truncate text-xs font-medium">
												{preset.server.name}
											</span>
											<AuthBadge authType={preset.server.authType} />
										</div>
										<p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">
											{preset.description}
										</p>
									</div>
									<div className="shrink-0 self-center">
										{adding ? (
											<RoseCurveSpinner size={10} />
										) : (
											<Plus
												size={12}
												className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
											/>
										)}
									</div>
								</button>
							);
						})
					)}
				</div>
			) : (
				<CustomMcpForm
					onSubmit={async (entry) => {
						await addServerEntry(entry, entry.name);
					}}
					existingUrls={existingUrls}
				/>
			)}
		</div>
	);
}

function TabBtn({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex-1 px-3 py-1.5 font-medium uppercase tracking-wider transition-colors ${
				active
					? "border-b-2 border-foreground text-foreground"
					: "text-muted-foreground hover:text-foreground"
			}`}
		>
			{children}
		</button>
	);
}

function AuthBadge({ authType }: { authType: McpAuthType }) {
	if (authType === "tiger_junction") {
		return (
			<Badge variant="secondary" className="shrink-0 gap-1 text-[9px]">
				<GraduationCap size={8} />
				Princeton
			</Badge>
		);
	}
	if (authType === "oauth") {
		return (
			<Badge variant="secondary" className="shrink-0 gap-1 text-[9px]">
				<div className="h-1 w-1 rounded-full bg-emerald-500" />
				OAuth
			</Badge>
		);
	}
	if (authType === "bearer") {
		return (
			<Badge variant="secondary" className="shrink-0 text-[9px]">
				Key
			</Badge>
		);
	}
	return (
		<Badge variant="secondary" className="shrink-0 text-[9px]">
			Public
		</Badge>
	);
}

function CustomMcpForm({
	onSubmit,
	existingUrls,
}: {
	onSubmit: (entry: McpServerEntry) => Promise<void>;
	existingUrls: Set<string>;
}) {
	const [name, setName] = useState("");
	const [url, setUrl] = useState("");
	const [authType, setAuthType] = useState<"none" | "bearer" | "oauth">("none");
	const [authToken, setAuthToken] = useState("");
	const [showToken, setShowToken] = useState(false);
	const [urlError, setUrlError] = useState("");
	const [submitting, setSubmitting] = useState(false);

	const handleSubmit = async () => {
		const trimmedName = name.trim();
		const trimmedUrl = url.trim();
		if (!trimmedName || !trimmedUrl) return;
		const error = validateMcpUrl(trimmedUrl);
		if (error) {
			setUrlError(error);
			return;
		}
		if (existingUrls.has(trimmedUrl)) {
			setUrlError("This server URL is already added");
			return;
		}
		if (authType === "bearer" && !authToken.trim()) {
			toast.error("Bearer token required");
			return;
		}
		setUrlError("");
		setSubmitting(true);
		try {
			await onSubmit({
				name: trimmedName,
				url: trimmedUrl,
				authType,
				...(authType === "bearer" ? { authToken: authToken.trim() } : {}),
			});
		} finally {
			setSubmitting(false);
		}
	};

	const canSubmit =
		!!name.trim() &&
		!!url.trim() &&
		(authType !== "bearer" || !!authToken.trim()) &&
		!submitting;

	return (
		<div className="space-y-3 px-3 py-3">
			<div>
				<label
					htmlFor="mcp-status-name"
					className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground"
				>
					Display Name
				</label>
				<Input
					id="mcp-status-name"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="e.g. My Postgres"
					className="h-7 text-xs"
				/>
			</div>
			<div>
				<label
					htmlFor="mcp-status-url"
					className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground"
				>
					Server URL
				</label>
				<Input
					id="mcp-status-url"
					value={url}
					onChange={(e) => {
						setUrl(e.target.value);
						if (urlError) setUrlError("");
					}}
					placeholder="https://mcp.example.com/sse"
					className={`h-7 text-xs ${urlError ? "border-red-500" : ""}`}
				/>
				{urlError && (
					<p className="mt-1 text-[10px] text-red-500">{urlError}</p>
				)}
			</div>
			<div>
				<label
					htmlFor="mcp-status-auth"
					className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground"
				>
					Authentication
				</label>
				<Select
					value={authType}
					onValueChange={(v) => setAuthType(v as "none" | "bearer" | "oauth")}
				>
					<SelectTrigger className="h-7 text-xs">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="none">None</SelectItem>
						<SelectItem value="bearer">Bearer Token</SelectItem>
						<SelectItem value="oauth">OAuth</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<AnimatePresence initial={false}>
				{authType === "bearer" && (
					<motion.div
						key="bearer"
						initial={{ opacity: 0, height: 0 }}
						animate={{ opacity: 1, height: "auto" }}
						exit={{ opacity: 0, height: 0 }}
					>
						<label
							htmlFor="mcp-status-token"
							className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground"
						>
							Bearer Token
						</label>
						<div className="flex gap-1">
							<Input
								id="mcp-status-token"
								type={showToken ? "text" : "password"}
								value={authToken}
								onChange={(e) => setAuthToken(e.target.value)}
								placeholder="Enter token..."
								className="h-7 flex-1 text-xs"
							/>
							<Button
								variant="ghost"
								size="icon-xs"
								onClick={() => setShowToken(!showToken)}
								type="button"
							>
								{showToken ? <EyeOff size={11} /> : <Eye size={11} />}
							</Button>
						</div>
					</motion.div>
				)}
				{authType === "oauth" && (
					<motion.p
						key="oauth-hint"
						initial={{ opacity: 0, height: 0 }}
						animate={{ opacity: 1, height: "auto" }}
						exit={{ opacity: 0, height: 0 }}
						className="text-[10px] text-muted-foreground"
					>
						You'll be prompted to connect via OAuth right after adding.
					</motion.p>
				)}
			</AnimatePresence>

			<Button
				size="sm"
				className="w-full h-7 gap-1 text-[11px]"
				onClick={handleSubmit}
				disabled={!canSubmit}
			>
				{submitting ? <RoseCurveSpinner size={10} /> : <Plus size={11} />}
				Add Server
			</Button>
		</div>
	);
}

/* ---------- OAuth re-auth utilities (existing exports) ---------- */

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
