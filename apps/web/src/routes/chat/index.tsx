import { useAuth } from "@clerk/tanstack-react-start";
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
import { useConvexAuth, usePaginatedQuery } from "convex/react";
import {
	Box,
	Check,
	ChevronDown,
	Cpu,
	MessageSquare,
	PanelLeftClose,
	PanelLeftOpen,
	Plus,
	Search, // Icon for search
	Settings,
	Share2,
	SlidersHorizontal,
	Trash2,
	X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { countActiveAgents } from "../../components/chat/background-agents-panel";
import { ChatInput } from "../../components/chat/chat-input";
import { ChatMessages } from "../../components/chat/chat-messages";
import {
	ChatSkeleton,
	EmptyChat,
	groupByDate,
	HighlightText,
	McpFailureBanner,
	SandboxPanelToggle,
} from "../../components/chat/chat-misc";
import { SettingsDialog } from "../../components/chat/settings-dialog";
import { ShareDialog } from "../../components/chat/share-dialog";
import { useChatPaletteCommands } from "../../components/command-palette/commands/chat-commands";
import { HarnessAgentBadge } from "../../components/harness-agent-badge";
import { HarnessMark } from "../../components/harness-mark";
import { HeaderSkillsMenu } from "../../components/header-skills-menu";
import {
	type HealthStatus,
	McpServerStatus,
} from "../../components/mcp-server-status";
import type { DisplayMode } from "../../components/message-actions";
import { RoseCurveSpinner } from "../../components/rose-curve-spinner";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Input } from "../../components/ui/input"; // reuse input from components
import { ScrollArea } from "../../components/ui/scroll-area";
import { Separator } from "../../components/ui/separator";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "../../components/ui/tooltip";
import { UsageDialog } from "../../components/usage-dialog";
import { formatResetTime, UsageBadge } from "../../components/usage-display";
import { env } from "../../env";
import {
	EMPTY_STREAM_STATE,
	useChatStreamContext,
	useChatStreamSideEffects,
} from "../../lib/chat-stream-context";
import {
	agentStreamFields,
	buildHarnessStreamConfig,
} from "../../lib/harness-stream";
import type { McpAuthType } from "../../lib/mcp";
import { fetchCommandsFromApi, sanitizeServerName } from "../../lib/mcp";
import {
	SandboxPanelProvider,
	useSandboxPanel,
} from "../../lib/sandbox-panel-context";
import type { SkillEntry } from "../../lib/skills";
import type { BudgetExceededInfo } from "../../lib/use-chat-stream";
import { toPersistableParts } from "../../lib/use-chat-stream";
import { useFollowStream } from "../../lib/use-follow-stream";
import { cn } from "../../lib/utils";

export const Route = createFileRoute("/chat/")({
	validateSearch: (
		search: Record<string, unknown>,
	): { harnessId?: string; convoId?: string } => ({
		harnessId: (search.harnessId as string) ?? undefined,
		convoId: (search.convoId as string) ?? undefined,
	}),
	beforeLoad: async ({ context, search }) => {
		if (!context.userId) {
			throw redirect({ to: "/sign-in" });
		}
		const settings = await context.queryClient.ensureQueryData(
			convexQuery(api.userSettings.get, {}),
		);
		// A deep-linked conversation (e.g. a freshly forked share) always opens
		// in the simple chat view, even for workspaces-mode users.
		if (settings.workspacesMode === "workspaces" && !search.convoId) {
			throw redirect({
				to: "/workspaces",
			});
		}
	},
	component: ChatPage,
});

const FASTAPI_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";

type SandboxSelection = "harness" | "none" | Id<"sandboxes">;

