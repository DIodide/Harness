import { useAuth } from "@clerk/tanstack-react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { env } from "../env";
import type { AgentMode } from "./agent-mode";

const FASTAPI_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";

export type AgentCredentialKind = "auth_json" | "api_key" | "oauth_token";

export interface AgentCatalogEntry {
	id: Exclude<AgentMode, "default">;
	name: string;
	available: boolean;
	/** "user" = connected in settings, "server" = deployment fallback. */
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

/** Catalog of external ACP agents with per-user connection status. */
export function useAgentCatalog() {
	const { getToken, isSignedIn } = useAuth();
	return useQuery({
		queryKey: ["agent-catalog"],
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

/** Store (write-only) or remove a per-user agent credential. */
export function useAgentCredentialMutations() {
	const { getToken } = useAuth();
	const queryClient = useQueryClient();
	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: ["agent-catalog"] });

	const connect = useMutation({
		mutationFn: async (input: {
			agent: string;
			kind: AgentCredentialKind;
			value: string;
			label?: string;
		}) => {
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
		},
		onSuccess: invalidate,
	});

	const disconnect = useMutation({
		mutationFn: async (agent: string) => {
			const token = await getToken({ template: "convex" });
			const response = await authedFetch(token, `/credentials/${agent}`, {
				method: "DELETE",
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
		},
		onSuccess: invalidate,
	});

	return { connect, disconnect };
}
