import { useAuth } from "@clerk/tanstack-react-start";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import {
	ArrowLeft,
	Check,
	Cpu,
	Eye,
	EyeOff,
	Loader2,
	Pencil,
	Plus,
	Server,
	Shield,
	Trash2,
	X,
} from "lucide-react";
import { motion } from "motion/react";
import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import toast from "react-hot-toast";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../components/ui/select";
import { Separator } from "../../components/ui/separator";
import { Skeleton } from "../../components/ui/skeleton";
import { env } from "../../env";
import { MODELS } from "../../lib/models";

const API_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";

export const Route = createFileRoute("/harnesses/$harnessId")({
	beforeLoad: ({ context }) => {
		if (!context.userId) {
			throw redirect({ to: "/sign-in" });
		}
	},
	component: HarnessEditPage,
});

interface McpServerEntry {
	name: string;
	url: string;
	authType: "none" | "bearer" | "oauth";
	authToken?: string;
}

function HarnessEditPage() {
	const { harnessId } = Route.useParams();
	const { data: harness, isLoading } = useQuery(
		convexQuery(api.harnesses.get, {
			id: harnessId as Id<"harnesses">,
		}),
	);

	const updateHarness = useMutation({
		mutationFn: useConvexMutation(api.harnesses.update),
		onSuccess: () => {
			toast.success("Harness saved");
		},
	});

	const [name, setName] = useState<string | null>(null);
	const [model, setModel] = useState<string | null>(null);
	const [mcpServers, setMcpServers] = useState<McpServerEntry[] | null>(null);

	// Use local state if edited, otherwise fall back to server data
	const currentName = name ?? harness?.name ?? "";
	const currentModel = model ?? harness?.model ?? "";
	const currentMcpServers = mcpServers ?? harness?.mcpServers ?? [];

	const hasChanges = name !== null || model !== null || mcpServers !== null;

	const handleSave = () => {
		const updates: Record<string, unknown> = {
			id: harnessId as Id<"harnesses">,
		};
		if (name !== null) updates.name = name;
		if (model !== null) updates.model = model;
		if (mcpServers !== null) updates.mcpServers = mcpServers;
		updateHarness.mutate(updates as Parameters<typeof updateHarness.mutate>[0]);
	};

	const handleAddServer = (server: McpServerEntry) => {
		setMcpServers([...currentMcpServers, server]);
	};

	const handleRemoveServer = (index: number) => {
		setMcpServers(currentMcpServers.filter((_, i) => i !== index));
	};

	const handleUpdateServer = (index: number, updated: McpServerEntry) => {
		const next = [...currentMcpServers];
		next[index] = updated;
		setMcpServers(next);
	};

	if (isLoading) {
		return <EditSkeleton />;
	}

	if (!harness) {
		return (
			<div className="flex h-full flex-col items-center justify-center bg-background">
				<p className="mb-4 text-sm text-muted-foreground">Harness not found.</p>
				<Button size="sm" variant="outline" asChild>
					<Link to="/harnesses">Back to Harnesses</Link>
				</Button>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col overflow-auto bg-background">
			<header className="flex items-center justify-between border-b border-border px-6 py-4">
				<div className="flex items-center gap-4">
					<Button variant="ghost" size="icon-xs" asChild>
						<Link to="/harnesses">
							<ArrowLeft size={14} />
						</Link>
					</Button>
					<div>
						<h1 className="text-lg font-medium tracking-tight text-foreground">
							Edit Harness
						</h1>
						<p className="text-xs text-muted-foreground">
							Configure name, model, and MCP servers
						</p>
					</div>
				</div>
				<Button
					size="sm"
					onClick={handleSave}
					disabled={!hasChanges || updateHarness.isPending}
				>
					{updateHarness.isPending ? (
						<Loader2 size={14} className="animate-spin" />
					) : (
						<Check size={14} />
					)}
					Save Changes
				</Button>
			</header>

			<div className="flex-1 p-6">
				<div className="mx-auto max-w-2xl space-y-8">
					{/* Name & Model */}
					<motion.section
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
					>
						<h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
							General
						</h2>
						<div className="space-y-4">
							<div>
								<label
									htmlFor="harness-name"
									className="mb-1.5 block text-xs font-medium text-foreground"
								>
									Name
								</label>
								<Input
									id="harness-name"
									value={currentName}
									onChange={(e) => setName(e.target.value)}
									placeholder="My Harness"
									className="max-w-sm"
								/>
							</div>
							<div>
								<label
									htmlFor="harness-model"
									className="mb-1.5 block text-xs font-medium text-foreground"
								>
									Model
								</label>
								<Select value={currentModel} onValueChange={(v) => setModel(v)}>
									<SelectTrigger className="max-w-sm">
										<SelectValue placeholder="Select a model" />
									</SelectTrigger>
									<SelectContent>
										{MODELS.map((m) => (
											<SelectItem key={m.value} value={m.value}>
												<Cpu size={12} />
												{m.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>
					</motion.section>

					<Separator />

					{/* MCP Servers */}
					<motion.section
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.05 }}
					>
						<div className="mb-4 flex items-center justify-between">
							<h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
								MCP Servers
							</h2>
							<Badge variant="secondary" className="text-[10px]">
								{currentMcpServers.length} configured
							</Badge>
						</div>

						{currentMcpServers.length > 0 && (
							<div className="mb-4 space-y-2">
								{currentMcpServers.map((server, i) => (
									<McpServerRow
										key={`${server.name}-${i}`}
										server={server}
										onRemove={() => handleRemoveServer(i)}
										onUpdate={(updated) => handleUpdateServer(i, updated)}
									/>
								))}
							</div>
						)}

						<AddMcpServerForm onAdd={handleAddServer} />
					</motion.section>

					<Separator />

					{/* Status */}
					<motion.section
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.1 }}
					>
						<h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
							Status
						</h2>
						<div className="flex items-center gap-3">
							<div
								className={`h-2 w-2 ${
									harness.status === "started"
										? "bg-emerald-500"
										: harness.status === "stopped"
											? "bg-muted-foreground/40"
											: "bg-amber-400"
								}`}
							/>
							<span className="text-sm text-foreground capitalize">
								{harness.status}
							</span>
						</div>
					</motion.section>
				</div>
			</div>
		</div>
	);
}

function McpServerRow({
	server,
	onRemove,
	onUpdate,
}: {
	server: McpServerEntry;
	onRemove: () => void;
	onUpdate: (updated: McpServerEntry) => void;
}) {
	const [editingUrl, setEditingUrl] = useState(false);
	const [urlDraft, setUrlDraft] = useState(server.url);
	const inputRef = useRef<HTMLInputElement>(null);

	const startEditing = () => {
		setUrlDraft(server.url);
		setEditingUrl(true);
		// Focus after React renders the input
		setTimeout(() => inputRef.current?.focus(), 0);
	};

	const commitUrl = () => {
		const trimmed = urlDraft.trim();
		if (trimmed && trimmed !== server.url) {
			onUpdate({ ...server, url: trimmed });
		}
		setEditingUrl(false);
	};

	const cancelEdit = () => {
		setUrlDraft(server.url);
		setEditingUrl(false);
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			commitUrl();
		} else if (e.key === "Escape") {
			cancelEdit();
		}
	};

	return (
		<motion.div
			initial={{ opacity: 0, y: 4 }}
			animate={{ opacity: 1, y: 0 }}
			className="group flex items-center gap-3 border border-border px-3 py-2.5"
		>
			<Server size={14} className="shrink-0 text-muted-foreground" />
			<div className="min-w-0 flex-1">
				<p className="text-xs font-medium text-foreground">{server.name}</p>
				{editingUrl ? (
					<div className="mt-0.5 flex items-center gap-1.5">
						<Input
							ref={inputRef}
							value={urlDraft}
							onChange={(e) => setUrlDraft(e.target.value)}
							onBlur={commitUrl}
							onKeyDown={handleKeyDown}
							className="h-6 text-[11px]"
						/>
					</div>
				) : (
					<button
						type="button"
						onClick={startEditing}
						className="group/url flex items-center gap-1 truncate text-[11px] text-muted-foreground transition-colors hover:text-foreground"
					>
						<span className="truncate">{server.url}</span>
						<Pencil
							size={9}
							className="shrink-0 opacity-0 transition-opacity group-hover/url:opacity-100"
						/>
					</button>
				)}
			</div>
			{server.authType === "bearer" && (
				<Badge variant="secondary" className="shrink-0 text-[10px]">
					<Shield size={8} />
					Bearer
				</Badge>
			)}
			{server.authType === "oauth" && (
				<OAuthStatusBadge serverUrl={server.url} />
			)}
			<Button
				variant="ghost"
				size="icon-xs"
				onClick={onRemove}
				className="shrink-0 opacity-0 group-hover:opacity-100"
			>
				<Trash2 size={12} />
			</Button>
		</motion.div>
	);
}