function ChatPage() {
	const navigate = useNavigate();
	const { getToken } = useAuth();
	const { harnessId: initialHarnessId, convoId: initialConvoId } =
		Route.useSearch();

	const { data: harnesses, isLoading: harnessesLoading } = useQuery(
		convexQuery(api.harnesses.list, {}),
	);
	const { data: conversations } = useQuery(
		convexQuery(api.conversations.list, {}),
	);
	const { data: sandboxes } = useQuery(convexQuery(api.sandboxes.list, {}));
	const { data: userSettings } = useQuery(
		convexQuery(api.userSettings.get, {}),
	);

	const [activeHarnessId, setActiveHarnessId] =
		useState<Id<"harnesses"> | null>(null);
	const [activeSandboxSelection, setActiveSandboxSelection] =
		useState<SandboxSelection>("harness");
	const [activeConvoId, setActiveConvoId] =
		useState<Id<"conversations"> | null>(null);
	// Session-only model override — does not persist to the harness
	const [sessionModel, setSessionModel] = useState<string | null>(null);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
	const [editingMessageId, setEditingMessageId] =
		useState<Id<"messages"> | null>(null);
	const [editingContent, setEditingContent] = useState("");

	// Budget exceeded state
	const [budgetExceeded, setBudgetExceeded] =
		useState<BudgetExceededInfo | null>(null);

	// Streaming state lives in the global provider so an in-flight stream
	// survives navigation away from /chat (e.g. to /harnesses) and back.
	const chatStream = useChatStreamContext();
	const { streamStates, streamStatesRef, clearStreamState, setStreamState } =
		chatStream;

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

	// Bump to force a slash-command refetch (after OAuth, harness edit, etc.)
	const [commandRefreshKey, setCommandRefreshKey] = useState(0);
	const refreshCommands = useCallback(
		() => setCommandRefreshKey((k) => k + 1),
		[],
	);

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

	const dequeueMessage = useCallback((id: number) => {
		// Key by stable id, not array index: the queue can auto-shift between
		// render and click, which would otherwise remove the wrong item.
		messageQueueRef.current = messageQueueRef.current.filter(
			(it) => it.id !== id,
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

	const updateHarness = useMutation({
		mutationFn: useConvexMutation(api.harnesses.update),
	});
	const upsertCommandsMut = useMutation({
		mutationFn: useConvexMutation(api.commands.upsert),
	});

	// Save interrupted assistant message from frontend
	const saveInterruptedMsg = useMutation({
		mutationFn: useConvexMutation(api.messages.saveInterruptedMessage),
	});

	// Save user message (used for queue processing)
	const sendMessageFromQueue = useMutation({
		mutationFn: useConvexMutation(api.messages.send),
	});

	// Persist a turn that ended without a clean "done" — a user Stop (onAbort)
	// OR an agent connection drop that surfaces as onError — so the
	// streamed-so-far content isn't lost. No-op if onDone already saved it.
	const persistInterruptedTurn = (convoId: string) => {
		const state = streamStatesRef.current[convoId];
		if (state?.pendingDoneContent != null) return; // onDone already saved
		if (
			!state ||
			(!state.content && !state.reasoning && state.toolCalls.length === 0)
		) {
			clearStreamState(convoId);
			return;
		}
		// Keep only completed tool calls (those with a result).
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
		// model only arrives in "done"; fall back to session then harness model.
		const model = state.model ?? sessionModel ?? activeHarness?.model ?? null;
		saveInterruptedMsg.mutate(
			{
				conversationId: convoId as Id<"conversations">,
				content: partialContent,
				...(state.reasoning ? { reasoning: state.reasoning } : {}),
				...(completedToolCalls.length > 0
					? { toolCalls: completedToolCalls }
					: {}),
				...(cleanedParts.length > 0
					? { parts: toPersistableParts(cleanedParts) }
					: {}),
				...(state.usage ? { usage: state.usage } : {}),
				...(model ? { model } : {}),
			},
			{
				// If the write fails, clear the bubble so it doesn't wedge (it
				// otherwise only clears on a matching persisted row).
				onError: () => {
					clearStreamState(convoId);
					toast.error("Couldn't save the interrupted response.");
				},
			},
		);
		// Keep the bubble until Convex syncs the interrupted message (set
		// pendingDoneContent so convexHasMessage can match).
		setStreamState(convoId, () => ({
			...state,
			toolCalls: completedToolCalls,
			parts: cleanedParts,
			pendingDoneContent: partialContent,
			model,
		}));
	};

	const drainQueueAfterTurn = (convoId: string) => {
		if (!pendingQueueSendRef.current && messageQueueRef.current.length > 0) {
			const next = shiftQueue();
			if (next) pendingQueueSendRef.current = { convoId, content: next };
		}
	};

	useChatStreamSideEffects({
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
		onBudgetExceeded: (_convoId, info) => {
			setBudgetExceeded(info);
			const which = info.dailyPct >= 100 ? "daily" : "weekly";
			toast.error(
				`${which.charAt(0).toUpperCase() + which.slice(1)} usage limit reached`,
			);
		},
		onError: (convoId, error, kind) => {
			toast.error(error);
			// Persist the streamed-so-far turn ONLY on a connection drop, where
			// the backend skipped its own save. A server-emitted error frame was
			// already persisted backend-side — saving here too would duplicate
			// the assistant row.
			if (kind === "disconnect") persistInterruptedTurn(convoId);
		},
		onAbort: (convoId) => {
			persistInterruptedTurn(convoId);
			drainQueueAfterTurn(convoId);
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
		if (
			activeSandboxSelection === "harness" ||
			activeSandboxSelection === "none" ||
			!sandboxes
		) {
			return;
		}

		if (!sandboxes.some((sandbox) => sandbox._id === activeSandboxSelection)) {
			setActiveSandboxSelection("harness");
		}
	}, [activeSandboxSelection, sandboxes]);

	const { isAuthenticated: convexAuthReady } = useConvexAuth();
	useEffect(() => {
		if (convexAuthReady && harnesses && harnesses.length === 0) {
			navigate({ to: "/onboarding", search: { flow: "first-run" } });
		}
	}, [convexAuthReady, harnesses, navigate]);

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
			clearStreamState(convoId);

			// Process next queued message now that Convex has synced
			if (messageQueueRef.current.length > 0) {
				const next = shiftQueue();
				if (next) {
					pendingQueueSendRef.current = { convoId, content: next };
				}
			}
		},
		[clearStreamState, shiftQueue],
	);

	const activeHarness = harnesses?.find((h) => h._id === activeHarnessId);
	const selectedSandbox =
		activeSandboxSelection !== "harness" && activeSandboxSelection !== "none"
			? sandboxes?.find((sandbox) => sandbox._id === activeSandboxSelection)
			: undefined;
	const effectiveSandboxDaytonaId =
		activeSandboxSelection === "none"
			? null
			: (selectedSandbox?.daytonaSandboxId ??
				activeHarness?.daytonaSandboxId ??
				null);
	const effectiveSandboxEnabled =
		activeSandboxSelection === "none"
			? false
			: Boolean(
					selectedSandbox?.daytonaSandboxId ?? activeHarness?.daytonaSandboxId,
				);

	const handleAddSkill = useCallback(
		(skill: SkillEntry) => {
			if (!activeHarness) return;
			const existing = activeHarness.skills ?? [];
			if (existing.some((s) => s.name === skill.name)) return;
			updateHarness.mutate({
				id: activeHarness._id,
				skills: [...existing, skill],
			});
		},
		[activeHarness, updateHarness],
	);

	const handleRemoveSkill = useCallback(
		(skill: SkillEntry) => {
			if (!activeHarness) return;
			const filtered = (activeHarness.skills ?? []).filter(
				(s) => s.name !== skill.name,
			);
			updateHarness.mutate({ id: activeHarness._id, skills: filtered });
		},
		[activeHarness, updateHarness],
	);

	// Shared builder: queued sends, regenerate, and edit-resend must carry
	// the same agent/credential fields as the composer path — without them
	// the request silently reroutes to the default OpenRouter loop.
	const buildHarnessConfig = useCallback(() => {
		if (!activeHarness) return null;
		return buildHarnessStreamConfig(activeHarness, {
			model: sessionModel,
			sandboxId: effectiveSandboxDaytonaId,
		});
	}, [activeHarness, effectiveSandboxDaytonaId, sessionModel]);

	// Collect all command IDs across the active harness's MCP servers
	const allCommandIds = useMemo(
		() => (activeHarness?.mcpServers ?? []).flatMap((s) => s.commandIds ?? []),
		[activeHarness?.mcpServers],
	);
	const { data: storedCommands } = useQuery(
		convexQuery(
			api.commands.getByIds,
			allCommandIds.length > 0 ? { ids: allCommandIds } : "skip",
		),
	);

	// Health-check MCP servers when harness changes, or on-demand via refreshHealth.
	const healthCheckRunRef = useRef<{ cancel: () => void } | null>(null);
	const runHealthCheck = useCallback(
		(
			servers: Array<{
				name: string;
				url: string;
				authType: McpAuthType;
				authToken?: string;
			}>,
		) => {
			healthCheckRunRef.current?.cancel();

			if (servers.length === 0) {
				setMcpHealthStatuses({});
				return;
			}

			// Mark unknown URLs as checking; preserve already-known statuses so
			// previously-healthy servers don't flash to "Checking…" during a
			// refresh triggered by adding/removing a server.
			setMcpHealthStatuses((prev) => {
				const next: Record<string, HealthStatus> = {};
				for (const s of servers) {
					next[s.url] = prev[s.url] ?? "checking";
				}
				return next;
			});

			let cancelled = false;
			const run = async () => {
				try {
					const token = await getToken();
					const res = await fetch(`${FASTAPI_URL}/api/mcp/health/check`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							...(token ? { Authorization: `Bearer ${token}` } : {}),
						},
						body: JSON.stringify({
							mcp_servers: servers.map((s) => ({
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
						for (const s of servers) fallback[s.url] = "unreachable";
						setMcpHealthStatuses(fallback);
						return;
					}
					const data = await res.json();
					if (cancelled) return;
					const statuses: Record<string, HealthStatus> = {};
					for (const server of data.servers) {
						if (server.status === "ok") statuses[server.url] = "reachable";
						else if (server.status === "auth_required")
							statuses[server.url] = "auth_required";
						else statuses[server.url] = "unreachable";
					}
					setMcpHealthStatuses(statuses);
				} catch {
					if (cancelled) return;
					const fallback: Record<string, HealthStatus> = {};
					for (const s of servers) fallback[s.url] = "unreachable";
					setMcpHealthStatuses(fallback);
				}
			};

			run();
			healthCheckRunRef.current = {
				cancel: () => {
					cancelled = true;
				},
			};
		},
		[getToken],
	);

	const refreshHealth = useCallback(() => {
		if (activeHarness) runHealthCheck(activeHarness.mcpServers);
	}, [activeHarness, runHealthCheck]);

	// Re-run when the harness or its set of MCP server URLs changes. The URL
	// key catches inline adds/removes from the header tooltip without making
	// every harness-doc edit (name, model, etc.) trigger a health re-check.
	const mcpUrlKey = activeHarness?.mcpServers.map((s) => s.url).join("|") ?? "";
	// biome-ignore lint/correctness/useExhaustiveDependencies: deps are id + url-set; runHealthCheck is stable
	useEffect(() => {
		if (!activeHarness) {
			setMcpHealthStatuses({});
			return;
		}
		runHealthCheck(activeHarness.mcpServers);
		return () => {
			healthCheckRunRef.current?.cancel();
		};
	}, [activeHarness?._id, mcpUrlKey]);

	// Sync slash commands: fetch from MCP servers, upsert into commands table,
	// and store the resulting IDs on the harness's mcpServers.
	// Only runs on explicit triggers (OAuth reconnect, etc.) — NOT on harness
	// switch or page load, since connecting to each MCP server is expensive.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only fires on commandRefreshKey
	useEffect(() => {
		if (commandRefreshKey === 0) return; // skip initial mount
		if (!activeHarness || activeHarness.mcpServers.length === 0) return;

		let cancelled = false;
		(async () => {
			try {
				const token = await getToken();
				const cmds = await fetchCommandsFromApi(
					FASTAPI_URL,
					activeHarness.mcpServers,
					token,
				);
				if (cancelled || !cmds || cmds.length === 0) return;

				// Upsert all commands into the commands table (stringify parameters)
				const ids: string[] = await upsertCommandsMut.mutateAsync({
					commands: cmds.map((c) => ({
						name: c.name,
						server: c.server,
						tool: c.tool,
						description: c.description,
						parametersJson: JSON.stringify(c.parameters),
					})),
				});

				if (cancelled) return;

				// Build a name→id map, then assign IDs to each mcpServer
				const idByName = new Map(
					cmds.map((c, i) => [c.name, ids[i] as Id<"commands">]),
				);
				const enriched = activeHarness.mcpServers.map((s) => ({
					name: s.name,
					url: s.url,
					authType: s.authType,
					...(s.authToken ? { authToken: s.authToken } : {}),
					commandIds: [...idByName.entries()]
						.filter(([name]) =>
							name.startsWith(`${sanitizeServerName(s.name)}__`),
						)
						.map(([, id]) => id),
				}));

				if (!cancelled) {
					updateHarness.mutate({
						id: activeHarness._id,
						mcpServers: enriched,
					});
				}
			} catch {
				// Non-blocking — commands are optional
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [commandRefreshKey]);

	const handleInterrupt = useCallback(
		(convoId: string) => {
			chatStream.cancel(convoId);
		},
		[chatStream],
	);

	const sendQueuedMessage = useCallback(
		async (convoId: string, content: string) => {
			if (!activeHarness) return;
			await sendMessageFromQueue.mutateAsync({
				conversationId: convoId as Id<"conversations">,
				role: "user",
				content,
				harnessId: activeHarness._id,
			});

			// Build history from current messages + the new user message
			const msgs = activeMessagesRef.current ?? [];
			const history = [
				...msgs.map((m) => ({ role: m.role, content: m.content })),
				{ role: "user", content },
			];

			const harnessConfig = buildHarnessConfig();
			if (!harnessConfig) return;

			chatStream.stream({
				messages: history,
				harness: harnessConfig,
				conversation_id: convoId,
				...agentStreamFields(harnessConfig),
			});
		},
		[activeHarness, chatStream, sendMessageFromQueue, buildHarnessConfig],
	);

	const handleSendNow = useCallback(
		(id: number) => {
			if (!activeConvoId) return;
			// Key by stable id, not array index (the queue can auto-shift).
			const item = messageQueueRef.current.find((it) => it.id === id);
			if (!item) return;
			messageQueueRef.current = messageQueueRef.current.filter(
				(it) => it.id !== id,
			);
			setMessageQueue([...messageQueueRef.current]);
			// If a turn is in flight, interrupt and let the effect flush after it
			// ends; otherwise there's no controller to cancel (no-op) so send the
			// message directly rather than dropping it.
			if (chatStream.streamingConvoIds.has(activeConvoId)) {
				pendingQueueSendRef.current = {
					convoId: activeConvoId,
					content: item.content,
				};
				chatStream.cancel(activeConvoId);
			} else {
				void sendQueuedMessage(activeConvoId, item.content);
			}
		},
		[activeConvoId, chatStream, sendQueuedMessage],
	);

	// Process pending queued messages after stream ends
	useEffect(() => {
		const pending = pendingQueueSendRef.current;
		if (!pending || !activeHarness) return;

		const convoId = pending.convoId;
		// Wait until the conversation is no longer streaming
		if (chatStream.streamingConvoIds.has(convoId)) return;

		pendingQueueSendRef.current = null;
		void sendQueuedMessage(convoId, pending.content);
	}, [chatStream.streamingConvoIds, activeHarness, sendQueuedMessage]);

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

	// Open a deep-linked conversation once (e.g. a chat just forked from a
	// shared link arriving as /chat?convoId=…). Only opens one the user owns.
	const appliedInitialConvo = useRef(false);
	useEffect(() => {
		if (appliedInitialConvo.current || !initialConvoId || !conversations) {
			return;
		}
		const target = conversations.find((c) => c._id === initialConvoId);
		if (target) {
			appliedInitialConvo.current = true;
			handleSelectConversation(target._id);
		}
	}, [initialConvoId, conversations, handleSelectConversation]);

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

	// removeFrom (not remove): regenerating a mid-conversation message must
	// truncate the conversation there, or the messages after it are orphaned
	// once the new response is appended at the end.
	const truncateFromMessage = useMutation({
		mutationFn: useConvexMutation(api.messages.removeFrom),
	});

	const handleRegenerate = useCallback(
		async (
			messageId: Id<"messages">,
			history: Array<{ role: string; content: string }>,
		) => {
			if (!activeHarness || !activeConvoId) return;
			// Don't regenerate while a turn is in flight, or while a just-finished
			// turn's bubble hasn't synced yet (the action buttons briefly reappear
			// in that window) — it would race the streaming state.
			if (
				chatStream.streamingConvoIds.has(activeConvoId) ||
				streamStatesRef.current[activeConvoId]?.pendingDoneContent != null
			) {
				return;
			}

			await truncateFromMessage.mutateAsync({ id: messageId });

			const harnessConfig = buildHarnessConfig();
			if (!harnessConfig) return;

			chatStream.stream({
				messages: history,
				harness: harnessConfig,
				conversation_id: activeConvoId,
				...agentStreamFields(harnessConfig),
			});
		},
		[
			activeHarness,
			activeConvoId,
			chatStream,
			truncateFromMessage,
			buildHarnessConfig,
			streamStatesRef,
		],
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

				const harnessConfig = buildHarnessConfig();
				if (!harnessConfig) return;

				chatStream.stream({
					messages: history,
					harness: harnessConfig,
					conversation_id: newConvoId,
					...agentStreamFields(harnessConfig),
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
			buildHarnessConfig,
		],
	);

	useChatPaletteCommands({
		isStreaming: activeConvoId
			? chatStream.streamingConvoIds.has(activeConvoId)
			: false,
		canStartNewConversation: Boolean(activeHarnessId),
		sidebarOpen,
		onNewConversation: () => setActiveConvoId(null),
		onCancelStream: () => {
			if (activeConvoId) handleInterrupt(activeConvoId);
		},
		onToggleSidebar: () => setSidebarOpen((v) => !v),
	});

	if (harnessesLoading || !harnesses || harnesses.length === 0) {
		return <ChatSkeleton />;
	}
	const activeConversation = conversations?.find(
		(c) => c._id === activeConvoId,
	);
	const isLocalActiveStreaming = activeConvoId
		? chatStream.streamingConvoIds.has(activeConvoId)
		: false;
	// When THIS tab isn't driving the active conversation's turn (a sharee or
	// another of the owner's tabs is), follow the live token feed so it streams
	// down here too. Disabled while we're the initiator (our local stream is
	// token-perfect — never render both).
	const { followState: ownerFollow, clearFollow: clearOwnerFollow } =
		useFollowStream({
			conversationId: activeConvoId ?? null,
			enabled: !!activeConvoId && !isLocalActiveStreaming,
		});
	const localActiveStreamState = activeConvoId
		? (streamStates[activeConvoId] ?? EMPTY_STREAM_STATE)
		: EMPTY_STREAM_STATE;
	const activeStreamState = isLocalActiveStreaming
		? localActiveStreamState
		: (ownerFollow ?? EMPTY_STREAM_STATE);
	const isActiveConvoStreaming = isLocalActiveStreaming || ownerFollow != null;
	const agentActivityCount = countActiveAgents(
		activeStreamState.parts,
		isActiveConvoStreaming,
	);

	return (
		<SandboxPanelProvider
			sandboxId={effectiveSandboxEnabled ? effectiveSandboxDaytonaId : null}
			agentParts={activeStreamState.parts}
			agentIsStreaming={isActiveConvoStreaming}
		>
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
						conversationId={activeConvoId}
						harness={activeHarness}
						harnesses={harnesses ?? []}
						onSwitchHarness={setActiveHarnessId}
						sandboxes={sandboxes ?? []}
						activeSandboxSelection={activeSandboxSelection}
						onSwitchSandbox={setActiveSandboxSelection}
						effectiveSandboxEnabled={effectiveSandboxEnabled}
						sidebarOpen={sidebarOpen}
						onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
						isStreaming={isActiveConvoStreaming}
						mcpHealthStatuses={mcpHealthStatuses}
						onRefreshCommands={refreshCommands}
						onRefreshHealth={refreshHealth}
						onAddSkill={handleAddSkill}
						onRemoveSkill={handleRemoveSkill}
					/>

					<McpFailureBanner
						failures={mcpFailures}
						onDismiss={(id) =>
							setMcpFailures((prev) => prev.filter((f) => f.id !== id))
						}
						onDismissAll={() => setMcpFailures([])}
					/>

					{budgetExceeded && (
						<div className="mx-4 mt-2 flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
							<div>
								<p className="font-medium">
									{budgetExceeded.dailyPct >= 100 ? "Daily" : "Weekly"} usage
									limit reached
								</p>
								<p className="text-xs text-red-300/70 mt-0.5">
									Resets in{" "}
									{budgetExceeded.dailyPct >= 100
										? formatResetTime(budgetExceeded.dailyReset)
										: formatResetTime(budgetExceeded.weeklyReset)}
								</p>
							</div>
							<Button
								variant="ghost"
								size="sm"
								className="text-red-300 hover:text-red-200"
								onClick={() => setBudgetExceeded(null)}
							>
								<X size={14} />
							</Button>
						</div>
					)}

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
							agentStatus={activeStreamState.agentStatus}
							streamPlan={activeStreamState.plan}
							agentUsage={activeStreamState.agentUsage}
							onStreamSynced={(cid) =>
								isLocalActiveStreaming
									? handleStreamSynced(cid)
									: clearOwnerFollow()
							}
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
							forkedFromShareToken={activeConversation?.forkedFromShareToken}
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
						agentActivityCount={agentActivityCount}
						slashCommands={(storedCommands ?? []).filter(Boolean).map((c) => ({
							name: c?.name,
							server: c?.server,
							tool: c?.tool,
							description: c?.description,
							parameters: JSON.parse(c?.parametersJson),
						}))}
						sessionModel={
							(userSettings?.chatConfigScope ?? "harness") === "harness"
								? null
								: sessionModel
						}
						modelSelectorMode={
							(userSettings?.chatConfigScope as "session" | "harness") ??
							"harness"
						}
						onSessionModelChange={(model) => {
							if (
								(userSettings?.chatConfigScope ?? "harness") === "harness" &&
								model !== null &&
								activeHarnessId &&
								model !== activeHarness?.model
							) {
								updateHarness.mutate({ id: activeHarnessId, model });
							} else {
								setSessionModel(model);
							}
						}}
						onConvoCreated={handleSelectConversation}
						sandboxEnabled={effectiveSandboxEnabled}
						sandboxId={effectiveSandboxDaytonaId ?? undefined}
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
						budgetExceeded={!!budgetExceeded}
					/>
				</div>

				{/* Self-gates on panelOpen; opened by the sandbox toggle (when a
				    sandbox is attached) or the composer Agents button (agent mode),
				    so it works without a sandbox. */}
				<AnimatePresence>
					<SandboxPanelToggle />
				</AnimatePresence>
			</div>
		</SandboxPanelProvider>
	);
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
	const [usageOpen, setUsageOpen] = useState(false);

	return (
		<div className="flex h-full w-[280px] flex-col bg-background">
			<div className="flex items-center justify-between px-3 py-3">
				<Link to="/" className="flex items-center gap-2">
					<HarnessMark size={18} className="text-foreground" />
					<span className="text-sm font-semibold tracking-tight text-foreground">
						Harness
					</span>
				</Link>
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
														<RoseCurveSpinner
															size={12}
															className="text-muted-foreground"
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
			<div className="px-2 py-1">
				<UsageBadge onClick={() => setUsageOpen(true)} />
			</div>
			<Separator />
			<div className="space-y-0.5 p-2">
				<Button
					variant="ghost"
					size="sm"
					className="w-full justify-start"
					asChild
				>
					<Link to="/sandboxes">
						<Box size={12} />
						Manage Sandboxes
					</Link>
				</Button>
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
			<UsageDialog open={usageOpen} onOpenChange={setUsageOpen} />
		</div>
	);
}

function ChatHeader({
	conversationId,
	harness,
	harnesses,
	onSwitchHarness,
	sandboxes,
	activeSandboxSelection,
	onSwitchSandbox,
	effectiveSandboxEnabled,
	sidebarOpen,
	onToggleSidebar,
	isStreaming,
	mcpHealthStatuses,
	onRefreshCommands,
	onRefreshHealth,
	onAddSkill,
	onRemoveSkill,
}: {
	conversationId?: Id<"conversations"> | null;
	harness?: {
		_id: Id<"harnesses">;
		name: string;
		model: string;
		status: string;
		agent?: string;
		agentCredentialId?: string;
		mcpServers: Array<{
			name: string;
			url: string;
			authType: McpAuthType;
			authToken?: string;
			commandIds?: string[];
		}>;
		skills: SkillEntry[];
		sandboxEnabled?: boolean;
		daytonaSandboxId?: string;
	};
	harnesses: Array<{
		_id: Id<"harnesses">;
		name: string;
		model: string;
		status: string;
	}>;
	onSwitchHarness: (id: Id<"harnesses">) => void;
	sandboxes: Array<{
		_id: Id<"sandboxes">;
		name: string;
		daytonaSandboxId: string;
		status: string;
		ephemeral: boolean;
	}>;
	activeSandboxSelection: SandboxSelection;
	onSwitchSandbox: (selection: SandboxSelection) => void;
	effectiveSandboxEnabled: boolean;
	sidebarOpen: boolean;
	onToggleSidebar: () => void;
	isStreaming: boolean;
	mcpHealthStatuses?: Record<string, HealthStatus>;
	onRefreshCommands: () => void;
	onRefreshHealth: () => void;
	onAddSkill: (skill: SkillEntry) => void;
	onRemoveSkill: (skill: SkillEntry) => void;
}) {
	const [shareOpen, setShareOpen] = useState(false);
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
							{harness && (
								<HarnessAgentBadge
									agent={harness.agent}
									agentCredentialId={harness.agentCredentialId}
								/>
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

				{harness && (
					<McpServerStatus
						servers={harness.mcpServers}
						harnessId={harness._id}
						healthStatuses={mcpHealthStatuses}
						onReconnected={() => {
							onRefreshHealth();
							onRefreshCommands();
						}}
						onChanged={() => {
							onRefreshHealth();
							onRefreshCommands();
						}}
					/>
				)}

				{harness && (
					<HeaderSkillsMenu
						skills={harness.skills}
						onAdd={onAddSkill}
						onRemove={onRemoveSkill}
					/>
				)}

				<SandboxSelector
					harness={harness}
					sandboxes={sandboxes}
					activeSandboxSelection={activeSandboxSelection}
					onSwitchSandbox={onSwitchSandbox}
					isStreaming={isStreaming}
					panelAvailable={effectiveSandboxEnabled}
				/>
			</div>

			{conversationId && (
				<div className="flex items-center gap-2">
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="sm"
								className="gap-1.5"
								onClick={() => setShareOpen(true)}
							>
								<Share2 size={13} />
								<span className="text-xs font-medium">Share</span>
							</Button>
						</TooltipTrigger>
						<TooltipContent>Share this chat</TooltipContent>
					</Tooltip>
					<ShareDialog
						conversationId={conversationId}
						open={shareOpen}
						onOpenChange={setShareOpen}
					/>
				</div>
			)}
		</header>
	);
}

function SandboxSelector({
	harness,
	sandboxes,
	activeSandboxSelection,
	onSwitchSandbox,
	isStreaming,
	panelAvailable,
}: {
	harness?: {
		name: string;
		sandboxEnabled?: boolean;
		daytonaSandboxId?: string;
	};
	sandboxes: Array<{
		_id: Id<"sandboxes">;
		name: string;
		daytonaSandboxId: string;
		status: string;
		ephemeral: boolean;
	}>;
	activeSandboxSelection: SandboxSelection;
	onSwitchSandbox: (selection: SandboxSelection) => void;
	isStreaming: boolean;
	panelAvailable: boolean;
}) {
	const panel = useSandboxPanel();
	const panelOpen = !!panel?.panelOpen;
	const selectedSandbox =
		activeSandboxSelection !== "harness" && activeSandboxSelection !== "none"
			? sandboxes.find((sandbox) => sandbox._id === activeSandboxSelection)
			: undefined;
	const defaultSandbox = harness?.daytonaSandboxId
		? sandboxes.find(
				(sandbox) => sandbox.daytonaSandboxId === harness.daytonaSandboxId,
			)
		: undefined;
	const defaultSandboxName =
		defaultSandbox?.name ?? harness?.daytonaSandboxId ?? "None";
	const label =
		activeSandboxSelection === "none"
			? "No sandbox"
			: (selectedSandbox?.name ?? `Default: ${defaultSandboxName}`);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className={cn(
						"gap-1.5",
						panelOpen &&
							"text-emerald-600 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-400",
					)}
					disabled={isStreaming}
				>
					<Box size={12} />
					<span className="max-w-[140px] truncate text-xs font-medium">
						{label}
					</span>
					{panelOpen && (
						<span className="h-1.5 w-1.5 bg-emerald-500" aria-hidden="true" />
					)}
					<ChevronDown size={12} className="text-muted-foreground" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="min-w-60">
				<DropdownMenuItem
					onClick={() => panel?.togglePanel()}
					disabled={!panelAvailable}
				>
					<span className="w-3 shrink-0">
						{panelOpen ? <Check size={12} /> : null}
					</span>
					<div className="min-w-0 flex-1">
						<p className="truncate text-xs">
							{panelOpen ? "Close sandbox panel" : "Open sandbox panel"}
						</p>
						<p className="truncate text-[10px] text-muted-foreground">
							{panelAvailable
								? "Browse files and interact directly"
								: "Attach a sandbox to enable the panel"}
						</p>
					</div>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={() => onSwitchSandbox("harness")}>
					{activeSandboxSelection === "harness" ? (
						<Check size={12} className="shrink-0" />
					) : (
						<span className="w-3 shrink-0" />
					)}
					<div className="min-w-0 flex-1">
						<p className="truncate text-xs">
							Use default: {defaultSandboxName}
						</p>
						<p className="truncate text-[10px] text-muted-foreground">
							{harness?.daytonaSandboxId
								? harness.daytonaSandboxId
								: "No default sandbox"}
						</p>
					</div>
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => onSwitchSandbox("none")}>
					{activeSandboxSelection === "none" ? (
						<Check size={12} className="shrink-0" />
					) : (
						<span className="w-3 shrink-0" />
					)}
					<div className="min-w-0 flex-1">
						<p className="truncate text-xs">No sandbox</p>
						<p className="truncate text-[10px] text-muted-foreground">
							Chat without sandbox tools
						</p>
					</div>
				</DropdownMenuItem>
				{sandboxes.length > 0 && <DropdownMenuSeparator />}
				{sandboxes.map((sandbox) => (
					<DropdownMenuItem
						key={sandbox._id}
						onClick={() => onSwitchSandbox(sandbox._id)}
					>
						{activeSandboxSelection === sandbox._id ? (
							<Check size={12} className="shrink-0" />
						) : (
							<span className="w-3 shrink-0" />
						)}
						<div className="min-w-0 flex-1">
							<p className="truncate text-xs">{sandbox.name}</p>
							<p className="truncate text-[10px] text-muted-foreground">
								{sandbox.status}
								{sandbox.ephemeral ? " · ephemeral" : " · persistent"}
							</p>
						</div>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** Renders the sandbox panel (animated) when open. */
