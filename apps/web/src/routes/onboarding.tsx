import { useAuth } from "@clerk/tanstack-react-start";
import {
	convexQuery,
	useConvexAction,
	useConvexMutation,
} from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type {
	Doc,
	Id,
} from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import {
	ArrowLeft,
	ArrowRight,
	Box,
	Check,
	ChevronDown,
	Eye,
	EyeOff,
	Layers,
	Link2,
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
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { OAuthConnectRow } from "../components/mcp-oauth-connect-row";
import { PresetMcpGrid } from "../components/preset-mcp-grid";
import { PrincetonConnectRow } from "../components/princeton-connect-row";
import { RecommendedSkillsGrid } from "../components/recommended-skills-grid";
import { RoseCurveSpinner } from "../components/rose-curve-spinner";
import { SkillsBrowser } from "../components/skills-browser";
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
import { Textarea } from "../components/ui/textarea";
import { env } from "../env";
import type { McpServerEntry } from "../lib/mcp";
import {
	fetchCommandsFromApi,
	PRESET_MCPS,
	presetIdsToServerEntries,
	sanitizeServerName,
	toMcpServerPayload,
} from "../lib/mcp";
import { MODELS } from "../lib/models";
import type { SkillEntry } from "../lib/skills";
import { RECOMMENDED_SKILLS } from "../lib/skills";
import { SYSTEM_PROMPT_MAX_LENGTH } from "../lib/system-prompt";

const API_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";

export const Route = createFileRoute("/onboarding")({
	beforeLoad: ({ context }) => {
		if (!context.userId) {
			throw redirect({ to: "/sign-in" });
		}
	},
	component: OnboardingPage,
});

const BASE_STEPS = [
	{ key: "name", label: "Name & Model", icon: Wrench },
	{ key: "mcps", label: "MCP Servers", icon: Layers },
	{ key: "sandbox", label: "Sandbox", icon: Terminal },
	{ key: "skills", label: "Skills", icon: Zap },
];

const CONNECT_STEP = { key: "connect", label: "Connect", icon: Link2 };

type SandboxConfig = {
	persistent: boolean;
	autoStart: boolean;
	defaultLanguage: string;
	resourceTier: "basic" | "standard" | "performance";
};

type Sandbox = Doc<"sandboxes">;

function getDefaultSandboxSelection(sandbox: Sandbox | undefined) {
	if (!sandbox) return undefined;
	return {
		sandboxId: sandbox._id,
		daytonaSandboxId: sandbox.daytonaSandboxId,
		config: {
			persistent: !sandbox.ephemeral,
			autoStart: true,
			defaultLanguage: sandbox.language ?? "python",
			resourceTier: getResourceTierFromSandbox(sandbox),
		} satisfies SandboxConfig,
	};
}

function getResourceTierFromSandbox(
	sandbox: Sandbox,
): SandboxConfig["resourceTier"] {
	if (sandbox.resources.cpu >= 4 || sandbox.resources.memoryGB >= 8) {
		return "performance";
	}
	if (sandbox.resources.cpu >= 2 || sandbox.resources.memoryGB >= 4) {
		return "standard";
	}
	return "basic";
}

function formatSandboxMeta(sandbox: Sandbox) {
	const type = sandbox.ephemeral ? "Ephemeral" : "Persistent";
	const language = sandbox.language
		? sandbox.language.charAt(0).toUpperCase() + sandbox.language.slice(1)
		: "Default";
	return `${type} - ${language} - ${sandbox.resources.cpu} CPU - ${sandbox.resources.memoryGB} GB RAM`;
}

function OnboardingPage() {
	const navigate = useNavigate();

	const [name, setName] = useState("");
	const [model, setModel] = useState("");
	const [systemPrompt, setSystemPrompt] = useState("");
	const [customMcpServers, setCustomMcpServers] = useState<McpServerEntry[]>(
		[],
	);
	const [sandboxEnabled, setSandboxEnabled] = useState(false);
	const [selectedSandboxId, setSelectedSandboxId] =
		useState<Id<"sandboxes"> | null>(null);
	const [selectedPresetMcps, setSelectedPresetMcps] = useState<string[]>([]);
	const [selectedSkills, setSelectedSkills] = useState<SkillEntry[]>([]);

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
	// Direct Convex mutations for fire-and-forget command sync (survives unmount)
	const upsertCommandsFn = useConvexMutation(api.commands.upsert);
	const updateHarnessFn = useConvexMutation(api.harnesses.update);
	const ensureSkillDetailsFn = useConvexAction(api.skills.ensureSkillDetails);
	const { getToken } = useAuth();
	const createHarnessFn = useConvexMutation(api.harnesses.create);
	const { data: sandboxes, isLoading: sandboxesLoading } = useQuery(
		convexQuery(api.sandboxes.list, {}),
	);
	const selectedSandbox = useMemo(
		() => sandboxes?.find((sandbox) => sandbox._id === selectedSandboxId),
		[sandboxes, selectedSandboxId],
	);

	useEffect(() => {
		if (selectedSandboxId || !sandboxes?.length) return;
		setSelectedSandboxId(sandboxes[0]._id);
	}, [sandboxes, selectedSandboxId]);

	const createHarness = useMutation({
		mutationFn: async (args: {
			name: string;
			model: string;
			status: "started" | "stopped" | "draft";
			mcpServers: McpServerEntry[];
			skills: SkillEntry[];
			systemPrompt?: string;
			sandboxEnabled?: boolean;
			sandboxConfig?: SandboxConfig;
			defaultSandbox?: {
				sandboxId: Id<"sandboxes">;
				daytonaSandboxId: string;
				config: SandboxConfig;
			};
		}) => {
			const { defaultSandbox, ...createArgs } = args;
			const harnessId = await createHarnessFn(createArgs);

			if (args.sandboxEnabled && defaultSandbox) {
				await updateHarnessFn({
					id: harnessId as Id<"harnesses">,
					sandboxId: defaultSandbox.sandboxId,
					daytonaSandboxId: defaultSandbox.daytonaSandboxId,
					sandboxConfig: defaultSandbox.config,
				});
				return harnessId;
			}

			return harnessId;
		},
		onSuccess: (harnessId, variables) => {
			const id = harnessId as Id<"harnesses">;
			if (variables.status === "draft") {
				navigate({ to: "/harnesses" });
				toast.success("Draft saved");
			} else {
				navigate({ to: "/chat", search: { harnessId: id as string } });
			}

			// Fire-and-forget: sync skill details for added skills
			if (selectedSkills.length > 0) {
				ensureSkillDetailsFn({
					names: selectedSkills.map((s) => s.name),
				}).catch(() => {});
			}

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
									mcp_servers: toMcpServerPayload(allMcpServers),
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

				// Fire-and-forget: fetch commands, upsert, and link to harness
				(async () => {
					try {
						const token = await getToken();
						const cmds = await fetchCommandsFromApi(
							API_URL,
							allMcpServers,
							token,
						);
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
						const enriched = allMcpServers.map((s) => ({
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

						await updateHarnessFn({ id, mcpServers: enriched });
					} catch {
						// Non-blocking
					}
				})();
			}
		},
	});

	const canProceed = () => {
		if (currentStep === "name")
			return name.trim().length > 0 && model.length > 0;
		if (currentStep === "sandbox" && sandboxEnabled) {
			return !!selectedSandbox;
		}
		return true;
	};

	const handleNext = () => {
		if (safeIndex < steps.length - 1) setStepIndex(safeIndex + 1);
	};

	const handleBack = () => {
		if (safeIndex > 0) setStepIndex(safeIndex - 1);
	};

	// Strip commandIds from servers — commands are synced after creation in the chat page
	const mcpServersForMutation = allMcpServers.map(
		({ commandIds: _, ...rest }) => rest,
	);

	const handleCreate = () => {
		const defaultSandbox = getDefaultSandboxSelection(selectedSandbox);
		if (sandboxEnabled && !defaultSandbox) {
			toast.error("Select an existing sandbox");
			return;
		}
		createHarness.mutate({
			name: name.trim(),
			model,
			status: "started" as const,
			mcpServers: mcpServersForMutation,
			skills: selectedSkills,
			systemPrompt: systemPrompt.trim() || undefined,
			sandboxEnabled: sandboxEnabled || undefined,
			sandboxConfig: sandboxEnabled ? defaultSandbox?.config : undefined,
			defaultSandbox: sandboxEnabled ? defaultSandbox : undefined,
		});
	};

	const handleSaveDraft = () => {
		if (!name.trim()) {
			toast.error("Give your harness a name before saving");
			return;
		}
		if (!model) {
			toast.error("Pick a model before saving");
			return;
		}
		const defaultSandbox = getDefaultSandboxSelection(selectedSandbox);
		if (sandboxEnabled && !defaultSandbox) {
			toast.error("Select an existing sandbox");
			return;
		}
		createHarness.mutate({
			name: name.trim(),
			model,
			status: "draft" as const,
			mcpServers: mcpServersForMutation,
			skills: selectedSkills,
			systemPrompt: systemPrompt.trim() || undefined,
			sandboxEnabled: sandboxEnabled || undefined,
			sandboxConfig: sandboxEnabled ? defaultSandbox?.config : undefined,
			defaultSandbox: sandboxEnabled ? defaultSandbox : undefined,
		});
	};

	const handleAddServer = (server: McpServerEntry) => {
		setCustomMcpServers((prev) => [...prev, server]);
	};

	const handleRemoveServer = (index: number) => {
		setCustomMcpServers((prev) => prev.filter((_, i) => i !== index));
	};

	const togglePresetMcp = (id: string) => {
		setSelectedPresetMcps((prev) =>
			prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
		);
	};

	return (
		<div className="flex min-h-screen flex-col bg-background">
			<header className="flex items-center justify-between border-b border-border px-6 py-4">
				<div className="flex items-center gap-4">
					<Button variant="ghost" size="icon-xs" asChild>
						<Link to="/harnesses">
							<ArrowLeft size={14} />
						</Link>
					</Button>
					<div>
						<h1 className="text-lg font-medium tracking-tight text-foreground">
							Create Harness
						</h1>
						<p className="text-xs text-muted-foreground">
							Configure a new AI agent harness
						</p>
					</div>
				</div>
				<Button
					variant="ghost"
					size="sm"
					onClick={handleSaveDraft}
					disabled={
						createHarness.isPending || !name.trim() || !model
					}
					title={
						!name.trim() || !model
							? "Name the harness and pick a model first"
							: undefined
					}
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
									systemPrompt={systemPrompt}
									setSystemPrompt={setSystemPrompt}
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
									sandboxes={sandboxes ?? []}
									sandboxesLoading={sandboxesLoading}
									selectedSandboxId={selectedSandboxId}
									setSelectedSandboxId={setSelectedSandboxId}
								/>
							)}
							{currentStep === "skills" && (
								<StepSkills
									selected={selectedSkills}
									onToggle={(skill) =>
										setSelectedSkills((prev) =>
											prev.some((s) => s.name === skill.name)
												? prev.filter((s) => s.name !== skill.name)
												: [...prev, skill],
										)
									}
								/>
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
									<RoseCurveSpinner size={12} className="text-background" />
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
	systemPrompt,
	setSystemPrompt,
}: {
	name: string;
	setName: (v: string) => void;
	model: string;
	setModel: (v: string) => void;
	systemPrompt: string;
	setSystemPrompt: (v: string) => void;
}) {
	return (
		<div className="space-y-6">
			<p className="text-xs text-muted-foreground">
				Give your harness a name and select a model to get started.
			</p>
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
			<div>
				<label
					htmlFor="system-prompt"
					className="mb-2 block text-xs font-medium text-foreground"
				>
					System Prompt{" "}
					<span className="font-normal text-muted-foreground">(Optional)</span>
				</label>
				<Textarea
					id="system-prompt"
					placeholder="e.g. You are a helpful coding assistant that always explains your reasoning."
					value={systemPrompt}
					maxLength={SYSTEM_PROMPT_MAX_LENGTH}
					onChange={(e) => setSystemPrompt(e.target.value)}
					className="h-24 resize-y"
				/>
				<p className="mt-1.5 text-xs text-muted-foreground">
					Custom instructions prepended to every conversation (max{" "}
					{SYSTEM_PROMPT_MAX_LENGTH.toLocaleString()} characters).
				</p>
			</div>

			<details className="group border-t border-border pt-4">
				<summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground">
					<ChevronDown
						size={12}
						className="transition-transform group-open:rotate-180"
					/>
					What can I add in the next steps?
				</summary>
				<div className="mt-4 space-y-4 opacity-60">
					<div>
						<div className="mb-2 flex items-center gap-1.5">
							<Layers size={12} className="text-muted-foreground" />
							<p className="text-[11px] font-medium text-muted-foreground">
								MCP Servers
							</p>
						</div>
						<div className="pointer-events-none flex flex-wrap gap-1.5">
							{PRESET_MCPS.map((mcp) => (
								<span
									key={mcp.id}
									className="inline-flex items-center gap-1.5 border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground"
								>
									<Server size={10} className="shrink-0" />
									{mcp.server.name}
								</span>
							))}
							<span className="inline-flex items-center gap-1 border border-dashed border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground">
								<Plus size={10} />
								Custom
							</span>
						</div>
					</div>

					<div>
						<div className="mb-2 flex items-center gap-1.5">
							<Zap size={12} className="text-muted-foreground" />
							<p className="text-[11px] font-medium text-muted-foreground">
								Skills
							</p>
						</div>
						<div className="pointer-events-none flex flex-wrap gap-1.5">
							{RECOMMENDED_SKILLS.map((rec) => (
								<span
									key={rec.id}
									className="inline-flex items-center gap-1.5 border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground"
								>
									<Zap size={10} className="shrink-0" />
									{rec.skill.skillId}
								</span>
							))}
							<span className="inline-flex items-center gap-1 border border-dashed border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground">
								<Plus size={10} />
								Browse more
							</span>
						</div>
					</div>
				</div>
			</details>
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
	sandboxes,
	sandboxesLoading,
	selectedSandboxId,
	setSelectedSandboxId,
}: {
	enabled: boolean;
	setEnabled: (v: boolean) => void;
	sandboxes: Sandbox[];
	sandboxesLoading: boolean;
	selectedSandboxId: Id<"sandboxes"> | null;
	setSelectedSandboxId: (v: Id<"sandboxes"> | null) => void;
}) {
	return (
		<div className="space-y-4">
			<p className="text-xs text-muted-foreground">
				Choose the default sandbox this harness should use for code execution,
				file management, terminal commands, and git operations.
			</p>

			<div className="flex items-center gap-3 border border-border px-3 py-2.5 transition-colors hover:bg-muted/30">
				<Checkbox
					id="sandbox-enabled"
					checked={enabled}
					onCheckedChange={(checked) => setEnabled(checked === true)}
				/>
				<label
					htmlFor="sandbox-enabled"
					className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
				>
					<div className="flex-1">
						<p className="text-xs font-medium text-foreground">
							Enable default sandbox
						</p>
						<p className="text-[11px] text-muted-foreground">
							Attach an existing sandbox to this harness
						</p>
					</div>
					<Box size={14} className="shrink-0 text-muted-foreground" />
				</label>
			</div>

			{enabled && (
				<motion.div
					initial={{ opacity: 0, height: 0 }}
					animate={{ opacity: 1, height: "auto" }}
					exit={{ opacity: 0, height: 0 }}
					className="space-y-4"
				>
					<div className="space-y-2">
						<span className="block text-xs font-medium text-foreground">
							Select Sandbox
						</span>
						{sandboxesLoading ? (
							<p className="text-[11px] text-muted-foreground">
								Loading sandboxes...
							</p>
						) : sandboxes.length > 0 ? (
							<Select
								value={selectedSandboxId ?? undefined}
								onValueChange={(value) =>
									setSelectedSandboxId(value as Id<"sandboxes">)
								}
							>
								<SelectTrigger className="w-full max-w-lg text-xs">
									<SelectValue placeholder="Choose a sandbox" />
								</SelectTrigger>
								<SelectContent>
									{sandboxes.map((sandbox) => (
										<SelectItem key={sandbox._id} value={sandbox._id}>
											<span className="truncate">{sandbox.name}</span>
											<span className="text-[10px] text-muted-foreground">
												{formatSandboxMeta(sandbox)}
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						) : (
							<div className="border border-dashed border-border px-3 py-2.5">
								<p className="text-xs font-medium text-foreground">
									No existing sandboxes
								</p>
								<p className="mt-1 text-[11px] text-muted-foreground">
									Create a sandbox from the Sandboxes page, then return here to
									attach it.
								</p>
							</div>
						)}
					</div>
				</motion.div>
			)}

			{!enabled && (
				<p className="text-center text-[11px] text-muted-foreground/60">
					You can set a default sandbox later from the harness settings.
				</p>
			)}
		</div>
	);
}

function StepSkills({
	selected,
	onToggle,
}: {
	selected: SkillEntry[];
	onToggle: (skill: SkillEntry) => void;
}) {
	return (
		<div className="space-y-4">
			<p className="text-xs text-muted-foreground">
				Select recommended skills or browse the full catalog.
			</p>
			{selected.length > 0 && (
				<Badge variant="secondary" className="text-[10px]">
					{selected.length} selected
				</Badge>
			)}
			<RecommendedSkillsGrid selected={selected} onToggle={onToggle} />
			<div>
				<h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
					Browse All Skills
				</h3>
				<SkillsBrowser currentSkills={selected} onToggle={onToggle} />
			</div>
		</div>
	);
}
