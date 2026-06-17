import { useAuth, useUser } from "@clerk/tanstack-react-start";
import { useCallback, useRef, useState } from "react";
import { env } from "../env";
import {
	type AgentMode,
	type AgentPermissionRequest,
	type AgentPlanEntry,
	type AgentQuestionRequest,
	ensureAgentSession,
	forgetAgentSession,
} from "./agent-mode";
import { checkChatRateLimit } from "./chat-ratelimit";
import { buildAcpImageBlocks } from "./multimodal";

const FASTAPI_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";

export interface ToolCallEvent {
	tool: string;
	arguments: Record<string, unknown>;
	call_id: string;
	result?: string;
	/** ACP tool kind (execute|read|edit|...) for agent built-ins. */
	kind?: string;
	locations?: Array<{ path?: string }>;
	/** Set when a background/sub agent made this call (nest under parent). */
	parentId?: string | null;
	/** Tool-call status (in_progress|completed|failed). */
	status?: string | null;
	/** MCP server this tool belongs to (parsed from mcp__server__tool). */
	serverName?: string | null;
}

/** Message-boundary metadata on agent text/thought chunks. */
export interface ChunkMeta {
	messageId?: string | null;
	parentId?: string | null;
}

/** Live context/cost usage from the user's own agent account. */
export interface AgentUsage {
	used: number | null;
	size: number | null;
	cost: number | null;
	currency: string;
}

export interface ToolDiff {
	path?: string | null;
	oldText?: string | null;
	newText?: string | null;
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
	kind?: string;
	locations?: Array<{ path?: string }>;
	diff?: ToolDiff | null;
	messageId?: string | null;
	parentId?: string | null;
	/** Tool-call status; "failed" drives destructive styling. */
	status?: string | null;
	/** Process exit code for command/terminal tool calls. */
	exitCode?: number | null;
	/** MCP server attribution. */
	serverName?: string | null;
}

export interface ConvoStreamState {
	content: string | null;
	reasoning: string | null;
	toolCalls: ToolCallEvent[];
	parts: StreamPart[];
	pendingDoneContent: string | null;
	usage: UsageData | null;
	model: string | null;
	/** ACP agent mode: friendly gateway status ("Starting Codex sandbox…"). */
	agentStatus: string | null;
	/** ACP agent mode: latest plan snapshot from the agent. */
	plan: AgentPlanEntry[] | null;
	/** ACP agent mode: live context/cost usage (user's own account). */
	agentUsage: AgentUsage | null;
}

export interface BudgetExceededInfo {
	dailyPct: number;
	weeklyPct: number;
	dailyReset: string;
	weeklyReset: string;
}

