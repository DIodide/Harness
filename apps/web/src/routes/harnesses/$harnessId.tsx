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
	Box,
	Check,
	Cpu,
	Eye,
	EyeOff,
	Pencil,
	Plus,
	Server,
	Shield,
	Terminal,
	Trash2,
	X,
} from "lucide-react";
import { motion } from "motion/react";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { OAuthConnectRow } from "../../components/mcp-oauth-connect-row";
import { PresetMcpGrid } from "../../components/preset-mcp-grid";
import { PrincetonConnectRow } from "../../components/princeton-connect-row";
import { RecommendedSkillsGrid } from "../../components/recommended-skills-grid";
import { RoseCurveSpinner } from "../../components/rose-curve-spinner";
import { SkillViewerDialog } from "../../components/skill-viewer-dialog";
import { SkillsBrowser } from "../../components/skills-browser";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "../../components/ui/dialog";
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
import { Textarea } from "../../components/ui/textarea";
import { env } from "../../env";
import type { McpServerEntry } from "../../lib/mcp";
import {
	fetchCommandsFromApi,
	PRESET_MCPS,
	sanitizeServerName,
	toMcpServerPayload,
} from "../../lib/mcp";
import { MODELS } from "../../lib/models";
import type { SkillEntry } from "../../lib/skills";
import { SYSTEM_PROMPT_MAX_LENGTH } from "../../lib/system-prompt";

const API_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";

type SandboxConfig = {
	persistent: boolean;
	autoStart: boolean;
	defaultLanguage: string;
	resourceTier: "basic" | "standard" | "performance";
	snapshotId?: string;
	gitRepo?: string;
	networkRestricted?: boolean;
};

type Sandbox = Doc<"sandboxes">;

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

function getSandboxConfigFromSandbox(sandbox: Sandbox): SandboxConfig {
	return {
		persistent: !sandbox.ephemeral,
		autoStart: true,
		defaultLanguage: sandbox.language ?? "python",
		resourceTier: getResourceTierFromSandbox(sandbox),
		gitRepo: sandbox.gitRepo,
		snapshotId: sandbox.snapshotId,
	};
}

function formatSandboxMeta(sandbox: Sandbox) {
	const type = sandbox.ephemeral ? "Ephemeral" : "Persistent";
	const language = sandbox.language
		? sandbox.language.charAt(0).toUpperCase() + sandbox.language.slice(1)
		: "Default";
	return `${type} - ${language} - ${sandbox.resources.cpu} CPU - ${sandbox.resources.memoryGB} GB RAM`;
}

export const Route = createFileRoute("/harnesses/$harnessId")({
	beforeLoad: ({ context }) => {
		if (!context.userId) {
			throw redirect({ to: "/sign-in" });
		}
	},
	component: HarnessEditPage,
});

