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
	type AgentQuestionAction,
	type AgentQuestionRequest,
	agentStatusLabel,
	answerAgentPermission,
	answerAgentQuestion,
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

// Mirror of the backend cap (routes/agents.py _MAX_TOOL_RESULT_CHARS): keep a
// runaway terminal stream from bloating the persisted message past Convex's
// document limit.
const MAX_TOOL_RESULT_CHARS = 256_000;

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

export interface PendingAgentQuestion {
	sessionId: string;
	request: AgentQuestionRequest;
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
	/** ACP agent mode: pending tool-approvals per conversation (FIFO —
	 * agents can issue parallel tool calls, each awaiting its own answer;
	 * a single slot would clobber all but the latest). */
	pendingPermissions: Record<string, PendingAgentPermission[]>;
	answerPermission: (
		conversationId: string,
		optionId: string | null,
	) => Promise<void>;
	/** ACP agent mode: pending agent questions per conversation (FIFO). */
	pendingQuestions: Record<string, PendingAgentQuestion[]>;
	answerQuestion: (
		conversationId: string,
		action: AgentQuestionAction,
		content?: Record<string, string | string[] | boolean>,
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
		Record<string, PendingAgentPermission[]>
	>({});
	const [pendingQuestions, setPendingQuestions] = useState<
		Record<string, PendingAgentQuestion[]>
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
								status: event.status ?? null,
								serverName: event.serverName ?? null,
							},
						],
						agentStatus: null,
					},
				};
			});
		},
		onToolResult: (convoId, event) => {
			// Two modes:
			// - append: live terminal stream — concatenate output_delta onto
			//   the call's result, record exit_code/status, never replace.
			// - replace: status-only progress must not blank a result an
			//   earlier update delivered; a truthy result marks it finished.
			const append = Boolean(event.append);
			const overwrite =
				!append &&
				(Boolean(event.result) ||
					event.status === "completed" ||
					event.status === "failed");
			// Late-arriving full tool input (e.g. the Workflow script) merges
			// onto the args the streaming tool_call didn't have yet.
			const mergedArgs =
				event.arguments && Object.keys(event.arguments).length > 0
					? (p: StreamPart) => ({
							...(p.arguments ?? {}),
							...event.arguments,
						})
					: null;
			const capResult = (s: string) =>
				s.length > MAX_TOOL_RESULT_CHARS
					? `…[earlier output truncated]\n${s.slice(-MAX_TOOL_RESULT_CHARS)}`
					: s;
			const patchPart = (p: StreamPart): StreamPart => {
				if (append) {
					return {
						...p,
						result: event.output_delta
							? capResult((p.result ?? "") + event.output_delta)
							: p.result,
						...(event.exit_code !== null && event.exit_code !== undefined
							? { exitCode: event.exit_code }
							: {}),
						...(event.status ? { status: event.status } : {}),
						...(mergedArgs ? { arguments: mergedArgs(p) } : {}),
					};
				}
				return {
					...p,
					...(overwrite ? { result: event.result } : {}),
					diff: event.diff ?? p.diff,
					...(event.status ? { status: event.status } : {}),
					...(mergedArgs ? { arguments: mergedArgs(p) } : {}),
				};
			};
			setStreamStates((prev) => {
				const state = prev[convoId] ?? EMPTY_STREAM_STATE;
				return {
					...prev,
					[convoId]: {
						...state,
						toolCalls: state.toolCalls.map((tc) =>
							tc.call_id === event.call_id && overwrite
								? { ...tc, result: event.result }
								: tc,
						),
						parts: state.parts.map((p) =>
							p.type === "tool_call" && p.call_id === event.call_id
								? patchPart(p)
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
				[convoId]: [
					...(prev[convoId] ?? []).filter(
						(p) => p.request.request_id !== request.request_id,
					),
					{ sessionId, request },
				],
			}));
		},
		onPermissionResolved: (convoId, requestId) => {
			setPendingPermissions((prev) => {
				const queue = prev[convoId];
				if (!queue?.some((p) => p.request.request_id === requestId)) {
					return prev;
				}
				const remaining = queue.filter(
					(p) => p.request.request_id !== requestId,
				);
				const next = { ...prev };
				if (remaining.length > 0) next[convoId] = remaining;
				else delete next[convoId];
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
			setStreamStates((prev) => {
				// Claude (TodoWrite) and Codex re-emit the full plan repeatedly,
				// often unchanged — skip the setState when it's identical to
				// avoid redundant re-renders of the plan card.
				const current = prev[convoId]?.plan;
				if (
					current &&
					current.length === entries.length &&
					current.every(
						(e, i) =>
							e.content === entries[i].content &&
							e.status === entries[i].status,
					)
				) {
					return prev;
				}
				return {
					...prev,
					[convoId]: {
						...(prev[convoId] ?? EMPTY_STREAM_STATE),
						plan: entries,
					},
				};
			});
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
		onQuestionRequest: (convoId, sessionId, request) => {
			setPendingQuestions((prev) => ({
				...prev,
				[convoId]: [
					...(prev[convoId] ?? []).filter(
						(q) => q.request.request_id !== request.request_id,
					),
					{ sessionId, request },
				],
			}));
		},
		onQuestionResolved: (convoId, requestId) => {
			setPendingQuestions((prev) => {
				const queue = prev[convoId];
				if (!queue?.some((q) => q.request.request_id === requestId)) {
					return prev;
				}
				const remaining = queue.filter(
					(q) => q.request.request_id !== requestId,
				);
				const next = { ...prev };
				if (remaining.length > 0) next[convoId] = remaining;
				else delete next[convoId];
				return next;
			});
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

	const answerQuestion = useCallback(
		async (
			conversationId: string,
			action: AgentQuestionAction,
			content?: Record<string, string | string[] | boolean>,
		) => {
			const pending = pendingQuestions[conversationId]?.[0];
			if (!pending) return;
			setPendingQuestions((prev) => {
				const remaining = (prev[conversationId] ?? []).filter(
					(q) => q.request.request_id !== pending.request.request_id,
				);
				const next = { ...prev };
				if (remaining.length > 0) next[conversationId] = remaining;
				else delete next[conversationId];
				return next;
			});
			try {
				const token = await getToken({ template: "convex" });
				await answerAgentQuestion(
					token,
					pending.sessionId,
					pending.request.request_id,
					action,
					content,
				);
			} catch (err) {
				toast.error(
					err instanceof Error ? err.message : "Failed to send answer",
				);
			}
		},
		[pendingQuestions, getToken],
	);

	const answerPermission = useCallback(
		async (conversationId: string, optionId: string | null) => {
			const pending = pendingPermissions[conversationId]?.[0];
			if (!pending) return;
			setPendingPermissions((prev) => {
				const remaining = (prev[conversationId] ?? []).filter(
					(p) => p.request.request_id !== pending.request.request_id,
				);
				const next = { ...prev };
				if (remaining.length > 0) next[conversationId] = remaining;
				else delete next[conversationId];
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
			pendingQuestions,
			answerQuestion,
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
			pendingQuestions,
			answerQuestion,
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