interface UseChatStreamCallbacks {
	onToken: (conversationId: string, content: string, meta?: ChunkMeta) => void;
	onThinking: (
		conversationId: string,
		content: string,
		meta?: ChunkMeta,
	) => void;
	onToolCall: (conversationId: string, event: ToolCallEvent) => void;
	onToolResult: (
		conversationId: string,
		event: {
			call_id: string;
			result: string;
			diff?: ToolDiff | null;
			status?: string | null;
			/** Live terminal stream: append output_delta instead of replacing. */
			append?: boolean;
			output_delta?: string;
			exit_code?: number | null;
			/** Late-arriving full tool input (e.g. Workflow script). */
			arguments?: Record<string, unknown> | null;
		},
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
	onSandboxStatus?: (
		conversationId: string,
		event: { sandbox_id: string; status: string },
	) => void;
	onError: (conversationId: string, error: string) => void;
	onBudgetExceeded?: (conversationId: string, info: BudgetExceededInfo) => void;
	onAbort?: (conversationId: string) => void;
	/** ACP agent mode: the agent is waiting for a tool-use approval. */
	onPermissionRequest?: (
		conversationId: string,
		sessionId: string,
		request: AgentPermissionRequest,
	) => void;
	/** ACP agent mode: a pending permission request was resolved. */
	onPermissionResolved?: (conversationId: string, requestId: string) => void;
	/** ACP agent mode: gateway status (provisioning, ready, ...). */
	onAgentStatus?: (
		conversationId: string,
		data: { state?: string; agent?: string },
	) => void;
	/** ACP agent mode: agent plan snapshot. */
	onPlan?: (conversationId: string, entries: AgentPlanEntry[]) => void;
	/** ACP agent mode: context window + cost from the user's own account. */
	onAgentUsage?: (conversationId: string, usage: AgentUsage) => void;
	/** ACP agent mode: session config/commands/mode changed server-side. */
	onAgentSessionChanged?: (conversationId: string) => void;
	/** ACP agent mode: the agent asked the user a structured question. */
	onQuestionRequest?: (
		conversationId: string,
		sessionId: string,
		request: AgentQuestionRequest,
	) => void;
	/** ACP agent mode: a pending question was answered or timed out. */
	onQuestionResolved?: (conversationId: string, requestId: string) => void;
}

export type MessageContent = string | Array<Record<string, unknown>>;

export interface ChatStreamRequest {
	messages: Array<{ role: string; content: MessageContent }>;
	harness: {
		model: string;
		mcp_servers: Array<{
			name: string;
			url: string;
			auth_type: "none" | "bearer" | "oauth" | "tiger_junction";
			auth_token?: string;
		}>;
		skills: Array<{ name: string; description: string }>;
		name: string;
		harness_id?: string;
		system_prompt?: string;
		sandbox_enabled?: boolean;
		sandbox_id?: string;
		sandbox_config?: {
			persistent: boolean;
			auto_start: boolean;
			default_language: string;
			resource_tier: string;
		};
	};
	conversation_id: string;
	forced_tool?: string;
	/**
	 * External ACP agent ("codex", "claude-code"). Omitted or "default" uses
	 * the Harness-provided OpenRouter loop. In agent mode, usage is billed to
	 * the user's own agent account — no OpenRouter usage tracking applies.
	 */
	agent?: AgentMode;
}

/**
 * Strip stream-only fields (messageId, locations, diff) and map camelCase
 * parentId to the persisted parent_id before writing parts to Convex —
 * the message validators reject unknown fields.
 */
export function toPersistableParts(parts: StreamPart[]): Array<{
	type: "text" | "reasoning" | "tool_call";
	content?: string;
	tool?: string;
	arguments?: Record<string, unknown>;
	call_id?: string;
	result?: string;
	kind?: string;
	parent_id?: string;
	status?: string;
	exit_code?: number;
	server_name?: string;
}> {
	return parts.map((part) => ({
		type: part.type,
		...(part.content !== undefined ? { content: part.content } : {}),
		...(part.tool !== undefined ? { tool: part.tool } : {}),
		...(part.arguments !== undefined ? { arguments: part.arguments } : {}),
		...(part.call_id !== undefined ? { call_id: part.call_id } : {}),
		...(part.result !== undefined ? { result: part.result } : {}),
		...(part.kind !== undefined ? { kind: part.kind } : {}),
		...(part.parentId ? { parent_id: part.parentId } : {}),
		...(part.status ? { status: part.status } : {}),
		...(part.exitCode !== undefined && part.exitCode !== null
			? { exit_code: part.exitCode }
			: {}),
		...(part.serverName ? { server_name: part.serverName } : {}),
	}));
}

function extractText(content: MessageContent): string {
	if (typeof content === "string") return content;
	return content
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text as string)
		.join("\n");
}

/** Minimal SSE reader shared by the agent-mode stream. */
async function consumeSse(
	response: Response,
	onEvent: (event: string, data: Record<string, unknown>) => void,
): Promise<void> {
	if (!response.body) throw new Error("Response body is null");
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
				try {
					onEvent(currentEvent, JSON.parse(line.slice(6)));
				} catch {
					// Skip malformed JSON lines
				}
				currentEvent = "message";
			}
		}
	}
}

