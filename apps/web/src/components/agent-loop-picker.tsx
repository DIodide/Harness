import { Check, KeyRound, Loader2, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ComponentType, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { KIND_OPTIONS } from "../lib/agent-kind-options";
import {
	type AgentMode,
	agentModelLabel,
	CLAUDE_CODE_CONFIG_OPTIONS,
	flattenConfigChoices,
	isEffortConfigId,
} from "../lib/agent-mode";
import { MODELS } from "../lib/models";
import {
	type AgentCatalogEntry,
	type AgentCredentialKind,
	useAgentCatalog,
	useAgentCredentialMutations,
} from "../lib/use-agent-catalog";
import {
	ClaudeLogo,
	CursorLogo,
	GeminiLogo,
	OpenAILogo,
	OpenCodeLogo,
} from "./agent-logos";
import { HarnessMark } from "./harness-mark";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "./ui/select";
import { Textarea } from "./ui/textarea";

/**
 * Harness-level agent loop configuration: which agent runs this harness,
 * which stored credential it uses (one per harness; credentials are
 * reusable), and the model — model choice is linked to the agent.
 */

interface AgentCardDef {
	id: AgentMode | "opencode" | "gemini";
	label: string;
	logo?: ComponentType<{ size?: number; className?: string }>;
	comingSoon?: boolean;
}

const AGENT_CARDS: AgentCardDef[] = [
	{ id: "default", label: "Harness" },
	{ id: "claude-code", label: "Claude Code", logo: ClaudeLogo },
	{ id: "codex", label: "Codex CLI", logo: OpenAILogo },
	{ id: "cursor", label: "Cursor", logo: CursorLogo },
	{ id: "opencode", label: "OpenCode", logo: OpenCodeLogo, comingSoon: true },
	{ id: "gemini", label: "Gemini CLI", logo: GeminiLogo, comingSoon: true },
];

export function agentModelsFor(
	agent: AgentMode,
	catalog: AgentCatalogEntry[] | undefined,
): Array<{ value: string; label: string }> {
	if (agent === "default") {
		return MODELS.map((m) => ({ value: m.value, label: m.label }));
	}
	const entry = catalog?.find((e) => e.id === agent);
	return (entry?.models ?? []).map((m) => ({
		value: m,
		label: agentModelLabel(m),
	}));
}

export function credentialDisplayName(cred: {
	label: string | null;
	kind: AgentCredentialKind;
	created_at: number | null;
}): string {
	if (cred.label) return cred.label;
	const kindLabel =
		cred.kind === "auth_json"
			? "Login"
			: cred.kind === "oauth_token"
				? "OAuth token"
				: "API key";
	const when = cred.created_at
		? new Date(cred.created_at).toLocaleDateString()
		: "";
	return when ? `${kindLabel} · added ${when}` : kindLabel;
}

export function NewCredentialForm({
	agent,
	onCreated,
	onCancel,
}: {
	agent: Exclude<AgentMode, "default">;
	onCreated: (credentialId: string) => void;
	onCancel: () => void;
}) {
	const options = KIND_OPTIONS[agent] ?? [];
	const [kind, setKind] = useState<AgentCredentialKind>(options[0].kind);
	const [value, setValue] = useState("");
	const [label, setLabel] = useState("");
	const { connect } = useAgentCredentialMutations();
	const selected = options.find((o) => o.kind === kind) ?? options[0];

	const handleSave = () => {
		connect.mutate(
			{ agent, kind, value, label: label.trim() || undefined },
			{
				onSuccess: (credentialId) => {
					toast.success("Credential saved");
					onCreated(credentialId);
				},
				onError: (error) => toast.error(error.message),
			},
		);
	};

	return (
		<div className="mt-2 min-w-0 space-y-2 border border-border bg-muted/30 p-3">
			<div className="grid gap-2 sm:grid-cols-2">
				<Select
					value={kind}
					onValueChange={(v) => setKind(v as AgentCredentialKind)}
				>
					<SelectTrigger className="h-8 w-full text-xs">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{options.map((option) => (
							<SelectItem key={option.kind} value={option.kind}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Input
					value={label}
					onChange={(e) => setLabel(e.target.value)}
					placeholder="Label (e.g. Work account)"
					maxLength={80}
					className="h-8 text-xs"
				/>
			</div>
			{selected.multiline ? (
				<Textarea
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder='Paste the contents of your auth.json — {"...": "..."}'
					rows={4}
					className="field-sizing-fixed max-h-32 min-w-0 resize-none overflow-auto font-mono text-[11px] break-all"
				/>
			) : (
				<Input
					type="password"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder="Paste secret"
					autoComplete="off"
					className="h-8 font-mono text-[11px]"
				/>
			)}
			<p className="text-[10px] text-muted-foreground">
				{selected.hint} Stored encrypted; never shown again after saving.
			</p>
			<div className="flex gap-2">
				<Button
					size="sm"
					className="h-7 text-[11px]"
					disabled={!value.trim() || connect.isPending}
					onClick={handleSave}
				>
					{connect.isPending ? (
						<Loader2 size={11} className="animate-spin" />
					) : (
						<Check size={11} />
					)}
					Save & use
				</Button>
				<Button
					size="sm"
					variant="ghost"
					className="h-7 text-[11px] text-muted-foreground"
					onClick={onCancel}
				>
					Cancel
				</Button>
			</div>
		</div>
	);
}

export function AgentLoopPicker({
	agent,
	onAgentChange,
	credentialId,
	onCredentialChange,
	model,
	onModelChange,
	agentMode,
	onAgentModeChange,
	reasoningEffort,
	onReasoningEffortChange,
}: {
	agent: AgentMode;
	onAgentChange: (agent: AgentMode) => void;
	credentialId: string | null;
	onCredentialChange: (credentialId: string | null) => void;
	model: string;
	onModelChange: (model: string) => void;
	/** Persisted ACP defaults (Claude Code). Optional — omit on forms that
	 *  don't surface them. */
	agentMode?: string | null;
	onAgentModeChange?: (mode: string) => void;
	reasoningEffort?: string | null;
	onReasoningEffortChange?: (effort: string) => void;
}) {
	const { data: catalog } = useAgentCatalog();
	const [addingCredential, setAddingCredential] = useState(false);

	const entry =
		agent === "default" ? undefined : catalog?.find((e) => e.id === agent);
	const credentials = entry?.credentials ?? [];
	const models = agentModelsFor(agent, catalog);

	// Mode / effort defaults are Claude Code's ACP session options; sourced from
	// the static catalog (the live session may refine them later).
	const showAgentConfig = agent === "claude-code";
	const modeOption = CLAUDE_CODE_CONFIG_OPTIONS.find((o) => o.id === "mode");
	const effortOption = CLAUDE_CODE_CONFIG_OPTIONS.find((o) =>
		isEffortConfigId(o.id),
	);
	const modeChoices = modeOption ? flattenConfigChoices(modeOption) : [];
	const effortChoices = effortOption ? flattenConfigChoices(effortOption) : [];

	// Keep selections coherent when the agent changes: model must come from
	// the agent's list, and the credential defaults to the newest stored one.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-sync only on agent/catalog change
	useEffect(() => {
		if (models.length > 0 && !models.some((m) => m.value === model)) {
			onModelChange(models[0].value);
		}
	}, [agent, catalog]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-sync only on agent/catalog change
	useEffect(() => {
		if (agent === "default") {
			if (credentialId !== null) onCredentialChange(null);
			return;
		}
		const valid = credentials.some((c) => c.credential_id === credentialId);
		if (!valid) {
			onCredentialChange(credentials[0]?.credential_id ?? null);
		}
	}, [agent, catalog]);

	return (
		<div className="min-w-0 space-y-4">
			<div>
				<p className="mb-2 block text-xs font-medium text-foreground">
					Agent loop
				</p>
				<div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
					{AGENT_CARDS.map((card) => {
						const selected = agent === card.id;
						const Logo = card.logo;
						return (
							<button
								key={card.id}
								type="button"
								disabled={card.comingSoon}
								onClick={() => onAgentChange(card.id as AgentMode)}
								className={`flex flex-col items-center gap-1.5 border px-2 py-3 text-center transition-colors ${
									card.comingSoon
										? "cursor-default border-border/60 opacity-45"
										: selected
											? "border-foreground bg-foreground/5"
											: "border-border hover:border-foreground/40"
								}`}
							>
								{Logo ? (
									<Logo size={18} className="text-foreground" />
								) : (
									<HarnessMark size={18} className="text-foreground" />
								)}
								<span className="text-[11px] font-medium leading-tight">
									{card.label}
								</span>
								{card.comingSoon && (
									<span className="text-[9px] uppercase tracking-wider text-muted-foreground">
										Soon
									</span>
								)}
							</button>
						);
					})}
				</div>
				<p className="mt-1.5 text-[11px] text-muted-foreground">
					{agent === "default"
						? "Harness-provided models via OpenRouter — usage counts toward your Harness budget."
						: "Runs in an isolated sandbox with your own credentials — billed to your account, Harness budgets don't apply."}
				</p>
			</div>

			{agent !== "default" && (
				<div>
					<p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
						<KeyRound size={12} />
						Credential
					</p>
					{credentials.length > 0 && (
						<div className="space-y-1.5">
							{credentials.map((cred) => {
								const selected = cred.credential_id === credentialId;
								return (
									<button
										key={cred.credential_id}
										type="button"
										onClick={() => onCredentialChange(cred.credential_id)}
										className={`flex w-full items-center gap-2 border px-3 py-2 text-left text-xs transition-colors ${
											selected
												? "border-foreground bg-foreground/5"
												: "border-border hover:border-foreground/40"
										}`}
									>
										<span
											className={`flex size-3.5 shrink-0 items-center justify-center rounded-full border ${
												selected
													? "border-foreground bg-foreground text-background"
													: "border-muted-foreground/40"
											}`}
										>
											{selected && <Check size={9} strokeWidth={3} />}
										</span>
										<span className="truncate font-medium text-foreground">
											{credentialDisplayName(cred)}
										</span>
									</button>
								);
							})}
						</div>
					)}
					<AnimatePresence>
						{addingCredential ? (
							<motion.div
								initial={{ opacity: 0, height: 0 }}
								animate={{ opacity: 1, height: "auto" }}
								exit={{ opacity: 0, height: 0 }}
								className="overflow-hidden"
							>
								<NewCredentialForm
									agent={agent as Exclude<AgentMode, "default">}
									onCreated={(id) => {
										onCredentialChange(id);
										setAddingCredential(false);
									}}
									onCancel={() => setAddingCredential(false)}
								/>
							</motion.div>
						) : (
							<Button
								size="sm"
								variant="outline"
								className="mt-2 h-7 text-[11px]"
								onClick={() => setAddingCredential(true)}
							>
								<Plus size={11} />
								{credentials.length > 0
									? "Add another credential"
									: "Add a credential"}
							</Button>
						)}
					</AnimatePresence>
					{credentials.length === 0 && !addingCredential && (
						<p className="mt-1.5 text-[11px] text-muted-foreground">
							This agent needs a credential before the harness can run.
						</p>
					)}
				</div>
			)}

			<div>
				<label
					htmlFor="agent-model-select"
					className="mb-2 block text-xs font-medium text-foreground"
				>
					Model
				</label>
				<Select value={model} onValueChange={onModelChange}>
					<SelectTrigger id="agent-model-select" className="h-9 w-full">
						<SelectValue placeholder="Select a model" />
					</SelectTrigger>
					<SelectContent>
						{models.map((m) => (
							<SelectItem key={m.value} value={m.value}>
								{m.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{agent !== "default" && (
					<p className="mt-1.5 text-[11px] text-muted-foreground">
						Model availability is determined by the agent — the live session may
						refine this list.
					</p>
				)}
			</div>

			{showAgentConfig && onAgentModeChange && (
				<div>
					<label
						htmlFor="agent-mode-select"
						className="mb-2 block text-xs font-medium text-foreground"
					>
						Mode
					</label>
					<Select
						value={agentMode ?? "default"}
						onValueChange={onAgentModeChange}
					>
						<SelectTrigger id="agent-mode-select" className="h-9 w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{modeChoices.map((c) => (
								<SelectItem key={c.value} value={c.value}>
									{c.name ?? c.value}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}

			{showAgentConfig && onReasoningEffortChange && (
				<div>
					<label
						htmlFor="agent-effort-select"
						className="mb-2 block text-xs font-medium text-foreground"
					>
						Reasoning effort
					</label>
					<Select
						value={reasoningEffort ?? "high"}
						onValueChange={onReasoningEffortChange}
					>
						<SelectTrigger id="agent-effort-select" className="h-9 w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{effortChoices.map((c) => (
								<SelectItem key={c.value} value={c.value}>
									{c.name ?? c.value}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}
		</div>
	);
}
