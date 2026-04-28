import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
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
}

const ChatStreamContext = createContext<ChatStreamContextValue | null>(null);

const SideEffectsRefContext =
	createContext<React.MutableRefObject<ChatStreamSideEffects> | null>(null);

export function ChatStreamProvider({ children }: { children: ReactNode }) {
	const [streamStates, setStreamStates] = useState<
		Record<string, ConvoStreamState>
	>({});
	const streamStatesRef = useRef(streamStates);
	useEffect(() => {
		streamStatesRef.current = streamStates;
	}, [streamStates]);

	const sideEffectsRef = useRef<ChatStreamSideEffects>({});

	const chatStream = useChatStream({
		onToken: (convoId, content) => {
			setStreamStates((prev) => {
				const state = prev[convoId] ?? EMPTY_STREAM_STATE;
				const parts = [...state.parts];
				const last = parts[parts.length - 1];
				if (last?.type === "text") {
					parts[parts.length - 1] = {
						...last,
						content: (last.content ?? "") + content,
					};
				} else {
					parts.push({ type: "text", content } as StreamPart);
				}
				return {
					...prev,
					[convoId]: {
						...state,
						content: (state.content ?? "") + content,
						parts,
					},
				};
			});
		},
		onThinking: (convoId, content) => {
			setStreamStates((prev) => {
				const state = prev[convoId] ?? EMPTY_STREAM_STATE;
				const parts = [...state.parts];
				const last = parts[parts.length - 1];
				if (last?.type === "reasoning") {
					parts[parts.length - 1] = {
						...last,
						content: (last.content ?? "") + content,
					};
				} else {
					parts.push({ type: "reasoning", content } as StreamPart);
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
							},
						],
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
								? { ...p, result: event.result }
								: p,
						),
					},
				};
			});
		},
		onMcpError: (convoId, event) => {
			sideEffectsRef.current.onMcpError?.(convoId, event);
		},
		onSandboxStatus: (convoId, event) => {
			sideEffectsRef.current.onSandboxStatus?.(convoId, event);
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
				},
			}));
			sideEffectsRef.current.onDone?.(convoId, fullContent, usage, model);
		},
		onBudgetExceeded: (convoId, info) => {
			sideEffectsRef.current.onBudgetExceeded?.(convoId, info);
		},
		onError: (convoId, message) => {
			setStreamStates((prev) => {
				const next = { ...prev };
				delete next[convoId];
				return next;
			});
			sideEffectsRef.current.onError?.(convoId, message);
		},
		onAbort: (convoId) => {
			sideEffectsRef.current.onAbort?.(convoId);
		},
	});

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
		}),
		[
			streamStates,
			chatStream.streamingConvoIds,
			chatStream.stream,
			chatStream.cancel,
			clearStreamState,
			setStreamState,
		],
	);

	return (
		<ChatStreamContext.Provider value={value}>
			<SideEffectsRefContext.Provider value={sideEffectsRef}>
				{children}
			</SideEffectsRefContext.Provider>
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
	const ref = useContext(SideEffectsRefContext);
	if (!ref) {
		throw new Error(
			"useChatStreamSideEffects must be used within ChatStreamProvider",
		);
	}
	useEffect(() => {
		ref.current = effects;
		return () => {
			ref.current = {};
		};
	}, [ref, effects]);
}
