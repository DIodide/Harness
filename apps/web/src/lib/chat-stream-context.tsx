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