function HarnessEditPage() {
	const navigate = useNavigate();
	const { harnessId } = Route.useParams();
	const { data: harness, isLoading } = useQuery(
		convexQuery(api.harnesses.get, {
			id: harnessId as Id<"harnesses">,
		}),
	);
	const { data: sandboxes, isLoading: sandboxesLoading } = useQuery(
		convexQuery(api.sandboxes.list, {}),
	);

	const { getToken } = useAuth();
	const updateHarnessFn = useConvexMutation(api.harnesses.update);
	const upsertCommandsFn = useConvexMutation(api.commands.upsert);
	const ensureSkillDetailsFn = useConvexAction(api.skills.ensureSkillDetails);

	const updateHarness = useMutation({
		mutationFn: updateHarnessFn,
		onSuccess: () => {
			const savedSkills = skills;
			const savedMcpServers = mcpServers;

			setName(null);
			setModel(null);
			setMcpServers(null);
			setSkills(null);
			setSystemPrompt(null);
			toast.success("Harness saved");
			navigate({ to: "/harnesses" });

			// Fire-and-forget: sync skill details for newly added skills
			if (savedSkills !== null && savedSkills.length > 0) {
				ensureSkillDetailsFn({ names: savedSkills.map((s) => s.name) }).catch(
					() => {},
				);
			}

			// Regenerate suggested prompts and commands when MCP servers changed
			if (savedMcpServers !== null && savedMcpServers.length > 0) {
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
									mcp_servers: toMcpServerPayload(savedMcpServers),
								}),
							},
						);
						if (res.ok) {
							const data = await res.json();
							if (data.prompts?.length > 0) {
								updateHarnessFn({
									id: harnessId as Id<"harnesses">,
									suggestedPrompts: data.prompts,
								});
							}
						}
					} catch {
						// Non-blocking
					}
				})();

				// Fire-and-forget: fetch commands, upsert, and link to harness
				(async () => {
					try {
						const token = await getToken();
						const cmds = await fetchCommandsFromApi(
							API_URL,
							savedMcpServers,
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
						const enriched = savedMcpServers.map((s) => ({
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
							id: harnessId as Id<"harnesses">,
							mcpServers: enriched,
						});
					} catch {
						// Non-blocking
					}
				})();
			}
		},
	});

	const [name, setName] = useState<string | null>(null);
	const [model, setModel] = useState<string | null>(null);
	const [mcpServers, setMcpServers] = useState<McpServerEntry[] | null>(null);
	const [skills, setSkills] = useState<SkillEntry[] | null>(null);
	const [skillsBrowserOpen, setSkillsBrowserOpen] = useState(false);
	const [viewingSkillId, setViewingSkillId] = useState<string | null>(null);
	const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
	const [sandboxEnabled, setSandboxEnabled] = useState<boolean | null>(null);
	const [selectedSandboxId, setSelectedSandboxId] =
		useState<Id<"sandboxes"> | null>(null);

	// Use local state if edited, otherwise fall back to server data
	const currentName = name ?? harness?.name ?? "";
	const currentModel = model ?? harness?.model ?? "";
	const currentMcpServers = mcpServers ?? harness?.mcpServers ?? [];
	const currentSkills: SkillEntry[] = skills ?? harness?.skills ?? [];

	const toggleSkill = (skill: SkillEntry) => {
		const exists = currentSkills.some((s) => s.name === skill.name);
		setSkills(
			exists
				? currentSkills.filter((s) => s.name !== skill.name)
				: [...currentSkills, skill],
		);
	};

	const currentSandboxEnabled =
		sandboxEnabled ?? harness?.sandboxEnabled ?? false;
	const linkedSandbox = useMemo(
		() =>
			sandboxes?.find(
				(sandbox) =>
					sandbox._id === harness?.sandboxId ||
					sandbox.daytonaSandboxId === harness?.daytonaSandboxId,
			),
		[sandboxes, harness?.sandboxId, harness?.daytonaSandboxId],
	);
	const currentSelectedSandboxId =
		selectedSandboxId ?? linkedSandbox?._id ?? null;
	const currentSelectedSandbox = useMemo(
		() =>
			sandboxes?.find((sandbox) => sandbox._id === currentSelectedSandboxId),
		[sandboxes, currentSelectedSandboxId],
	);

	const currentSystemPrompt = systemPrompt ?? harness?.systemPrompt ?? "";

	const hasChanges =
		name !== null ||
		model !== null ||
		mcpServers !== null ||
		skills !== null ||
		systemPrompt !== null ||
		sandboxEnabled !== null ||
		selectedSandboxId !== null;

	// Derived: which preset IDs are already in the server list
	const selectedPresetMcps = useMemo(
		() =>
			PRESET_MCPS.filter((p) =>
				currentMcpServers.some(
					(s) => s.url === p.server.url && s.name === p.server.name,
				),
			).map((p) => p.id),
		[currentMcpServers],
	);

	// Derived: servers that don't match any preset (manually added)
	const customMcpServers = useMemo(
		() =>
			currentMcpServers.filter(
				(s) =>
					!PRESET_MCPS.some(
						(p) => p.server.name === s.name && p.server.url === s.url,
					),
			),
		[currentMcpServers],
	);

	const togglePresetMcp = (id: string) => {
		const preset = PRESET_MCPS.find((p) => p.id === id);
		if (!preset) return;
		const isSelected = currentMcpServers.some(
			(s) => s.name === preset.server.name && s.url === preset.server.url,
		);
		setMcpServers(
			isSelected
				? currentMcpServers.filter(
						(s) =>
							!(s.name === preset.server.name && s.url === preset.server.url),
					)
				: [...currentMcpServers, preset.server],
		);
	};

	// Servers requiring connection (OAuth or Princeton)
	const oauthServers = useMemo(
		() => currentMcpServers.filter((s) => s.authType === "oauth"),
		[currentMcpServers],
	);
	const tigerJunctionServers = useMemo(
		() => currentMcpServers.filter((s) => s.authType === "tiger_junction"),
		[currentMcpServers],
	);

	const handleSave = () => {
		const updates: Record<string, unknown> = {
			id: harnessId as Id<"harnesses">,
		};
		if (currentSandboxEnabled && !currentSelectedSandbox) {
			toast.error("Select an existing sandbox");
			return;
		}
		if (name !== null) updates.name = name;
		if (model !== null) updates.model = model;
		if (mcpServers !== null) updates.mcpServers = mcpServers;
		if (skills !== null) updates.skills = skills;
		if (systemPrompt !== null) updates.systemPrompt = systemPrompt.trim();
		if (currentSandboxEnabled) {
			updates.sandboxEnabled = true;
			updates.sandboxId = currentSelectedSandbox?._id;
			updates.daytonaSandboxId = currentSelectedSandbox?.daytonaSandboxId;
			updates.sandboxConfig = currentSelectedSandbox
				? getSandboxConfigFromSandbox(currentSelectedSandbox)
				: undefined;
		} else if (sandboxEnabled === false) {
			updates.sandboxEnabled = false;
		}
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
						<RoseCurveSpinner size={14} />
					) : (
						<Check size={14} />
					)}
					Save Changes
				</Button>
			</header>

			<div className="flex-1 p-6">
				<div className="mx-auto max-w-3xl space-y-8">
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
							<div>
								<label
									htmlFor="system-prompt"
									className="mb-1.5 block text-xs font-medium text-foreground"
								>
									System Prompt{" "}
									<span className="font-normal text-muted-foreground">
										(Optional)
									</span>
								</label>
								<Textarea
									id="system-prompt"
									placeholder="e.g. You are a helpful coding assistant that always explains your reasoning."
									value={currentSystemPrompt}
									maxLength={SYSTEM_PROMPT_MAX_LENGTH}
									onChange={(e) => setSystemPrompt(e.target.value)}
									className="h-24 max-w-lg resize-y"
								/>
								<p className="mt-1.5 text-xs text-muted-foreground">
									Custom instructions prepended to every conversation (max{" "}
									{SYSTEM_PROMPT_MAX_LENGTH.toLocaleString()} characters).
								</p>
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

						<div className="space-y-3">
							<div>
								<p className="text-xs font-medium text-foreground">
									Popular MCP Servers
								</p>
								<p className="mt-0.5 text-xs text-muted-foreground">
									Select from common integrations to add to your harness.
								</p>
							</div>
							<PresetMcpGrid
								selected={selectedPresetMcps}
								onToggle={togglePresetMcp}
							/>
						</div>

						<div className="mt-4 space-y-3">
							<div className="flex items-center gap-3">
								<div className="h-px flex-1 bg-border" />
								<p className="text-[11px] text-muted-foreground">
									or add custom
								</p>
								<div className="h-px flex-1 bg-border" />
							</div>

							{customMcpServers.length > 0 && (
								<div className="space-y-2">
									{customMcpServers.map((server) => {
										const i = currentMcpServers.findIndex(
											(s) => s.name === server.name && s.url === server.url,
										);
										return (
											<McpServerRow
												key={`${server.name}-${server.url}`}
												server={server}
												onRemove={() => handleRemoveServer(i)}
												onUpdate={(updated) => handleUpdateServer(i, updated)}
											/>
										);
									})}
								</div>
							)}

							<AddMcpServerForm onAdd={handleAddServer} />
						</div>
					</motion.section>

					<Separator />

					{/* Sandbox */}
					<motion.section
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.075 }}
					>
						<div className="mb-4 flex items-center justify-between">
							<h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
								Sandbox
							</h2>
							{currentSandboxEnabled && (
								<Badge variant="secondary" className="text-[10px]">
									<Terminal size={8} />
									Enabled
								</Badge>
							)}
						</div>

						<div className="space-y-4">
							{/* Enable toggle */}
							<div className="flex items-center gap-3 border border-border px-3 py-2.5 transition-colors hover:bg-muted/30">
								<Checkbox
									id="harness-sandbox-enabled"
									checked={currentSandboxEnabled}
									onCheckedChange={(checked) =>
										setSandboxEnabled(checked === true)
									}
								/>
								<label
									htmlFor="harness-sandbox-enabled"
									className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
								>
									<div className="flex-1">
										<p className="text-xs font-medium text-foreground">
											Enable sandbox for this harness
										</p>
										<p className="text-[11px] text-muted-foreground">
											Gives this harness access to code execution, file system,
											terminal, and git operations in an isolated environment
										</p>
									</div>
									<Box size={14} className="shrink-0 text-muted-foreground" />
								</label>
							</div>

							{currentSandboxEnabled && (
								<motion.div
									initial={{ opacity: 0, height: 0 }}
									animate={{ opacity: 1, height: "auto" }}
									exit={{ opacity: 0, height: 0 }}
									className="space-y-4"
								>
									<div className="space-y-2">
										<span className="block text-xs font-medium text-foreground">
											Attach Existing Sandbox
										</span>
										{sandboxesLoading ? (
											<p className="text-[11px] text-muted-foreground">
												Loading sandboxes...
											</p>
										) : sandboxes && sandboxes.length > 0 ? (
											<Select
												value={currentSelectedSandboxId ?? undefined}
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
													Create a sandbox from the Sandboxes page, then return
													here to attach it.
												</p>
											</div>
										)}
									</div>
								</motion.div>
							)}
						</div>
					</motion.section>

					<Separator />

					{/* Account Connections */}
					{(oauthServers.length > 0 || tigerJunctionServers.length > 0) && (
						<motion.section
							initial={{ opacity: 0, y: 8 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.08 }}
						>
							<h2 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
								Connections
							</h2>
							<p className="mb-4 text-xs text-muted-foreground">
								Connect your accounts. Connections persist across sessions.
							</p>
							{tigerJunctionServers.length > 0 && (
								<div className="mb-2 space-y-2">
									{tigerJunctionServers.map((server) => (
										<PrincetonConnectRow key={server.url} server={server} />
									))}
								</div>
							)}
							{oauthServers.length > 0 && (
								<OAuthConnectionsSection servers={oauthServers} />
							)}
						</motion.section>
					)}

					<Separator />

					{/* Skills */}
					<motion.section
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.09 }}
					>
						<div className="mb-4 flex items-center justify-between">
							<h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
								Skills
							</h2>
							<Badge variant="secondary" className="text-[10px]">
								{currentSkills.length} added
							</Badge>
						</div>

						<div className="mb-3">
							<h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
								Recommended Skills
							</h3>
							<RecommendedSkillsGrid
								selected={currentSkills}
								onToggle={toggleSkill}
							/>
						</div>

						{currentSkills.length > 0 && (
							<div className="mb-3 space-y-1.5">
								<h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
									Added Skills
								</h3>
								{currentSkills.map((skill) => {
									const displayName = skill.name.split("/").pop() ?? skill.name;
									return (
										<div
											key={skill.name}
											className="flex w-full items-start gap-3 border border-foreground bg-foreground/3 p-3 transition-colors hover:border-foreground/20"
										>
											<Checkbox
												checked={true}
												className="mt-0.5 shrink-0"
												onCheckedChange={() => toggleSkill(skill)}
											/>
											<button
												type="button"
												onClick={() => toggleSkill(skill)}
												className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
											>
												<p className="text-xs font-medium text-foreground">
													{displayName}
												</p>
											</button>
											<button
												type="button"
												aria-label={`View skill ${displayName}`}
												onClick={() => setViewingSkillId(skill.name)}
												className="mt-0.5 shrink-0 text-muted-foreground/40 transition-colors hover:text-foreground"
											>
												<Eye size={14} />
											</button>
										</div>
									);
								})}
								<SkillViewerDialog
									fullId={viewingSkillId}
									onClose={() => setViewingSkillId(null)}
								/>
							</div>
						)}

						<Dialog
							open={skillsBrowserOpen}
							onOpenChange={setSkillsBrowserOpen}
						>
							<DialogTrigger asChild>
								<Button
									variant="outline"
									size="sm"
									className="w-full border-dashed"
								>
									<Plus size={14} />
									Browse Skills Catalog
								</Button>
							</DialogTrigger>
							<DialogContent className="flex max-h-[80vh] flex-col overflow-hidden sm:max-w-3xl">
								<DialogHeader>
									<DialogTitle>Skills Catalog</DialogTitle>
									<DialogDescription>
										Browse and search {"\u2248"}50,000 skills from skills.sh
									</DialogDescription>
								</DialogHeader>
								<div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
									<SkillsBrowser
										currentSkills={currentSkills}
										onToggle={toggleSkill}
									/>
								</div>
							</DialogContent>
						</Dialog>
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

