import { useAuth } from "@clerk/tanstack-react-start";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "@tanstack/react-query";
import { env } from "../env";

const FASTAPI_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";

/** One stored workspace credential (metadata only — values are write-only). */
export interface WorkspaceCredentialMeta {
	_id: Id<"workspaceCredentials">;
	name: string;
	label?: string;
	createdAt: number;
	lastUsedAt?: number;
	/** How many workspaces this credential is assigned to. */
	workspaceCount: number;
}

/**
 * All of the current user's workspace credentials (metadata only; reactive via
 * Convex). Secrets are never returned to the browser.
 */
export function useWorkspaceCredentials() {
	return useQuery(convexQuery(api.workspaceCredentials.listMine, {}));
}

/** The credential ids/names assigned to a single workspace (reactive). */
export function useWorkspaceCredentialAssignments(
	workspaceId: Id<"workspaces"> | undefined,
) {
	return useQuery({
		...convexQuery(
			api.workspaceCredentials.listForWorkspace,
			workspaceId ? { workspaceId } : "skip",
		),
		enabled: !!workspaceId,
	});
}

/**
 * Create or rotate a workspace credential (write-only; encrypted server-side).
 * Without credentialId a credential is upserted by name; with one the secret
 * is rotated in place. Resolves to the credential id.
 *
 * Deletion and assignment go through the Convex mutations below
 * (user-authenticated); those are reactive so no manual invalidation is needed.
 */
export function useSaveWorkspaceCredential() {
	const { getToken } = useAuth();
	return useMutation({
		mutationFn: async (input: {
			name: string;
			value: string;
			label?: string;
			credential_id?: string;
		}): Promise<string> => {
			const token = await getToken({ template: "convex" });
			const response = await fetch(`${FASTAPI_URL}/api/credentials`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify(input),
			});
			if (!response.ok) {
				const detail = await response.text();
				let message = detail;
				try {
					message =
						(JSON.parse(detail) as { detail?: string }).detail ?? detail;
				} catch {
					// keep raw text
				}
				throw new Error(message || `HTTP ${response.status}`);
			}
			const payload = (await response.json()) as { credential_id: string };
			return payload.credential_id;
		},
	});
}

/** Convex mutations for managing workspace credentials + assignments. */
export function useWorkspaceCredentialMutations() {
	const remove = useMutation({
		mutationFn: useConvexMutation(api.workspaceCredentials.remove),
	});
	const assign = useMutation({
		mutationFn: useConvexMutation(api.workspaceCredentials.assign),
	});
	const unassign = useMutation({
		mutationFn: useConvexMutation(api.workspaceCredentials.unassign),
	});
	return { remove, assign, unassign };
}
