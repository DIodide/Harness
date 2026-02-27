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

interface UseChatStreamCallbacks {
	onToken: (content: string) => void;
	onToolCall: (event: ToolCallEvent) => void;
	onToolResult: (event: { call_id: string; result: string }) => void;
	onDone: (fullContent: string) => void;
	onError: (error: string) => void;
}

export interface ChatStreamRequest {
	messages: Array<{ role: string; content: string }>;
	harness: { model: string; mcps: string[]; name: string };
	conversation_id: string;
}

export function useChatStream(callbacks: UseChatStreamCallbacks) {
	const [isStreaming, setIsStreaming] = useState(false);
	const abortRef = useRef<AbortController | null>(null);
	const { getToken } = useAuth();
	// Store callbacks in a ref to avoid re-creating the stream function
	const cbRef = useRef(callbacks);
	cbRef.current = callbacks;

	const stream = useCallback(
		async (body: ChatStreamRequest) => {
			setIsStreaming(true);
			abortRef.current = new AbortController();

			try {
				const token = await getToken();
				const response = await fetch(`${FASTAPI_URL}/api/chat/stream`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...(token ? { Authorization: `Bearer ${token}` } : {}),
					},
					body: JSON.stringify(body),
					signal: abortRef.current.signal,
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
					// Keep the last potentially incomplete line in the buffer
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
										cbRef.current.onToken(data.content);
										break;
									case "tool_call":
										cbRef.current.onToolCall(data);
										break;
									case "tool_result":
										cbRef.current.onToolResult(data);
										break;
									case "done":
										cbRef.current.onDone(data.content);
										break;
									case "error":
										cbRef.current.onError(data.message);
										break;
								}
							} catch {
								// Skip malformed JSON lines
							}
							// Reset event type after processing data
							currentEvent = "message";
						}
					}
				}
			} catch (err: unknown) {
				if (err instanceof Error && err.name !== "AbortError") {
					cbRef.current.onError(err.message);
				}
			} finally {
				setIsStreaming(false);
			}
		},
		[getToken],
	);

	const cancel = useCallback(() => {
		abortRef.current?.abort();
	}, []);

	return { stream, isStreaming, cancel };
}