function validateMcpUrl(url: string): string | null {
	if (/\s/.test(url)) return "URL must not contain spaces";
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
			return "URL must start with http:// or https://";
	} catch {
		return "Please enter a valid URL";
	}
	return null;
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
	const [urlError, setUrlError] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const startEditing = () => {
		setUrlDraft(server.url);
		setUrlError("");
		setEditingUrl(true);
		// Focus after React renders the input
		setTimeout(() => inputRef.current?.focus(), 0);
	};

	const commitUrl = () => {
		const trimmed = urlDraft.trim();
		if (trimmed && trimmed !== server.url) {
			const error = validateMcpUrl(trimmed);
			if (error) {
				setUrlError(error);
				return;
			}
			onUpdate({ ...server, url: trimmed });
		}
		setUrlError("");
		setEditingUrl(false);
	};

	const cancelEdit = () => {
		setUrlDraft(server.url);
		setUrlError("");
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
					<div className="mt-0.5 flex flex-col gap-0.5">
						<div className="flex items-center gap-1.5">
							<Input
								ref={inputRef}
								value={urlDraft}
								onChange={(e) => {
									setUrlDraft(e.target.value);
									setUrlError("");
								}}
								onBlur={commitUrl}
								onKeyDown={handleKeyDown}
								className="h-6 text-[11px]"
							/>
						</div>
						{urlError && (
							<p className="text-[10px] text-destructive">{urlError}</p>
						)}
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
				<Badge variant="secondary" className="shrink-0 text-[10px]">
					<Shield size={8} />
					OAuth
				</Badge>
			)}
			{server.authType === "tiger_junction" && (
				<Badge variant="secondary" className="shrink-0 text-[10px]">
					<Shield size={8} />
					Princeton
				</Badge>
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
	const [authType, setAuthType] = useState<
		"none" | "bearer" | "oauth" | "tiger_junction"
	>("none");
	const [authToken, setAuthToken] = useState("");
	const [showToken, setShowToken] = useState(false);

	const reset = () => {
		setName("");
		setUrl("");
		setAuthType("none");
		setAuthToken("");
		setShowToken(false);
		setUrlError("");
	};

	const [urlError, setUrlError] = useState("");

	const handleSubmit = () => {
		if (!name.trim() || !url.trim()) return;
		const error = validateMcpUrl(url.trim());
		if (error) {
			setUrlError(error);
			return;
		}
		setUrlError("");
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

function OAuthConnectionsSection({ servers }: { servers: McpServerEntry[] }) {
	const { data: tokenStatuses } = useQuery(
		convexQuery(api.mcpOAuthTokens.listStatuses, {}),
	);

	const connectedByUrl = useMemo(() => {
		const now = Date.now();
		const result: Record<string, boolean> = {};
		for (const server of servers) {
			const persisted = tokenStatuses?.find(
				(s) => s.mcpServerUrl === server.url,
			);
			if (persisted?.connected && persisted.expiresAt * 1000 > now) {
				result[server.url] = true;
			}
		}
		return result;
	}, [tokenStatuses, servers]);

	return (
		<div className="space-y-2">
			{servers.map((server) => (
				<OAuthConnectRow
					key={server.url}
					server={server}
					isConnected={connectedByUrl[server.url] ?? false}
				/>
			))}
		</div>
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
				<div className="mx-auto max-w-3xl space-y-8">
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
