import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { Link } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { useMemo } from "react";
import toast from "react-hot-toast";
import {
	useWorkspaceCredentialAssignments,
	useWorkspaceCredentialMutations,
	useWorkspaceCredentials,
} from "../hooks/use-workspace-credentials";
import { Checkbox } from "./ui/checkbox";

/**
 * Assign/unassign env-var credentials to a workspace. Toggling fires the Convex
 * mutation immediately (assignments are reactive — no separate Save), so
 * revoking a credential takes effect at once for new runs.
 */
export function WorkspaceCredentialsField({
	workspaceId,
}: {
	workspaceId: Id<"workspaces">;
}) {
	const { data: credentials, isLoading } = useWorkspaceCredentials();
	const { data: assigned } = useWorkspaceCredentialAssignments(workspaceId);
	const { assign, unassign } = useWorkspaceCredentialMutations();

	const assignedIds = useMemo(
		() => new Set((assigned ?? []).map((c) => c._id)),
		[assigned],
	);

	const toggle = async (
		credentialId: Id<"workspaceCredentials">,
		next: boolean,
	) => {
		try {
			if (next) {
				await assign.mutateAsync({ credentialId, workspaceId });
			} else {
				await unassign.mutateAsync({ credentialId, workspaceId });
			}
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not update assignment",
			);
		}
	};

	return (
		<div className="space-y-1.5">
			<div className="flex items-center justify-between">
				<p className="text-xs font-medium text-foreground">Credentials</p>
				<Link
					to="/credentials"
					className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
				>
					Manage
				</Link>
			</div>
			{isLoading ? (
				<p className="text-[11px] text-muted-foreground">Loading…</p>
			) : !credentials || credentials.length === 0 ? (
				<p className="text-[11px] text-muted-foreground">
					No credentials yet.{" "}
					<Link
						to="/credentials"
						className="underline underline-offset-2 hover:text-foreground"
					>
						Create one
					</Link>{" "}
					to inject env vars into this workspace's sandbox.
				</p>
			) : (
				<div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-1.5">
					{credentials.map((cred) => {
						const checked = assignedIds.has(cred._id);
						const id = `cred-assign-${cred._id}`;
						return (
							<label
								key={cred._id}
								htmlFor={id}
								className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-muted/50"
							>
								<Checkbox
									id={id}
									checked={checked}
									disabled={assign.isPending || unassign.isPending}
									onCheckedChange={(value) => toggle(cred._id, value === true)}
								/>
								<KeyRound
									size={12}
									className="shrink-0 text-muted-foreground"
								/>
								<span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
									{cred.name}
								</span>
								{cred.label && (
									<span className="shrink-0 truncate text-[10px] text-muted-foreground">
										{cred.label}
									</span>
								)}
							</label>
						);
					})}
				</div>
			)}
		</div>
	);
}
