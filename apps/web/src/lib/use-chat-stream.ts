import { useAuth } from "@clerk/tanstack-react-start";
import { useCallback, useRef, useState } from "react";
import { env } from "../env";

const FASTAPI_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";

export interface ToolCallEvent {
	tool: string;
	arguments: Record<string, unknown>;
	call_id: string;
	result?: string;
}

export interface UsageData {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	cost?: number;
}

export interface StreamPart {
	type: "text" | "reasoning" | "tool_call";
	content?: string;
	tool?: string;
	arguments?: Record<string, unknown>;
	call_id?: string;
	result?: string;
}

export interface ConvoStreamState {
	content: string | null;
	reasoning: string | null;
	toolCalls: ToolCallEvent[];
	parts: StreamPart[];
	pendingDoneContent: string | null;
	usage: UsageData | null;
	model: string | null;
}

interface UseChatStreamCallbacks {
	onToken: (conversationId: string, content: string) => void;
	onThinking: (conversationId: string, content: string) => void;
	onToolCall: (conversationId: string, event: ToolCallEvent) => void;
	onToolResult: (
		conversationId: string,
		event: { call_id: string; result: string },
	) => void;
	onDone: (
		conversationId: string,
		fullContent: string,
		usage?: UsageData,
		model?: string,
	) => void;
	onMcpError: (
		conversationId: string,
		event: { server_name: string; server_url: string; reason: string },
	) => void;
	onError: (conversationId: string, error: string) => void;
	onAbort?: (conversationId: string) => void;
}

export interface ChatStreamRequest {
	messages: Array<{ role: string; content: string }>;
	harness: {
		model: string;
		mcp_servers: Array<{
			name: string;
			url: string;
			auth_type: "none" | "bearer" | "oauth";
			auth_token?: string;
		}>;
		name: string;
		skills: string[];
	};
	conversation_id: string;
}

export function useChatStream(callbacks: UseChatStreamCallbacks) {
	const [streamingConvoIds, setStreamingConvoIds] = useState<Set<string>>(
		() => new Set(),
	);
	const abortControllers = useRef<Map<string, AbortController>>(new Map());
	const { getToken } = useAuth();
	const cbRef = useRef(callbacks);
	cbRef.current = callbacks;

	const stream = useCallback(
		async (body: ChatStreamRequest) => {
			const convoId = body.conversation_id;

			// Abort any existing stream for this conversation
			abortControllers.current.get(convoId)?.abort();

			const controller = new AbortController();
			abortControllers.current.set(convoId, controller);
			setStreamingConvoIds((prev) => new Set(prev).add(convoId));

			try {
				const token = await getToken();
				const response = await fetch(`${FASTAPI_URL}/api/chat/stream`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...(token ? { Authorization: `Bearer ${token}` } : {}),
					},
					body: JSON.stringify(body),
					signal: controller.signal,
				});

				if (!response.ok) {
					const text = await response.text();
					throw new Error(text || `HTTP ${response.status}`);
				}

				if (!response.body) {
					throw new Error("Response body is null");
				}
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";
				let currentEvent = "message";

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";

					for (const line of lines) {
						if (line.startsWith("event: ")) {
							currentEvent = line.slice(7).trim();
							continue;
						}

						if (line.startsWith("data: ")) {
							const raw = line.slice(6);
							try {
								const data = JSON.parse(raw);
								switch (currentEvent) {
									case "token":
										cbRef.current.onToken(convoId, data.content);
										break;
									case "thinking":
										cbRef.current.onThinking(convoId, data.content);
										break;
									case "tool_call":
										cbRef.current.onToolCall(convoId, data);
										break;
									case "tool_result":
										cbRef.current.onToolResult(convoId, data);
										break;
									case "mcp_error":
										cbRef.current.onMcpError(convoId, data);
										break;
									case "done":
										cbRef.current.onDone(
											convoId,
											data.content,
											data.usage,
											data.model,
										);
										break;
									case "error":
										cbRef.current.onError(convoId, data.message);
										break;
								}
							} catch {
								// Skip malformed JSON lines
							}
							currentEvent = "message";
						}
					}
				}
			} catch (err: unknown) {
				if (err instanceof Error && err.name === "AbortError") {
					cbRef.current.onAbort?.(convoId);
				} else if (err instanceof Error) {
					cbRef.current.onError(convoId, err.message);
				}
			} finally {
				abortControllers.current.delete(convoId);
				setStreamingConvoIds((prev) => {
					const next = new Set(prev);
					next.delete(convoId);
					return next;
				});
			}
		},
		[getToken],
	);

	const cancel = useCallback((conversationId: string) => {
		abortControllers.current.get(conversationId)?.abort();
	}, []);

	return { stream, streamingConvoIds, cancel };
}
