import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { env } from "../env";
import type { AgentMode } from "./agent-mode";

const FASTAPI_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";

export type AgentCredentialKind = "auth_json" | "api_key" | "oauth_token";

/** One stored credential (metadata only — secrets are write-only). */
export interface AgentCredentialMeta {
	credential_id: string;
	kind: AgentCredentialKind;
	label: string | null;
	created_at: number | null;
}

export interface AgentCatalogEntry {
	id: Exclude<AgentMode, "default">;
	name: string;
	available: boolean;
	/** Models selectable for harnesses on this agent. */
	models: string[];
	/** All stored credentials for this agent, newest first. */
	credentials: AgentCredentialMeta[];
	/** "user" when at least one credential exists. */
	source: "user" | "server" | null;
	kind: AgentCredentialKind | null;
	connected_at: number | null;
	unavailable_reason: string | null;
}

async function authedFetch(
	token: string | null,
	path: string,
	init?: RequestInit,
): Promise<Response> {
	return fetch(`${FASTAPI_URL}/api/agents${path}`, {
		...init,
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(init?.headers ?? {}),
		},
	});
}

export const AGENT_CATALOG_QUERY_KEY = ["agent-catalog"] as const;

/** Catalog of external ACP agents with per-user credentials + models. */
export function useAgentCatalog() {
	const { getToken, isSignedIn } = useAuth();
	return useQuery({
		queryKey: AGENT_CATALOG_QUERY_KEY,
		enabled: isSignedIn === true,
		staleTime: 30_000,
		queryFn: async (): Promise<AgentCatalogEntry[]> => {
			const token = await getToken({ template: "convex" });
			const response = await authedFetch(token, "");
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const payload = (await response.json()) as {
				agents: AgentCatalogEntry[];
			};
			return payload.agents;
		},
	});
}

/**
 * Store a per-user agent credential (write-only; encrypted server-side).
 * Without credential_id a new credential is created — users keep several
 * per agent (work/personal) and link one per harness. With credential_id
 * the existing secret is replaced. Resolves to the credential id.
 *
 * Deletion goes through the Convex `agentCredentials.remove` mutation
 * (user-authenticated; it also unlinks any harnesses using it).
 */
export function useAgentCredentialMutations() {
	const { getToken } = useAuth();
	const queryClient = useQueryClient();
	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: AGENT_CATALOG_QUERY_KEY });

	const connect = useMutation({
		mutationFn: async (input: {
			agent: string;
			kind: AgentCredentialKind;
			value: string;
			label?: string;
			credential_id?: string;
		}): Promise<string> => {
			const token = await getToken({ template: "convex" });
			const response = await authedFetch(token, "/credentials", {
				method: "POST",
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
		onSuccess: invalidate,
	});

	return { connect, invalidateCatalog: invalidate };
}
