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
	Pencil,
	Plus,
	Search, // Icon for search
	Settings,
	SlidersHorizontal,
	Sparkles,
	Trash2,
	Wrench,
	X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
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
import { useChatPaletteCommands } from "../../components/command-palette/commands/chat-commands";
import { useWorkspaceActionCommands } from "../../components/command-palette/commands/workspace-action-commands";
import { useWorkspaceSwitchCommands } from "../../components/command-palette/commands/workspace-switch-commands";
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
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "../../components/ui/tooltip";
import { UsageDialog } from "../../components/usage-dialog";
import { formatResetTime, UsageBadge } from "../../components/usage-display";
import { WorkspaceColorPicker } from "../../components/workspace-color-picker";
import { env } from "../../env";
import {
	useModifierHeld,
	useWorkspaceShortcuts,
} from "../../hooks/use-workspace-shortcuts";
import {
	EMPTY_STREAM_STATE,
	useChatStreamContext,
	useChatStreamSideEffects,
} from "../../lib/chat-stream-context";
import type { McpAuthType } from "../../lib/mcp";
import { ariaKeyShortcut, formatShortcut, useIsMac } from "../../lib/platform";
import {
	SandboxPanelProvider,
	useSandboxPanel,
} from "../../lib/sandbox-panel-context";
import type { SkillEntry } from "../../lib/skills";
import type { BudgetExceededInfo } from "../../lib/use-chat-stream";
import { toPersistableParts } from "../../lib/use-chat-stream";
import { cn } from "../../lib/utils";
import { getWorkspaceColorHex } from "../../lib/workspace-colors";

export const Route = createFileRoute("/workspaces/")({
	validateSearch: (
		search: Record<string, unknown>,
	): { harnessId?: string; workspaceId?: string } => ({
		harnessId: (search.harnessId as string) ?? undefined,
		workspaceId: (search.workspaceId as string) ?? undefined,
	}),
	beforeLoad: async ({ context }) => {
		if (!context.userId) {
			throw redirect({ to: "/sign-in" });
		}
		const settings = await context.queryClient.ensureQueryData(
			convexQuery(api.userSettings.get, {}),
		);
		if (settings.workspacesMode !== "workspaces") {
			throw redirect({
				to: "/chat",
			});
		}
	},
	component: ChatPage,
});

const FASTAPI_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";

type SandboxSelection = "harness" | "none" | Id<"sandboxes">;
const NONE_OPTION = "__none__";

const LAST_CHAT_RESTORE_WINDOW_MS = 8 * 60 * 60 * 1000;

