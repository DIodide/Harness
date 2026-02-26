import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import {
	ArrowLeft,
	ArrowRight,
	Check,
	ExternalLink,
	Layers,
	Link2,
	Shield,
	Wrench,
	Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { HarnessMark } from "../components/harness-mark";
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

export const Route = createFileRoute("/onboarding")({
	beforeLoad: ({ context }) => {
		if (!context.userId) {
			throw redirect({ to: "/sign-in" });
		}
	},
	component: OnboardingPage,
});

type AuthType = "oauth" | "cas";

interface McpDefinition {
	id: string;
	name: string;
	description: string;
	auth?: { type: AuthType; provider: string; label: string };
}

const AVAILABLE_MCPS: McpDefinition[] = [
	{
		id: "browser",
		name: "Browser",
		description: "Web browsing and scraping capabilities",
	},
	{
		id: "terminal",
		name: "Terminal",
		description: "Execute shell commands and scripts",
	},
	{
		id: "editor",
		name: "Code Editor",
		description: "Read and write source code files",
	},
	{
		id: "database",
		name: "Database",
		description: "Query and manage databases",
	},
	{
		id: "search",
		name: "Search",
		description: "Search the web for information",
	},
	{
		id: "filesystem",
		name: "Filesystem",
		description: "Navigate and manage local files",
	},
	{
		id: "github",
		name: "GitHub",
		description: "Access repositories, issues, and pull requests",
		auth: { type: "oauth", provider: "github", label: "GitHub" },
	},
	{
		id: "google-drive",
		name: "Google Drive",
		description: "Read and write files in Google Drive",
		auth: { type: "oauth", provider: "google", label: "Google" },
	},
	{
		id: "slack",
		name: "Slack",
		description: "Send and read messages in Slack workspaces",
		auth: { type: "oauth", provider: "slack", label: "Slack" },
	},
	{
		id: "princeton-tigerhub",
		name: "TigerHub",
		description: "Access Princeton University TigerHub services",
		auth: { type: "cas", provider: "princeton", label: "Princeton CAS" },
	},
];

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

const MODELS = [
	{ value: "gpt-4o", label: "GPT-4o" },
	{ value: "claude-sonnet-4", label: "Claude Sonnet 4" },
	{ value: "claude-opus-4", label: "Claude Opus 4" },
	{ value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
];

function OnboardingPage() {
	const navigate = useNavigate();

	const [name, setName] = useState("");
	const [model, setModel] = useState("");
	const [selectedMcps, setSelectedMcps] = useState<string[]>([]);
	const [connectedProviders, setConnectedProviders] = useState<string[]>([]);
	const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

	const mcpsRequiringAuth = useMemo(
		() => AVAILABLE_MCPS.filter((m) => m.auth && selectedMcps.includes(m.id)),
		[selectedMcps],
	);
	const needsAuthStep = mcpsRequiringAuth.length > 0;

	const steps = useMemo(() => {
		const base = [
			{ key: "name", label: "Name & Model", icon: Wrench },
			{ key: "mcps", label: "MCPs", icon: Layers },
		];
		if (needsAuthStep) {
			base.push({ key: "connect", label: "Connect", icon: Link2 });
		}
		base.push({ key: "skills", label: "Skills", icon: Zap });
		return base;
	}, [needsAuthStep]);

	const [stepIndex, setStepIndex] = useState(0);
	const currentStep = steps[stepIndex]?.key ?? "name";

	const createHarness = useMutation({
		mutationFn: useConvexMutation(api.harnesses.create),
		onSuccess: () => {
			navigate({ to: "/chat" });
		},
	});

	const canProceed = () => {
		if (currentStep === "name")
			return name.trim().length > 0 && model.length > 0;
		return true;
	};

	const handleNext = () => {
		if (stepIndex < steps.length - 1) setStepIndex(stepIndex + 1);
	};

	const handleBack = () => {
		if (stepIndex > 0) setStepIndex(stepIndex - 1);
	};

	const handleCreate = () => {
		createHarness.mutate({
			name: name.trim(),
			model,
			status: "started",
			mcps: selectedMcps,
			skills: selectedSkills,
		});
	};

	const handleSaveDraft = () => {
		createHarness.mutate({
			name: name.trim() || "Untitled Harness",
			model: model || "gpt-4o",
			status: "draft",
			mcps: selectedMcps,
			skills: selectedSkills,
		});
	};

	const toggleMcp = (id: string) => {
		setSelectedMcps((prev) =>
			prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
		);
	};

	const toggleSkill = (id: string) => {
		setSelectedSkills((prev) =>
			prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
		);
	};

	const handleConnect = (provider: string) => {
		setConnectedProviders((prev) =>
			prev.includes(provider) ? prev : [...prev, provider],
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

			<div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10">
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
									if (i < stepIndex || canProceed()) setStepIndex(i);
								}}
								className={`flex h-9 items-center gap-2 border px-3 text-xs font-medium transition-colors ${
									i === stepIndex
										? "border-foreground bg-foreground text-background"
										: i < stepIndex
											? "border-foreground/20 bg-foreground/5 text-foreground"
											: "border-border text-muted-foreground"
								}`}
							>
								{i < stepIndex ? <Check size={12} /> : <s.icon size={12} />}
								<span className="hidden sm:inline">{s.label}</span>
								<span className="sm:hidden">{i + 1}</span>
							</button>
							{i < steps.length - 1 && (
								<div
									className={`h-px w-6 ${i < stepIndex ? "bg-foreground/20" : "bg-border"}`}
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
								<StepMcps selected={selectedMcps} toggle={toggleMcp} />
							)}
							{currentStep === "connect" && (
								<StepConnect
									mcps={mcpsRequiringAuth}
									connected={connectedProviders}
									onConnect={handleConnect}
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
						disabled={stepIndex === 0}
					>
						<ArrowLeft size={14} />
						Back
					</Button>

					{stepIndex < steps.length - 1 ? (
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

function StepMcps({
	selected,
	toggle,
}: {
	selected: string[];
	toggle: (id: string) => void;
}) {
	return (
		<div className="space-y-3">
			<p className="text-xs text-muted-foreground">
				Select the MCP servers your agent should have access to.
			</p>
			<div className="grid gap-2 sm:grid-cols-2">
				{AVAILABLE_MCPS.map((mcp) => (
					<button
						key={mcp.id}
						type="button"
						onClick={() => toggle(mcp.id)}
						className={`flex items-start gap-3 border p-3 text-left transition-colors ${
							selected.includes(mcp.id)
								? "border-foreground bg-foreground/3"
								: "border-border hover:border-foreground/20"
						}`}
					>
						<Checkbox
							checked={selected.includes(mcp.id)}
							className="mt-0.5"
							tabIndex={-1}
						/>
						<div className="flex-1">
							<div className="flex items-center gap-1.5">
								<p className="text-xs font-medium text-foreground">
									{mcp.name}
								</p>
								{mcp.auth && (
									<Badge
										variant="outline"
										className="px-1 py-0 text-[9px] uppercase"
									>
										{mcp.auth.type}
									</Badge>
								)}
							</div>
							<p className="text-xs text-muted-foreground">{mcp.description}</p>
						</div>
					</button>
				))}
			</div>
		</div>
	);
}

function StepConnect({
	mcps,
	connected,
	onConnect,
}: {
	mcps: McpDefinition[];
	connected: string[];
	onConnect: (provider: string) => void;
}) {
	const oauthMcps = mcps.filter((m) => m.auth?.type === "oauth");
	const casMcps = mcps.filter((m) => m.auth?.type === "cas");

	return (
		<div className="space-y-6">
			<p className="text-xs text-muted-foreground">
				Some of the MCPs you selected require authentication. Connect your
				accounts below — no secrets are stored locally.
			</p>

			{oauthMcps.length > 0 && (
				<div className="space-y-2">
					<h3 className="text-xs font-medium text-foreground">OAuth</h3>
					{oauthMcps.map((mcp) => {
						const provider = mcp.auth?.provider ?? "";
						const isConnected = connected.includes(provider);
						return (
							<div
								key={mcp.id}
								className="flex items-center justify-between border border-border p-3"
							>
								<div>
									<p className="text-xs font-medium text-foreground">
										{mcp.name}
									</p>
									<p className="text-[11px] text-muted-foreground">
										Sign in with {mcp.auth?.label} to grant access
									</p>
								</div>
								{isConnected ? (
									<Badge variant="secondary" className="gap-1 text-[10px]">
										<Check size={10} />
										Connected
									</Badge>
								) : (
									<Button
										variant="outline"
										size="xs"
										onClick={() => onConnect(provider)}
									>
										<ExternalLink size={10} />
										Connect
									</Button>
								)}
							</div>
						);
					})}
				</div>
			)}

			{casMcps.length > 0 && (
				<div className="space-y-2">
					<h3 className="text-xs font-medium text-foreground">
						CAS Authentication
					</h3>
					{casMcps.map((mcp) => {
						const provider = mcp.auth?.provider ?? "";
						const isConnected = connected.includes(provider);
						return (
							<div
								key={mcp.id}
								className="flex items-center justify-between border border-border p-3"
							>
								<div>
									<p className="text-xs font-medium text-foreground">
										{mcp.name}
									</p>
									<p className="text-[11px] text-muted-foreground">
										Authenticate via {mcp.auth?.label}
									</p>
								</div>
								{isConnected ? (
									<Badge variant="secondary" className="gap-1 text-[10px]">
										<Check size={10} />
										Authenticated
									</Badge>
								) : (
									<Button
										variant="outline"
										size="xs"
										onClick={() => onConnect(provider)}
									>
										<ExternalLink size={10} />
										Authenticate
									</Button>
								)}
							</div>
						);
					})}
				</div>
			)}

			<p className="text-[11px] text-muted-foreground/60">
				You can skip this and connect later from the harness settings.
			</p>
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