function AddMcpServerForm({
	onAdd,
}: {
	onAdd: (server: McpServerEntry) => void;
}) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [url, setUrl] = useState("");
	const [authType, setAuthType] = useState<"none" | "bearer" | "oauth">("none");
	const [authToken, setAuthToken] = useState("");
	const [showToken, setShowToken] = useState(false);

	const reset = () => {
		setName("");
		setUrl("");
		setAuthType("none");
		setAuthToken("");
		setShowToken(false);
	};

	const handleSubmit = () => {
		if (!name.trim() || !url.trim()) return;
		onAdd({
			name: name.trim(),
			url: url.trim(),
			authType,
			authToken: authType === "bearer" ? authToken : undefined,
		} as McpServerEntry);
		reset();
		setOpen(false);
	};

	if (!open) {
		return (
			<Button
				variant="outline"
				size="sm"
				onClick={() => setOpen(true)}
				className="w-full border-dashed"
			>
				<Plus size={14} />
				Add MCP Server
			</Button>
		);
	}

	return (
		<motion.div
			initial={{ opacity: 0, y: 4 }}
			animate={{ opacity: 1, y: 0 }}
			className="space-y-3 border border-border p-4"
		>
			<div className="flex items-center justify-between">
				<p className="text-xs font-medium text-foreground">New MCP Server</p>
				<Button
					variant="ghost"
					size="icon-xs"
					onClick={() => {
						reset();
						setOpen(false);
					}}
				>
					<X size={12} />
				</Button>
			</div>

			<div className="grid gap-3 sm:grid-cols-2">
				<div>
					<label
						htmlFor="mcp-name"
						className="mb-1 block text-[11px] text-muted-foreground"
					>
						Display Name
					</label>
					<Input
						id="mcp-name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="e.g. My Postgres"
						className="text-xs"
					/>
				</div>
				<div>
					<label
						htmlFor="mcp-url"
						className="mb-1 block text-[11px] text-muted-foreground"
					>
						Server URL
					</label>
					<Input
						id="mcp-url"
						value={url}
						onChange={(e) => setUrl(e.target.value)}
						placeholder="https://mcp.example.com/sse"
						className="text-xs"
					/>
				</div>
			</div>

			<div>
				<label
					htmlFor="mcp-auth"
					className="mb-1 block text-[11px] text-muted-foreground"
				>
					Authentication
				</label>
				<Select
					value={authType}
					onValueChange={(v) => setAuthType(v as "none" | "bearer" | "oauth")}
				>
					<SelectTrigger className="max-w-xs text-xs">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="none">None</SelectItem>
						<SelectItem value="bearer">Bearer Token</SelectItem>
						<SelectItem value="oauth">OAuth</SelectItem>
					</SelectContent>
				</Select>
			</div>

			{authType === "oauth" && (
				<motion.div
					initial={{ opacity: 0, height: 0 }}
					animate={{ opacity: 1, height: "auto" }}
					exit={{ opacity: 0, height: 0 }}
					className="rounded border border-border bg-muted/30 px-3 py-2"
				>
					<p className="text-[11px] text-muted-foreground">
						After adding this server, click &quot;Connect&quot; to authenticate
						via OAuth. You&apos;ll be redirected to the server&apos;s
						authorization provider.
					</p>
				</motion.div>
			)}

			{authType === "bearer" && (
				<motion.div
					initial={{ opacity: 0, height: 0 }}
					animate={{ opacity: 1, height: "auto" }}
					exit={{ opacity: 0, height: 0 }}
				>
					<label
						htmlFor="mcp-token"
						className="mb-1 block text-[11px] text-muted-foreground"
					>
						Bearer Token
					</label>
					<div className="flex gap-2">
						<Input
							id="mcp-token"
							type={showToken ? "text" : "password"}
							value={authToken}
							onChange={(e) => setAuthToken(e.target.value)}
							placeholder="Enter token..."
							className="flex-1 text-xs"
						/>
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={() => setShowToken(!showToken)}
						>
							{showToken ? <EyeOff size={12} /> : <Eye size={12} />}
						</Button>
					</div>
				</motion.div>
			)}

			<div className="flex justify-end gap-2 pt-1">
				<Button
					variant="outline"
					size="sm"
					onClick={() => {
						reset();
						setOpen(false);
					}}
				>
					Cancel
				</Button>
				<Button
					size="sm"
					onClick={handleSubmit}
					disabled={!name.trim() || !url.trim()}
				>
					<Plus size={12} />
					Add Server
				</Button>
			</div>
		</motion.div>
	);
}