/** One prompt turn against the ACP agent gateway (/api/agents). */
async function runAgentStream(
	body: ChatStreamRequest,
	token: string | null,
	controller: AbortController,
	cbRef: { current: UseChatStreamCallbacks },
): Promise<void> {
	const cb = new Proxy({} as UseChatStreamCallbacks, {
		get: (_target, prop) => cbRef.current[prop as keyof UseChatStreamCallbacks],
	});
	const convoId = body.conversation_id;
	const agent = body.agent as AgentMode;
	const messages = body.messages;
	const last = messages[messages.length - 1];
	const message = last ? extractText(last.content) : "";
	// Image attachments become ACP image blocks (base64); the gateway drops
	// them for agents without promptCapabilities.image.
	const blocks = last ? await buildAcpImageBlocks(last.content) : [];
	const history = messages.slice(0, -1).map((m) => ({
		role: m.role,
		content: extractText(m.content),
	}));

	const prompt = async (sessionId: string) =>
		fetch(`${FASTAPI_URL}/api/agents/sessions/${sessionId}/prompt`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body: JSON.stringify({
				message,
				history,
				...(blocks.length > 0 ? { blocks } : {}),
			}),
			signal: controller.signal,
		});

	// On a cold start the sandbox provision (~30s) happens BEFORE the prompt
	// SSE opens, so the gateway's own "provisioning" status frame can't reach
	// us yet. ensureAgentSession fires onProvisioning exactly when it's about
	// to pay a cold start (a new OR recreated session) — surface the honest
	// "Starting… up to ~30s" copy then; a warm reuse stays silent.
	const onProvisioning = () =>
		cb.onAgentStatus?.(convoId, { state: "provisioning", agent });

	let sessionId = await ensureAgentSession(
		token,
		agent,
		body.harness as never,
		convoId,
		controller.signal,
		onProvisioning,
	);
	let response = await prompt(sessionId);
	if (response.status === 404) {
		// Session was reaped or the gateway restarted — recreate once.
		forgetAgentSession(convoId, agent);
		sessionId = await ensureAgentSession(
			token,
			agent,
			body.harness as never,
			convoId,
			controller.signal,
			onProvisioning,
		);
		response = await prompt(sessionId);
	}
	if (!response.ok) {
		throw new Error((await response.text()) || `HTTP ${response.status}`);
	}

	let finished = false;
	await consumeSse(response, (event, data) => {
		if (event === "done" || event === "error") finished = true;
		switch (event) {
			case "token":
				cb.onToken(convoId, data.content as string, {
					messageId: (data.message_id ?? null) as string | null,
					parentId: (data.parent_id ?? null) as string | null,
				});
				break;
			case "thinking":
				cb.onThinking(convoId, data.content as string, {
					messageId: (data.message_id ?? null) as string | null,
					parentId: (data.parent_id ?? null) as string | null,
				});
				break;
			case "tool_call":
				cb.onToolCall(convoId, {
					tool: data.tool as string,
					arguments: (data.arguments ?? {}) as Record<string, unknown>,
					call_id: data.call_id as string,
					kind: (data.kind ?? "other") as string,
					locations: (data.locations ?? []) as Array<{ path?: string }>,
					parentId: (data.parent_id ?? null) as string | null,
					status: (data.status ?? null) as string | null,
					serverName: (data.server_name ?? null) as string | null,
				});
				break;
			case "tool_result":
				cb.onToolResult(convoId, {
					call_id: data.call_id as string,
					result: (data.result ?? "") as string,
					diff: (data.diff ?? null) as ToolDiff | null,
					status: (data.status ?? null) as string | null,
					append: Boolean(data.append),
					output_delta: (data.output_delta ?? "") as string,
					exit_code: (data.exit_code ?? null) as number | null,
					arguments: (data.arguments ?? null) as Record<string, unknown> | null,
				});
				break;
			case "permission_request":
				cb.onPermissionRequest?.(
					convoId,
					sessionId,
					data as unknown as AgentPermissionRequest,
				);
				break;
			case "permission_resolved":
				cb.onPermissionResolved?.(convoId, data.request_id as string);
				break;
			case "question_request":
				cb.onQuestionRequest?.(
					convoId,
					sessionId,
					data as unknown as AgentQuestionRequest,
				);
				break;
			case "question_resolved":
				cb.onQuestionResolved?.(convoId, data.request_id as string);
				break;
			case "question_answered": {
				// Surface the Q→A exchange as a transcript part (same shape the
				// backend persists), via the existing tool-call plumbing.
				const callId = data.call_id as string;
				const qa = (data.qa ?? []) as Array<{ q: string; a: string }>;
				cb.onToolCall(convoId, {
					tool: (data.message ?? "Question") as string,
					arguments: { qa, action: data.action },
					call_id: callId,
					kind: "ask_user",
				});
				cb.onToolResult(convoId, {
					call_id: callId,
					result: qa.length
						? qa.map((e) => `${e.q} → ${e.a}`).join("\n")
						: data.action !== "cancel"
							? "Skipped"
							: "Dismissed",
					diff: null,
				});
				break;
			}
			case "status":
				cb.onAgentStatus?.(convoId, data as { state?: string; agent?: string });
				break;
			case "plan":
				cb.onPlan?.(convoId, (data.entries ?? []) as AgentPlanEntry[]);
				break;
			case "agent_usage":
				cb.onAgentUsage?.(convoId, {
					used: (data.used ?? null) as number | null,
					size: (data.size ?? null) as number | null,
					cost: (data.cost ?? null) as number | null,
					currency: (data.currency ?? "USD") as string,
				});
				break;
			case "done":
				cb.onDone(
					convoId,
					data.content as string,
					undefined, // usage is user-side in agent mode
					data.model as string,
				);
				break;
			case "error":
				cb.onError(convoId, data.message as string);
				break;
			case "config_update":
			case "commands_update":
			case "mode_update":
				// Session-level state changed (agent switched mode itself, new
				// slash commands, ...) — composer selectors refresh from the
				// session endpoint.
				cb.onAgentSessionChanged?.(convoId);
				break;
		}
	});

	// The connection closed without the turn concluding (server restart,
	// proxy drop, network blip). Say so instead of silently stopping. We
	// can't re-attach to the still-running turn yet, so don't promise it —
	// if the agent is still working, the next send may report "a turn is
	// already in progress"; otherwise it starts fresh.
	if (!finished) {
		cb.onError(
			convoId,
			"The connection to the agent dropped before its turn finished. " +
				"It may still be working in its sandbox — wait a moment, or press " +
				"Stop and try again.",
		);
	}
}

