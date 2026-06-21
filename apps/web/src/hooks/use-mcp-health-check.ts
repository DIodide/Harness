import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import type { HealthStatus } from "../components/mcp-server-status";
import { env } from "../env";
import type { McpAuthType } from "../lib/mcp";

const FASTAPI_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";

type McpServer = {
	name: string;
	url: string;
	authType: McpAuthType;
	authToken?: string;
};

/**
 * Health-checks a harness's MCP servers — on harness/URL-set change and on
 * demand via `refreshHealth`. Shared by the /chat and /workspaces routes (the
 * block was previously copy-pasted byte-for-byte in both). The keyed effect
 * re-runs only when the harness id or its set of server URLs changes, so routine
 * harness edits (name, model) don't trigger a re-check.
 */
export function useMcpHealthCheck(
	activeHarness: { _id: Id<"harnesses">; mcpServers: McpServer[] } | undefined,
): {
	mcpHealthStatuses: Record<string, HealthStatus>;
	refreshHealth: () => void;
} {
	const { getToken } = useAuth();
	const [mcpHealthStatuses, setMcpHealthStatuses] = useState<
		Record<string, HealthStatus>
	>({});

	const healthCheckRunRef = useRef<{ cancel: () => void } | null>(null);
	const runHealthCheck = useCallback(
		(servers: McpServer[]) => {
			healthCheckRunRef.current?.cancel();

			if (servers.length === 0) {
				setMcpHealthStatuses({});
				return;
			}

			// Mark unknown URLs as checking; preserve already-known statuses so
			// previously-healthy servers don't flash to "Checking…" during a
			// refresh triggered by adding/removing a server.
			setMcpHealthStatuses((prev) => {
				const next: Record<string, HealthStatus> = {};
				for (const s of servers) {
					next[s.url] = prev[s.url] ?? "checking";
				}
				return next;
			});

			let cancelled = false;
			const run = async () => {
				try {
					const token = await getToken();
					const res = await fetch(`${FASTAPI_URL}/api/mcp/health/check`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							...(token ? { Authorization: `Bearer ${token}` } : {}),
						},
						body: JSON.stringify({
							mcp_servers: servers.map((s) => ({
								name: s.name,
								url: s.url,
								auth_type: s.authType,
								...(s.authToken ? { auth_token: s.authToken } : {}),
							})),
							force: true,
						}),
					});
					if (cancelled) return;
					if (!res.ok) {
						const fallback: Record<string, HealthStatus> = {};
						for (const s of servers) fallback[s.url] = "unreachable";
						setMcpHealthStatuses(fallback);
						return;
					}
					const data = await res.json();
					if (cancelled) return;
					const statuses: Record<string, HealthStatus> = {};
					for (const server of data.servers) {
						if (server.status === "ok") statuses[server.url] = "reachable";
						else if (server.status === "auth_required")
							statuses[server.url] = "auth_required";
						else statuses[server.url] = "unreachable";
					}
					setMcpHealthStatuses(statuses);
				} catch {
					if (cancelled) return;
					const fallback: Record<string, HealthStatus> = {};
					for (const s of servers) fallback[s.url] = "unreachable";
					setMcpHealthStatuses(fallback);
				}
			};

			run();
			healthCheckRunRef.current = {
				cancel: () => {
					cancelled = true;
				},
			};
		},
		[getToken],
	);

	const refreshHealth = useCallback(() => {
		if (activeHarness) runHealthCheck(activeHarness.mcpServers);
	}, [activeHarness, runHealthCheck]);

	// Re-run when the harness or its set of MCP server URLs changes. The URL
	// key catches inline adds/removes from the header tooltip without making
	// every harness-doc edit (name, model, etc.) trigger a health re-check.
	const mcpUrlKey = activeHarness?.mcpServers.map((s) => s.url).join("|") ?? "";
	// biome-ignore lint/correctness/useExhaustiveDependencies: deps are id + url-set; runHealthCheck is stable
	useEffect(() => {
		if (!activeHarness) {
			setMcpHealthStatuses({});
			return;
		}
		runHealthCheck(activeHarness.mcpServers);
		return () => {
			healthCheckRunRef.current?.cancel();
		};
	}, [activeHarness?._id, mcpUrlKey]);

	return { mcpHealthStatuses, refreshHealth };
}
