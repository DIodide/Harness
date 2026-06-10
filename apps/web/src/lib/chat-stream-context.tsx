import { useAuth } from "@clerk/tanstack-react-start";
import { useQueryClient } from "@tanstack/react-query";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import toast from "react-hot-toast";
import {
	type AgentPermissionRequest,
	agentStatusLabel,
	answerAgentPermission,
} from "./agent-mode";
import {
	type BudgetExceededInfo,
	type ChatStreamRequest,
	type ConvoStreamState,
	type StreamPart,
	type ToolCallEvent,
	type UsageData,
	useChatStream,
} from "./use-chat-stream";

export const EMPTY_STREAM_STATE: ConvoStreamState = {
	content: null,
	reasoning: null,
	toolCalls: [],
	parts: [],
	pendingDoneContent: null,
	usage: null,
	model: null,
	agentStatus: null,
	plan: null,
	agentUsage: null,
};

interface ChatStreamSideEffects {
	onDone?: (
		conversationId: string,
		fullContent: string,
		usage: UsageData | undefined,
		model: string | undefined,
	) => void;
	onAbort?: (conversationId: string) => void;
	onError?: (conversationId: string, message: string) => void;
	onMcpError?: (
		conversationId: string,
		event: { server_name: string; server_url: string; reason: string },
	) => void;
	onBudgetExceeded?: (conversationId: string, info: BudgetExceededInfo) => void;
	onSandboxStatus?: (
		conversationId: string,
		event: { sandbox_id: string; status: string },
	) => void;
}

export interface PendingAgentPermission {
	sessionId: string;
	request: AgentPermissionRequest;
}

interface ChatStreamContextValue {
	streamStates: Record<string, ConvoStreamState>;
	streamStatesRef: React.MutableRefObject<Record<string, ConvoStreamState>>;
	streamingConvoIds: Set<string>;
	stream: (body: ChatStreamRequest) => Promise<void>;
	cancel: (conversationId: string) => void;
	clearStreamState: (conversationId: string) => void;
	setStreamState: (
		conversationId: string,
		updater: (state: ConvoStreamState) => ConvoStreamState,
	) => void;
	/** ACP agent mode: pending tool-approval per conversation. */
	pendingPermissions: Record<string, PendingAgentPermission>;
	answerPermission: (
		conversationId: string,
		optionId: string | null,
	) => Promise<void>;
}

const ChatStreamContext = createContext<ChatStreamContextValue | null>(null);

type SideEffectsRegistry = Map<
	string,
	React.MutableRefObject<ChatStreamSideEffects>
>;

const SideEffectsRegistryContext =
	createContext<React.MutableRefObject<SideEffectsRegistry> | null>(null);