export function useChatStream(callbacks: UseChatStreamCallbacks) {
	const [streamingConvoIds, setStreamingConvoIds] = useState<Set<string>>(
		() => new Set(),
	);
	const abortControllers = useRef<Map<string, AbortController>>(new Map());
	const { getToken } = useAuth();
	const { user } = useUser();
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
				// Arcjet pre-flight request rate check (fail-open: Arcjet outage must not block chat)
				if (user?.id) {
					try {
						const rateCheck = await checkChatRateLimit({
							data: { userId: user.id },
						});
						if (!rateCheck.allowed) {
							cbRef.current.onError(
								convoId,
								`Too many requests. Please wait ${rateCheck.retryAfter ?? "a few"} seconds.`,
							);
							return;
						}
					} catch {
						// Arcjet unreachable — allow the request through.
						// Budget enforcement in FastAPI/Convex is the hard gate.
					}
				}

				const token = await getToken({ template: "convex" });

				// External ACP agent path (Codex CLI, Claude Code, ...).
				if (body.agent && body.agent !== "default") {
					await runAgentStream(body, token, controller, cbRef);
					return;
				}

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
									case "sandbox_status":
										cbRef.current.onSandboxStatus?.(convoId, data);
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
										if (
											data.code === "BUDGET_EXCEEDED" &&
											data.usage &&
											cbRef.current.onBudgetExceeded
										) {
											cbRef.current.onBudgetExceeded(
												convoId,
												data.usage as BudgetExceededInfo,
											);
										} else {
											cbRef.current.onError(convoId, data.message);
										}
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
		[getToken, user?.id],
	);

	const cancel = useCallback((conversationId: string) => {
		abortControllers.current.get(conversationId)?.abort();
	}, []);

	return { stream, streamingConvoIds, cancel };
}
