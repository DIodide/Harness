import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import {
	type AgentCatalogEntry,
	useAgentCatalog,
	useAgentCredentialMutations,
} from "../lib/use-agent-catalog";
import { ClaudeLogo, CursorLogo, OpenAILogo } from "./agent-logos";
import { credentialDisplayName, NewCredentialForm } from "./agent-loop-picker";
import { Button } from "./ui/button";

/**
 * Settings → Agent Credentials: the user's reusable credential library.
 * Credentials are write-only (encrypted server-side); each harness links
 * one in its configuration — connecting an agent to a harness happens in
 * the harness create/edit flow, not here.
 */

const AGENT_LOGOS: Record<
	string,
	(props: { size?: number; className?: string }) => React.ReactNode
> = {
	"claude-code": ClaudeLogo,
	codex: OpenAILogo,
	cursor: CursorLogo,
};

function AgentCredentialGroup({ entry }: { entry: AgentCatalogEntry }) {
	const [adding, setAdding] = useState(false);
	const { invalidateCatalog } = useAgentCredentialMutations();
	const removeFn = useConvexMutation(api.agentCredentials.remove);
	const remove = useMutation({
		mutationFn: removeFn,
		onSuccess: () => {
			toast.success("Credential removed");
			invalidateCatalog();
		},
		onError: (error) =>
			toast.error(error instanceof Error ? error.message : "Remove failed"),
	});
	const Logo = AGENT_LOGOS[entry.id];

	return (
		<div className="min-w-0 py-1.5">
			<div className="flex items-center gap-2">
				{Logo && <Logo size={13} className="shrink-0 text-foreground" />}
				<p className="flex-1 truncate text-xs font-medium text-foreground">
					{entry.name}
				</p>
				{!adding && (
					<Button
						size="sm"
						variant="ghost"
						className="h-6 text-[11px] text-muted-foreground"
						onClick={() => setAdding(true)}
					>
						<Plus size={11} />
						Add
					</Button>
				)}
			</div>

			{entry.credentials.length === 0 && !adding && (
				<p className="mt-1 text-[11px] text-muted-foreground">
					No credentials saved.
				</p>
			)}

			{entry.credentials.length > 0 && (
				<div className="mt-1.5 space-y-1">
					{entry.credentials.map((cred) => (
						<div
							key={cred.credential_id}
							className="flex items-center gap-2 border border-border px-2.5 py-1.5"
						>
							<span className="size-1.5 shrink-0 rounded-full bg-green-500" />
							<span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
								{credentialDisplayName(cred)}
							</span>
							<button
								type="button"
								className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
								title="Remove credential (harnesses using it are unlinked)"
								disabled={remove.isPending}
								onClick={() =>
									remove.mutate({
										credentialId: cred.credential_id as Id<"agentCredentials">,
									})
								}
							>
								<Trash2 size={12} />
							</button>
						</div>
					))}
				</div>
			)}

			{adding && (
				<NewCredentialForm
					agent={entry.id}
					onCreated={() => setAdding(false)}
					onCancel={() => setAdding(false)}
				/>
			)}
		</div>
	);
}

export function AgentConnections() {
	const { data: agents, isLoading, isError } = useAgentCatalog();

	if (isLoading) {
		return (
			<p className="py-1.5 text-[11px] text-muted-foreground">
				Loading credentials…
			</p>
		);
	}
	if (isError || !agents) {
		return (
			<p className="py-1.5 text-[11px] text-muted-foreground">
				Agent gateway unreachable.
			</p>
		);
	}
	return (
		<div className="min-w-0">
			{agents.map((entry) => (
				<AgentCredentialGroup key={entry.id} entry={entry} />
			))}
			<p className="mt-1 text-[10px] text-muted-foreground">
				Credentials are encrypted and write-only. Each harness picks one in its
				configuration; removing a credential unlinks any harnesses using it.
			</p>
		</div>
	);
}
