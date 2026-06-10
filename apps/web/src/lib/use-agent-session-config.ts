import { useAuth } from "@clerk/tanstack-react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type AgentConfigOption,
	type AgentMode,
	fetchAgentSession,
	getCachedAgentSessionId,
	setAgentConfigOption,
} from "./agent-mode";

interface SessionConfig {
	sessionId: string | null;
	options: AgentConfigOption[];
}

/**
 * Live ACP session config options (model, mode, ...) for the conversation's
 * agent session. Polls briefly until the session exists (it is created on
 * the first send), then settles.
 */
export function useAgentSessionConfig(
	conversationId: string | null,
	agent: AgentMode,
) {
	const { getToken } = useAuth();
	const queryClient = useQueryClient();
	const enabled = agent !== "default" && conversationId !== null;
	const queryKey = ["agent-session-config", conversationId, agent];

	const query = useQuery({
		queryKey,
		enabled,
		queryFn: async (): Promise<SessionConfig> => {
			if (!conversationId) return { sessionId: null, options: [] };
			const sessionId = getCachedAgentSessionId(conversationId, agent);
			if (!sessionId) return { sessionId: null, options: [] };
			const token = await getToken({ template: "convex" });
			const info = await fetchAgentSession(token, sessionId);
			return {
				sessionId,
				options: info?.config_options ?? [],
			};
		},
		// Until the session exists and reports options, check again shortly —
		// it appears after the first message (sandbox provisioning included).
		refetchInterval: (q) =>
			enabled && (q.state.data?.options?.length ?? 0) === 0 ? 5000 : false,
	});

	const setOption = useMutation({
		mutationFn: async (input: { configId: string; value: string }) => {
			const sessionId = query.data?.sessionId;
			if (!sessionId) throw new Error("Agent session not started yet");
			const token = await getToken({ template: "convex" });
			return setAgentConfigOption(
				token,
				sessionId,
				input.configId,
				input.value,
			);
		},
		onSuccess: (options) => {
			queryClient.setQueryData(queryKey, (prev: SessionConfig | undefined) => ({
				sessionId: prev?.sessionId ?? null,
				options,
			}));
		},
	});

	return {
		options: query.data?.options ?? [],
		sessionReady: Boolean(query.data?.sessionId),
		setOption,
	};
}
