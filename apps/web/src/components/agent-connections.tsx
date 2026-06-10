import { Bot, Check, Loader2 } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { KIND_OPTIONS } from "../lib/agent-kind-options";
import {
	type AgentCatalogEntry,
	type AgentCredentialKind,
	useAgentCatalog,
	useAgentCredentialMutations,
} from "../lib/use-agent-catalog";
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

export function StatusBadge({ entry }: { entry: AgentCatalogEntry }) {
	if (entry.source === "user") {
		return (
			<span className="flex items-center gap-1 text-[10px] text-green-500">
				<span className="size-1.5 rounded-full bg-green-500" />
				Connected
			</span>
		);
	}
	if (entry.source === "server") {
		return (
			<span className="flex items-center gap-1 text-[10px] text-muted-foreground">
				<span className="size-1.5 rounded-full bg-muted-foreground/50" />
				Server default
			</span>
		);
	}
	return (
		<span className="flex items-center gap-1 text-[10px] text-muted-foreground">
			<span className="size-1.5 rounded-full bg-muted-foreground/30" />
			Not connected
		</span>
	);
}

export function ConnectForm({
	entry,
	onDone,
}: {
	entry: AgentCatalogEntry;
	onDone: () => void;
}) {
	const options = KIND_OPTIONS[entry.id] ?? [];
	const [kind, setKind] = useState<AgentCredentialKind>(options[0].kind);
	const [value, setValue] = useState("");
	const { connect } = useAgentCredentialMutations();
	const selected = options.find((o) => o.kind === kind) ?? options[0];

	const handleSave = () => {
		connect.mutate(
			{ agent: entry.id, kind, value },
			{
				onSuccess: () => {
					toast.success(`${entry.name} connected`);
					setValue("");
					onDone();
				},
				onError: (error) => toast.error(error.message),
			},
		);
	};

	return (
		<div className="mt-2 min-w-0 space-y-2 rounded-md border border-border bg-background/40 p-2">
			<Select
				value={kind}
				onValueChange={(v) => setKind(v as AgentCredentialKind)}
			>
				<SelectTrigger className="h-7 w-full text-xs">
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
			{selected.multiline ? (
				<Textarea
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder='Paste the contents of your auth.json — {"...": "..."}'
					rows={4}
					// field-sizing-fixed: the default field-sizing-content makes the
					// textarea grow to fit pasted auth.json and blow out the dialog.
					className="field-sizing-fixed max-h-32 min-w-0 resize-none overflow-auto font-mono text-[11px] break-all"
				/>
			) : (
				<Input
					type="password"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder="Paste secret"
					autoComplete="off"
					className="h-7 font-mono text-[11px]"
				/>
			)}
			<p className="text-[10px] text-muted-foreground">
				{selected.hint} Stored encrypted; it is never shown again after saving.
			</p>
			<div className="flex gap-2">
				<Button
					size="sm"
					className="h-6 text-[11px]"
					disabled={!value.trim() || connect.isPending}
					onClick={handleSave}
				>
					{connect.isPending ? (
						<Loader2 size={11} className="animate-spin" />
					) : (
						<Check size={11} />
					)}
					Save
				</Button>
				<Button
					size="sm"
					variant="ghost"
					className="h-6 text-[11px] text-muted-foreground"
					onClick={onDone}
				>
					Cancel
				</Button>
			</div>
		</div>
	);
}

function AgentRow({ entry }: { entry: AgentCatalogEntry }) {
	const [editing, setEditing] = useState(false);
	const { disconnect } = useAgentCredentialMutations();

	return (
		<div className="min-w-0 py-1.5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-2">
					<Bot size={13} className="shrink-0 text-muted-foreground" />
					<div className="min-w-0">
						<p className="truncate text-xs font-medium text-foreground">
							{entry.name}
						</p>
						<StatusBadge entry={entry} />
					</div>
				</div>
				<div className="flex shrink-0 gap-1">
					{entry.source === "user" && !editing && (
						<Button
							size="sm"
							variant="ghost"
							className="h-6 text-[11px] text-muted-foreground hover:text-destructive"
							disabled={disconnect.isPending}
							onClick={() =>
								disconnect.mutate(entry.id, {
									onSuccess: () => toast.success(`${entry.name} disconnected`),
									onError: (error) => toast.error(error.message),
								})
							}
						>
							Disconnect
						</Button>
					)}
					{!editing && (
						<Button
							size="sm"
							variant="outline"
							className="h-6 text-[11px]"
							onClick={() => setEditing(true)}
						>
							{entry.source === "user" ? "Replace" : "Connect"}
						</Button>
					)}
				</div>
			</div>
			{editing && (
				<ConnectForm entry={entry} onDone={() => setEditing(false)} />
			)}
		</div>
	);
}

/**
 * Settings section for connecting external ACP agents (Codex CLI, Claude
 * Code). Secrets are write-only: encrypted by the backend, stored as
 * ciphertext in Convex, and used only when spawning the user's agent.
 */
export function AgentConnections() {
	const { data: agents, isLoading, isError } = useAgentCatalog();

	if (isLoading) {
		return (
			<p className="py-1.5 text-[11px] text-muted-foreground">
				Loading agents…
			</p>
		);
	}
	if (isError || !agents) {
		return (
			<p className="py-1.5 text-[11px] text-muted-foreground">
				Agent gateway unavailable.
			</p>
		);
	}
	return (
		<div className="min-w-0">
			{agents.map((entry) => (
				<AgentRow key={entry.id} entry={entry} />
			))}
			<p className="mt-1 text-[10px] text-muted-foreground">
				External agents run in isolated sandboxes and bill usage to your own
				account — Harness budgets don't apply.
			</p>
		</div>
	);
}
