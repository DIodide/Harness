import { Check } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ComponentType, useState } from "react";
import {
	type AgentCatalogEntry,
	useAgentCatalog,
} from "../../lib/use-agent-catalog";
import { ConnectForm } from "../agent-connections";
import {
	ClaudeLogo,
	CursorLogo,
	GeminiLogo,
	OpenAILogo,
	OpenCodeLogo,
} from "../agent-logos";

/**
 * Onboarding step: bring your own coding agent. Connectable agents come
 * from the gateway catalog; "coming soon" agents are display-only. Secrets
 * go through the same write-only encrypted path as Settings.
 */

interface AgentCardDef {
	id: string;
	name: string;
	blurb: string;
	logo: ComponentType<{ size?: number; className?: string }>;
	comingSoon?: boolean;
}

const AGENT_CARDS: AgentCardDef[] = [
	{
		id: "claude-code",
		name: "Claude Code",
		blurb: "Anthropic's coding agent",
		logo: ClaudeLogo,
	},
	{
		id: "codex",
		name: "Codex CLI",
		blurb: "OpenAI's coding agent",
		logo: OpenAILogo,
	},
	{
		id: "cursor",
		name: "Cursor",
		blurb: "Cursor's CLI agent",
		logo: CursorLogo,
	},
	{
		id: "opencode",
		name: "OpenCode",
		blurb: "Open-source agent",
		logo: OpenCodeLogo,
		comingSoon: true,
	},
	{
		id: "gemini",
		name: "Gemini CLI",
		blurb: "Google's coding agent",
		logo: GeminiLogo,
		comingSoon: true,
	},
];

function AgentCard({
	def,
	entry,
	selected,
	onSelect,
}: {
	def: AgentCardDef;
	entry?: AgentCatalogEntry;
	selected: boolean;
	onSelect: () => void;
}) {
	const connected = entry?.source === "user";
	const Logo = def.logo;

	return (
		<button
			type="button"
			disabled={def.comingSoon}
			onClick={onSelect}
			className={`relative flex flex-col items-start gap-3 border p-4 text-left transition-colors ${
				def.comingSoon
					? "cursor-default border-border/60 opacity-50"
					: selected
						? "border-foreground bg-foreground/5"
						: connected
							? "border-foreground/30 hover:border-foreground/60"
							: "border-border hover:border-foreground/40"
			}`}
		>
			{connected && (
				<span className="absolute top-2.5 right-2.5 flex size-4 items-center justify-center rounded-full bg-green-500 text-background">
					<Check size={10} strokeWidth={3} />
				</span>
			)}
			{def.comingSoon && (
				<span className="absolute top-2.5 right-2.5 border border-border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
					Coming soon
				</span>
			)}
			<Logo size={22} className="text-foreground" />
			<div className="min-w-0">
				<p className="text-sm font-medium text-foreground">{def.name}</p>
				<p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
					{def.blurb}
				</p>
				{connected && (
					<p className="mt-1 text-[10px] text-green-600 dark:text-green-500">
						Connected
					</p>
				)}
			</div>
		</button>
	);
}

export function AgentConnectStep() {
	const { data: catalog } = useAgentCatalog();
	const [selectedId, setSelectedId] = useState<string | null>(null);

	const entryFor = (id: string) => catalog?.find((entry) => entry.id === id);
	const selectedEntry = selectedId ? entryFor(selectedId) : undefined;
	const selectedDef = AGENT_CARDS.find((d) => d.id === selectedId);

	return (
		<div>
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
				{AGENT_CARDS.map((def) => (
					<AgentCard
						key={def.id}
						def={def}
						entry={entryFor(def.id)}
						selected={selectedId === def.id}
						onSelect={() =>
							setSelectedId((prev) => (prev === def.id ? null : def.id))
						}
					/>
				))}
			</div>

			<AnimatePresence>
				{selectedDef && selectedEntry && (
					<motion.div
						key={selectedDef.id}
						initial={{ opacity: 0, height: 0 }}
						animate={{ opacity: 1, height: "auto" }}
						exit={{ opacity: 0, height: 0 }}
						transition={{ duration: 0.2 }}
						className="overflow-hidden"
					>
						<div className="mt-4 border border-border bg-muted/30 p-4">
							<div className="mb-1 flex items-center gap-2">
								<selectedDef.logo size={14} className="text-foreground" />
								<p className="text-xs font-medium text-foreground">
									{selectedEntry.source === "user"
										? `Replace ${selectedDef.name} credentials`
										: `Connect ${selectedDef.name}`}
								</p>
							</div>
							<ConnectForm
								entry={selectedEntry}
								onDone={() => setSelectedId(null)}
							/>
						</div>
					</motion.div>
				)}
			</AnimatePresence>

			<p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
				Your agent runs in an isolated cloud sandbox and uses your own
				subscription or API key — Harness brokers your tool configurations to
				it. Credentials are encrypted and write-only. You can always connect or
				change agents later in Settings.
			</p>
		</div>
	);
}
