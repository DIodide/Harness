import { useAuth, useClerk, useUser } from "@clerk/tanstack-react-start";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import { usePaginatedQuery } from "convex/react";
import {
	AlertTriangle,
	ArrowUp,
	Brain,
	Check,
	ChevronDown,
	ChevronRight,
	Cpu,
	Loader2,
	LogOut,
	MessageSquare,
	Mic,
	PanelLeftClose,
	PanelLeftOpen,
	Paperclip,
	Plus,
	Search, // Icon for search
	Settings,
	SlidersHorizontal,
	Sparkles,
	Square,
	Trash2,
	User,
	Wrench,
	X,
	Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import React, {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import toast from "react-hot-toast";
import { AttachmentChip } from "../../components/attachment-chip";
import { HarnessMark } from "../../components/harness-mark";
import { MarkdownMessage } from "../../components/markdown-message";
import {
	type HealthStatus,
	McpServerStatus,
	OAuthReconnectPrompt,
	parseAuthRequiredError,
} from "../../components/mcp-server-status";
import {
	type DisplayMode,
	MessageActions,
} from "../../components/message-actions";
import { MessageAttachments } from "../../components/message-attachments";
import { SandboxPanel } from "../../components/sandbox/sandbox-panel";
import { SandboxResult } from "../../components/sandbox-result";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "../../components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Input } from "../../components/ui/input"; // reuse input from components
import { ScrollArea } from "../../components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../components/ui/select";
import { Separator } from "../../components/ui/separator";
import { Skeleton } from "../../components/ui/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "../../components/ui/tooltip";
import { env } from "../../env";
import { useFileAttachments } from "../../hooks/use-file-attachments";
import type { McpAuthType } from "../../lib/mcp";
import {
	acceptString,
	allowedMimeTypes,
	MODELS,
	modelSupportsAudio,
	modelSupportsMedia,
} from "../../lib/models";
import { buildMultimodalContent } from "../../lib/multimodal";
import {
	SandboxPanelProvider,
	useSandboxPanel,
} from "../../lib/sandbox-panel-context";
import type { SkillEntry } from "../../lib/skills";
import {
	type ConvoStreamState,
	type StreamPart,
	type ToolCallEvent,
	type UsageData,
	useChatStream,
} from "../../lib/use-chat-stream";
import { cn } from "../../lib/utils";

export const Route = createFileRoute("/chat/")({
	validateSearch: (search: Record<string, unknown>) => ({
		harnessId: (search.harnessId as string) ?? undefined,
	}),
	beforeLoad: ({ context }) => {
		if (!context.userId) {
			throw redirect({ to: "/sign-in" });
		}
	},
	component: ChatPage,
});

const FASTAPI_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";

const SUGGESTED_PROMPTS = [
	"Help me write a Python script to process CSV files",
	"Explain how WebSockets work in simple terms",
	"Review my API design and suggest improvements",
	"Create a deployment checklist for production",
];

const EMPTY_STREAM_STATE: ConvoStreamState = {
	content: null,
	reasoning: null,
	toolCalls: [],
	parts: [],
	pendingDoneContent: null,
	usage: null,
	model: null,
};

function ChatPage() {
	const navigate = useNavigate();
	const { getToken } = useAuth();
	const { harnessId: initialHarnessId } = Route.useSearch();

	const { data: harnesses, isLoading: harnessesLoading } = useQuery(
		convexQuery(api.harnesses.list, {}),
	);
	const { data: conversations } = useQuery(
		convexQuery(api.conversations.list, {}),
	);
	const { data: userSettings } = useQuery(
		convexQuery(api.userSettings.get, {}),
	);

	const [activeHarnessId, setActiveHarnessId] =
		useState<Id<"harnesses"> | null>(null);
	const [activeConvoId, setActiveConvoId] =
		useState<Id<"conversations"> | null>(null);
	// Session-only model override — does not persist to the harness
	const [sessionModel, setSessionModel] = useState<string | null>(null);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
	const [editingMessageId, setEditingMessageId] =
		useState<Id<"messages"> | null>(null);
	const [editingContent, setEditingContent] = useState("");

	// Per-conversation streaming state
	const [streamStates, setStreamStates] = useState<
		Record<string, ConvoStreamState>
	>({});
	const streamStatesRef = useRef(streamStates);
	useEffect(() => {
		streamStatesRef.current = streamStates;
	}, [streamStates]);

	// MCP server failures reported during stream start
	type McpFailure = {
		id: number;
		serverName: string;
		serverUrl: string;
		reason: string;
	};
	const [mcpFailures, setMcpFailures] = useState<McpFailure[]>([]);
	const mcpFailureIdRef = useRef(0);

	// MCP server health check statuses (keyed by server URL)
	const [mcpHealthStatuses, setMcpHealthStatuses] = useState<
		Record<string, HealthStatus>
	>({});

	// Track conversations that just finished streaming (show green checkmark briefly)
	const [doneConvoIds, setDoneConvoIds] = useState<Set<string>>(new Set());
	const prevStreamingRef = useRef<Set<string>>(new Set());

	// Lift messages query to ChatPage for queue processing
	const { data: activeMessages } = useQuery(
		convexQuery(
			api.messages.list,
			activeConvoId ? { conversationId: activeConvoId } : "skip",
		),
	);
	const activeMessagesRef = useRef(activeMessages);
	useEffect(() => {
		activeMessagesRef.current = activeMessages;
	}, [activeMessages]);

	// Message queue state
	type QueueItem = { id: number; content: string };
	const [messageQueue, setMessageQueue] = useState<QueueItem[]>([]);
	const messageQueueRef = useRef<QueueItem[]>([]);
	const queueIdCounter = useRef(0);
	const pendingQueueSendRef = useRef<{
		convoId: string;
		content: string;
	} | null>(null);

	const enqueueMessage = useCallback((content: string) => {
		const item: QueueItem = { id: ++queueIdCounter.current, content };
		messageQueueRef.current = [...messageQueueRef.current, item];
		setMessageQueue([...messageQueueRef.current]);
	}, []);

	const dequeueMessage = useCallback((index: number) => {
		messageQueueRef.current = messageQueueRef.current.filter(
			(_, i) => i !== index,
		);
		setMessageQueue([...messageQueueRef.current]);
	}, []);

	const shiftQueue = useCallback(() => {
		const [next, ...rest] = messageQueueRef.current;
		messageQueueRef.current = rest;
		setMessageQueue(rest);
		return next?.content;
	}, []);

	// Clear queue and MCP failures on conversation switch
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally resets queue when active conversation changes
	useEffect(() => {
		messageQueueRef.current = [];
		setMessageQueue([]);
		pendingQueueSendRef.current = null;
		setMcpFailures([]);
	}, [activeConvoId]);

	// Save interrupted assistant message from frontend
	const saveInterruptedMsg = useMutation({
		mutationFn: useConvexMutation(api.messages.saveInterruptedMessage),
	});

	// Save user message (used for queue processing)
	const sendMessageFromQueue = useMutation({
		mutationFn: useConvexMutation(api.messages.send),
	});

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
					parts.push({ type: "text", content });
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
					parts.push({ type: "reasoning", content });
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
		onToolCall: (convoId, event) => {
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
		onMcpError: (_convoId, event) => {
			setMcpFailures((prev) => [
				...prev,
				{
					id: ++mcpFailureIdRef.current,
					serverName: event.server_name,
					serverUrl: event.server_url,
					reason: event.reason,
				},
			]);
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
		},
		onError: (convoId, error) => {
			toast.error(error);
			setStreamStates((prev) => {
				const next = { ...prev };
				delete next[convoId];
				return next;
			});
		},
		onAbort: (convoId) => {
			const state = streamStatesRef.current[convoId];

			// If onDone already fired (pendingDoneContent is set), the backend already
			// saved the message — don't save a duplicate interrupted copy.
			if (
				state?.pendingDoneContent !== null &&
				state?.pendingDoneContent !== undefined
			) {
				// Just process queued messages if any
				if (
					!pendingQueueSendRef.current &&
					messageQueueRef.current.length > 0
				) {
					const next = shiftQueue();
					if (next) {
						pendingQueueSendRef.current = { convoId, content: next };
					}
				}
				return;
			}

			if (
				!state ||
				(!state.content && !state.reasoning && state.toolCalls.length === 0)
			) {
				// Nothing accumulated — just clear state
				setStreamStates((prev) => {
					const next = { ...prev };
					delete next[convoId];
					return next;
				});
			} else {
				// Filter: only keep completed tool calls (those with results)
				const completedToolCalls = state.toolCalls.filter(
					(tc) => tc.result,
				) as Array<{
					tool: string;
					arguments: Record<string, unknown>;
					call_id: string;
					result: string;
				}>;
				const cleanedParts = state.parts.filter(
					(p) => p.type !== "tool_call" || p.result,
				);

				const partialContent = state.content ?? "";
				// model is only sent in the "done" event which doesn't fire on abort,
				// so fall back to the session model, then the harness model
				const model = state.model ?? sessionModel ?? activeHarness?.model ?? null;

				saveInterruptedMsg.mutate({
					conversationId: convoId as Id<"conversations">,
					content: partialContent,
					...(state.reasoning ? { reasoning: state.reasoning } : {}),
					...(completedToolCalls.length > 0
						? { toolCalls: completedToolCalls }
						: {}),
					...(cleanedParts.length > 0 ? { parts: cleanedParts } : {}),
					...(state.usage ? { usage: state.usage } : {}),
					...(model ? { model } : {}),
				});

				// Keep streaming bubble visible until Convex syncs the interrupted message
				// (same pattern as onDone — set pendingDoneContent so convexHasMessage can match)
				setStreamStates((prev) => ({
					...prev,
					[convoId]: {
						...state,
						toolCalls: completedToolCalls,
						parts: cleanedParts,
						pendingDoneContent: partialContent,
						model,
					},
				}));
			}

			// Process next queued message if any (skip if handleSendNow already set one)
			if (!pendingQueueSendRef.current && messageQueueRef.current.length > 0) {
				const next = shiftQueue();
				if (next) {
					pendingQueueSendRef.current = { convoId, content: next };
				}
			}
		},
	});

	useEffect(() => {
		if (!harnesses || harnesses.length === 0) return;

		// If current selection is valid, keep it
		if (activeHarnessId && harnesses.some((h) => h._id === activeHarnessId)) {
			return;
		}

		// Prefer the harness ID from the URL search param (e.g. after creating one)
		if (initialHarnessId && harnesses.some((h) => h._id === initialHarnessId)) {
			setActiveHarnessId(initialHarnessId as Id<"harnesses">);
			return;
		}

		// Fall back to a started harness, then the first one
		const started = harnesses.find((h) => h.status === "started");
		setActiveHarnessId(started?._id ?? harnesses[0]._id);
	}, [harnesses, activeHarnessId, initialHarnessId]);

	// Reset session model whenever the active harness or conversation changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on harness/conversation switch
	useEffect(() => {
		setSessionModel(null);
	}, [activeHarnessId, activeConvoId]);

	useEffect(() => {
		if (harnesses && harnesses.length === 0) {
			navigate({ to: "/onboarding" });
		}
	}, [harnesses, navigate]);

	useEffect(() => {
		const prev = prevStreamingRef.current;
		const curr = chatStream.streamingConvoIds;

		for (const id of prev) {
			if (!curr.has(id)) {
				setDoneConvoIds((s) => new Set(s).add(id));
				setTimeout(() => {
					setDoneConvoIds((s) => {
						const next = new Set(s);
						next.delete(id);
						return next;
					});
				}, 800);
			}
		}

		prevStreamingRef.current = new Set(curr);
	}, [chatStream.streamingConvoIds]);

	const handleStreamSynced = useCallback(
		(convoId: string) => {
			setStreamStates((prev) => {
				const next = { ...prev };
				delete next[convoId];
				return next;
			});

			// Process next queued message now that Convex has synced
			if (messageQueueRef.current.length > 0) {
				const next = shiftQueue();
				if (next) {
					pendingQueueSendRef.current = { convoId, content: next };
				}
			}
		},
		[shiftQueue],
	);

	const activeHarness = harnesses?.find((h) => h._id === activeHarnessId);

	// Health-check MCP servers when harness changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: only re-run when harness ID changes
	useEffect(() => {
		if (!activeHarness || activeHarness.mcpServers.length === 0) {
			setMcpHealthStatuses({});
			return;
		}

		// Set all servers to "checking"
		const checking: Record<string, HealthStatus> = {};
		for (const s of activeHarness.mcpServers) {
			checking[s.url] = "checking";
		}
		setMcpHealthStatuses(checking);

		let cancelled = false;

		const runCheck = async () => {
			try {
				const token = await getToken();
				const res = await fetch(`${FASTAPI_URL}/api/mcp/health/check`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...(token ? { Authorization: `Bearer ${token}` } : {}),
					},
					body: JSON.stringify({
						mcp_servers: activeHarness.mcpServers.map((s) => ({
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
					for (const s of activeHarness.mcpServers) {
						fallback[s.url] = "unreachable";
					}
					setMcpHealthStatuses(fallback);
					return;
				}

				const data = await res.json();
				if (cancelled) return;

				const statuses: Record<string, HealthStatus> = {};
				for (const server of data.servers) {
					if (server.status === "ok") {
						statuses[server.url] = "reachable";
					} else if (server.status === "auth_required") {
						statuses[server.url] = "auth_required";
					} else {
						statuses[server.url] = "unreachable";
					}
				}
				setMcpHealthStatuses(statuses);
			} catch {
				if (cancelled) return;
				const fallback: Record<string, HealthStatus> = {};
				for (const s of activeHarness.mcpServers) {
					fallback[s.url] = "unreachable";
				}
				setMcpHealthStatuses(fallback);
			}
		};

		runCheck();
		return () => {
			cancelled = true;
		};
	}, [activeHarness?._id, getToken]);

	const handleInterrupt = useCallback(
		(convoId: string) => {
			chatStream.cancel(convoId);
		},
		[chatStream],
	);

	const handleSendNow = useCallback(
		(index: number) => {
			if (!activeConvoId) return;
			const item = messageQueueRef.current[index];
			if (!item) return;
			// Remove this message from queue
			messageQueueRef.current = messageQueueRef.current.filter(
				(_, i) => i !== index,
			);
			setMessageQueue([...messageQueueRef.current]);
			// Set it as the pending send and interrupt
			pendingQueueSendRef.current = {
				convoId: activeConvoId,
				content: item.content,
			};
			chatStream.cancel(activeConvoId);
		},
		[activeConvoId, chatStream],
	);

	// Process pending queued messages after stream ends
	useEffect(() => {
		const pending = pendingQueueSendRef.current;
		if (!pending || !activeHarness) return;

		const convoId = pending.convoId;
		// Wait until the conversation is no longer streaming
		if (chatStream.streamingConvoIds.has(convoId)) return;

		pendingQueueSendRef.current = null;

		const run = async () => {
			await sendMessageFromQueue.mutateAsync({
				conversationId: convoId as Id<"conversations">,
				role: "user",
				content: pending.content,
				harnessId: activeHarness._id,
			});

			// Build history from current messages + the new user message
			const msgs = activeMessagesRef.current ?? [];
			const history = [
				...msgs.map((m) => ({ role: m.role, content: m.content })),
				{ role: "user", content: pending.content },
			];

			chatStream.stream({
				messages: history,
				harness: {
					model: sessionModel ?? activeHarness.model,
					mcp_servers: activeHarness.mcpServers.map((s) => ({
						name: s.name,
						url: s.url,
						auth_type: s.authType as
							| "none"
							| "bearer"
							| "oauth"
							| "tiger_junction",
						auth_token: s.authToken,
					})),
					skills: activeHarness.skills ?? [],
					name: activeHarness.name,
					harness_id: activeHarness._id,

					sandbox_enabled: (activeHarness as any).sandboxEnabled ?? false,
					sandbox_id: (activeHarness as any).daytonaSandboxId ?? undefined,
					sandbox_config: (activeHarness as any).sandboxConfig
						? {
								persistent: (activeHarness as any).sandboxConfig.persistent,
								auto_start: (activeHarness as any).sandboxConfig.autoStart,
								default_language: (activeHarness as any).sandboxConfig
									.defaultLanguage,
								resource_tier: (activeHarness as any).sandboxConfig
									.resourceTier,
							}
						: undefined,
				},
				conversation_id: convoId,
			});
		};

		run();
	}, [
		chatStream.streamingConvoIds,
		activeHarness,
		chatStream,
		sendMessageFromQueue,
		sessionModel,
	]);

	const handleSelectConversation = useCallback(
		(convoId: Id<"conversations"> | null) => {
			setActiveConvoId(convoId);

			if (
				convoId &&
				userSettings?.autoSwitchHarness &&
				conversations &&
				harnesses
			) {
				const convo = conversations.find((c) => c._id === convoId);
				if (
					convo?.lastHarnessId &&
					harnesses.some((h) => h._id === convo.lastHarnessId)
				) {
					setActiveHarnessId(convo.lastHarnessId);
				}
			}
		},
		[userSettings, conversations, harnesses],
	);

	// State handlers for searching
	const [scrollToMessageId, setScrollToMessageId] =
		useState<Id<"messages"> | null>(null);
	const handleSelectMessage = useCallback(
		(convoId: Id<"conversations">, messageId: Id<"messages">) => {
			handleSelectConversation(convoId);
			setScrollToMessageId(messageId);
		},
		[handleSelectConversation],
	);

	const removeMessage = useMutation({
		mutationFn: useConvexMutation(api.messages.remove),
	});

	const handleRegenerate = useCallback(
		async (
			messageId: Id<"messages">,
			history: Array<{ role: string; content: string }>,
		) => {
			if (!activeHarness || !activeConvoId) return;

			await removeMessage.mutateAsync({ id: messageId });

			const harnessConfig = {
				model: sessionModel ?? activeHarness.model,
				mcp_servers: activeHarness.mcpServers.map((s) => ({
					name: s.name,
					url: s.url,
					auth_type: s.authType as
						| "none"
						| "bearer"
						| "oauth"
						| "tiger_junction",
					auth_token: s.authToken,
				})),
				skills: activeHarness.skills ?? [],
				name: activeHarness.name,
				harness_id: activeHarness._id,
				sandbox_enabled: (activeHarness as any).sandboxEnabled ?? false,
				sandbox_id: (activeHarness as any).daytonaSandboxId ?? undefined,
				sandbox_config: (activeHarness as any).sandboxConfig
					? {
							persistent: (activeHarness as any).sandboxConfig.persistent,
							auto_start: (activeHarness as any).sandboxConfig.autoStart,
							default_language: (activeHarness as any).sandboxConfig
								.defaultLanguage,
							resource_tier: (activeHarness as any).sandboxConfig.resourceTier,
						}
					: undefined,
			};

			chatStream.stream({
				messages: history,
				harness: harnessConfig,
				conversation_id: activeConvoId,
			});
		},
		[activeHarness, activeConvoId, chatStream, removeMessage, sessionModel],
	);

	const forkConversation = useMutation({
		mutationFn: useConvexMutation(api.conversations.fork),
	});

	const handleFork = useCallback(
		async (messageId: Id<"messages">) => {
			if (!activeConvoId) return;
			const newConvoId = await forkConversation.mutateAsync({
				conversationId: activeConvoId,
				upToMessageId: messageId,
			});
			handleSelectConversation(newConvoId);
		},
		[activeConvoId, forkConversation, handleSelectConversation],
	);

	const editForkAndSend = useMutation({
		mutationFn: useConvexMutation(api.conversations.editForkAndSend),
	});
	const isEditSaving = useRef(false);

	const handleStartEditPrompt = useCallback(
		(messageId: Id<"messages">, content: string) => {
			setEditingMessageId(messageId);
			setEditingContent(content);
		},
		[],
	);

	const handleCancelEditPrompt = useCallback(() => {
		setEditingMessageId(null);
		setEditingContent("");
	}, []);

	const handleSaveEditPrompt = useCallback(
		async (messageId: Id<"messages">, newContent: string) => {
			if (!activeConvoId || !activeHarness || !activeMessages) return;
			if (isEditSaving.current) return;
			isEditSaving.current = true;

			try {
				const idx = activeMessages.findIndex((m) => m._id === messageId);
				if (idx === -1) return;

				// Atomic fork + message insert — no flicker
				const newConvoId = await editForkAndSend.mutateAsync({
					conversationId: activeConvoId,
					upToMessageCount: idx,
					newContent,
					harnessId: activeHarness._id,
				});

				handleSelectConversation(newConvoId);

				const history = activeMessages.slice(0, idx).map((m) => ({
					role: m.role,
					content: m.content,
				}));
				history.push({ role: "user", content: newContent });

				chatStream.stream({
					messages: history,
					harness: {
						model: sessionModel ?? activeHarness.model,
						mcp_servers: activeHarness.mcpServers.map((s) => ({
							name: s.name,
							url: s.url,
							auth_type: s.authType as
								| "none"
								| "bearer"
								| "oauth"
								| "tiger_junction",
							auth_token: s.authToken,
						})),
						skills: activeHarness.skills ?? [],
						name: activeHarness.name,
					},
					conversation_id: newConvoId,
				});

				setEditingMessageId(null);
				setEditingContent("");
			} finally {
				isEditSaving.current = false;
			}
		},
		[
			activeConvoId,
			activeHarness,
			activeMessages,
			editForkAndSend,
			handleSelectConversation,
			chatStream,
			sessionModel,
		],
	);

	if (harnessesLoading || !harnesses || harnesses.length === 0) {
		return <ChatSkeleton />;
	}
	const activeConversation = conversations?.find(
		(c) => c._id === activeConvoId,
	);
	const activeStreamState = activeConvoId
		? (streamStates[activeConvoId] ?? EMPTY_STREAM_STATE)
		: EMPTY_STREAM_STATE;
	const isActiveConvoStreaming = activeConvoId
		? chatStream.streamingConvoIds.has(activeConvoId)
		: false;

	const sandboxEnabled = (activeHarness as any)?.sandboxEnabled ?? false;
	const daytonaSandboxId = (activeHarness as any)?.daytonaSandboxId ?? null;

	return (
		<SandboxPanelProvider sandboxId={sandboxEnabled ? daytonaSandboxId : null}>
			<div className="flex h-full overflow-hidden bg-background">
				<AnimatePresence>
					{sidebarOpen && (
						<motion.aside
							initial={{ width: 0, opacity: 0 }}
							animate={{ width: 280, opacity: 1 }}
							exit={{ width: 0, opacity: 0 }}
							transition={{ duration: 0.2 }}
							className="flex h-full flex-col overflow-hidden border-r border-border"
						>
							<ChatSidebar
								conversations={(conversations ?? []).filter(
									(c) =>
										!(c as Record<string, unknown>).editParentConversationId,
								)}
								activeConvoId={activeConvoId}
								onSelect={handleSelectConversation}
								onSelectMessage={handleSelectMessage}
								harnessId={activeHarnessId}
								onClose={() => setSidebarOpen(false)}
								streamingConvoIds={chatStream.streamingConvoIds}
								doneConvoIds={doneConvoIds}
							/>
						</motion.aside>
					)}
				</AnimatePresence>

				<div className="flex flex-1 flex-col overflow-hidden">
					<ChatHeader
						harness={activeHarness}
						harnesses={harnesses ?? []}
						onSwitchHarness={setActiveHarnessId}
						sidebarOpen={sidebarOpen}
						onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
						isStreaming={isActiveConvoStreaming}
						mcpHealthStatuses={mcpHealthStatuses}
					/>

					<McpFailureBanner
						failures={mcpFailures}
						onDismiss={(id) =>
							setMcpFailures((prev) => prev.filter((f) => f.id !== id))
						}
						onDismissAll={() => setMcpFailures([])}
					/>

					{activeConvoId ? (
						<ChatMessages
							conversationId={activeConvoId}
							messages={activeMessages ?? []}
							streamingContent={activeStreamState.content}
							streamingReasoning={activeStreamState.reasoning}
							activeToolCalls={activeStreamState.toolCalls}
							streamParts={activeStreamState.parts}
							pendingDoneContent={activeStreamState.pendingDoneContent}
							streamUsage={activeStreamState.usage}
							streamModel={activeStreamState.model}
							onStreamSynced={handleStreamSynced}
							displayMode={
								(userSettings?.displayMode as DisplayMode) ?? "standard"
							}
							onRegenerate={handleRegenerate}
							onFork={handleFork}
							onStartEditPrompt={handleStartEditPrompt}
							onCancelEditPrompt={handleCancelEditPrompt}
							onSaveEditPrompt={handleSaveEditPrompt}
							editingMessageId={editingMessageId}
							editingContent={editingContent}
							onEditContentChange={setEditingContent}
							allConversations={conversations ?? []}
							activeConversation={activeConversation}
							forkedFromConversationId={
								activeConversation?.forkedFromConversationId
							}
							forkedFromConversationTitle={
								activeConversation?.forkedFromConversationId
									? (conversations?.find(
											(c) =>
												c._id === activeConversation.forkedFromConversationId,
										)?.title ?? "Original conversation")
									: undefined
							}
							forkedAtMessageCount={activeConversation?.forkedAtMessageCount}
							onNavigateToConversation={handleSelectConversation}
							isStreaming={isActiveConvoStreaming}
							scrollToMessageId={scrollToMessageId}
							onClearScrollTarget={() => setScrollToMessageId(null)}
						/>
					) : (
						<EmptyChat
							suggestedPrompts={activeHarness?.suggestedPrompts}
							onPromptClick={(text) => setPendingPrompt(text)}
						/>
					)}

					<ChatInput
						conversationId={activeConvoId}
						activeHarness={activeHarness}
						sessionModel={sessionModel}
						onSessionModelChange={setSessionModel}
						onConvoCreated={handleSelectConversation}
						isStreaming={isActiveConvoStreaming}
						onStream={chatStream.stream}
						onInterrupt={handleInterrupt}
						onEnqueue={enqueueMessage}
						messages={activeMessages}
						messageQueue={messageQueue}
						onDequeue={dequeueMessage}
						onSendNow={handleSendNow}
						pendingPrompt={pendingPrompt}
						onPendingPromptConsumed={() => setPendingPrompt(null)}
					/>
				</div>

				<AnimatePresence>
					{sandboxEnabled && <SandboxPanelToggle />}
				</AnimatePresence>
			</div>
		</SandboxPanelProvider>
	);
}

function HighlightText({ text, query }: { text: string; query: string }) {
	if (!query) return <>{text}</>;

	const lowerText = text.toLowerCase();
	const lowerQuery = query.toLowerCase();
	const parts: React.ReactNode[] = [];
	let lastIndex = 0;

	let index = lowerText.indexOf(lowerQuery, lastIndex);
	while (index !== -1) {
		if (index > lastIndex) {
			parts.push(text.slice(lastIndex, index));
		}
		parts.push(
			<mark
				key={index}
				className="bg-yellow-200 dark:bg-yellow-800 text-inherit rounded-sm"
			>
				{text.slice(index, index + query.length)}
			</mark>,
		);
		lastIndex = index + query.length;
		index = lowerText.indexOf(lowerQuery, lastIndex);
	}

	if (lastIndex < text.length) {
		parts.push(text.slice(lastIndex));
	}

	return <>{parts}</>;
}

function ChatSidebar({
	conversations,
	activeConvoId,
	onSelect,
	onSelectMessage, // called when user clicks a content match
	harnessId,
	onClose,
	streamingConvoIds,
	doneConvoIds,
}: {
	conversations: Array<{
		_id: Id<"conversations">;
		title: string;
		lastMessageAt: number;
		lastHarnessId?: Id<"harnesses">;
	}>;
	activeConvoId: Id<"conversations"> | null;
	onSelect: (id: Id<"conversations"> | null) => void;
	onSelectMessage: (
		convoId: Id<"conversations">,
		messageId: Id<"messages">,
	) => void;
	harnessId: Id<"harnesses"> | null;
	onClose: () => void;
	streamingConvoIds: Set<string>;
	doneConvoIds: Set<string>;
}) {
	const removeConvo = useMutation({
		mutationFn: useConvexMutation(api.conversations.remove),
		onSuccess: () => {
			if (activeConvoId) onSelect(null);
		},
	});

	const handleNew = () => {
		if (!harnessId) return;
		onSelect(null);
	};

	const [searchQuery, setSearchQuery] = useState("");
	const [titlesExpanded, setTitlesExpanded] = useState(false);
	const [contentExpanded, setContentExpanded] = useState(false);

	// consts to set initial amounts for how many search hits we show
	// as well as max amounts for how many results we show after
	// show more is pressed
	const INITIAL_TITLE_COUNT = 10;
	const INITIAL_CONTENT_COUNT = 15;
	const LOAD_MORE_TITLE_COUNT = 100;
	const LOAD_MORE_CONTENT_COUNT = 250;

	const titleSearch = usePaginatedQuery(
		api.conversations.searchTitles,
		searchQuery.length > 0 ? { query: searchQuery } : "skip",
		{ initialNumItems: INITIAL_TITLE_COUNT },
	);

	const contentSearch = usePaginatedQuery(
		api.conversations.searchContent,
		searchQuery.length > 0 ? { query: searchQuery } : "skip",
		{ initialNumItems: INITIAL_CONTENT_COUNT },
	);

	const { data: titleCount } = useQuery({
		...convexQuery(
			api.conversations.searchTitlesCount,
			searchQuery.length > 0 ? { query: searchQuery } : "skip",
		),
	});

	const { data: contentCount } = useQuery({
		...convexQuery(
			api.conversations.searchContentCount,
			searchQuery.length > 0 ? { query: searchQuery } : "skip",
		),
	});

	const grouped = groupByDate(conversations);

	const [settingsOpen, setSettingsOpen] = useState(false);

	return (
		<div className="flex h-full w-[280px] flex-col bg-background">
			<div className="flex items-center justify-between px-3 py-3">
				<div className="flex items-center gap-2">
					<HarnessMark size={18} className="text-foreground" />
					<span className="text-sm font-semibold tracking-tight text-foreground">
						Harness
					</span>
				</div>
				<div className="flex items-center gap-1">
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon-xs" onClick={handleNew}>
								<Plus size={14} />
							</Button>
						</TooltipTrigger>
						<TooltipContent>New chat</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon-xs" onClick={onClose}>
								<PanelLeftClose size={14} />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Close sidebar</TooltipContent>
					</Tooltip>
				</div>
			</div>

			<Separator />

			{/* Add input component connected to searchQuery state */}
			<div className="px-2 py-2">
				<div className="relative">
					<Search
						size={14}
						className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						placeholder="Search chats..."
						value={searchQuery}
						onChange={(e) => {
							setSearchQuery(e.target.value);
							setTitlesExpanded(false);
							setContentExpanded(false);
						}}
						className="h-8 pl-8 text-xs"
					/>
				</div>
			</div>

			<ScrollArea className="min-h-0 flex-1 px-2 py-2">
				{/* BRANCH 1: Active search — show search results */}
				{searchQuery &&
				titleSearch.status !== "LoadingFirstPage" &&
				contentSearch.status !== "LoadingFirstPage" ? (
					<div className="flex flex-col gap-4 h-full">
						{/* --- TITLE MATCHES SECTION --- */}
						{titleSearch.results.length > 0 && (
							<div className="flex flex-col shrink-0">
								<div className="sticky top-0 z-10 mb-1 flex items-center gap-2 bg-background px-2 py-1">
									<p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
										Conversations
									</p>
									{titlesExpanded ? (
										<button
											type="button"
											onClick={() => setTitlesExpanded(false)}
											className="text-[11px] text-blue-500 hover:text-blue-600"
										>
											Show Less
										</button>
									) : (titleCount ?? 0) > INITIAL_TITLE_COUNT ? (
										<button
											type="button"
											onClick={() => {
												if (titleSearch.status === "CanLoadMore") {
													titleSearch.loadMore(LOAD_MORE_TITLE_COUNT);
												}
												setTitlesExpanded(true);
											}}
											className="text-[11px] text-blue-500 hover:text-blue-600"
										>
											Show More
										</button>
									) : null}
								</div>
								{(titlesExpanded
									? titleSearch.results
									: titleSearch.results.slice(0, INITIAL_TITLE_COUNT)
								).map((convo) => (
									<button
										key={convo._id}
										type="button"
										onClick={() => onSelect(convo._id)}
										className={cn(
											"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
											activeConvoId === convo._id
												? "bg-muted text-foreground"
												: "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
										)}
									>
										<MessageSquare size={12} className="shrink-0" />
										<span className="truncate">
											<HighlightText text={convo.title} query={searchQuery} />
										</span>
									</button>
								))}
							</div>
						)}

						{/* --- CONTENT MATCHES SECTION --- */}
						{contentSearch.results.length > 0 && (
							<div className="flex flex-col flex-1 min-h-0">
								<div className="sticky top-0 z-10 mb-1 flex items-center gap-2 bg-background px-2 py-1">
									<p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
										Messages
									</p>
									{contentExpanded ? (
										<button
											type="button"
											onClick={() => setContentExpanded(false)}
											className="text-[11px] text-blue-500 hover:text-blue-600"
										>
											Show Less
										</button>
									) : (contentCount ?? 0) > INITIAL_CONTENT_COUNT ? (
										<button
											type="button"
											onClick={() => {
												if (contentSearch.status === "CanLoadMore") {
													contentSearch.loadMore(LOAD_MORE_CONTENT_COUNT);
												}
												setContentExpanded(true);
											}}
											className="text-[11px] text-blue-500 hover:text-blue-600"
										>
											Show More
										</button>
									) : null}
								</div>
								<div
									className={cn(
										"overflow-y-auto",
										contentExpanded && "flex-1 min-h-0",
									)}
								>
									{(contentExpanded
										? contentSearch.results
										: contentSearch.results.slice(0, INITIAL_CONTENT_COUNT)
									).map((match) => (
										<button
											key={match.messageId}
											type="button"
											onClick={() =>
												onSelectMessage(match.conversationId, match.messageId)
											}
											className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors
												text-muted-foreground hover:bg-muted/50 hover:text-foreground"
										>
											<span className="text-[11px] font-medium text-foreground truncate">
												{match.conversationTitle}
											</span>
											<span className="text-[11px] leading-snug">
												<HighlightText
													text={match.snippet}
													query={searchQuery}
												/>
											</span>
										</button>
									))}
								</div>
							</div>
						)}

						{/* --- NO RESULTS --- */}
						{titleSearch.results.length === 0 &&
							contentSearch.results.length === 0 && (
								<p className="px-2 py-8 text-center text-xs text-muted-foreground">
									No results found
								</p>
							)}
					</div>
				) : /* BRANCH 2 & 3: Normal mode */
				conversations.length === 0 ? (
					<p className="px-2 py-8 text-center text-xs text-muted-foreground">
						No conversations yet
					</p>
				) : (
					<div className="space-y-4">
						{grouped.map((group) => (
							<div key={group.label}>
								<p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
									{group.label}
								</p>
								{group.items.map((convo) => (
									<div key={convo._id} className="group relative">
										<button
											type="button"
											onClick={() => onSelect(convo._id)}
											className={cn(
												"flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors",
												activeConvoId === convo._id
													? "bg-muted text-foreground"
													: "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
											)}
										>
											<AnimatePresence mode="wait">
												{streamingConvoIds.has(convo._id) ? (
													<motion.span
														key="spinner"
														initial={{ opacity: 0, scale: 0.5 }}
														animate={{ opacity: 1, scale: 1 }}
														exit={{ opacity: 0, scale: 0.5 }}
														transition={{ duration: 0.15 }}
														className="flex shrink-0"
													>
														<Loader2
															size={12}
															className="animate-spin text-muted-foreground"
														/>
													</motion.span>
												) : doneConvoIds.has(convo._id) ? (
													<motion.span
														key="check"
														initial={{ opacity: 0, scale: 0.5 }}
														animate={{ opacity: 1, scale: 1 }}
														exit={{ opacity: 0, scale: 0.5 }}
														transition={{ duration: 0.15 }}
														className="flex shrink-0"
													>
														<Check size={12} className="text-emerald-500" />
													</motion.span>
												) : (
													<motion.span
														key="icon"
														initial={{ opacity: 0, scale: 0.5 }}
														animate={{ opacity: 1, scale: 1 }}
														exit={{ opacity: 0, scale: 0.5 }}
														transition={{ duration: 0.15 }}
														className="flex shrink-0"
													>
														<MessageSquare size={12} />
													</motion.span>
												)}
											</AnimatePresence>
											<span className="truncate">{convo.title}</span>
										</button>
										<Button
											variant="ghost"
											size="icon-xs"
											className="absolute right-1 top-1 opacity-0 group-hover:opacity-100"
											onClick={(e) => {
												e.stopPropagation();
												removeConvo.mutate({
													id: convo._id,
												});
											}}
										>
											<Trash2 size={10} />
										</Button>
									</div>
								))}
							</div>
						))}
					</div>
				)}
			</ScrollArea>

			<Separator />
			<div className="space-y-0.5 p-2">
				<Button
					variant="ghost"
					size="sm"
					className="w-full justify-start"
					asChild
				>
					<Link to="/harnesses">
						<SlidersHorizontal size={12} />
						Manage Harnesses
					</Link>
				</Button>
				<Button
					variant="ghost"
					size="sm"
					className="w-full justify-start"
					onClick={() => setSettingsOpen(true)}
				>
					<Settings size={12} />
					Settings
				</Button>
			</div>

			<SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
		</div>
	);
}

function SettingsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { signOut, openUserProfile } = useClerk();
	const { user } = useUser();
	const navigate = useNavigate();
	const { data: userSettings } = useQuery(
		convexQuery(api.userSettings.get, {}),
	);
	const updateSettings = useMutation({
		mutationFn: useConvexMutation(api.userSettings.update),
	});

	const handleSignOut = async () => {
		await signOut();
		navigate({ to: "/sign-in" });
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle className="text-sm">Settings</DialogTitle>
					<DialogDescription>Manage your preferences.</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div>
						<p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
							Profile
						</p>
						<div className="flex items-center gap-3 py-1.5">
							<Avatar className="h-8 w-8">
								<AvatarImage src={user?.imageUrl} />
								<AvatarFallback className="text-xs">
									{user?.firstName?.[0]}
									{user?.lastName?.[0]}
								</AvatarFallback>
							</Avatar>
							<div className="min-w-0 flex-1">
								<p className="truncate text-xs font-medium text-foreground">
									{user?.fullName}
								</p>
								<p className="truncate text-[11px] text-muted-foreground">
									{user?.primaryEmailAddress?.emailAddress}
								</p>
							</div>
						</div>
						<Button
							variant="ghost"
							size="sm"
							className="w-full justify-start text-muted-foreground hover:text-foreground"
							onClick={() => openUserProfile()}
						>
							<User size={12} />
							Manage account
						</Button>
					</div>

					<Separator />

					<div>
						<p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
							Behavior
						</p>
						<label
							htmlFor="auto-switch"
							className="flex items-center justify-between gap-3 py-1.5"
						>
							<div>
								<p className="text-xs font-medium text-foreground">
									Auto-switch harness
								</p>
								<p className="text-[11px] text-muted-foreground">
									Switch to a conversation's harness when selected.
								</p>
							</div>
							<Checkbox
								id="auto-switch"
								checked={userSettings?.autoSwitchHarness ?? true}
								onCheckedChange={(checked) => {
									updateSettings.mutate({
										autoSwitchHarness: checked === true,
									});
								}}
							/>
						</label>
					</div>

					<Separator />

					<div>
						<p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
							Display
						</p>
						<div className="flex items-center justify-between gap-3 py-1.5">
							<div>
								<p className="text-xs font-medium text-foreground">
									Message actions
								</p>
								<p className="text-[11px] text-muted-foreground">
									Controls which buttons appear on messages.
								</p>
							</div>
							<Select
								value={(userSettings?.displayMode as string) ?? "standard"}
								onValueChange={(value) => {
									updateSettings.mutate({
										displayMode: value as "zen" | "standard" | "developer",
									});
								}}
							>
								<SelectTrigger className="w-[120px]">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="zen">Zen</SelectItem>
									<SelectItem value="standard">Standard</SelectItem>
									<SelectItem value="developer">Developer</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					<Separator />

					<div>
						<p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
							Account
						</p>
						<Button
							variant="ghost"
							size="sm"
							className="w-full justify-start text-muted-foreground hover:text-foreground"
							onClick={handleSignOut}
						>
							<LogOut size={12} />
							Sign out
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function McpFailureBanner({
	failures,
	onDismiss,
	onDismissAll,
}: {
	failures: Array<{
		id: number;
		serverName: string;
		serverUrl: string;
		reason: string;
	}>;
	onDismiss: (id: number) => void;
	onDismissAll: () => void;
}) {
	if (failures.length === 0) return null;

	return (
		<AnimatePresence>
			<motion.div
				initial={{ height: 0, opacity: 0 }}
				animate={{ height: "auto", opacity: 1 }}
				exit={{ height: 0, opacity: 0 }}
				transition={{ duration: 0.2 }}
				className="border-b border-amber-500/20 bg-amber-500/5"
			>
				<div className="flex items-start gap-3 px-4 py-2.5">
					<AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
					<div className="min-w-0 flex-1">
						<p className="text-xs font-medium text-amber-600 dark:text-amber-400">
							{failures.length === 1
								? "An MCP server failed to connect"
								: `${failures.length} MCP servers failed to connect`}
						</p>
						<div className="mt-1 flex flex-wrap gap-1.5">
							{failures.map((f) => (
								<span
									key={f.id}
									className="inline-flex items-center gap-1.5 rounded-sm bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300"
								>
									<span
										className={`h-1 w-1 rounded-full ${f.reason === "auth_required" ? "bg-red-400" : "bg-amber-400"}`}
									/>
									{f.serverName}
									{f.reason === "auth_required" && (
										<span className="text-amber-500/70">— OAuth required</span>
									)}
									<button
										type="button"
										className="ml-0.5 opacity-50 transition-opacity hover:opacity-100"
										onClick={() => onDismiss(f.id)}
									>
										<X size={8} />
									</button>
								</span>
							))}
						</div>
						<p className="mt-1 text-[10px] text-amber-600/60 dark:text-amber-400/50">
							Tools from these servers won't be available. Reconnect from the
							MCP status menu above.
						</p>
					</div>
					<button
						type="button"
						className="shrink-0 rounded-sm p-0.5 text-amber-500/50 transition-colors hover:bg-amber-500/10 hover:text-amber-500"
						onClick={onDismissAll}
					>
						<X size={12} />
					</button>
				</div>
			</motion.div>
		</AnimatePresence>
	);
}

function SkillsStatus({ skills }: { skills: SkillEntry[] }) {
	if (skills.length === 0) return null;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							<Zap size={10} />
							{skills.length} Skill{skills.length !== 1 && "s"}
						</button>
					</TooltipTrigger>
					<TooltipContent>Active skills</TooltipContent>
				</Tooltip>
			</DropdownMenuTrigger>

			<DropdownMenuContent align="start" className="w-72">
				<div className="border-b border-border px-3 py-2">
					<span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
						Skills
					</span>
				</div>
				<div className="max-h-48 overflow-y-auto py-1">
					{skills.map((skill) => (
						<DropdownMenuItem key={skill.name} className="px-3 py-1.5">
							<span className="truncate text-xs font-medium">
								{skill.name.split("/").pop() ?? skill.name}
							</span>
						</DropdownMenuItem>
					))}
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ChatHeader({
	harness,
	harnesses,
	onSwitchHarness,
	sidebarOpen,
	onToggleSidebar,
	isStreaming,
	mcpHealthStatuses,
}: {
	harness?: {
		_id: Id<"harnesses">;
		name: string;
		model: string;
		status: string;
		mcpServers: Array<{
			name: string;
			url: string;
			authType: McpAuthType;
			authToken?: string;
		}>;
		skills: SkillEntry[];
	};
	harnesses: Array<{
		_id: Id<"harnesses">;
		name: string;
		model: string;
		status: string;
	}>;
	onSwitchHarness: (id: Id<"harnesses">) => void;
	sidebarOpen: boolean;
	onToggleSidebar: () => void;
	isStreaming: boolean;
	mcpHealthStatuses?: Record<string, HealthStatus>;
}) {
	return (
		<header className="flex items-center justify-between border-b border-border px-4 py-2.5">
			<div className="flex items-center gap-2">
				{!sidebarOpen && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon-xs" onClick={onToggleSidebar}>
								<PanelLeftOpen size={14} />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Open sidebar</TooltipContent>
					</Tooltip>
				)}

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className="gap-1.5"
							disabled={isStreaming}
						>
							<span className="text-xs font-medium">
								{harness?.name ?? "Select Harness"}
							</span>
							{harness && (
								<Badge variant="secondary" className="text-[10px]">
									<Cpu size={8} />
									{harness.model}
								</Badge>
							)}
							<ChevronDown size={12} className="text-muted-foreground" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start">
						{harnesses
							.filter((h) => h.status !== "draft")
							.map((h) => (
								<DropdownMenuItem
									key={h._id}
									onClick={() => onSwitchHarness(h._id)}
								>
									<div
										className={`h-1.5 w-1.5 ${h.status === "started" ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
									/>
									{h.name}
									<span className="ml-auto text-[10px] text-muted-foreground">
										{h.model}
									</span>
								</DropdownMenuItem>
							))}
					</DropdownMenuContent>
				</DropdownMenu>

				{harness && harness.mcpServers.length > 0 && (
					<McpServerStatus
						servers={harness.mcpServers}
						healthStatuses={mcpHealthStatuses}
					/>
				)}

				{harness && harness.skills.length > 0 && (
					<SkillsStatus skills={harness.skills} />
				)}

				{harness && (harness as any).sandboxEnabled && <SandboxBadge />}
			</div>
		</header>
	);
}

/** Clickable sandbox badge in the header — toggles the sandbox panel. */
function SandboxBadge() {
	const panel = useSandboxPanel();
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					onClick={() => panel?.togglePanel()}
					className={cn(
						"flex items-center gap-1.5 border px-2 py-1 text-[10px] transition-colors",
						panel?.panelOpen
							? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
							: "border-border text-muted-foreground hover:bg-muted/30",
					)}
				>
					<div className="h-1.5 w-1.5 bg-emerald-500" />
					<span>Sandbox</span>
				</button>
			</TooltipTrigger>
			<TooltipContent>
				<p>
					{panel?.panelOpen
						? "Close sandbox panel"
						: "Open sandbox panel — browse files and interact directly"}
				</p>
			</TooltipContent>
		</Tooltip>
	);
}

/** Renders the sandbox panel (animated) when open. */
function SandboxPanelToggle() {
	const panel = useSandboxPanel();
	if (!panel?.panelOpen) return null;
	return <SandboxPanel />;
}

function ChatMessages({
	conversationId,
	messages,
	streamingContent,
	streamingReasoning,
	activeToolCalls,
	streamParts,
	pendingDoneContent,
	streamUsage,
	streamModel,
	onStreamSynced,
	displayMode,
	onRegenerate,
	onFork,
	onStartEditPrompt,
	onCancelEditPrompt,
	onSaveEditPrompt,
	editingMessageId,
	editingContent,
	onEditContentChange,
	allConversations,
	activeConversation,
	forkedFromConversationId,
	forkedFromConversationTitle,
	forkedAtMessageCount,
	onNavigateToConversation,
	isStreaming,
	scrollToMessageId,
	onClearScrollTarget,
}: {
	conversationId: Id<"conversations">;
	messages: Array<{
		_id: Id<"messages">;
		role: "user" | "assistant";
		content: string;
		reasoning?: string;
		toolCalls?: Array<{
			tool: string;
			arguments: unknown;
			call_id: string;
			result: string;
		}>;
		parts?: Array<{
			type: "text" | "reasoning" | "tool_call";
			content?: string;
			tool?: string;
			arguments?: unknown;
			call_id?: string;
			result?: string;
		}>;
		usage?: {
			promptTokens: number;
			completionTokens: number;
			totalTokens: number;
			cost?: number;
		};
		model?: string;
		interrupted?: boolean;
		attachments?: Array<{
			storageId: Id<"_storage">;
			mimeType: string;
			fileName: string;
			fileSize: number;
		}>;
	}>;
	streamingContent: string | null;
	streamingReasoning: string | null;
	activeToolCalls: ToolCallEvent[];
	streamParts: StreamPart[];
	pendingDoneContent: string | null;
	streamUsage: UsageData | null;
	streamModel: string | null;
	onStreamSynced: (convoId: string) => void;
	displayMode: DisplayMode;
	onRegenerate: (
		messageId: Id<"messages">,
		history: Array<{ role: string; content: string }>,
	) => void;
	onFork: (messageId: Id<"messages">) => void;
	onStartEditPrompt: (messageId: Id<"messages">, content: string) => void;
	onCancelEditPrompt: () => void;
	onSaveEditPrompt: (messageId: Id<"messages">, newContent: string) => void;
	editingMessageId: Id<"messages"> | null;
	editingContent: string;
	onEditContentChange: (content: string) => void;
	allConversations: Array<{
		_id: Id<"conversations">;
		_creationTime: number;
		editParentConversationId?: Id<"conversations">;
		editParentMessageCount?: number;
	}>;
	activeConversation:
		| {
				_id: Id<"conversations">;
				editParentConversationId?: Id<"conversations">;
				editParentMessageCount?: number;
		  }
		| undefined;
	forkedFromConversationId?: Id<"conversations">;
	forkedFromConversationTitle?: string;
	forkedAtMessageCount?: number;
	onNavigateToConversation: (convoId: Id<"conversations"> | null) => void;
	isStreaming: boolean;
	scrollToMessageId: Id<"messages"> | null;
	onClearScrollTarget: () => void;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
	// "Pinned to bottom" — when true, auto-scroll follows new content.
	// Unpins when the user scrolls up past a threshold; re-pins when they
	// scroll back near the bottom or click the scroll-to-bottom button.
	const [isPinned, setIsPinned] = useState(true);
	const isPinnedRef = useRef(true);
	// When true, suppress entrance animations and auto-scroll (set on conversation switches)
	const skipNextTransition = useRef(false);
	// Skip entry animation on conversation switches (but not the initial mount)
	const prevConversationId = useRef(conversationId);
	if (prevConversationId.current !== conversationId) {
		prevConversationId.current = conversationId;
		skipNextTransition.current = true;
		// Re-pin when switching conversations
		isPinnedRef.current = true;
		setIsPinned(true);
	}
	// Snapshot captured at render time so animations can read it before the effect resets it
	const skipEntryAnimation = skipNextTransition.current;

	// Unpin when the user scrolls up (wheel or touch).
	// We detect intent directly via input events — not scroll position —
	// because scroll-position checks race against programmatic auto-scroll.
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		let lastTouchY = 0;

		const unpin = () => {
			isPinnedRef.current = false;
			setIsPinned(false);
		};
		const handleWheel = (e: WheelEvent) => {
			if (e.deltaY < 0 && isPinnedRef.current && el.scrollTop > 0) {
				unpin();
			}
		};
		const handleTouchStart = (e: TouchEvent) => {
			lastTouchY = e.touches[0].clientY;
		};
		const handleTouchMove = (e: TouchEvent) => {
			if (
				e.touches[0].clientY > lastTouchY &&
				isPinnedRef.current &&
				el.scrollTop > 0
			) {
				unpin();
			}
			lastTouchY = e.touches[0].clientY;
		};

		el.addEventListener("wheel", handleWheel, { passive: true });
		el.addEventListener("touchstart", handleTouchStart, { passive: true });
		el.addEventListener("touchmove", handleTouchMove, { passive: true });
		return () => {
			el.removeEventListener("wheel", handleWheel);
			el.removeEventListener("touchstart", handleTouchStart);
			el.removeEventListener("touchmove", handleTouchMove);
		};
	}, []);

	const scrollToBottom = useCallback(() => {
		if (!scrollRef.current) return;
		scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		isPinnedRef.current = true;
		setIsPinned(true);
	}, []);

	// Build a lookup map for O(1) ancestor traversal
	const convoMap = useMemo(() => {
		const map = new Map<
			Id<"conversations">,
			{
				_id: Id<"conversations">;
				_creationTime: number;
				editParentConversationId?: Id<"conversations">;
				editParentMessageCount?: number;
			}
		>();
		for (const c of allConversations) {
			map.set(c._id, c);
		}
		return map;
	}, [allConversations]);

	// Walk the ancestor chain to find, for a given message position i,
	// the root conversation (base of the edit tree at that position) and
	// the "version conversation" (which copy of message i the active
	// conversation is showing — used to determine current page index).
	const findEditAncestor = useCallback(
		(
			convId: Id<"conversations">,
			pos: number,
		): { rootId: Id<"conversations">; versionId: Id<"conversations"> } => {
			let currentId = convId;
			for (;;) {
				const c = convoMap.get(currentId);
				if (!c?.editParentConversationId) {
					// No parent — this conversation is the root at this position
					return { rootId: currentId, versionId: currentId };
				}
				if (c.editParentMessageCount === pos) {
					// Fork is exactly at this position — parent is the root
					return {
						rootId: c.editParentConversationId,
						versionId: currentId,
					};
				}
				if ((c.editParentMessageCount ?? 0) > pos) {
					// Fork is at a later position — content at pos came from parent
					currentId = c.editParentConversationId;
				} else {
					// Fork is at an earlier position — content at pos is
					// original to this conversation, so it is the root here
					return { rootId: currentId, versionId: currentId };
				}
			}
		},
		[convoMap],
	);

	// Detect whether Convex has synced the assistant message (computed during render)
	const lastMsg = messages?.[messages.length - 1];
	const convexHasMessage =
		pendingDoneContent !== null &&
		lastMsg?.role === "assistant" &&
		lastMsg.content === pendingDoneContent;
	const isActivelyStreaming =
		streamingContent !== null || streamingReasoning !== null;
	// Show the streaming bubble when we have content, reasoning, or tool calls, but Convex hasn't synced yet
	const showStreamingBubble =
		(streamingContent !== null ||
			streamingReasoning !== null ||
			activeToolCalls.length > 0) &&
		!convexHasMessage;

	// Clear streaming state once Convex has synced — fire in effect to avoid setState during render
	useEffect(() => {
		if (convexHasMessage) {
			onStreamSynced(conversationId);
		}
	}, [convexHasMessage, onStreamSynced, conversationId]);

	// Re-pin when user sends a new message (they expect to see the response)
	const messageCount = messages?.length ?? 0;
	const lastMsgRole = messages?.[messages.length - 1]?.role;
	// biome-ignore lint/correctness/useExhaustiveDependencies: only reset on new user message
	useEffect(() => {
		if (lastMsgRole === "user") {
			isPinnedRef.current = true;
			setIsPinned(true);
		}
	}, [messageCount]);

	// Auto-scroll: runs in useLayoutEffect (synchronous, before paint) so it
	// can't race with wheel/touch events that fire after paint. Once the user
	// unpins, this becomes a no-op until they re-pin.
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new messages and streaming
	useLayoutEffect(() => {
		if (skipNextTransition.current) {
			skipNextTransition.current = false;
			return;
		}
		if (scrollRef.current && isPinnedRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [messages, streamingContent, streamingReasoning]);

	useEffect(() => {
		if (!scrollToMessageId || !messages?.length) return;

		const el = document.querySelector(
			`[data-message-id="${scrollToMessageId}"]`,
		);
		if (!el) return;

		// Clear any previous highlight timeout
		if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);

		el.scrollIntoView({ behavior: "smooth", block: "center" });
		// Add ring + yellow highlight
		el.classList.add(
			"ring-2",
			"ring-primary",
			"ring-offset-2",
			"highlight-fade",
		);

		highlightTimeoutRef.current = setTimeout(() => {
			el.classList.remove(
				"ring-2",
				"ring-primary",
				"ring-offset-2",
				"highlight-fade",
			);
			highlightTimeoutRef.current = null;
		}, 3000);

		onClearScrollTarget();
	}, [scrollToMessageId, messages, onClearScrollTarget]);

	if (messages.length === 0 && !isActivelyStreaming) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<p className="text-sm text-muted-foreground">
					Send a message to start the conversation.
				</p>
			</div>
		);
	}

	return (
		<div ref={scrollRef} className="flex-1 overflow-y-auto">
			<div className="mx-auto max-w-3xl px-4 py-6">
				{(() => {
					const lastUserMsgIdx = messages
						? messages.reduce(
								(last, m, idx) => (m.role === "user" ? idx : last),
								-1,
							)
						: -1;
					return messages?.map((msg, i) => {
						// Skip entrance animation for the message that just replaced the streaming bubble
						const isJustSynced = convexHasMessage && msg._id === lastMsg?._id;
						const showForkBanner =
							forkedFromConversationId !== undefined &&
							forkedAtMessageCount !== undefined &&
							i === forkedAtMessageCount - 1;
						const { rootId: editRootId, versionId: editVersionId } =
							msg.role === "user" && activeConversation
								? findEditAncestor(activeConversation._id, i)
								: { rootId: undefined, versionId: undefined };
						const editSiblings =
							editRootId !== undefined
								? allConversations.filter(
										(c) =>
											c.editParentConversationId === editRootId &&
											c.editParentMessageCount === i,
									)
								: [];
						const editAllVersionIds =
							editSiblings.length > 0
								? [
										editRootId as Id<"conversations">,
										...[...editSiblings]
											.sort((a, b) => a._creationTime - b._creationTime)
											.map((c) => c._id),
									]
								: [];
						const editVersionIdx =
							editAllVersionIds.length === 0 || editVersionId === undefined
								? -1
								: editAllVersionIds.indexOf(editVersionId);
						return (
							<React.Fragment key={msg._id}>
								<motion.div
									data-message-id={msg._id}
									initial={
										isJustSynced || skipEntryAnimation
											? false
											: { opacity: 0, y: 8 }
									}
									animate={{ opacity: 1, y: 0 }}
									transition={
										isJustSynced || skipEntryAnimation
											? { duration: 0 }
											: { delay: i * 0.03 }
									}
									className={cn(
										"group mb-6 flex gap-3",
										msg.role === "user" && "justify-end",
									)}
								>
									{msg.role === "assistant" && (
										<Avatar className="h-7 w-7 shrink-0">
											<AvatarFallback className="bg-foreground text-background text-[10px]">
												<Sparkles size={12} />
											</AvatarFallback>
										</Avatar>
									)}
									<div
										className={cn(
											"max-w-[80%]",
											msg.role === "user" && "flex flex-col items-end",
										)}
									>
										{msg.role === "user" &&
											msg.attachments &&
											msg.attachments.length > 0 && (
												<MessageAttachments attachments={msg.attachments} />
											)}
										<div
											className={cn(
												"text-sm leading-relaxed",
												msg.role === "user" && editingMessageId !== msg._id
													? "bg-foreground px-3.5 py-2.5 text-background"
													: "text-foreground",
											)}
										>
											{msg.role === "assistant" &&
											(msg as Record<string, unknown>).parts ? (
												(
													(msg as Record<string, unknown>).parts as Array<{
														type: "text" | "reasoning" | "tool_call";
														content?: string;
														tool?: string;
														arguments?: Record<string, unknown>;
														call_id?: string;
														result?: string;
													}>
												).map((part) => {
													const key =
														part.type === "tool_call"
															? (part.call_id ?? part.tool)
															: `${part.type}-${part.content?.slice(0, 32)}`;
													if (part.type === "reasoning" && part.content) {
														return (
															<ThinkingBlock
																key={key}
																content={part.content}
																isStreaming={false}
															/>
														);
													}
													if (part.type === "text" && part.content) {
														return (
															<MarkdownMessage
																key={key}
																content={part.content}
															/>
														);
													}
													if (part.type === "tool_call" && part.tool) {
														return (
															<ToolCallBlock
																key={key}
																tool={part.tool}
																arguments={part.arguments ?? {}}
																result={part.result}
																isStreaming={false}
															/>
														);
													}
													return null;
												})
											) : (
												<>
													{msg.role === "assistant" && msg.reasoning && (
														<ThinkingBlock
															content={msg.reasoning}
															isStreaming={false}
														/>
													)}
													{msg.role === "assistant" ? (
														<MarkdownMessage content={msg.content} />
													) : editingMessageId === msg._id ? (
														<div className="flex flex-col gap-2">
															<textarea
																ref={(el) => {
																	if (el) {
																		el.focus();
																		el.setSelectionRange(
																			el.value.length,
																			el.value.length,
																		);
																	}
																}}
																className="min-h-[80px] w-full resize-none rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
																value={editingContent}
																onChange={(e) =>
																	onEditContentChange(e.target.value)
																}
																onKeyDown={(e) => {
																	if (e.key === "Enter" && !e.shiftKey) {
																		e.preventDefault();
																		onSaveEditPrompt(msg._id, editingContent);
																	}
																}}
															/>
															<div className="flex gap-2">
																<button
																	type="button"
																	onClick={() =>
																		onSaveEditPrompt(msg._id, editingContent)
																	}
																	className="rounded bg-foreground px-3 py-1 text-xs text-background hover:bg-foreground/90"
																>
																	Save
																</button>
																<button
																	type="button"
																	onClick={onCancelEditPrompt}
																	className="rounded border border-border px-3 py-1 text-xs text-foreground hover:bg-muted"
																>
																	Cancel
																</button>
															</div>
														</div>
													) : (
														<p className="whitespace-pre-wrap">{msg.content}</p>
													)}
													{msg.role === "assistant" &&
														msg.toolCalls &&
														msg.toolCalls.length > 0 && (
															<div className="mt-2 space-y-1">
																{(
																	msg.toolCalls as Array<{
																		tool: string;
																		arguments: Record<string, unknown>;
																		call_id: string;
																		result: string;
																	}>
																).map((tc) => (
																	<ToolCallBlock
																		key={tc.call_id}
																		tool={tc.tool}
																		arguments={tc.arguments}
																		result={tc.result}
																		isStreaming={false}
																	/>
																))}
															</div>
														)}
												</>
											)}
										</div>
										{msg.role === "assistant" && msg.interrupted && (
											<div className="mt-1 flex items-center gap-1.5 text-xs text-amber-500">
												<span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
												Response interrupted
											</div>
										)}
										<MessageActions
											content={msg.content}
											role={msg.role}
											displayMode={displayMode}
											isStreaming={isStreaming}
											usage={
												msg.role === "assistant" && msg.usage
													? (msg.usage as UsageData)
													: undefined
											}
											model={
												msg.role === "assistant"
													? (msg.model ?? undefined)
													: undefined
											}
											onRegenerate={
												msg.role === "assistant"
													? () => {
															if (!messages) return;
															const idx = messages.findIndex(
																(m) => m._id === msg._id,
															);
															const history = messages
																.slice(0, idx)
																.map((m) => ({
																	role: m.role,
																	content: m.content,
																}));
															onRegenerate(msg._id, history);
														}
													: undefined
											}
											onFork={
												msg.role === "assistant"
													? () => onFork(msg._id)
													: undefined
											}
											onEditPrompt={
												msg.role === "user" && i === lastUserMsgIdx
													? () => onStartEditPrompt(msg._id, msg.content)
													: undefined
											}
										/>
										{editVersionIdx !== -1 && editAllVersionIds.length > 1 && (
											<div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
												<button
													type="button"
													disabled={editVersionIdx === 0}
													onClick={() => {
														skipNextTransition.current = true;
														onNavigateToConversation(
															editAllVersionIds[
																editVersionIdx - 1
															] as Id<"conversations">,
														);
													}}
													className="disabled:opacity-30 hover:text-foreground"
												>
													←
												</button>
												<span>
													{editVersionIdx + 1}/{editAllVersionIds.length}
												</span>
												<button
													type="button"
													disabled={
														editVersionIdx === editAllVersionIds.length - 1
													}
													onClick={() => {
														skipNextTransition.current = true;
														onNavigateToConversation(
															editAllVersionIds[
																editVersionIdx + 1
															] as Id<"conversations">,
														);
													}}
													className="disabled:opacity-30 hover:text-foreground"
												>
													→
												</button>
											</div>
										)}
									</div>
									{msg.role === "user" && (
										<Avatar className="h-7 w-7 shrink-0">
											<AvatarFallback className="bg-muted text-foreground text-[10px]">
												U
											</AvatarFallback>
										</Avatar>
									)}
								</motion.div>
								{showForkBanner && forkedFromConversationId && (
									<div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
										<div className="h-px flex-1 bg-border" />
										<span>
											Branched from{" "}
											<button
												type="button"
												onClick={() =>
													onNavigateToConversation(
														forkedFromConversationId ?? null,
													)
												}
												className="font-medium text-foreground underline underline-offset-2 hover:text-foreground/80"
											>
												{forkedFromConversationTitle}
											</button>
										</span>
										<div className="h-px flex-1 bg-border" />
									</div>
								)}
							</React.Fragment>
						);
					});
				})()}

				{showStreamingBubble && (
					<motion.div
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						className="mb-6 flex gap-3"
					>
						<Avatar className="h-7 w-7 shrink-0">
							<AvatarFallback className="bg-foreground text-background text-[10px]">
								<Sparkles size={12} />
							</AvatarFallback>
						</Avatar>
						<div className="max-w-[80%]">
							<div className="text-sm leading-relaxed text-foreground">
								{streamParts.length > 0
									? streamParts.map((part, idx) => {
											const isLast = idx === streamParts.length - 1;
											if (part.type === "reasoning" && part.content) {
												return (
													<ThinkingBlock
														key={`sp-${part.type}-${idx}`}
														content={part.content}
														isStreaming={isLast && isActivelyStreaming}
													/>
												);
											}
											if (part.type === "text" && part.content) {
												return (
													<MarkdownMessage
														key={`sp-${part.type}-${idx}`}
														content={part.content}
													/>
												);
											}
											if (part.type === "tool_call" && part.tool) {
												return (
													<ToolCallBlock
														key={part.call_id ?? `sp-tc-${idx}`}
														tool={part.tool}
														arguments={part.arguments ?? {}}
														result={part.result}
														isStreaming={!part.result}
													/>
												);
											}
											return null;
										})
									: !streamingReasoning &&
										activeToolCalls.length === 0 &&
										!streamingContent && (
											<Loader2
												size={14}
												className="animate-spin text-muted-foreground"
											/>
										)}
							</div>
							{displayMode === "developer" && streamUsage && (
								<div className="flex items-center gap-3 pt-1">
									<StreamingUsage usage={streamUsage} model={streamModel} />
								</div>
							)}
						</div>
					</motion.div>
				)}
			</div>
			{!isPinned && (
				<div className="sticky bottom-4 flex justify-center pointer-events-none">
					<button
						type="button"
						onClick={scrollToBottom}
						className="pointer-events-auto rounded-full border border-border bg-background p-2 shadow-md transition-colors hover:bg-muted"
					>
						<ChevronDown size={16} />
					</button>
				</div>
			)}
		</div>
	);
}

function ThinkingBlock({
	content,
	isStreaming,
}: {
	content: string;
	isStreaming: boolean;
}) {
	const [open, setOpen] = useState(true);
	const [userToggled, setUserToggled] = useState(false);

	// Auto-collapse when thinking finishes, unless the user manually toggled
	useEffect(() => {
		if (!isStreaming && !userToggled) {
			setOpen(false);
		}
	}, [isStreaming, userToggled]);

	return (
		<div className="mb-2">
			<button
				type="button"
				onClick={() => {
					setUserToggled(true);
					setOpen((o) => !o);
				}}
				className="flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
			>
				<motion.span
					animate={{ rotate: open ? 90 : 0 }}
					transition={{ duration: 0.15 }}
					className="flex"
				>
					<ChevronRight size={10} />
				</motion.span>
				<Brain size={10} />
				{isStreaming ? (
					<span className="flex items-center gap-1">
						Thinking
						<Loader2 size={8} className="animate-spin" />
					</span>
				) : (
					<span>Thought process</span>
				)}
			</button>
			<AnimatePresence>
				{open && (
					<motion.div
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.2 }}
						className="overflow-hidden"
					>
						<div className="mt-1.5 border-l-2 border-muted-foreground/20 pl-3 text-[11px] leading-relaxed text-muted-foreground">
							<MarkdownMessage content={content} />
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

function ToolCallBlock({
	tool,
	arguments: args,
	result,
	isStreaming,
}: {
	tool: string;
	arguments: Record<string, unknown>;
	result?: string;
	isStreaming: boolean;
}) {
	const [open, setOpen] = useState(false);
	const isSandboxTool = tool.startsWith("sandbox__");
	const displayName = isSandboxTool
		? tool.replace("sandbox__", "sandbox / ")
		: tool.includes("__")
			? tool.replace("__", " / ")
			: tool;
	const authError = result ? parseAuthRequiredError(result) : null;

	// For sandbox tools with results, render rich result inline (always visible)
	if (isSandboxTool && result && !isStreaming && !authError) {
		return (
			<div className="mb-1.5">
				<button
					type="button"
					onClick={() => setOpen((o) => !o)}
					className="flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
				>
					<motion.span
						animate={{ rotate: open ? 90 : 0 }}
						transition={{ duration: 0.15 }}
						className="flex"
					>
						<ChevronRight size={10} />
					</motion.span>
					<Wrench size={10} className="text-emerald-500" />
					<span>{displayName}</span>
				</button>

				{/* Rich sandbox result (always visible) */}
				<div className="ml-4 mt-1">
					<SandboxResult result={result} toolName={tool} args={args} />
				</div>

				{/* Collapsible raw arguments (for developer mode) */}
				<AnimatePresence>
					{open && (
						<motion.div
							initial={{ height: 0, opacity: 0 }}
							animate={{ height: "auto", opacity: 1 }}
							exit={{ height: 0, opacity: 0 }}
							transition={{ duration: 0.2 }}
							className="overflow-hidden"
						>
							<div className="mt-1.5 ml-4 space-y-2 border-l-2 border-muted-foreground/20 pl-3 text-[11px] leading-relaxed text-muted-foreground">
								<div>
									<p className="mb-0.5 font-medium text-foreground/70">
										Arguments
									</p>
									<pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2 font-mono text-[10px]">
										{JSON.stringify(args, null, 2)}
									</pre>
								</div>
							</div>
						</motion.div>
					)}
				</AnimatePresence>
			</div>
		);
	}

	// Default rendering for MCP tools and streaming sandbox tools
	return (
		<div className="mb-1.5">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
			>
				<motion.span
					animate={{ rotate: open ? 90 : 0 }}
					transition={{ duration: 0.15 }}
					className="flex"
				>
					<ChevronRight size={10} />
				</motion.span>
				{isStreaming ? (
					<Loader2 size={10} className="animate-spin" />
				) : authError ? (
					<Wrench size={10} className="text-destructive" />
				) : (
					<Wrench size={10} className="text-emerald-500" />
				)}
				<span>
					{displayName}
					{isStreaming ? "..." : ""}
				</span>
				{authError && (
					<span className="text-[10px] text-destructive">— auth required</span>
				)}
			</button>

			{authError && (
				<div className="mt-1.5 ml-4">
					<OAuthReconnectPrompt
						serverUrl={authError.serverUrl}
						errorMessage={authError.error}
					/>
				</div>
			)}

			<AnimatePresence>
				{open && (
					<motion.div
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.2 }}
						className="overflow-hidden"
					>
						<div className="mt-1.5 space-y-2 border-l-2 border-muted-foreground/20 pl-3 text-[11px] leading-relaxed text-muted-foreground">
							<div>
								<p className="mb-0.5 font-medium text-foreground/70">
									Arguments
								</p>
								<pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2 font-mono text-[10px]">
									{JSON.stringify(args, null, 2)}
								</pre>
							</div>
							{result && !authError && (
								<div>
									<p className="mb-0.5 font-medium text-foreground/70">
										Result
									</p>
									<pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2 font-mono text-[10px]">
										{result}
									</pre>
								</div>
							)}
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

function StreamingUsage({
	usage,
	model,
}: {
	usage: UsageData;
	model: string | null;
}) {
	const parts: string[] = [];
	if (model) parts.push(model);
	parts.push(`${usage.promptTokens} in / ${usage.completionTokens} out`);
	if (usage.cost != null) parts.push(`$${usage.cost.toFixed(4)}`);
	return (
		<span className="text-[10px] text-muted-foreground">
			{parts.join(" · ")}
		</span>
	);
}

function EmptyChat({
	suggestedPrompts,
	onPromptClick,
}: {
	suggestedPrompts?: string[];
	onPromptClick: (text: string) => void;
}) {
	const prompts =
		suggestedPrompts && suggestedPrompts.length > 0
			? suggestedPrompts
			: SUGGESTED_PROMPTS;

	return (
		<div className="flex flex-1 flex-col items-center justify-center px-4">
			<motion.div
				initial={{ opacity: 0, y: 12 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.4 }}
				className="text-center"
			>
				<div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center bg-foreground">
					<HarnessMark size={24} className="text-background" />
				</div>
				<h2 className="mb-2 text-lg font-medium text-foreground">
					Start a conversation
				</h2>
				<p className="mb-8 text-sm text-muted-foreground">
					Ask anything — your agent is equipped and ready.
				</p>
				<div className="grid max-w-lg gap-2 sm:grid-cols-2">
					{prompts.slice(0, 4).map((prompt) => (
						<button
							key={prompt}
							type="button"
							onClick={() => onPromptClick(prompt)}
							className="border border-border p-3 text-left text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-muted hover:text-foreground"
						>
							{prompt}
						</button>
					))}
				</div>
			</motion.div>
		</div>
	);
}

function ChatInput({
	conversationId,
	activeHarness,
	sessionModel,
	onSessionModelChange,
	onConvoCreated,
	isStreaming,
	onStream,
	onInterrupt,
	onEnqueue,
	messages: existingMessages,
	messageQueue,
	onDequeue,
	onSendNow,
	pendingPrompt,
	onPendingPromptConsumed,
}: {
	conversationId: Id<"conversations"> | null;
	activeHarness?: {
		_id: Id<"harnesses">;
		name: string;
		model: string;
		mcpServers: Array<{
			name: string;
			url: string;
			authType: McpAuthType;
			authToken?: string;
		}>;
		skills: SkillEntry[];
	};
	onConvoCreated: (id: Id<"conversations">) => void;
	isStreaming: boolean;
	onStream: (body: {
		messages: Array<{
			role: string;
			content: string | Array<Record<string, unknown>>;
		}>;
		harness: {
			model: string;
			mcp_servers: Array<{
				name: string;
				url: string;
				auth_type: McpAuthType;
				auth_token?: string;
			}>;
			skills: SkillEntry[];
			name: string;
		};
		conversation_id: string;
	}) => Promise<void>;
	onInterrupt: (convoId: string) => void;
	onEnqueue: (content: string) => void;
	messages?: Array<{
		role: string;
		content: string;
		attachments?: Array<{
			storageId: Id<"_storage">;
			mimeType: string;
			fileName: string;
			fileSize: number;
		}>;
	}>;
	messageQueue: { id: number; content: string }[];
	onDequeue: (index: number) => void;
	onSendNow: (index: number) => void;
	pendingPrompt?: string | null;
	sessionModel?: string | null;
	onSessionModelChange: (model: string | null) => void;
	onPendingPromptConsumed?: () => void;
}) {
	const [text, setText] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [isDragOver, setIsDragOver] = useState(false);

	const effectiveModel = sessionModel ?? activeHarness?.model;
	const currentModelLabel =
		MODELS.find((m) => m.value === effectiveModel)?.label ?? effectiveModel ?? "Model";

	const supportsMedia = modelSupportsMedia(effectiveModel);
	const supportsAudio = modelSupportsAudio(effectiveModel);
	const supportsAnyAttachment = supportsMedia || supportsAudio;
	const modelAccept = acceptString(effectiveModel);
	const modelAllowedMimes = useMemo(
		() => allowedMimeTypes(effectiveModel),
		[effectiveModel],
	);

	const {
		attachments,
		addFiles,
		removeAttachment,
		clearAttachments,
		hasUploading,
		resolveSignedUrls,
	} = useFileAttachments(modelAllowedMimes);

	// Clear attachments if the active model switches to one that doesn't support media
	useEffect(() => {
		if (!supportsAnyAttachment) clearAttachments();
	}, [supportsAnyAttachment, clearAttachments]);

	// ── Voice recording ──────────────────────────────────────────────
	const [isRecording, setIsRecording] = useState(false);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const chunksRef = useRef<Blob[]>([]);

	const startRecording = useCallback(async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
			chunksRef.current = [];
			recorder.ondataavailable = (e) => {
				if (e.data.size > 0) chunksRef.current.push(e.data);
			};
			recorder.onstop = () => {
				const blob = new Blob(chunksRef.current, { type: "audio/webm" });
				const file = new File([blob], `recording-${Date.now()}.webm`, {
					type: "audio/webm",
				});
				addFiles([file]);
				for (const t of stream.getTracks()) t.stop();
			};
			mediaRecorderRef.current = recorder;
			recorder.start();
			setIsRecording(true);
		} catch {
			toast.error("Microphone access denied");
		}
	}, [addFiles]);

	const stopRecording = useCallback(() => {
		mediaRecorderRef.current?.stop();
		mediaRecorderRef.current = null;
		setIsRecording(false);
	}, []);

	// Fill input from suggested prompt click
	useEffect(() => {
		if (pendingPrompt) {
			setText(pendingPrompt);
			onPendingPromptConsumed?.();
			// Focus and resize after state update
			requestAnimationFrame(() => {
				textareaRef.current?.focus();
			});
		}
	}, [pendingPrompt, onPendingPromptConsumed]);

	// Prompt history state
	const [historyIndex, setHistoryIndex] = useState(-1);
	const [draft, setDraft] = useState("");

	const userPrompts = useMemo(
		() =>
			existingMessages
				?.filter((m) => m.role === "user")
				.map((m) => m.content)
				.reverse() ?? [],
		[existingMessages],
	);

	const createConvo = useMutation({
		mutationFn: useConvexMutation(api.conversations.create),
	});
	const sendMessage = useMutation({
		mutationFn: useConvexMutation(api.messages.send),
	});

	const adjustHeight = useCallback(() => {
		const ta = textareaRef.current;
		if (ta) {
			ta.style.height = "auto";
			ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
		}
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: resize on text change
	useEffect(() => {
		adjustHeight();
	}, [text, adjustHeight]);

	const handleSend = async () => {
		const content = text.trim();
		if (!content || !activeHarness) return;

		setText("");
		setHistoryIndex(-1);
		setDraft("");
		clearAttachments();

		// If streaming, just enqueue — don't interrupt
		if (isStreaming && conversationId) {
			onEnqueue(content);
			return;
		}

		// Snapshot harness config at send time (convert to snake_case for FastAPI)
		const harnessConfig = {
			model: effectiveModel ?? activeHarness.model,
			mcp_servers: activeHarness.mcpServers.map((s) => ({
				name: s.name,
				url: s.url,
				auth_type: s.authType as McpAuthType,
				auth_token: s.authToken,
			})),
			skills: activeHarness.skills ?? [],
			name: activeHarness.name,
			harness_id: activeHarness._id,
			sandbox_enabled: (activeHarness as any).sandboxEnabled ?? false,
			sandbox_id: (activeHarness as any).daytonaSandboxId ?? undefined,
			sandbox_config: (activeHarness as any).sandboxConfig
				? {
						persistent: (activeHarness as any).sandboxConfig.persistent,
						auto_start: (activeHarness as any).sandboxConfig.autoStart,
						default_language: (activeHarness as any).sandboxConfig
							.defaultLanguage,
						resource_tier: (activeHarness as any).sandboxConfig.resourceTier,
					}
				: undefined,
		};

		let convoId = conversationId;
		if (!convoId) {
			const newId = await createConvo.mutateAsync({
				title: content.slice(0, 60),
				harnessId: activeHarness._id,
			});
			convoId = newId;
			onConvoCreated(newId);
		}

		// Snapshot ready attachments from the current render's state (clearAttachments above is async)
		const readyAttachments = attachments
			.filter((a) => a.status === "ready" && a.storageId)
			.map((a) => ({
				storageId: a.storageId as Id<"_storage">,
				mimeType: a.mimeType,
				fileName: a.fileName,
				fileSize: a.fileSize,
			}));

		// Save user message to Convex
		await sendMessage.mutateAsync({
			conversationId: convoId,
			role: "user",
			content,
			harnessId: activeHarness._id,
			...(readyAttachments.length > 0 ? { attachments: readyAttachments } : {}),
		});

		// Build message history for the LLM (with multimodal content where applicable)
		const history: Array<{
			role: string;
			content: string | Array<Record<string, unknown>>;
		}> = [];
		for (const m of existingMessages ?? []) {
			if (m.role === "user" && m.attachments && m.attachments.length > 0) {
				history.push({
					role: m.role,
					content: await buildMultimodalContent(
						m.content,
						m.attachments,
						resolveSignedUrls,
					),
				});
			} else {
				history.push({ role: m.role, content: m.content });
			}
		}

		// Add the new user message (with any current attachments)
		if (readyAttachments.length > 0) {
			history.push({
				role: "user",
				content: await buildMultimodalContent(
					content,
					readyAttachments,
					resolveSignedUrls,
				),
			});
		} else {
			history.push({ role: "user", content });
		}

		// Start streaming from FastAPI
		onStream({
			messages: history,
			harness: harnessConfig,
			conversation_id: convoId,
		});
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
			return;
		}

		if (e.key === "ArrowUp") {
			// Trigger history when empty or single-line (no newlines) so first press works
			const isSingleLine = !text.includes("\n");
			if (isSingleLine || !text) {
				if (userPrompts.length === 0) return;
				e.preventDefault();
				if (historyIndex === -1) {
					setDraft(text);
					setHistoryIndex(0);
					setText(userPrompts[0]);
				} else if (historyIndex < userPrompts.length - 1) {
					const nextIndex = historyIndex + 1;
					setHistoryIndex(nextIndex);
					setText(userPrompts[nextIndex]);
				}
			}
		}

		if (e.key === "ArrowDown") {
			const ta = textareaRef.current;
			if (ta && historyIndex >= 0) {
				e.preventDefault();
				if (historyIndex > 0) {
					const nextIndex = historyIndex - 1;
					setHistoryIndex(nextIndex);
					setText(userPrompts[nextIndex]);
				} else {
					setHistoryIndex(-1);
					setText(draft);
				}
			}
		}
	};

	const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
		if (!supportsAnyAttachment) return;
		const files = Array.from(e.clipboardData.files).filter(
			(f) =>
				f.type.startsWith("image/") ||
				f.type === "application/pdf" ||
				f.type.startsWith("audio/"),
		);
		if (files.length > 0) {
			e.preventDefault();
			addFiles(files);
		}
	};

	const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		if (supportsAnyAttachment && e.dataTransfer.types.includes("Files")) {
			setIsDragOver(true);
		}
	};

	const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
		// Only clear if leaving the container entirely (not moving to a child)
		if (!e.currentTarget.contains(e.relatedTarget as Node)) {
			setIsDragOver(false);
		}
	};

	const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		setIsDragOver(false);
		if (!supportsAnyAttachment) return;
		const files = Array.from(e.dataTransfer.files);
		if (files.length > 0) addFiles(files);
	};

	const showStopButton = isStreaming && !text.trim();

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop drop zone
		<div
			className={cn(
				"relative border-t border-border px-4 py-2 transition-colors",
				isDragOver && "bg-primary/5",
			)}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			{/* Drop overlay */}
			{isDragOver && (
				<div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-primary/50 bg-primary/5">
					<div className="flex items-center gap-2 text-sm font-medium text-primary">
						<Paperclip size={16} />
						Drop files to attach
					</div>
				</div>
			)}

			{/* Hidden file input */}
			<input
				ref={fileInputRef}
				type="file"
				accept={modelAccept}
				multiple
				className="hidden"
				onChange={(e) => {
					if (e.target.files) addFiles(Array.from(e.target.files));
					e.target.value = "";
				}}
			/>

			<div className="mx-auto max-w-xl">
				{/* Queued messages as chips above the input */}
				<AnimatePresence>
					{messageQueue.length > 0 && (
						<motion.div
							initial={{ opacity: 0, height: 0 }}
							animate={{ opacity: 1, height: "auto" }}
							exit={{ opacity: 0, height: 0 }}
							className="mb-2 flex flex-col gap-1.5 overflow-hidden"
						>
							{messageQueue.map((item, idx) => (
								<motion.div
									key={item.id}
									initial={{ opacity: 0, x: -8 }}
									animate={{ opacity: 1, x: 0 }}
									exit={{ opacity: 0, x: 8 }}
									className="group/q flex items-start gap-2 rounded border border-border bg-muted/50 px-2.5 py-1.5"
								>
									<span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
										{item.content}
									</span>
									<div className="flex shrink-0 items-center gap-1">
										<Tooltip>
											<TooltipTrigger asChild>
												<button
													type="button"
													onClick={() => onSendNow(idx)}
													className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
												>
													<ArrowUp size={12} />
												</button>
											</TooltipTrigger>
											<TooltipContent>Send now</TooltipContent>
										</Tooltip>
										<Tooltip>
											<TooltipTrigger asChild>
												<button
													type="button"
													onClick={() => onDequeue(idx)}
													className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
												>
													<X size={12} />
												</button>
											</TooltipTrigger>
											<TooltipContent>Remove</TooltipContent>
										</Tooltip>
									</div>
								</motion.div>
							))}
						</motion.div>
					)}
				</AnimatePresence>

				{/* Attachment preview strip */}
				<AnimatePresence>
					{attachments.length > 0 && (
						<motion.div
							initial={{ opacity: 0, height: 0 }}
							animate={{ opacity: 1, height: "auto" }}
							exit={{ opacity: 0, height: 0 }}
							className="mb-2 flex flex-wrap gap-2 overflow-hidden"
						>
							{attachments.map((attachment) => (
								<AttachmentChip
									key={attachment.localId}
									attachment={attachment}
									onRemove={() => removeAttachment(attachment.localId)}
								/>
							))}
						</motion.div>
					)}
				</AnimatePresence>

				<div className="flex items-center gap-2 border border-border bg-background px-3 py-2 focus-within:border-foreground/30">
					{/* Attach button — hidden for models that don't support media */}
					{supportsAnyAttachment && (
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									onClick={() => fileInputRef.current?.click()}
									className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
								>
									<Paperclip size={15} />
								</button>
							</TooltipTrigger>
							<TooltipContent>Attach files</TooltipContent>
						</Tooltip>
					)}

					{supportsAudio && (
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									onClick={isRecording ? stopRecording : startRecording}
									className={cn(
										"shrink-0 transition-colors",
										isRecording
											? "animate-pulse text-destructive"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									{isRecording ? <Square size={15} /> : <Mic size={15} />}
								</button>
							</TooltipTrigger>
							<TooltipContent>
								{isRecording ? "Stop recording" : "Record audio"}
							</TooltipContent>
						</Tooltip>
					)}

					<textarea
						ref={textareaRef}
						value={text}
						onChange={(e) => {
							setText(e.target.value);
							if (historyIndex !== -1) {
								setHistoryIndex(-1);
								setDraft("");
							}
						}}
						onKeyDown={handleKeyDown}
						onPaste={handlePaste}
						placeholder="Send a message..."
						rows={1}
						className="max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
					/>
					{activeHarness && !(activeHarness as any).lockModel && (
						<DropdownMenu>
							<Tooltip>
								<TooltipTrigger asChild>
									<DropdownMenuTrigger asChild>
										<button
											type="button"
											className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors hover:bg-foreground/10 hover:text-foreground ${sessionModel ? "text-foreground" : "text-muted-foreground"}`}
										>
											{sessionModel && (
												<span className="size-1.5 shrink-0 rounded-full bg-primary" />
											)}
											<span className="max-w-[90px] truncate">{currentModelLabel}</span>
											<ChevronDown size={10} />
										</button>
									</DropdownMenuTrigger>
								</TooltipTrigger>
								<TooltipContent>
									{sessionModel
										? `Session override: ${currentModelLabel}`
										: "Switch model for this session"}
								</TooltipContent>
							</Tooltip>
							<DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
								{sessionModel && (
									<>
										<DropdownMenuItem
											onClick={() => onSessionModelChange(null)}
											className="flex items-center gap-2 text-muted-foreground italic"
										>
											<span className="w-3 shrink-0" />
											Use harness default
										</DropdownMenuItem>
										<DropdownMenuSeparator />
									</>
								)}
								{MODELS.map((model) => (
									<DropdownMenuItem
										key={model.value}
										onClick={() => onSessionModelChange(model.value)}
										className="flex items-center gap-2"
									>
										{model.value === effectiveModel ? (
											<Check size={12} className="shrink-0" />
										) : (
											<span className="w-3 shrink-0" />
										)}
										{model.label}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					)}
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								size="icon-xs"
								onClick={() => {
									if (showStopButton && conversationId) {
										onInterrupt(conversationId);
									} else {
										handleSend();
									}
								}}
								disabled={
									!showStopButton &&
									(!text.trim() ||
										hasUploading ||
										sendMessage.isPending ||
										createConvo.isPending)
								}
								variant={showStopButton ? "destructive" : "default"}
							>
								{showStopButton ? <Square size={10} /> : <ArrowUp size={14} />}
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							{showStopButton
								? "Stop generation"
								: isStreaming
									? "Queue message"
									: "Send message"}
						</TooltipContent>
					</Tooltip>
				</div>
				<p className="mt-1.5 text-center text-[10px] text-muted-foreground">
					Harness may produce inaccurate information.
				</p>
			</div>
		</div>
	);
}

function ChatSkeleton() {
	return (
		<div className="flex h-full bg-background">
			<div className="w-[280px] border-r border-border p-3">
				<Skeleton className="mb-4 h-6 w-24" />
				<div className="space-y-2">
					{["s1", "s2", "s3", "s4", "s5"].map((key) => (
						<Skeleton key={key} className="h-7 w-full" />
					))}
				</div>
			</div>
			<div className="flex flex-1 flex-col">
				<div className="border-b border-border px-4 py-2.5">
					<Skeleton className="h-6 w-40" />
				</div>
				<div className="flex flex-1 items-center justify-center">
					<div className="h-5 w-5 animate-spin border-2 border-foreground border-t-transparent" />
				</div>
			</div>
		</div>
	);
}

function groupByDate(
	conversations: Array<{
		_id: Id<"conversations">;
		title: string;
		lastMessageAt: number;
		lastHarnessId?: Id<"harnesses">;
	}>,
) {
	const now = Date.now();
	const dayMs = 86400000;
	const todayStart = now - (now % dayMs);

	const groups: { label: string; items: typeof conversations }[] = [];
	const today: typeof conversations = [];
	const yesterday: typeof conversations = [];
	const week: typeof conversations = [];
	const older: typeof conversations = [];

	for (const c of conversations) {
		if (c.lastMessageAt >= todayStart) today.push(c);
		else if (c.lastMessageAt >= todayStart - dayMs) yesterday.push(c);
		else if (c.lastMessageAt >= todayStart - 7 * dayMs) week.push(c);
		else older.push(c);
	}

	if (today.length) groups.push({ label: "Today", items: today });
	if (yesterday.length) groups.push({ label: "Yesterday", items: yesterday });
	if (week.length) groups.push({ label: "Previous 7 Days", items: week });
	if (older.length) groups.push({ label: "Older", items: older });

	return groups;
}