function ChatPage() {
	const navigate = useNavigate();
	const { getToken } = useAuth();
	const { harnessId: initialHarnessId, workspaceId: initialWorkspaceId } =
		Route.useSearch();

	const { data: harnesses, isLoading: harnessesLoading } = useQuery(
		convexQuery(api.harnesses.list, {}),
	);
	const { data: workspaces } = useQuery(convexQuery(api.workspaces.list, {}));

	// Every user should have a workspace for chats to live in — create the
	// Default lazily for accounts predating (or skipping) onboarding.
	const ensureDefaultWorkspace = useMutation({
		mutationFn: useConvexMutation(api.workspaces.ensureDefault),
	});
	const ensuredDefaultRef = useRef(false);
	useEffect(() => {
		if (workspaces && workspaces.length === 0 && !ensuredDefaultRef.current) {
			ensuredDefaultRef.current = true;
			ensureDefaultWorkspace.mutate({});
		}
	}, [workspaces, ensureDefaultWorkspace]);
	const { data: sandboxes } = useQuery(convexQuery(api.sandboxes.list, {}));
	const { data: userSettings } = useQuery(
		convexQuery(api.userSettings.get, {}),
	);

	const [activeHarnessId, setActiveHarnessId] =
		useState<Id<"harnesses"> | null>(null);
	const [activeWorkspaceId, setActiveWorkspaceId] =
		useState<Id<"workspaces"> | null>(null);
	const [activeSandboxSelection, setActiveSandboxSelection] =
		useState<SandboxSelection>("harness");
	const [activeConvoId, setActiveConvoId] =
		useState<Id<"conversations"> | null>(null);
	const { data: conversations } = useQuery(
		convexQuery(
			api.conversations.list,
			activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
		),
	);

	const prevWorkspaceIdRef = useRef<Id<"workspaces"> | null>(null);
	const pendingRestoreWorkspaceIdRef = useRef<Id<"workspaces"> | null>(null);
	// Session-only model override — does not persist to the harness
	const [sessionModel, setSessionModel] = useState<string | null>(null);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [pendingEditWorkspaceId, setPendingEditWorkspaceId] =
		useState<Id<"workspaces"> | null>(null);
	const [pendingCreateWorkspace, setPendingCreateWorkspace] = useState(0);
	const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
	const [editingMessageId, setEditingMessageId] =
		useState<Id<"messages"> | null>(null);
	const [editingContent, setEditingContent] = useState("");

	// Budget exceeded state
	const [budgetExceeded, setBudgetExceeded] =
		useState<BudgetExceededInfo | null>(null);

	// Streaming state lives in the global provider so an in-flight stream
	// survives navigation away from /workspaces (e.g. to /harnesses) and back.
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

	const updateHarness = useMutation({
		mutationFn: useConvexMutation(api.harnesses.update),
	});

	// Save interrupted assistant message from frontend
	const saveInterruptedMsg = useMutation({
		mutationFn: useConvexMutation(api.messages.saveInterruptedMessage),
	});

	// Save user message (used for queue processing)
	const sendMessageFromQueue = useMutation({
		mutationFn: useConvexMutation(api.messages.send),
	});

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
		onError: (_convoId, error) => {
			toast.error(error);
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
				clearStreamState(convoId);
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
				const model =
					state.model ?? sessionModel ?? activeHarness?.model ?? null;

				saveInterruptedMsg.mutate({
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
				});

				// Keep streaming bubble visible until Convex syncs the interrupted message
				// (same pattern as onDone — set pendingDoneContent so convexHasMessage can match)
				setStreamState(convoId, () => ({
					...state,
					toolCalls: completedToolCalls,
					parts: cleanedParts,
					pendingDoneContent: partialContent,
					model,
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

	// When the active workspace changes, queue a one-shot attempt to restore the
	// workspace's most-recent chat (if touched within LAST_CHAT_RESTORE_WINDOW_MS).
	// Tracked via a ref so nulling activeConvoId on "New chat" doesn't re-trigger.
	useEffect(() => {
		if (prevWorkspaceIdRef.current === activeWorkspaceId) return;
		prevWorkspaceIdRef.current = activeWorkspaceId;
		pendingRestoreWorkspaceIdRef.current = activeWorkspaceId;
	}, [activeWorkspaceId]);

	useEffect(() => {
		const pending = pendingRestoreWorkspaceIdRef.current;
		if (!pending || pending !== activeWorkspaceId) return;
		if (!conversations) return;
		if (activeConvoId) {
			pendingRestoreWorkspaceIdRef.current = null;
			return;
		}
		pendingRestoreWorkspaceIdRef.current = null;
		const cutoff = Date.now() - LAST_CHAT_RESTORE_WINDOW_MS;
		const mostRecent = conversations.find(
			(c) =>
				!(c as Record<string, unknown>).editParentConversationId &&
				c.lastMessageAt >= cutoff,
		);
		if (mostRecent) {
			setActiveConvoId(mostRecent._id);
		}
	}, [activeWorkspaceId, conversations, activeConvoId]);

	useEffect(() => {
		if (!workspaces || workspaces.length === 0) {
			setActiveWorkspaceId(null);
			setActiveConvoId(null);
			return;
		}

		if (
			activeWorkspaceId &&
			workspaces.some((workspace) => workspace._id === activeWorkspaceId)
		) {
			return;
		}

		if (
			initialWorkspaceId &&
			workspaces.some((workspace) => workspace._id === initialWorkspaceId)
		) {
			setActiveWorkspaceId(initialWorkspaceId as Id<"workspaces">);
			return;
		}

		setActiveWorkspaceId(workspaces[0]._id);
	}, [workspaces, activeWorkspaceId, initialWorkspaceId]);

	const activeWorkspace = workspaces?.find(
		(workspace) => workspace._id === activeWorkspaceId,
	);

	useEffect(() => {
		if (!activeWorkspace) {
			if (!initialHarnessId && harnesses?.length) {
				const started = harnesses.find((h) => h.status === "started");
				setActiveHarnessId(started?._id ?? harnesses[0]._id);
			}
			setActiveSandboxSelection("harness");
			return;
		}

		if (activeWorkspace.harnessId) {
			setActiveHarnessId(activeWorkspace.harnessId);
		} else {
			setActiveHarnessId(null);
		}
		setActiveSandboxSelection(activeWorkspace.sandboxId ?? "none");
		navigate({
			to: "/workspaces",
			search: { workspaceId: activeWorkspace._id },
			replace: true,
		});
	}, [activeWorkspace, harnesses, initialHarnessId, navigate]);

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

	const updateWorkspaceSandboxFn = useConvexMutation(api.workspaces.update);
	const handleSwapSandbox = useCallback(
		(sandboxId: Id<"sandboxes">) => {
			if (!activeWorkspaceId) return;
			setActiveSandboxSelection(sandboxId);
			updateWorkspaceSandboxFn({ id: activeWorkspaceId, sandboxId }).catch(
				() => {
					toast.error("Failed to switch sandbox");
				},
			);
		},
		[activeWorkspaceId, updateWorkspaceSandboxFn],
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

	const buildHarnessConfig = useCallback(() => {
		if (!activeHarness) return null;

		return {
			model: sessionModel ?? activeHarness.model,
			mcp_servers: activeHarness.mcpServers.map((s) => ({
				name: s.name,
				url: s.url,
				auth_type: s.authType as "none" | "bearer" | "oauth" | "tiger_junction",
				auth_token: s.authToken,
			})),
			skills: activeHarness.skills ?? [],
			name: activeHarness.name,
			harness_id: activeHarness._id,
			system_prompt: activeHarness.systemPrompt ?? undefined,
			sandbox_enabled: effectiveSandboxEnabled,
			sandbox_id: effectiveSandboxDaytonaId ?? undefined,
			sandbox_config: activeHarness.sandboxConfig
				? {
						persistent: activeHarness.sandboxConfig.persistent,
						auto_start: activeHarness.sandboxConfig.autoStart,
						default_language: activeHarness.sandboxConfig.defaultLanguage,
						resource_tier: activeHarness.sandboxConfig.resourceTier,
					}
				: undefined,
		};
	}, [
		activeHarness,
		effectiveSandboxDaytonaId,
		effectiveSandboxEnabled,
		sessionModel,
	]);

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

			const harnessConfig = buildHarnessConfig();
			if (!harnessConfig) return;

			chatStream.stream({
				messages: history,
				harness: harnessConfig,
				conversation_id: convoId,
			});
		};

		run();
	}, [
		chatStream.streamingConvoIds,
		activeHarness,
		chatStream,
		sendMessageFromQueue,
		buildHarnessConfig,
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

			const harnessConfig = buildHarnessConfig();
			if (!harnessConfig) return;

			chatStream.stream({
				messages: history,
				harness: harnessConfig,
				conversation_id: activeConvoId,
			});
		},
		[
			activeHarness,
			activeConvoId,
			chatStream,
			removeMessage,
			buildHarnessConfig,
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
		canStartNewConversation: Boolean(activeWorkspace),
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
	const activeStreamState = activeConvoId
		? (streamStates[activeConvoId] ?? EMPTY_STREAM_STATE)
		: EMPTY_STREAM_STATE;
	const isActiveConvoStreaming = activeConvoId
		? chatStream.streamingConvoIds.has(activeConvoId)
		: false;

	return (
		<SandboxPanelProvider
			sandboxId={effectiveSandboxEnabled ? effectiveSandboxDaytonaId : null}
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
							<WorkspaceSidebar
								workspaces={workspaces ?? []}
								harnesses={harnesses ?? []}
								sandboxes={sandboxes ?? []}
								activeWorkspaceId={activeWorkspaceId}
								onSelectWorkspace={(workspaceId) => {
									setActiveWorkspaceId(workspaceId);
									setActiveConvoId(null);
								}}
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
								pendingEditWorkspaceId={pendingEditWorkspaceId}
								onPendingEditConsumed={() => setPendingEditWorkspaceId(null)}
								pendingCreateWorkspace={pendingCreateWorkspace}
							/>
						</motion.aside>
					)}
				</AnimatePresence>

				<div className="flex flex-1 flex-col overflow-hidden">
					<ChatHeader
						workspace={activeWorkspace}
						harness={activeHarness}
						sandboxes={sandboxes ?? []}
						activeSandboxSelection={activeSandboxSelection}
						effectiveSandboxEnabled={effectiveSandboxEnabled}
						sidebarOpen={sidebarOpen}
						onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
						mcpHealthStatuses={mcpHealthStatuses}
						onRefreshHealth={refreshHealth}
						onSwapSandbox={handleSwapSandbox}
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

					{!activeWorkspace ? (
						<EmptyWorkspaceState
							hasWorkspaces={(workspaces ?? []).length > 0}
							onCreateWorkspace={() => {
								setSidebarOpen(true);
								setPendingCreateWorkspace((n) => n + 1);
							}}
						/>
					) : !activeHarness ? (
						<NoHarnessAttachedState
							workspaceName={activeWorkspace.name}
							onAttachHarness={() => {
								setSidebarOpen(true);
								setPendingEditWorkspaceId(activeWorkspace._id);
							}}
						/>
					) : activeConvoId ? (
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
						activeHarness={activeWorkspace ? activeHarness : undefined}
						disabled={!activeWorkspace || !activeHarness}
						placeholder={
							!activeWorkspace
								? "Select a workspace to start chatting"
								: !activeHarness
									? "Attach a harness to this workspace to start chatting"
									: "Send a message..."
						}
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
						workspaceId={activeWorkspaceId ?? undefined}
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

				<AnimatePresence>
					{effectiveSandboxEnabled && <SandboxPanelToggle />}
				</AnimatePresence>
			</div>
		</SandboxPanelProvider>
	);
}

function WorkspaceSidebar({
	workspaces,
	harnesses,
	sandboxes,
	activeWorkspaceId,
	onSelectWorkspace,
	conversations,
	activeConvoId,
	onSelect,
	onSelectMessage, // called when user clicks a content match
	harnessId,
	onClose,
	streamingConvoIds,
	doneConvoIds,
	pendingEditWorkspaceId,
	onPendingEditConsumed,
	pendingCreateWorkspace,
}: {
	workspaces: Array<{
		_id: Id<"workspaces">;
		name: string;
		harnessId?: Id<"harnesses">;
		sandboxId?: Id<"sandboxes">;
		color?: string;
	}>;
	harnesses: Array<{
		_id: Id<"harnesses">;
		name: string;
		status: string;
		model: string;
	}>;
	sandboxes: Array<{
		_id: Id<"sandboxes">;
		name: string;
		status: string;
		ephemeral: boolean;
	}>;
	activeWorkspaceId: Id<"workspaces"> | null;
	onSelectWorkspace: (id: Id<"workspaces">) => void;
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
	pendingEditWorkspaceId?: Id<"workspaces"> | null;
	onPendingEditConsumed?: () => void;
	pendingCreateWorkspace?: number;
}) {
	const removeConvo = useMutation({
		mutationFn: useConvexMutation(api.conversations.remove),
		onSuccess: () => {
			if (activeConvoId) onSelect(null);
		},
	});
	const createWorkspace = useMutation({
		mutationFn: useConvexMutation(api.workspaces.create),
		onSuccess: (workspaceId) => {
			onSelectWorkspace(workspaceId as Id<"workspaces">);
			setCreateOpen(false);
			setNewWorkspaceName("");
			setNewWorkspaceColor(null);
		},
	});
	const updateWorkspace = useMutation({
		mutationFn: useConvexMutation(api.workspaces.update),
		onSuccess: () => {
			setRenameWorkspace(null);
			setRenameWorkspaceName("");
			setRenameWorkspaceHarnessId(null);
			setRenameWorkspaceSandboxId(null);
			setRenameWorkspaceColor(null);
		},
	});

	const isMac = useIsMac();
	useWorkspaceShortcuts(workspaces, onSelectWorkspace, isMac);
	useWorkspaceSwitchCommands(workspaces, onSelectWorkspace, isMac);
	const modifierHeld = useModifierHeld(isMac);

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
		searchQuery.length > 0 && activeWorkspaceId
			? { query: searchQuery, workspaceId: activeWorkspaceId }
			: "skip",
		{ initialNumItems: INITIAL_TITLE_COUNT },
	);

	const contentSearch = usePaginatedQuery(
		api.conversations.searchContent,
		searchQuery.length > 0 && activeWorkspaceId
			? { query: searchQuery, workspaceId: activeWorkspaceId }
			: "skip",
		{ initialNumItems: INITIAL_CONTENT_COUNT },
	);

	const { data: titleCount } = useQuery({
		...convexQuery(
			api.conversations.searchTitlesCount,
			searchQuery.length > 0 && activeWorkspaceId
				? { query: searchQuery, workspaceId: activeWorkspaceId }
				: "skip",
		),
	});

	const { data: contentCount } = useQuery({
		...convexQuery(
			api.conversations.searchContentCount,
			searchQuery.length > 0 && activeWorkspaceId
				? { query: searchQuery, workspaceId: activeWorkspaceId }
				: "skip",
		),
	});

	const grouped = groupByDate(conversations);

	const [settingsOpen, setSettingsOpen] = useState(false);
	const [usageOpen, setUsageOpen] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	const [newWorkspaceName, setNewWorkspaceName] = useState("");
	const [renameWorkspace, setRenameWorkspace] = useState<{
		_id: Id<"workspaces">;
		name: string;
		harnessId?: Id<"harnesses">;
		sandboxId?: Id<"sandboxes">;
		color?: string;
	} | null>(null);
	const [renameWorkspaceName, setRenameWorkspaceName] = useState("");
	const [renameWorkspaceHarnessId, setRenameWorkspaceHarnessId] =
		useState<Id<"harnesses"> | null>(null);
	const [renameWorkspaceSandboxId, setRenameWorkspaceSandboxId] =
		useState<Id<"sandboxes"> | null>(null);
	const [newWorkspaceHarnessId, setNewWorkspaceHarnessId] =
		useState<Id<"harnesses"> | null>(null);
	const [newWorkspaceSandboxId, setNewWorkspaceSandboxId] =
		useState<Id<"sandboxes"> | null>(null);
	const [newWorkspaceColor, setNewWorkspaceColor] = useState<string | null>(
		null,
	);
	const [renameWorkspaceColor, setRenameWorkspaceColor] = useState<
		string | null
	>(null);
	const [confirmDeleteWorkspace, setConfirmDeleteWorkspace] = useState(false);

	function resetRenameWorkspaceDialog() {
		setRenameWorkspace(null);
		setRenameWorkspaceName("");
		setRenameWorkspaceHarnessId(null);
		setRenameWorkspaceSandboxId(null);
		setRenameWorkspaceColor(null);
		setConfirmDeleteWorkspace(false);
	}

	const deleteWorkspace = useMutation({
		mutationFn: useConvexMutation(api.workspaces.remove),
		onSuccess: () => {
			resetRenameWorkspaceDialog();
			toast.success("Workspace deleted");
		},
		onError: () => {
			setConfirmDeleteWorkspace(false);
			toast.error("Failed to delete workspace");
		},
	});

	const createSelectedWorkspace = () => {
		const harness = harnesses.find(
			(item) => item._id === newWorkspaceHarnessId,
		);
		const sandbox = sandboxes.find(
			(item) => item._id === newWorkspaceSandboxId,
		);
		createWorkspace.mutate({
			name:
				newWorkspaceName.trim() ||
				(harness && sandbox
					? `${harness.name} / ${sandbox.name}`
					: (harness?.name ?? sandbox?.name ?? "New workspace")),
			...(newWorkspaceHarnessId ? { harnessId: newWorkspaceHarnessId } : {}),
			...(newWorkspaceSandboxId ? { sandboxId: newWorkspaceSandboxId } : {}),
			...(newWorkspaceColor ? { color: newWorkspaceColor } : {}),
		});
	};

	const startRenameWorkspace = (workspace: {
		_id: Id<"workspaces">;
		name: string;
		harnessId?: Id<"harnesses">;
		sandboxId?: Id<"sandboxes">;
		color?: string;
	}) => {
		setRenameWorkspace(workspace);
		setRenameWorkspaceName(workspace.name);
		setRenameWorkspaceHarnessId(workspace.harnessId ?? null);
		setRenameWorkspaceSandboxId(workspace.sandboxId ?? null);
		setRenameWorkspaceColor(workspace.color ?? null);
		setConfirmDeleteWorkspace(false);
	};

	// Open the edit dialog when an external trigger (e.g. the empty-state
	// "Attach a harness" CTA) requests it for a specific workspace.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only react to id changes
	useEffect(() => {
		if (!pendingEditWorkspaceId) return;
		const workspace = workspaces.find((w) => w._id === pendingEditWorkspaceId);
		if (workspace) startRenameWorkspace(workspace);
		onPendingEditConsumed?.();
	}, [pendingEditWorkspaceId]);

	useEffect(() => {
		if (!pendingCreateWorkspace) return;
		setCreateOpen(true);
	}, [pendingCreateWorkspace]);

	const saveWorkspaceName = () => {
		if (!renameWorkspace) return;
		const name = renameWorkspaceName.trim();
		if (!name) {
			toast.error("Workspace name is required");
			return;
		}
		updateWorkspace.mutate({
			id: renameWorkspace._id,
			name,
			harnessId: renameWorkspaceHarnessId,
			sandboxId: renameWorkspaceSandboxId,
			// Empty string clears any existing color on the server.
			color: renameWorkspaceColor ?? "",
		});
	};

	const removeWorkspace = () => {
		if (!renameWorkspace) return;
		if (!confirmDeleteWorkspace) {
			setConfirmDeleteWorkspace(true);
			return;
		}
		deleteWorkspace.mutate({ id: renameWorkspace._id });
	};

	const activeWorkspace = workspaces.find((w) => w._id === activeWorkspaceId);
	useWorkspaceActionCommands({
		activeWorkspace,
		canCreateWorkspace: true,
		onCreateWorkspace: () => setCreateOpen(true),
		onRenameActiveWorkspace: () => {
			if (activeWorkspace) startRenameWorkspace(activeWorkspace);
		},
	});

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

			<div className="shrink-0 px-2 py-2">
				<div className="mb-1 flex items-center justify-between px-2">
					<p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
						Workspaces
					</p>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon-xs"
								onClick={() => setCreateOpen(true)}
							>
								<Plus size={12} />
							</Button>
						</TooltipTrigger>
						<TooltipContent>New workspace</TooltipContent>
					</Tooltip>
				</div>
				<ScrollArea className="h-56">
					<div className="space-y-0.5 pr-2">
						{workspaces.length === 0 ? (
							<p className="px-2 py-2 text-[11px] text-muted-foreground">
								Create a workspace to start.
							</p>
						) : (
							workspaces.map((workspace, index) => {
								const harness = harnesses.find(
									(item) => item._id === workspace.harnessId,
								);
								const sandbox = sandboxes.find(
									(item) => item._id === workspace.sandboxId,
								);
								const colorHex = getWorkspaceColorHex(workspace.color);
								const isActive = activeWorkspaceId === workspace._id;
								const hasShortcut = index < 9;
								const shortcutDigit = index + 1;
								return (
									<div key={workspace._id} className="group relative">
										<button
											type="button"
											onClick={() => onSelectWorkspace(workspace._id)}
											aria-keyshortcuts={
												hasShortcut
													? ariaKeyShortcut(shortcutDigit, isMac)
													: undefined
											}
											title={
												hasShortcut
													? `${workspace.name} — ${formatShortcut(shortcutDigit, isMac)}`
													: workspace.name
											}
											style={
												colorHex ? { backgroundColor: colorHex } : undefined
											}
											className={cn(
												"flex w-full items-start gap-2 rounded-md px-2 py-2 pr-8 text-left transition-all",
												colorHex
													? "text-foreground hover:brightness-95"
													: isActive
														? "bg-muted text-foreground"
														: "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
												isActive &&
													colorHex &&
													"ring-2 ring-inset ring-foreground/40",
											)}
										>
											<Sparkles size={12} className="mt-0.5 shrink-0" />
											<span className="min-w-0 flex-1">
												<span className="block truncate text-xs font-medium">
													{workspace.name}
												</span>
												<span
													className={cn(
														"block truncate text-[10px]",
														colorHex
															? "text-foreground/60"
															: "text-muted-foreground",
													)}
												>
													{harness?.name ?? "None"} / {sandbox?.name ?? "None"}
												</span>
											</span>
										</button>
										{modifierHeld && hasShortcut && (
											<span
												aria-hidden="true"
												className="pointer-events-none absolute right-1 top-1 rounded-sm bg-background/85 px-1 py-0.5 font-mono text-[9px] leading-none text-muted-foreground ring-1 ring-border/60 backdrop-blur-sm transition-opacity group-hover:opacity-0"
											>
												{formatShortcut(shortcutDigit, isMac)}
											</span>
										)}
										<Tooltip>
											<TooltipTrigger asChild>
												<Button
													variant="ghost"
													size="icon-xs"
													className="absolute right-1 top-1.5 opacity-0 group-hover:opacity-100"
													onClick={(event) => {
														event.stopPropagation();
														startRenameWorkspace(workspace);
													}}
												>
													<Pencil size={10} />
												</Button>
											</TooltipTrigger>
											<TooltipContent>Edit workspace</TooltipContent>
										</Tooltip>
									</div>
								);
							})
						)}
					</div>
				</ScrollArea>
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

			<Dialog open={createOpen} onOpenChange={setCreateOpen}>
				<DialogContent className="sm:max-w-sm">
					<DialogHeader>
						<DialogTitle className="text-sm">New Workspace</DialogTitle>
						<DialogDescription>
							Name this workspace and select its harness and sandbox.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-1.5">
							<p className="text-xs font-medium text-foreground">Name</p>
							<Input
								value={newWorkspaceName}
								onChange={(event) => setNewWorkspaceName(event.target.value)}
								placeholder="Workspace name"
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										createSelectedWorkspace();
									}
								}}
							/>
						</div>
						<div className="space-y-1.5">
							<p className="text-xs font-medium text-foreground">Harness</p>
							<Select
								value={newWorkspaceHarnessId ?? NONE_OPTION}
								onValueChange={(value) =>
									setNewWorkspaceHarnessId(
										value === NONE_OPTION ? null : (value as Id<"harnesses">),
									)
								}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select a harness" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={NONE_OPTION}>None</SelectItem>
									{harnesses
										.filter((harness) => harness.status !== "draft")
										.map((harness) => (
											<SelectItem key={harness._id} value={harness._id}>
												{harness.name}
											</SelectItem>
										))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1.5">
							<p className="text-xs font-medium text-foreground">Sandbox</p>
							<Select
								value={newWorkspaceSandboxId ?? NONE_OPTION}
								onValueChange={(value) =>
									setNewWorkspaceSandboxId(
										value === NONE_OPTION ? null : (value as Id<"sandboxes">),
									)
								}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select a sandbox" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={NONE_OPTION}>None</SelectItem>
									{sandboxes.map((sandbox) => (
										<SelectItem key={sandbox._id} value={sandbox._id}>
											{sandbox.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1.5">
							<p className="text-xs font-medium text-foreground">Color</p>
							<WorkspaceColorPicker
								value={newWorkspaceColor}
								onChange={setNewWorkspaceColor}
							/>
						</div>
						<Button
							className="w-full"
							disabled={createWorkspace.isPending}
							onClick={createSelectedWorkspace}
						>
							{createWorkspace.isPending ? (
								<RoseCurveSpinner size={14} />
							) : (
								<Plus size={14} />
							)}
							Create Workspace
						</Button>
					</div>
				</DialogContent>
			</Dialog>
			<Dialog
				open={renameWorkspace !== null}
				onOpenChange={(open) => {
					if (!open) {
						resetRenameWorkspaceDialog();
					}
				}}
			>
				<DialogContent className="sm:max-w-sm">
					<DialogHeader>
						<DialogTitle className="text-sm">Edit Workspace</DialogTitle>
						<DialogDescription>
							Update this workspace's name, harness, and sandbox.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-1.5">
							<p className="text-xs font-medium text-foreground">Name</p>
							<Input
								value={renameWorkspaceName}
								onChange={(event) => setRenameWorkspaceName(event.target.value)}
								placeholder="Workspace name"
								autoFocus
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										saveWorkspaceName();
									}
								}}
							/>
						</div>
						<div className="space-y-1.5">
							<p className="text-xs font-medium text-foreground">Harness</p>
							<Select
								value={renameWorkspaceHarnessId ?? NONE_OPTION}
								onValueChange={(value) =>
									setRenameWorkspaceHarnessId(
										value === NONE_OPTION ? null : (value as Id<"harnesses">),
									)
								}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select a harness" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={NONE_OPTION}>None</SelectItem>
									{harnesses
										.filter((harness) => harness.status !== "draft")
										.map((harness) => (
											<SelectItem key={harness._id} value={harness._id}>
												{harness.name}
											</SelectItem>
										))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1.5">
							<p className="text-xs font-medium text-foreground">Sandbox</p>
							<Select
								value={renameWorkspaceSandboxId ?? NONE_OPTION}
								onValueChange={(value) =>
									setRenameWorkspaceSandboxId(
										value === NONE_OPTION ? null : (value as Id<"sandboxes">),
									)
								}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select a sandbox" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={NONE_OPTION}>None</SelectItem>
									{sandboxes.map((sandbox) => (
										<SelectItem key={sandbox._id} value={sandbox._id}>
											{sandbox.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1.5">
							<p className="text-xs font-medium text-foreground">Color</p>
							<WorkspaceColorPicker
								value={renameWorkspaceColor}
								onChange={setRenameWorkspaceColor}
							/>
						</div>
						{confirmDeleteWorkspace ? (
							<p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
								Deleting this workspace will also delete its conversations.
								Click delete again to confirm.
							</p>
						) : null}
						<Button
							type="button"
							className="w-full"
							disabled={
								updateWorkspace.isPending ||
								deleteWorkspace.isPending ||
								!renameWorkspaceName.trim()
							}
							onClick={saveWorkspaceName}
						>
							{updateWorkspace.isPending ? (
								<RoseCurveSpinner size={14} />
							) : (
								<Pencil size={14} />
							)}
							Save Workspace
						</Button>
						<Button
							type="button"
							variant="destructive"
							className="w-full"
							disabled={updateWorkspace.isPending || deleteWorkspace.isPending}
							onClick={removeWorkspace}
						>
							{deleteWorkspace.isPending ? (
								<RoseCurveSpinner size={14} />
							) : (
								<Trash2 size={14} />
							)}
							{confirmDeleteWorkspace
								? "Confirm Delete Workspace"
								: "Delete Workspace"}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
			<SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
			<UsageDialog open={usageOpen} onOpenChange={setUsageOpen} />
		</div>
	);
}

function ChatHeader({
	workspace,
	harness,
	sandboxes,
	activeSandboxSelection,
	effectiveSandboxEnabled,
	sidebarOpen,
	onToggleSidebar,
	mcpHealthStatuses,
	onRefreshHealth,
	onSwapSandbox,
	onAddSkill,
	onRemoveSkill,
}: {
	workspace?: {
		_id: Id<"workspaces">;
		name: string;
		color?: string;
	};
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
		}>;
		skills: SkillEntry[];
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
	effectiveSandboxEnabled: boolean;
	sidebarOpen: boolean;
	onToggleSidebar: () => void;
	mcpHealthStatuses?: Record<string, HealthStatus>;
	onRefreshHealth: () => void;
	onSwapSandbox: (sandboxId: Id<"sandboxes">) => void;
	onAddSkill: (skill: SkillEntry) => void;
	onRemoveSkill: (skill: SkillEntry) => void;
}) {
	const activeSandboxId =
		activeSandboxSelection !== "harness" && activeSandboxSelection !== "none"
			? activeSandboxSelection
			: null;
	const workspaceColorHex = getWorkspaceColorHex(workspace?.color);

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

				<div
					className={cn(
						"flex items-center gap-2 rounded-md border px-2.5 py-1.5",
						workspaceColorHex
							? "border-transparent text-foreground"
							: "border-border/70 bg-muted/40 text-foreground",
					)}
					style={
						workspaceColorHex
							? { backgroundColor: workspaceColorHex }
							: undefined
					}
				>
					<span
						className={cn(
							"text-[10px] uppercase tracking-wider",
							workspaceColorHex
								? "text-foreground/70"
								: "text-muted-foreground",
						)}
					>
						Workspace
					</span>
					<span className="max-w-[220px] truncate text-xs font-semibold">
						{workspace?.name ?? "No workspace selected"}
					</span>
				</div>

				<div className="flex items-center gap-1.5 px-1.5 py-1">
					<span className="text-xs font-medium">
						{harness?.name ?? "No harness"}
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
				</div>

				{harness && (
					<McpServerStatus
						servers={harness.mcpServers}
						harnessId={harness._id}
						healthStatuses={mcpHealthStatuses}
						onReconnected={onRefreshHealth}
						onChanged={onRefreshHealth}
					/>
				)}

				{harness && (
					<HeaderSkillsMenu
						skills={harness.skills}
						onAdd={onAddSkill}
						onRemove={onRemoveSkill}
					/>
				)}

				<WorkspaceSandboxSelector
					sandboxes={sandboxes}
					activeSandboxId={activeSandboxId}
					panelAvailable={effectiveSandboxEnabled}
					onSwap={onSwapSandbox}
				/>
			</div>
		</header>
	);
}

/**
 * Unified sandbox control in the workspace header: shows the attached
 * sandbox, lets the user swap it (persists via workspaces.update), and
 * toggles the inline sandbox panel from the same dropdown.
 */
function WorkspaceSandboxSelector({
	sandboxes,
	activeSandboxId,
	panelAvailable,
	onSwap,
}: {
	sandboxes: Array<{
		_id: Id<"sandboxes">;
		name: string;
		status: string;
		ephemeral: boolean;
	}>;
	activeSandboxId: Id<"sandboxes"> | null;
	panelAvailable: boolean;
	onSwap: (sandboxId: Id<"sandboxes">) => void;
}) {
	const panel = useSandboxPanel();
	const active = activeSandboxId
		? sandboxes.find((s) => s._id === activeSandboxId)
		: undefined;
	const label = active?.name ?? "No sandbox";
	const panelOpen = !!panel?.panelOpen;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className={cn(
						"gap-1.5 px-2",
						panelOpen &&
							"text-emerald-600 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-400",
					)}
				>
					<Box size={12} />
					<span className="max-w-[160px] truncate text-xs font-medium">
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
				{sandboxes.length > 0 && <DropdownMenuSeparator />}
				{sandboxes.map((sandbox) => (
					<DropdownMenuItem
						key={sandbox._id}
						onClick={() => onSwap(sandbox._id)}
					>
						<span className="w-3 shrink-0">
							{activeSandboxId === sandbox._id ? <Check size={12} /> : null}
						</span>
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
function EmptyWorkspaceState({
	hasWorkspaces,
	onCreateWorkspace,
}: {
	hasWorkspaces: boolean;
	onCreateWorkspace: () => void;
}) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center px-4">
			<motion.div
				initial={{ opacity: 0, y: 12 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.4 }}
				className="max-w-md text-center"
			>
				<div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center bg-foreground">
					<Sparkles size={24} className="text-background" />
				</div>
				<h2 className="mb-2 text-lg font-medium text-foreground">
					{hasWorkspaces ? "Pick a workspace" : "Create your first workspace"}
				</h2>
				<p className="mb-6 text-sm text-muted-foreground">
					{hasWorkspaces ? (
						"Select one from the sidebar, or create a new workspace to start a fresh conversation."
					) : (
						<>
							A workspace pairs a{" "}
							<span className="font-medium text-foreground">harness</span>{" "}
							(model + MCP servers + skills) with a{" "}
							<span className="font-medium text-foreground">sandbox</span> (the
							environment your agent runs in), and keeps each conversation
							scoped to that pairing.
						</>
					)}
				</p>
				<Button onClick={onCreateWorkspace} className="gap-2">
					<Plus size={14} />
					{hasWorkspaces ? "New workspace" : "Create workspace"}
				</Button>
				<p className="mt-4 text-xs text-muted-foreground">
					You can also use the{" "}
					<Plus size={10} className="inline -translate-y-px" /> button at the
					top of the Workspaces panel in the sidebar.
				</p>
			</motion.div>
		</div>
	);
}

function NoHarnessAttachedState({
	workspaceName,
	onAttachHarness,
}: {
	workspaceName: string;
	onAttachHarness: () => void;
}) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center px-4">
			<motion.div
				initial={{ opacity: 0, y: 12 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.4 }}
				className="max-w-sm text-center"
			>
				<div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center bg-foreground">
					<Wrench size={24} className="text-background" />
				</div>
				<h2 className="mb-2 text-lg font-medium text-foreground">
					No harness attached
				</h2>
				<p className="mb-6 text-sm text-muted-foreground">
					<span className="font-medium text-foreground">{workspaceName}</span>{" "}
					doesn't have a harness yet. Attach one to choose the model, MCP
					servers, and skills your agent uses in this workspace.
				</p>
				<Button onClick={onAttachHarness} className="gap-2">
					<Wrench size={14} />
					Attach a harness
				</Button>
			</motion.div>
		</div>
	);
}