function OAuthStatusBadge({ serverUrl }: { serverUrl: string }) {
	const { getToken } = useAuth();
	const [status, setStatus] = useState<
		"unknown" | "connected" | "disconnected"
	>("unknown");
	const [connecting, setConnecting] = useState(false);

	const checkStatus = useCallback(async () => {
		try {
			const token = await getToken();
			const res = await fetch(
				`${API_URL}/api/mcp/oauth/status?server_url=${encodeURIComponent(serverUrl)}`,
				{
					headers: {
						Authorization: `Bearer ${token}`,
					},
				},
			);
			if (res.ok) {
				const data = await res.json();
				setStatus(data.connected ? "connected" : "disconnected");
			}
		} catch {
			setStatus("disconnected");
		}
	}, [getToken, serverUrl]);

	// Check status on mount
	useEffect(() => {
		checkStatus();
	}, [checkStatus]);

	const handleConnect = async () => {
		setConnecting(true);
		try {
			const token = await getToken();
			const res = await fetch(
				`${API_URL}/api/mcp/oauth/start?server_url=${encodeURIComponent(serverUrl)}`,
				{
					headers: {
						Authorization: `Bearer ${token}`,
					},
				},
			);
			if (!res.ok) throw new Error("Failed to start OAuth");
			const data = await res.json();

			// Open popup for OAuth flow
			const popup = window.open(
				data.authorization_url,
				"mcp-oauth",
				"width=600,height=700",
			);

			// Listen for callback message from popup
			const handler = (event: MessageEvent) => {
				if (event.data?.type === "mcp-oauth-callback") {
					window.removeEventListener("message", handler);
					if (event.data.success) {
						setStatus("connected");
						toast.success("Connected to MCP server via OAuth");
					} else {
						toast.error(event.data.error || "OAuth connection failed");
					}
					setConnecting(false);
					popup?.close();
				}
			};
			window.addEventListener("message", handler);

			// Fallback: if popup closes without message
			const interval = setInterval(() => {
				if (popup?.closed) {
					clearInterval(interval);
					window.removeEventListener("message", handler);
					setConnecting(false);
					checkStatus();
				}
			}, 500);
		} catch {
			toast.error("Failed to start OAuth flow");
			setConnecting(false);
		}
	};

	if (status === "connected") {
		return (
			<Badge variant="secondary" className="shrink-0 gap-1 text-[10px]">
				<div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
				OAuth
			</Badge>
		);
	}

	return (
		<Button
			variant="outline"
			size="sm"
			className="h-5 shrink-0 px-2 text-[10px]"
			onClick={handleConnect}
			disabled={connecting}
		>
			{connecting ? (
				<Loader2 size={8} className="animate-spin" />
			) : (
				<Shield size={8} />
			)}
			Connect
		</Button>
	);
}

function EditSkeleton() {
	return (
		<div className="flex h-full flex-col bg-background">
			<header className="flex items-center justify-between border-b border-border px-6 py-4">
				<div className="flex items-center gap-4">
					<Skeleton className="h-6 w-6" />
					<Skeleton className="h-6 w-40" />
				</div>
				<Skeleton className="h-8 w-28" />
			</header>
			<div className="flex-1 p-6">
				<div className="mx-auto max-w-2xl space-y-8">
					<div className="space-y-4">
						<Skeleton className="h-4 w-20" />
						<Skeleton className="h-9 w-80" />
						<Skeleton className="h-9 w-80" />
					</div>
					<Separator />
					<div className="space-y-4">
						<Skeleton className="h-4 w-24" />
						<Skeleton className="h-14 w-full" />
						<Skeleton className="h-14 w-full" />
					</div>
				</div>
			</div>
		</div>
	);
}
