import { useAuth } from "@clerk/tanstack-react-start";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import {
	ArrowLeft,
	ArrowRight,
	Box,
	Check,
	Cpu,
	Eye,
	EyeOff,
	HardDrive,
	Layers,
	Link2,
	Play,
	Plus,
	Server,
	Shield,
	Terminal,
	Trash2,
	Wrench,
	X,
	Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { HarnessMark } from "../components/harness-mark";
import { OAuthConnectRow } from "../components/mcp-oauth-connect-row";
import { PresetMcpGrid } from "../components/preset-mcp-grid";
import { PrincetonConnectRow } from "../components/princeton-connect-row";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../components/ui/select";
import { env } from "../env";
import type { McpServerEntry } from "../lib/mcp";
import { presetIdsToServerEntries } from "../lib/mcp";
import { MODELS } from "../lib/models";

const API_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";

export const Route = createFileRoute("/onboarding")({
	beforeLoad: ({ context }) => {
		if (!context.userId) {
			throw redirect({ to: "/sign-in" });
		}
	},
	component: OnboardingPage,
});

const AVAILABLE_SKILLS = [
	{ id: "coding", name: "Coding", description: "Write and review code" },
	{
		id: "research",
		name: "Research",
		description: "Gather and synthesize information",
	},
	{
		id: "writing",
		name: "Writing",
		description: "Draft documents and content",
	},
	{
		id: "analysis",
		name: "Data Analysis",
		description: "Analyze datasets and trends",
	},
	{
		id: "debugging",
		name: "Debugging",
		description: "Find and fix issues in code",
	},
	{
		id: "devops",
		name: "DevOps",
		description: "Infrastructure and deployment",
	},
];

const BASE_STEPS = [
	{ key: "name", label: "Name & Model", icon: Wrench },
	{ key: "mcps", label: "MCP Servers", icon: Layers },
	{ key: "sandbox", label: "Sandbox", icon: Terminal },
	{ key: "skills", label: "Skills", icon: Zap },
];

const CONNECT_STEP = { key: "connect", label: "Connect", icon: Link2 };

function OnboardingPage() {
	const navigate = useNavigate();

	const [name, setName] = useState("");
	const [model, setModel] = useState("");
	const [customMcpServers, setCustomMcpServers] = useState<McpServerEntry[]>(
		[],
	);
	const [sandboxEnabled, setSandboxEnabled] = useState(false);
	const [sandboxConfig, setSandboxConfig] = useState({
		persistent: false,
		autoStart: true,
		defaultLanguage: "python",
		resourceTier: "basic" as "basic" | "standard" | "performance",
	});
	const [selectedPresetMcps, setSelectedPresetMcps] = useState<string[]>([]);
	const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

	const [stepIndex, setStepIndex] = useState(0);

	const allMcpServers = useMemo(
		() => [
			...customMcpServers,
			...presetIdsToServerEntries(selectedPresetMcps),
		],
		[customMcpServers, selectedPresetMcps],
	);

	const hasOAuthServers = allMcpServers.some((s) => s.authType === "oauth");
	const hasTigerJunction = allMcpServers.some(
		(s) => s.authType === "tiger_junction",
	);
	const hasConnectStep = hasOAuthServers || hasTigerJunction;

	const steps = useMemo(() => {
		if (!hasConnectStep) return BASE_STEPS;
		// Insert connect step after MCP Servers, before Sandbox
		return [
			BASE_STEPS[0],
			BASE_STEPS[1],
			CONNECT_STEP,
			BASE_STEPS[2],
			BASE_STEPS[3],
		];
	}, [hasConnectStep]);

	// Clamp stepIndex if steps shrink (e.g. OAuth servers removed while on connect step)
	const safeIndex = Math.min(stepIndex, steps.length - 1);
	const currentStep = steps[safeIndex]?.key ?? "name";

	const updateHarnessMut = useMutation({
		mutationFn: useConvexMutation(api.harnesses.update),
	});
	const { getToken } = useAuth();

	const createHarness = useMutation({
		mutationFn: useConvexMutation(api.harnesses.create),
		onSuccess: (harnessId) => {
			const id = harnessId as Id<"harnesses">;
			navigate({ to: "/chat", search: { harnessId: id as string } });

			// Fire-and-forget: generate suggested prompts from MCP tools
			if (allMcpServers.length > 0) {
				(async () => {
					try {
						const token = await getToken();
						const res = await fetch(
							`${API_URL}/api/mcp/health/generate-prompts`,
							{
								method: "POST",
								headers: {
									"Content-Type": "application/json",
									...(token ? { Authorization: `Bearer ${token}` } : {}),
								},
								body: JSON.stringify({
									mcp_servers: allMcpServers.map((s) => ({
										name: s.name,
										url: s.url,
										auth_type: s.authType,
										...(s.authToken ? { auth_token: s.authToken } : {}),
									})),
								}),
							},
						);
						if (res.ok) {
							const data = await res.json();
							if (data.prompts?.length > 0) {
								updateHarnessMut.mutate({
									id: id,
									suggestedPrompts: data.prompts,
								});
							}
						}
					} catch {
						// Non-blocking — prompts are optional
					}
				})();
			}
		},
	});

	const canProceed = () => {
		if (currentStep === "name")
			return name.trim().length > 0 && model.length > 0;
		return true;
	};

	const handleNext = () => {
		if (safeIndex < steps.length - 1) setStepIndex(safeIndex + 1);
	};

	const handleBack = () => {
		if (safeIndex > 0) setStepIndex(safeIndex - 1);
	};

	const handleCreate = () => {
		createHarness.mutate({
			name: name.trim(),
			model,
			status: "started",
			mcpServers: allMcpServers,
			skills: selectedSkills,
			...(sandboxEnabled ? { sandboxEnabled: true, sandboxConfig } : {}),
		} as any);
	};

	const handleSaveDraft = () => {
		createHarness.mutate({
			name: name.trim() || "Untitled Harness",
			model: model || "gpt-4o",
			status: "draft",
			mcpServers: allMcpServers,
			skills: selectedSkills,
			...(sandboxEnabled ? { sandboxEnabled: true, sandboxConfig } : {}),
		} as any);
	};

	const handleAddServer = (server: McpServerEntry) => {
		setCustomMcpServers((prev) => [...prev, server]);
	};

	const handleRemoveServer = (index: number) => {
		setCustomMcpServers((prev) => prev.filter((_, i) => i !== index));
	};

	const toggleSkill = (id: string) => {
		setSelectedSkills((prev) =>
			prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
		);
	};

	const togglePresetMcp = (id: string) => {
		setSelectedPresetMcps((prev) =>
			prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
		);
	};

	return (
		<div className="flex min-h-screen flex-col bg-background">
			<header className="flex items-center justify-between border-b border-border px-6 py-4">
				<div className="flex items-center gap-2">
					<HarnessMark size={22} className="text-foreground" />
					<span className="text-lg font-semibold tracking-tight text-foreground">
						Harness
					</span>
				</div>
				<Button
					variant="ghost"
					size="sm"
					onClick={handleSaveDraft}
					disabled={createHarness.isPending}
				>
					Save Draft
				</Button>
			</header>

			<div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
				<div className="mb-2 text-center">
					<h1 className="text-2xl font-medium tracking-tight text-foreground">
						Let's build your first harness
					</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						Configure the tools and capabilities your AI agent needs.
					</p>
				</div>

				<div className="mb-10 mt-8 flex items-center justify-center gap-1">
					{steps.map((s, i) => (
						<div key={s.key} className="flex items-center gap-1">
							<button
								type="button"
								onClick={() => {
									if (i < safeIndex || canProceed()) setStepIndex(i);
								}}
								className={`flex h-9 items-center gap-2 border px-3 text-xs font-medium transition-colors ${
									i === safeIndex
										? "border-foreground bg-foreground text-background"
										: i < safeIndex
											? "border-foreground/20 bg-foreground/5 text-foreground"
											: "border-border text-muted-foreground"
								}`}
							>
								{i < safeIndex ? <Check size={12} /> : <s.icon size={12} />}
								<span className="hidden sm:inline">{s.label}</span>
								<span className="sm:hidden">{i + 1}</span>
							</button>
							{i < steps.length - 1 && (
								<div
									className={`h-px w-6 ${i < safeIndex ? "bg-foreground/20" : "bg-border"}`}
								/>
							)}
						</div>
					))}
				</div>

				<div className="flex-1">
					<AnimatePresence mode="wait">
						<motion.div
							key={currentStep}
							initial={{ opacity: 0, x: 20 }}
							animate={{ opacity: 1, x: 0 }}
							exit={{ opacity: 0, x: -20 }}
							transition={{ duration: 0.25 }}
						>
							{currentStep === "name" && (
								<StepNameModel
									name={name}
									setName={setName}
									model={model}
									setModel={setModel}
								/>
							)}
							{currentStep === "mcps" && (
								<StepMcpServers
									servers={customMcpServers}
									onAdd={handleAddServer}
									onRemove={handleRemoveServer}
									selectedPresets={selectedPresetMcps}
									onTogglePreset={togglePresetMcp}
								/>
							)}
							{currentStep === "connect" && (
								<StepConnect
									servers={allMcpServers.filter(
										(s) =>
											s.authType === "oauth" || s.authType === "tiger_junction",
									)}
								/>
							)}
							{currentStep === "sandbox" && (
								<StepSandbox
									enabled={sandboxEnabled}
									setEnabled={setSandboxEnabled}
									config={sandboxConfig}
									setConfig={setSandboxConfig}
								/>
							)}
							{currentStep === "skills" && (
								<StepSkills selected={selectedSkills} toggle={toggleSkill} />
							)}
						</motion.div>
					</AnimatePresence>
				</div>

				<div className="flex items-center justify-between border-t border-border pt-6">
					<Button
						variant="outline"
						size="sm"
						onClick={handleBack}
						disabled={safeIndex === 0}
					>
						<ArrowLeft size={14} />
						Back
					</Button>

					{safeIndex < steps.length - 1 ? (
						<Button size="sm" onClick={handleNext} disabled={!canProceed()}>
							Next
							<ArrowRight size={14} />
						</Button>
					) : (
						<Button
							size="sm"
							onClick={handleCreate}
							disabled={createHarness.isPending || !canProceed()}
						>
							{createHarness.isPending ? (
								<span className="flex items-center gap-2">
									<span className="h-3 w-3 animate-spin border border-background border-t-transparent" />
									Creating...
								</span>
							) : (
								<>
									Create Harness
									<Shield size={14} />
								</>
							)}
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}

function StepNameModel({
	name,
	setName,
	model,
	setModel,
}: {
	name: string;
	setName: (v: string) => void;
	model: string;
	setModel: (v: string) => void;
}) {
	return (
		<div className="space-y-6">
			<div>
				<label
					htmlFor="harness-name"
					className="mb-2 block text-xs font-medium text-foreground"
				>
					Harness Name
				</label>
				<Input
					id="harness-name"
					placeholder="e.g. Coding Assistant"
					value={name}
					onChange={(e) => setName(e.target.value)}
					className="h-9"
				/>
				<p className="mt-1.5 text-xs text-muted-foreground">
					Give your harness a descriptive name.
				</p>
			</div>
			<div>
				<label
					htmlFor="model-select"
					className="mb-2 block text-xs font-medium text-foreground"
				>
					Model
				</label>
				<Select value={model} onValueChange={setModel}>
					<SelectTrigger id="model-select" className="h-9">
						<SelectValue placeholder="Select a model" />
					</SelectTrigger>
					<SelectContent>
						{MODELS.map((m) => (
							<SelectItem key={m.value} value={m.value}>
								{m.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p className="mt-1.5 text-xs text-muted-foreground">
					Choose the LLM that powers this harness.
				</p>
			</div>
		</div>
	);
}

function StepMcpServers({
	servers,
	onAdd,
	onRemove,
	selectedPresets,
	onTogglePreset,
}: {
	servers: McpServerEntry[];
	onAdd: (server: McpServerEntry) => void;
	onRemove: (index: number) => void;
	selectedPresets: string[];
	onTogglePreset: (id: string) => void;
}) {
	return (
		<div className="space-y-6">
			<div className="space-y-3">
				<div>
					<p className="text-xs font-medium text-foreground">
						Popular MCP Servers
					</p>
					<p className="mt-0.5 text-xs text-muted-foreground">
						Select from common integrations to add to your harness.
					</p>
				</div>
				<PresetMcpGrid selected={selectedPresets} onToggle={onTogglePreset} />
			</div>

			<div className="space-y-3">
				<div className="flex items-center gap-3">
					<div className="h-px flex-1 bg-border" />
					<p className="text-[11px] text-muted-foreground">or add custom</p>
					<div className="h-px flex-1 bg-border" />
				</div>

				{servers.length > 0 && (
					<div className="space-y-2">
						{servers.map((server, i) => (
							<motion.div
								key={`${server.name}-${server.url}`}
								initial={{ opacity: 0, y: 4 }}
								animate={{ opacity: 1, y: 0 }}
								className="group flex items-center gap-3 border border-border px-3 py-2.5"
							>
								<Server size={14} className="shrink-0 text-muted-foreground" />
								<div className="min-w-0 flex-1">
									<p className="text-xs font-medium text-foreground">
										{server.name}
									</p>
									<p className="truncate text-[11px] text-muted-foreground">
										{server.url}
									</p>
								</div>
								{server.authType === "bearer" && (
									<Badge variant="secondary" className="shrink-0 text-[10px]">
										<Shield size={8} />
										Bearer
									</Badge>
								)}
								{server.authType === "oauth" && (
									<Badge
										variant="secondary"
										className="shrink-0 gap-1 text-[10px]"
									>
										<Shield size={8} />
										OAuth
									</Badge>
								)}
								<Button
									variant="ghost"
									size="icon-xs"
									onClick={() => onRemove(i)}
									className="shrink-0 opacity-0 group-hover:opacity-100"
								>
									<Trash2 size={12} />
								</Button>
							</motion.div>
						))}
					</div>
				)}

				<AddMcpServerForm onAdd={onAdd} />
			</div>
		</div>
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
	const [authType, setAuthType] = useState<
		"none" | "bearer" | "oauth" | "tiger_junction"
	>("none");
	const [authToken, setAuthToken] = useState("");
	const [showToken, setShowToken] = useState(false);

	const [urlError, setUrlError] = useState("");

	const reset = () => {
		setName("");
		setUrl("");
		setAuthType("none");
		setAuthToken("");
		setShowToken(false);
		setUrlError("");
	};

	const handleSubmit = () => {
		if (!name.trim() || !url.trim()) return;
		if (/\s/.test(url.trim())) {
			setUrlError("URL must not contain spaces");
			return;
		}
		try {
			const parsed = new URL(url.trim());
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
				setUrlError("URL must start with http:// or https://");
				return;
			}
		} catch {
			setUrlError("Please enter a valid URL");
			return;
		}
		setUrlError("");
		onAdd({
			name: name.trim(),
			url: url.trim(),
			authType,
			authToken: authType === "bearer" ? authToken : undefined,
		});
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
						onChange={(e) => {
							setUrl(e.target.value);
							if (urlError) setUrlError("");
						}}
						placeholder="https://mcp.example.com/sse"
						className={`text-xs ${urlError ? "border-red-500" : ""}`}
					/>
					{urlError && (
						<p className="mt-1 text-[11px] text-red-500">{urlError}</p>
					)}
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
					onValueChange={(v) =>
						setAuthType(v as "none" | "bearer" | "oauth" | "tiger_junction")
					}
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

			{authType === "oauth" && (
				<motion.div
					initial={{ opacity: 0, height: 0 }}
					animate={{ opacity: 1, height: "auto" }}
					exit={{ opacity: 0, height: 0 }}
					className="rounded border border-border bg-muted/30 px-3 py-2"
				>
					<p className="text-[11px] text-muted-foreground">
						You'll be able to connect via OAuth in the next step.
					</p>
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

function StepConnect({ servers }: { servers: McpServerEntry[] }) {
	const { data: tokenStatuses } = useQuery(
		convexQuery(api.mcpOAuthTokens.listStatuses, {}),
	);

	const oauthServers = servers.filter((s) => s.authType === "oauth");
	const tjServers = servers.filter((s) => s.authType === "tiger_junction");

	const connectedServers = useMemo(() => {
		const now = Date.now();
		const result: Record<string, boolean> = {};
		for (const server of oauthServers) {
			const persisted = tokenStatuses?.find(
				(s) => s.mcpServerUrl === server.url,
			);
			if (persisted?.connected && persisted.expiresAt * 1000 > now) {
				result[server.url] = true;
			}
		}
		return result;
	}, [tokenStatuses, oauthServers]);

	return (
		<div className="space-y-4">
			<div>
				<p className="text-xs text-muted-foreground">
					Connect your accounts to enable authenticated MCP servers.
				</p>
			</div>

			<div className="space-y-2">
				{tjServers.map((server) => (
					<PrincetonConnectRow key={server.url} server={server} />
				))}
				{oauthServers.map((server) => (
					<OAuthConnectRow
						key={server.url}
						server={server}
						isConnected={connectedServers[server.url] ?? false}
					/>
				))}
			</div>

			<p className="text-center text-[11px] text-muted-foreground/60">
				You can skip this step and connect later from harness settings.
			</p>
		</div>
	);
}

function StepSandbox({
	enabled,
	setEnabled,
	config,
	setConfig,
}: {
	enabled: boolean;
	setEnabled: (v: boolean) => void;
	config: {
		persistent: boolean;
		autoStart: boolean;
		defaultLanguage: string;
		resourceTier: "basic" | "standard" | "performance";
	};
	setConfig: (v: {
		persistent: boolean;
		autoStart: boolean;
		defaultLanguage: string;
		resourceTier: "basic" | "standard" | "performance";
	}) => void;
}) {
	return (
		<div className="space-y-4">
			<p className="text-xs text-muted-foreground">
				Give your harness an isolated sandbox environment for code execution,
				file management, terminal commands, and git operations.
			</p>

			<label className="flex cursor-pointer items-center gap-3 border border-border px-3 py-2.5 transition-colors hover:bg-muted/30">
				<Checkbox
					checked={enabled}
					onCheckedChange={(checked) => setEnabled(checked === true)}
				/>
				<div className="flex-1">
					<p className="text-xs font-medium text-foreground">Enable sandbox</p>
					<p className="text-[11px] text-muted-foreground">
						A sandbox will be auto-provisioned when you start chatting
					</p>
				</div>
				<Box size={14} className="shrink-0 text-muted-foreground" />
			</label>

			{enabled && (
				<motion.div
					initial={{ opacity: 0, height: 0 }}
					animate={{ opacity: 1, height: "auto" }}
					exit={{ opacity: 0, height: 0 }}
					className="space-y-4"
				>
					{/* Sandbox type */}
					<div>
						<label className="mb-1.5 block text-xs font-medium text-foreground">
							Sandbox Type
						</label>
						<div className="grid gap-2 sm:grid-cols-2">
							<button
								type="button"
								onClick={() => setConfig({ ...config, persistent: false })}
								className={`flex items-start gap-2.5 border px-3 py-2.5 text-left transition-colors ${
									!config.persistent
										? "border-foreground bg-foreground/5"
										: "border-border hover:bg-muted/30"
								}`}
							>
								<Play size={12} className="mt-0.5 shrink-0" />
								<div>
									<p className="text-xs font-medium">Ephemeral</p>
									<p className="text-[11px] text-muted-foreground">
										Created per conversation, auto-deleted when done
									</p>
								</div>
							</button>
							<button
								type="button"
								onClick={() => setConfig({ ...config, persistent: true })}
								className={`flex items-start gap-2.5 border px-3 py-2.5 text-left transition-colors ${
									config.persistent
										? "border-foreground bg-foreground/5"
										: "border-border hover:bg-muted/30"
								}`}
							>
								<HardDrive size={12} className="mt-0.5 shrink-0" />
								<div>
									<p className="text-xs font-medium">Persistent</p>
									<p className="text-[11px] text-muted-foreground">
										Maintains state across conversations
									</p>
								</div>
							</button>
						</div>
					</div>

					{/* Resource tier */}
					<div>
						<label className="mb-1.5 block text-xs font-medium text-foreground">
							Resource Tier
						</label>
						<Select
							value={config.resourceTier}
							onValueChange={(v) =>
								setConfig({
									...config,
									resourceTier: v as "basic" | "standard" | "performance",
								})
							}
						>
							<SelectTrigger className="max-w-sm text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="basic">
									<Cpu size={10} />
									Basic — 1 CPU, 1 GB RAM, 3 GB Disk
								</SelectItem>
								<SelectItem value="standard">
									<Cpu size={10} />
									Standard — 2 CPU, 4 GB RAM, 8 GB Disk
								</SelectItem>
								<SelectItem value="performance">
									<Cpu size={10} />
									Performance — 4 CPU, 8 GB RAM, 10 GB Disk
								</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{/* Default language */}
					<div>
						<label className="mb-1.5 block text-xs font-medium text-foreground">
							Default Language
						</label>
						<Select
							value={config.defaultLanguage}
							onValueChange={(v) =>
								setConfig({ ...config, defaultLanguage: v })
							}
						>
							<SelectTrigger className="max-w-sm text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="python">Python</SelectItem>
								<SelectItem value="javascript">JavaScript</SelectItem>
								<SelectItem value="typescript">TypeScript</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</motion.div>
			)}

			{!enabled && (
				<p className="text-center text-[11px] text-muted-foreground/60">
					You can enable a sandbox later from the harness settings.
				</p>
			)}
		</div>
	);
}

function StepSkills({
	selected,
	toggle,
}: {
	selected: string[];
	toggle: (id: string) => void;
}) {
	return (
		<div className="space-y-3">
			<p className="text-xs text-muted-foreground">
				Select the skills your agent should have.
			</p>
			<div className="grid gap-2 sm:grid-cols-2">
				{AVAILABLE_SKILLS.map((skill) => (
					<button
						key={skill.id}
						type="button"
						onClick={() => toggle(skill.id)}
						className={`flex items-start gap-3 border p-3 text-left transition-colors ${
							selected.includes(skill.id)
								? "border-foreground bg-foreground/3"
								: "border-border hover:border-foreground/20"
						}`}
					>
						<Checkbox
							checked={selected.includes(skill.id)}
							className="mt-0.5"
							tabIndex={-1}
						/>
						<div>
							<p className="text-xs font-medium text-foreground">
								{skill.name}
							</p>
							<p className="text-xs text-muted-foreground">
								{skill.description}
							</p>
						</div>
					</button>
				))}
			</div>
		</div>
	);
}
