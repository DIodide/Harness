import { useAuth } from "@clerk/tanstack-react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type AgentCommand,
	type AgentConfigOption,
	type AgentMode,
	fetchAgentSession,
	getCachedAgentSessionId,
	setAgentConfigOption,
} from "./agent-mode";

interface SessionConfig {
	sessionId: string | null;
	options: AgentConfigOption[];
	commands: AgentCommand[];
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
			if (!conversationId)
				return { sessionId: null, options: [], commands: [] };
			const sessionId = getCachedAgentSessionId(conversationId, agent);
			if (!sessionId) return { sessionId: null, options: [], commands: [] };
			const token = await getToken({ template: "convex" });
			const info = await fetchAgentSession(token, sessionId);
			return {
				sessionId,
				options: info?.config_options ?? [],
				commands: info?.available_commands ?? [],
			};
		},
		// Until the session exists and reports options/commands, check again
		// shortly — they appear after the first message (sandbox provisioning
		// included). Once present, live refresh happens via stream events.
		refetchInterval: (q) =>
			enabled &&
			(q.state.data?.options?.length ?? 0) === 0 &&
			(q.state.data?.commands?.length ?? 0) === 0
				? 5000
				: false,
	});

	const setOption = useMutation({
		mutationFn: async (input: { configId: string; value: string }) => {
			// Resolve the LIVE session id at call time — query.data.sessionId
			// goes stale when the session is recreated/stolen (warm reuse),
			// which made model/mode switches POST to a dead session → 404.
			const sessionId = conversationId
				? getCachedAgentSessionId(conversationId, agent)
				: null;
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
				commands: prev?.commands ?? [],
			}));
		},
	});

	return {
		options: query.data?.options ?? [],
		commands: query.data?.commands ?? [],
		sessionReady: Boolean(query.data?.sessionId),
		setOption,
	};
}
