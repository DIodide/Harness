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
	PanelLeftClose,
	PanelLeftOpen,
	Plus,
	Settings,
	Sparkles,
	Square,
	Trash2,
	User,
	Wrench,
	X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import toast from "react-hot-toast";
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
	DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
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
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

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
				// so fall back to the active harness model
				const model = state.model ?? activeHarness?.model ?? null;

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
					model: activeHarness.model,
					mcp_servers: activeHarness.mcpServers.map((s) => ({
						name: s.name,
						url: s.url,
						auth_type: s.authType as "none" | "bearer" | "oauth",
						auth_token: s.authToken,
					})),
					name: activeHarness.name,
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
				model: activeHarness.model,
				mcp_servers: activeHarness.mcpServers.map((s) => ({
					name: s.name,
					url: s.url,
					auth_type: s.authType as "none" | "bearer" | "oauth",
					auth_token: s.authToken,
				})),
				name: activeHarness.name,
			};

			chatStream.stream({
				messages: history,
				harness: harnessConfig,
				conversation_id: activeConvoId,
			});
		},
		[activeHarness, activeConvoId, chatStream, removeMessage],
	);

	if (harnessesLoading || !harnesses || harnesses.length === 0) {
		return <ChatSkeleton />;
	}
	const activeStreamState = activeConvoId
		? (streamStates[activeConvoId] ?? EMPTY_STREAM_STATE)
		: EMPTY_STREAM_STATE;
	const isActiveConvoStreaming = activeConvoId
		? chatStream.streamingConvoIds.has(activeConvoId)
		: false;

	return (
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
							conversations={conversations ?? []}
							activeConvoId={activeConvoId}
							onSelect={handleSelectConversation}
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
						isStreaming={isActiveConvoStreaming}
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
		</div>
	);
}

function ChatSidebar({
	conversations,
	activeConvoId,
	onSelect,
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

			<ScrollArea className="min-h-0 flex-1 px-2 py-2">
				{conversations.length === 0 ? (
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
						<Settings size={12} />
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
			authType: "none" | "bearer" | "oauth";
			authToken?: string;
		}>;
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
			</div>
		</header>
	);
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
	isStreaming,
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
	isStreaming: boolean;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const userHasScrolledUp = useRef(false);
	const isAutoScrolling = useRef(false);

	// Track user scroll position to avoid hijacking scroll during streaming
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const handleScroll = () => {
			// Ignore scroll events triggered by our own programmatic scrolling
			if (isAutoScrolling.current) return;
			const distanceFromBottom =
				el.scrollHeight - el.scrollTop - el.clientHeight;
			userHasScrolledUp.current = distanceFromBottom > 100;
		};
		el.addEventListener("scroll", handleScroll, { passive: true });
		return () => el.removeEventListener("scroll", handleScroll);
	}, []);

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

	// Reset scroll lock when user sends a new message
	const messageCount = messages?.length ?? 0;
	const lastMsgRole = messages?.[messages.length - 1]?.role;
	// biome-ignore lint/correctness/useExhaustiveDependencies: only reset on new user message
	useEffect(() => {
		if (lastMsgRole === "user") {
			userHasScrolledUp.current = false;
		}
	}, [messageCount]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new messages and streaming
	useEffect(() => {
		if (scrollRef.current && !userHasScrolledUp.current) {
			isAutoScrolling.current = true;
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
			// Reset after the browser fires the scroll event
			requestAnimationFrame(() => {
				isAutoScrolling.current = false;
			});
		}
	}, [messages, streamingContent, streamingReasoning]);

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
				{messages?.map((msg, i) => {
					// Skip entrance animation for the message that just replaced the streaming bubble
					const isJustSynced = convexHasMessage && msg._id === lastMsg?._id;
					return (
						<motion.div
							key={msg._id}
							initial={isJustSynced ? false : { opacity: 0, y: 8 }}
							animate={{ opacity: 1, y: 0 }}
							transition={isJustSynced ? { duration: 0 } : { delay: i * 0.03 }}
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
							<div className="max-w-[80%]">
								<div
									className={cn(
										"text-sm leading-relaxed",
										msg.role === "user"
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
													<MarkdownMessage key={key} content={part.content} />
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
													const history = messages.slice(0, idx).map((m) => ({
														role: m.role,
														content: m.content,
													}));
													onRegenerate(msg._id, history);
												}
											: undefined
									}
								/>
							</div>
							{msg.role === "user" && (
								<Avatar className="h-7 w-7 shrink-0">
									<AvatarFallback className="bg-muted text-foreground text-[10px]">
										U
									</AvatarFallback>
								</Avatar>
							)}
						</motion.div>
					);
				})}

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
	const displayName = tool.includes("__") ? tool.replace("__", " / ") : tool;
	const authError = result ? parseAuthRequiredError(result) : null;

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
			authType: "none" | "bearer" | "oauth";
			authToken?: string;
		}>;
	};
	onConvoCreated: (id: Id<"conversations">) => void;
	isStreaming: boolean;
	onStream: (body: {
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
		};
		conversation_id: string;
	}) => Promise<void>;
	onInterrupt: (convoId: string) => void;
	onEnqueue: (content: string) => void;
	messages?: Array<{ role: string; content: string }>;
	messageQueue: { id: number; content: string }[];
	onDequeue: (index: number) => void;
	onSendNow: (index: number) => void;
	pendingPrompt?: string | null;
	onPendingPromptConsumed?: () => void;
}) {
	const [text, setText] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);

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

		// If streaming, just enqueue — don't interrupt
		if (isStreaming && conversationId) {
			onEnqueue(content);
			return;
		}

		// Snapshot harness config at send time (convert to snake_case for FastAPI)
		const harnessConfig = {
			model: activeHarness.model,
			mcp_servers: activeHarness.mcpServers.map((s) => ({
				name: s.name,
				url: s.url,
				auth_type: s.authType as "none" | "bearer" | "oauth",
				auth_token: s.authToken,
			})),
			name: activeHarness.name,
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

		// Save user message to Convex
		await sendMessage.mutateAsync({
			conversationId: convoId,
			role: "user",
			content,
			harnessId: activeHarness._id,
		});

		// Build message history for the LLM
		const history: Array<{ role: string; content: string }> =
			existingMessages?.map((m) => ({
				role: m.role,
				content: m.content,
			})) ?? [];
		history.push({ role: "user", content });

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

	const showStopButton = isStreaming && !text.trim();

	return (
		<div className="border-t border-border px-4 py-3">
			<div className="mx-auto max-w-3xl">
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

				<div className="flex items-end gap-2 border border-border bg-background px-3 py-2 focus-within:border-foreground/30">
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
						placeholder="Send a message..."
						rows={1}
						className="max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
					/>
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