export function ChatStreamProvider({ children }: { children: ReactNode }) {
	const [streamStates, setStreamStates] = useState<
		Record<string, ConvoStreamState>
	>({});
	const streamStatesRef = useRef(streamStates);
	streamStatesRef.current = streamStates;

	const sideEffectsRegistryRef = useRef<SideEffectsRegistry>(new Map());
	const { getToken } = useAuth();
	const queryClient = useQueryClient();
	const [pendingPermissions, setPendingPermissions] = useState<
		Record<string, PendingAgentPermission>
	>({});

	const dispatchSideEffect = useCallback(
		<K extends keyof ChatStreamSideEffects>(
			key: K,
			invoke: (handler: NonNullable<ChatStreamSideEffects[K]>) => void,
		) => {
			for (const ref of sideEffectsRegistryRef.current.values()) {
				const handler = ref.current[key];
				if (handler) invoke(handler as NonNullable<ChatStreamSideEffects[K]>);
			}
		},
		[],
	);

	const chatStream = useChatStream({
		onToken: (convoId, content, meta) => {
			setStreamStates((prev) => {
				const state = prev[convoId] ?? EMPTY_STREAM_STATE;
				const parts = [...state.parts];
				const last = parts[parts.length - 1];
				// Distinct ACP messageIds (e.g. before/after a background task
				// completes) become distinct parts instead of one merged blob.
				const sameMessage =
					last?.type === "text" &&
					(last.messageId ?? null) === (meta?.messageId ?? null);
				if (sameMessage && last) {
					parts[parts.length - 1] = {
						...last,
						content: (last.content ?? "") + content,
					};
				} else {
					parts.push({
						type: "text",
						content,
						messageId: meta?.messageId ?? null,
						parentId: meta?.parentId ?? null,
					} as StreamPart);
				}
				return {
					...prev,
					[convoId]: {
						...state,
						content: (state.content ?? "") + content,
						parts,
						agentStatus: null,
					},
				};
			});
		},
		onThinking: (convoId, content, meta) => {
			setStreamStates((prev) => {
				const state = prev[convoId] ?? EMPTY_STREAM_STATE;
				const parts = [...state.parts];
				const last = parts[parts.length - 1];
				const sameMessage =
					last?.type === "reasoning" &&
					(last.messageId ?? null) === (meta?.messageId ?? null);
				if (sameMessage && last) {
					parts[parts.length - 1] = {
						...last,
						content: (last.content ?? "") + content,
					};
				} else {
					parts.push({
						type: "reasoning",
						content,
						messageId: meta?.messageId ?? null,
						parentId: meta?.parentId ?? null,
					} as StreamPart);
				}
				return {
					...prev,
					[convoId]: {
						...state,
						reasoning: (state.reasoning ?? "") + content,
						parts,
					},
				};
			});
		},
		onToolCall: (convoId, event: ToolCallEvent) => {
			setStreamStates((prev) => {
				const state = prev[convoId] ?? EMPTY_STREAM_STATE;
				return {
					...prev,
					[convoId]: {
						...state,
						toolCalls: [...state.toolCalls, event],
						parts: [
							...state.parts,
							{
								type: "tool_call" as const,
								tool: event.tool,
								arguments: event.arguments,
								call_id: event.call_id,
								kind: event.kind,
								locations: event.locations,
								parentId: event.parentId ?? null,
							},
						],
						agentStatus: null,
					},
				};
			});
		},
		onToolResult: (convoId, event) => {
			setStreamStates((prev) => {
				const state = prev[convoId] ?? EMPTY_STREAM_STATE;
				return {
					...prev,
					[convoId]: {
						...state,
						toolCalls: state.toolCalls.map((tc) =>
							tc.call_id === event.call_id
								? { ...tc, result: event.result }
								: tc,
						),
						parts: state.parts.map((p) =>
							p.type === "tool_call" && p.call_id === event.call_id
								? { ...p, result: event.result, diff: event.diff ?? p.diff }
								: p,
						),
					},
				};
			});
		},
		onMcpError: (convoId, event) => {
			dispatchSideEffect("onMcpError", (h) => h(convoId, event));
		},
		onSandboxStatus: (convoId, event) => {
			dispatchSideEffect("onSandboxStatus", (h) => h(convoId, event));
		},
		onDone: (convoId, fullContent, usage, model) => {
			setStreamStates((prev) => ({
				...prev,
				[convoId]: {
					content: prev[convoId]?.content ?? fullContent,
					reasoning: prev[convoId]?.reasoning ?? null,
					toolCalls: prev[convoId]?.toolCalls ?? [],
					parts: prev[convoId]?.parts ?? [],
					pendingDoneContent: fullContent,
					usage: usage ?? prev[convoId]?.usage ?? null,
					model: model ?? prev[convoId]?.model ?? null,
					agentStatus: null,
					plan: null,
					agentUsage: prev[convoId]?.agentUsage ?? null,
				},
			}));
			dispatchSideEffect("onDone", (h) =>
				h(convoId, fullContent, usage, model),
			);
		},
		onBudgetExceeded: (convoId, info) => {
			dispatchSideEffect("onBudgetExceeded", (h) => h(convoId, info));
		},
		onError: (convoId, message) => {
			setStreamStates((prev) => {
				const next = { ...prev };
				delete next[convoId];
				return next;
			});
			dispatchSideEffect("onError", (h) => h(convoId, message));
		},
		onAbort: (convoId) => {
			dispatchSideEffect("onAbort", (h) => h(convoId));
		},
		onPermissionRequest: (convoId, sessionId, request) => {
			setPendingPermissions((prev) => ({
				...prev,
				[convoId]: { sessionId, request },
			}));
		},
		onPermissionResolved: (convoId, requestId) => {
			setPendingPermissions((prev) => {
				if (prev[convoId]?.request.request_id !== requestId) return prev;
				const next = { ...prev };
				delete next[convoId];
				return next;
			});
		},
		onAgentStatus: (convoId, data) => {
			setStreamStates((prev) => ({
				...prev,
				[convoId]: {
					...(prev[convoId] ?? EMPTY_STREAM_STATE),
					agentStatus: agentStatusLabel(data),
				},
			}));
		},
		onPlan: (convoId, entries) => {
			setStreamStates((prev) => ({
				...prev,
				[convoId]: {
					...(prev[convoId] ?? EMPTY_STREAM_STATE),
					plan: entries,
				},
			}));
		},
		onAgentUsage: (convoId, usage) => {
			setStreamStates((prev) => ({
				...prev,
				[convoId]: {
					...(prev[convoId] ?? EMPTY_STREAM_STATE),
					agentUsage: usage,
				},
			}));
		},
		onAgentSessionChanged: (convoId) => {
			// The agent changed its own session state (mode flip from an
			// "always allow" approval, plan-mode exit, new slash commands).
			// Refresh the composer's selectors/menu from the session endpoint.
			queryClient.invalidateQueries({
				queryKey: ["agent-session-config", convoId],
			});
		},
	});

	const answerPermission = useCallback(
		async (conversationId: string, optionId: string | null) => {
			const pending = pendingPermissions[conversationId];
			if (!pending) return;
			setPendingPermissions((prev) => {
				const next = { ...prev };
				delete next[conversationId];
				return next;
			});
			try {
				const token = await getToken({ template: "convex" });
				await answerAgentPermission(
					token,
					pending.sessionId,
					pending.request.request_id,
					optionId,
				);
			} catch (err) {
				toast.error(
					err instanceof Error ? err.message : "Failed to send approval",
				);
			}
		},
		[pendingPermissions, getToken],
	);

	const clearStreamState = useCallback((convoId: string) => {
		setStreamStates((prev) => {
			const next = { ...prev };
			delete next[convoId];
			return next;
		});
	}, []);

	const setStreamState = useCallback(
		(
			convoId: string,
			updater: (state: ConvoStreamState) => ConvoStreamState,
		) => {
			setStreamStates((prev) => ({
				...prev,
				[convoId]: updater(prev[convoId] ?? EMPTY_STREAM_STATE),
			}));
		},
		[],
	);

	const value = useMemo<ChatStreamContextValue>(
		() => ({
			streamStates,
			streamStatesRef,
			streamingConvoIds: chatStream.streamingConvoIds,
			stream: chatStream.stream,
			cancel: chatStream.cancel,
			clearStreamState,
			setStreamState,
			pendingPermissions,
			answerPermission,
		}),
		[
			streamStates,
			chatStream.streamingConvoIds,
			chatStream.stream,
			chatStream.cancel,
			clearStreamState,
			setStreamState,
			pendingPermissions,
			answerPermission,
		],
	);

	return (
		<ChatStreamContext.Provider value={value}>
			<SideEffectsRegistryContext.Provider value={sideEffectsRegistryRef}>
				{children}
			</SideEffectsRegistryContext.Provider>
		</ChatStreamContext.Provider>
	);
}

export function useChatStreamContext() {
	const ctx = useContext(ChatStreamContext);
	if (!ctx) {
		throw new Error(
			"useChatStreamContext must be used within ChatStreamProvider",
		);
	}
	return ctx;
}

export function useChatStreamSideEffects(effects: ChatStreamSideEffects) {
	const registry = useContext(SideEffectsRegistryContext);
	if (!registry) {
		throw new Error(
			"useChatStreamSideEffects must be used within ChatStreamProvider",
		);
	}
	const id = useId();
	const effectsRef = useRef(effects);
	effectsRef.current = effects;

	useEffect(() => {
		const map = registry.current;
		map.set(id, effectsRef);
		return () => {
			map.delete(id);
		};
	}, [registry, id]);
}
