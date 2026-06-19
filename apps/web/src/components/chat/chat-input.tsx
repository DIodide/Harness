import { useAuth } from "@clerk/tanstack-react-start";
import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation } from "@tanstack/react-query";
import {
	ArrowUp,
	Bot,
	Check,
	ChevronDown,
	Cpu,
	Gauge,
	Layers,
	Mic,
	Paperclip,
	RotateCcw,
	Shield,
	SlidersHorizontal,
	Square,
	X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import React, {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import toast from "react-hot-toast";
import { useFileAttachments } from "../../hooks/use-file-attachments";
import {
	AGENT_MODES,
	type AgentMode,
	cancelAgentTurn,
	flattenConfigChoices,
	getCachedAgentSessionId,
	queueAgentPrompt,
} from "../../lib/agent-mode";
import {
	CHAT_INPUT_COUNTER_THRESHOLD,
	CHAT_INPUT_MAX_LENGTH,
} from "../../lib/chat-input";
import { useChatStreamContext } from "../../lib/chat-stream-context";
import { buildHarnessStreamConfig } from "../../lib/harness-stream";
import type { McpAuthType, McpServerCommand } from "../../lib/mcp";
import {
	acceptString,
	allowedMimeTypes,
	IMAGE_MIMES,
	MODELS,
	modelSupportsAudio,
	modelSupportsMedia,
} from "../../lib/models";
import { buildMultimodalContent } from "../../lib/multimodal";
import { useSandboxPanel } from "../../lib/sandbox-panel-context";
import type { SkillEntry } from "../../lib/skills";
import { useAgentCatalog } from "../../lib/use-agent-catalog";
import { useAgentSessionConfig } from "../../lib/use-agent-session-config";
import { cn } from "../../lib/utils";
import { AgentPermissionCard } from "../agent-permission-card";
import { AgentQuestionCard } from "../agent-question-card";
import { AttachmentChip } from "../attachment-chip";
import {
	type SlashCommand,
	SlashCommandMenu,
	useSlashCommandInput,
} from "../slash-commands";
import { Button } from "../ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { EffortSlider } from "./effort-slider";

const isEffortOption = (id: string) =>
	id === "effort" || id === "reasoning_effort";

/** Icon for an ACP config option chip, keyed by conventional option ids. */
function agentOptionIcon(optionId: string) {
	const className = "shrink-0";
	switch (optionId) {
		case "model":
			return <Cpu size={11} className={className} />;
		case "mode":
			return <Shield size={11} className={className} />;
		case "effort":
		case "reasoning_effort":
			return <Gauge size={11} className={className} />;
		default:
			return <SlidersHorizontal size={11} className={className} />;
	}
}

export function ChatInput({
	conversationId,
	activeHarness,
	slashCommands,
	sessionModel,
	modelSelectorMode = "session",
	onSessionModelChange,
	onConvoCreated,
	workspaceId,
	sandboxEnabled,
	sandboxId,
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
	budgetExceeded,
	agentActivityCount = 0,
	disabled = false,
	placeholder = "Send a message...",
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
			commandIds?: string[];
		}>;
		skills: SkillEntry[];
		systemPrompt?: string;
		agent?: string;
		agentCredentialId?: string;
		sandboxEnabled?: boolean;
		daytonaSandboxId?: string;
		sandboxConfig?: {
			persistent: boolean;
			autoStart: boolean;
			defaultLanguage: string;
			resourceTier: "basic" | "standard" | "performance";
			gitRepo?: string;
		};
	};
	slashCommands?: McpServerCommand[];
	onConvoCreated: (id: Id<"conversations">) => void;
	workspaceId?: Id<"workspaces">;
	sandboxEnabled: boolean;
	sandboxId?: string;
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
		agent?: AgentMode;
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
	onDequeue: (id: number) => void;
	onSendNow: (id: number) => void;
	pendingPrompt?: string | null;
	sessionModel?: string | null;
	modelSelectorMode?: "session" | "harness";
	onSessionModelChange: (model: string | null) => void;
	onPendingPromptConsumed?: () => void;
	budgetExceeded?: boolean;
	agentActivityCount?: number;
	disabled?: boolean;
	placeholder?: string;
}) {
	const [text, setText] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	// The Agents composer button drives the right sandbox panel's Agents tab.
	const sandboxPanel = useSandboxPanel();
	// Mirror the panel's effectiveTab fallback: the Agents tab is what renders
	// when activeTab is "agents" OR there's no sandbox (Files/Terminal/Git need
	// one, so the panel falls back to Agents). Reading raw activeTab here would
	// desync the button highlight after a sandbox detaches with the panel open.
	const agentsTabOpen =
		sandboxPanel?.panelOpen === true &&
		(sandboxPanel.activeTab === "agents" || sandboxPanel.sandboxId == null);
	const toggleAgentsTab = useCallback(() => {
		if (!sandboxPanel) return;
		if (agentsTabOpen) sandboxPanel.togglePanel();
		else sandboxPanel.openAgentsTab();
	}, [sandboxPanel, agentsTabOpen]);
	// Synchronous guard against double-dispatch (rapid Enter): set at the top
	// of a send, cleared once the send is dispatched/decided.
	const sendInFlightRef = useRef(false);
	const [isDragOver, setIsDragOver] = useState(false);

	// ACP agent mode: the agent loop is HARNESS configuration
	// (activeHarness.agent). In-chat switches update the harness by default
	// (chatConfigScope === "harness"); with the session-only setting they
	// live in sessionAgent and reset when the harness changes. Usage is
	// billed to the user's own agent account, so the budget gate doesn't
	// apply in agent mode.
	const [sessionAgent, setSessionAgent] = useState<AgentMode | null>(null);
	const harnessAgent: AgentMode =
		activeHarness?.agent && activeHarness.agent !== "default"
			? (activeHarness.agent as AgentMode)
			: "default";
	const agentMode: AgentMode = sessionAgent ?? harnessAgent;
	const updateHarnessAgentFn = useConvexMutation(api.harnesses.update);
	const updateHarnessAgent = useMutation({
		mutationFn: updateHarnessAgentFn,
		onError: (error) =>
			toast.error(
				error instanceof Error ? error.message : "Could not update harness",
			),
	});
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset override when harness changes
	useEffect(() => {
		setSessionAgent(null);
	}, [activeHarness?._id]);
	const setAgentMode = (value: AgentMode) => {
		if (modelSelectorMode === "harness" && activeHarness) {
			updateHarnessAgent.mutate({
				id: activeHarness._id,
				agent: value,
			});
			setSessionAgent(null);
		} else {
			setSessionAgent(value);
		}
	};
	const { getToken } = useAuth();
	const {
		pendingPermissions,
		answerPermission,
		pendingQuestions,
		answerQuestion,
	} = useChatStreamContext();
	// Head of the per-conversation FIFO — answering it reveals the next.
	const pendingPermission = conversationId
		? pendingPermissions[conversationId]?.[0]
		: undefined;
	const pendingQuestion = conversationId
		? pendingQuestions[conversationId]?.[0]
		: undefined;
	const { data: agentCatalog } = useAgentCatalog();
	const agentAvailability = useMemo(() => {
		const map = new Map<string, boolean>();
		for (const entry of agentCatalog ?? []) map.set(entry.id, entry.available);
		return map;
	}, [agentCatalog]);
	// ACP session config options (model, mode, ...) and agent-advertised
	// slash commands — populated once the session exists (after the first
	// send), kept live by config/commands stream events.
	const {
		options: agentConfigOptions,
		commands: agentCommands,
		setOption: setAgentOption,
	} = useAgentSessionConfig(conversationId, agentMode);
	const agentModeActive = agentMode !== "default";
	const effortOption = agentConfigOptions.find((o) => isEffortOption(o.id));

	const effectiveModel = sessionModel ?? activeHarness?.model;
	const currentModelLabel =
		MODELS.find((m) => m.value === effectiveModel)?.label ??
		effectiveModel ??
		"Model";

	// In agent mode attachments are governed by the agent, not the harness
	// model: both Claude Code and Codex accept images (the gateway drops
	// them for agents that don't); audio is not part of ACP prompts.
	const supportsMedia = agentModeActive || modelSupportsMedia(effectiveModel);
	const supportsAudio = !agentModeActive && modelSupportsAudio(effectiveModel);
	const supportsAnyAttachment = supportsMedia || supportsAudio;
	const modelAccept = agentModeActive
		? IMAGE_MIMES.join(",")
		: acceptString(effectiveModel);
	const modelAllowedMimes = useMemo(
		() =>
			agentModeActive ? new Set(IMAGE_MIMES) : allowedMimeTypes(effectiveModel),
		[agentModeActive, effectiveModel],
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

	// ── Slash commands ──────────────────────────────────────────────
	// Default mode: MCP tool commands (intercepted, sent as forced_tool).
	// Agent mode: the agent's own commands (/compact, /review, ...) sent
	// through verbatim — the agent parses them itself.
	const agentSlashCommands = useMemo<SlashCommand[]>(() => {
		if (!agentModeActive) return [];
		const agentLabel =
			AGENT_MODES.find((a) => a.id === agentMode)?.label ?? "Agent";
		return agentCommands.map((cmd) => ({
			name: cmd.name,
			tool: cmd.name,
			server: agentLabel,
			description: cmd.description ?? "",
			parameters: {},
			source: "agent" as const,
			inputHint: cmd.input?.hint,
		}));
	}, [agentModeActive, agentMode, agentCommands]);

	const effectiveSlashCommands = agentModeActive
		? agentSlashCommands
		: (slashCommands ?? []);

	const slash = useSlashCommandInput({
		storedCommands: effectiveSlashCommands,
		text,
		setText,
		textareaRef,
	});

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
		if (budgetExceeded && agentMode === "default") return;
		// Block a second dispatch while the first is still deciding (rapid
		// double-Enter would otherwise create two conversations / two streams).
		if (sendInFlightRef.current) return;

		// ── Slash command interception ────────────────────────────────
		// MCP commands are stripped + sent with forced_tool; agent commands
		// pass through verbatim (the agent parses "/name args" itself).
		const slashResult = slash.trySend(content);
		if (slashResult?.kind === "invalid") return; // already toasted

		const messageContent =
			slashResult?.kind === "mcp" ? slashResult.message : content;
		const forcedTool =
			slashResult?.kind === "mcp" ? slashResult.forcedTool : undefined;

		sendInFlightRef.current = true;
		setText("");
		setHistoryIndex(-1);
		setDraft("");
		clearAttachments();

		try {
			// If streaming: agents that support prompt queueing (Claude Code)
			// accept the message immediately and run it after the current turn —
			// no need to lock the conversation. Otherwise fall back to the
			// client-side queue.
			if (isStreaming && conversationId) {
				if (agentMode !== "default") {
					const sessionId = getCachedAgentSessionId(conversationId, agentMode);
					if (sessionId) {
						let queued = false;
						try {
							const token = await getToken({ template: "convex" });
							queued = await queueAgentPrompt(token, sessionId, content);
						} catch {
							// Token refresh / gateway blip — fall through to the
							// client-side queue rather than losing the message.
							queued = false;
						}
						if (queued) {
							// Persist for the transcript; if THIS fails the turn is
							// already queued gateway-side, so don't re-queue (would
							// duplicate) — just surface it.
							try {
								await sendMessage.mutateAsync({
									conversationId,
									role: "user",
									content,
									harnessId: activeHarness._id,
								});
							} catch {
								toast.error(
									"Message queued, but couldn't be saved to the transcript.",
								);
							}
							return;
						}
					}
				}
				onEnqueue(content);
				return;
			}

			await dispatchFreshSend(content, messageContent, forcedTool);
		} catch (err) {
			// The send failed before it was dispatched (createConvo / persist /
			// token). Restore the draft so the user's message isn't lost.
			setText(content);
			toast.error(
				err instanceof Error ? err.message : "Couldn't send your message",
			);
		} finally {
			sendInFlightRef.current = false;
		}
	};

	const dispatchFreshSend = async (
		content: string,
		messageContent: string,
		forcedTool: string | undefined,
	) => {
		if (!activeHarness) return;
		const resolvedSandboxId = sandboxEnabled ? sandboxId : undefined;

		// Snapshot harness config at send time (shared snake_case builder —
		// the same one queued/regenerate/edit-resend paths use).
		const harnessConfig = buildHarnessStreamConfig(activeHarness, {
			model: effectiveModel,
			agentOverride: sessionAgent,
			sandboxId: resolvedSandboxId,
		});

		let convoId = conversationId;
		if (!convoId) {
			const newId = await createConvo.mutateAsync({
				title: content.slice(0, 60),
				harnessId: activeHarness._id,
				...(workspaceId ? { workspaceId } : {}),
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

		// Save user message to Convex (original text including /command prefix)
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

		// For slash commands, send the cleaned message (without /command prefix) to the LLM
		const llmContent = messageContent;

		// Add the new user message (with any current attachments)
		if (readyAttachments.length > 0) {
			history.push({
				role: "user",
				content: await buildMultimodalContent(
					llmContent,
					readyAttachments,
					resolveSignedUrls,
				),
			});
		} else {
			history.push({ role: "user", content: llmContent });
		}

		// Start streaming from FastAPI
		onStream({
			messages: history,
			harness: harnessConfig,
			conversation_id: convoId,
			...(forcedTool ? { forced_tool: forcedTool } : {}),
			...(agentMode !== "default" ? { agent: agentMode } : {}),
		});
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		// Slash command menu gets first shot at keyboard events
		if (slash.handleKeyDown(e)) return;

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

	// Stopping an agent turn must reach the agent (ACP session/cancel), not
	// just abort the browser fetch — otherwise it keeps running in its
	// sandbox. The stream then concludes with stopReason=cancelled and the
	// partial response is saved.
	const handleStop = useCallback(
		(convoId: string) => {
			if (!agentModeActive) {
				onInterrupt(convoId);
				return;
			}
			const sessionId = getCachedAgentSessionId(convoId, agentMode);
			if (!sessionId) {
				onInterrupt(convoId);
				return;
			}
			void (async () => {
				try {
					const token = await getToken({ template: "convex" });
					await cancelAgentTurn(token, sessionId);
				} catch {
					// Gateway unreachable — at least stop the local stream.
					onInterrupt(convoId);
				}
			})();
		},
		[agentModeActive, agentMode, getToken, onInterrupt],
	);

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

			<div className="mx-auto max-w-3xl">
				{/* ACP agent question (AskUserQuestion) — blocks until answered.
				    Keyed by request_id: an in-place swap to the next queued
				    question must remount the stepper, not inherit its state. */}
				{pendingQuestion && conversationId && (
					<AgentQuestionCard
						key={pendingQuestion.request.request_id}
						request={pendingQuestion.request}
						onAnswer={(action, content) =>
							answerQuestion(conversationId, action, content)
						}
					/>
				)}
				{/* ACP agent approval — blocks the turn until answered */}
				{pendingPermission && conversationId && (
					<AgentPermissionCard
						key={pendingPermission.request.request_id}
						request={pendingPermission.request}
						onAnswer={(optionId) => answerPermission(conversationId, optionId)}
					/>
				)}
				{/* Queued messages as chips above the input */}
				<AnimatePresence>
					{messageQueue.length > 0 && (
						<motion.div
							initial={{ opacity: 0, height: 0 }}
							animate={{ opacity: 1, height: "auto" }}
							exit={{ opacity: 0, height: 0 }}
							className="mb-2 flex flex-col gap-1.5 overflow-hidden"
						>
							{messageQueue.map((item) => (
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
													onClick={() => onSendNow(item.id)}
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
													onClick={() => onDequeue(item.id)}
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

				{/* Slash command autocomplete menu */}
				<div className="relative">
					<SlashCommandMenu
						isOpen={slash.menuOpen}
						commands={slash.commands}
						filtered={slash.filtered}
						selectedIndex={slash.selectedIndex}
						onSelect={slash.selectCommand}
						emptyLabel={
							agentModeActive
								? "Agent commands appear after the first message"
								: "No MCP tools available"
						}
					/>
				</div>

				<div className="border border-border bg-background transition-colors focus-within:border-foreground/30">
					{/* Input row */}
					<div className="px-3 pt-2.5">
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
							placeholder={
								activeHarness
									? placeholder
									: "Select a harness to start chatting"
							}
							disabled={disabled || !activeHarness}
							rows={1}
							maxLength={CHAT_INPUT_MAX_LENGTH}
							className="max-h-[200px] min-h-[24px] w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
						/>
					</div>
					{/* Reasoning effort as a boxed slider (agent mode) — its own
					    full-width row so the controls bar below stays uncluttered;
					    the rightmost stop is Ultracode. */}
					{activeHarness && agentMode !== "default" && effortOption && (
						<div className="flex px-2 pt-1.5">
							<EffortSlider
								effortOption={effortOption}
								onSetEffort={(value) =>
									setAgentOption.mutate(
										{ configId: effortOption.id, value },
										{ onError: (error) => toast.error(error.message) },
									)
								}
								text={text}
								onSetText={setText}
							/>
						</div>
					)}
					{/* Controls bar */}
					<div className="flex items-center gap-0.5 px-2 pb-1.5">
						{supportsAnyAttachment && (
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={() => fileInputRef.current?.click()}
										className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
									>
										<Paperclip size={14} />
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
											"shrink-0 rounded p-1 transition-colors",
											isRecording
												? "animate-pulse text-destructive"
												: "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
										)}
									>
										{isRecording ? <Square size={14} /> : <Mic size={14} />}
									</button>
								</TooltipTrigger>
								<TooltipContent>
									{isRecording ? "Stop recording" : "Record audio"}
								</TooltipContent>
							</Tooltip>
						)}
						<div className="flex-1" />
						{activeHarness && (
							<DropdownMenu>
								<Tooltip>
									<TooltipTrigger asChild>
										<DropdownMenuTrigger asChild>
											<button
												type="button"
												className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors hover:bg-foreground/10 hover:text-foreground ${agentMode !== "default" ? "text-foreground" : "text-muted-foreground"}`}
											>
												<Bot size={12} className="shrink-0" />
												<span className="max-w-[100px] truncate">
													{AGENT_MODES.find((a) => a.id === agentMode)?.label}
												</span>
												<ChevronDown size={10} />
											</button>
										</DropdownMenuTrigger>
									</TooltipTrigger>
									<TooltipContent>
										{agentMode === "default"
											? "Agent engine for this conversation"
											: "External agent — usage billed to your own account"}
									</TooltipContent>
								</Tooltip>
								<DropdownMenuContent align="end">
									{AGENT_MODES.map((agentOption) => {
										const unavailable =
											agentOption.id !== "default" &&
											agentAvailability.get(agentOption.id) === false;
										return (
											<DropdownMenuItem
												key={agentOption.id}
												disabled={unavailable}
												onClick={() => setAgentMode(agentOption.id)}
												className="flex items-center gap-2"
											>
												{agentOption.id === agentMode ? (
													<Check size={12} className="shrink-0" />
												) : (
													<span className="w-3 shrink-0" />
												)}
												<div className="flex flex-col">
													<span>{agentOption.label}</span>
													<span className="text-[10px] text-muted-foreground">
														{unavailable
															? "Add a credential first (harness settings or Settings → Agent Credentials)"
															: agentOption.description}
													</span>
												</div>
											</DropdownMenuItem>
										);
									})}
								</DropdownMenuContent>
							</DropdownMenu>
						)}
						{/* Agent session options — one labeled selector per option
					    (model, mode, ...). Effort is rendered as the slider above. */}
						{activeHarness &&
							agentMode !== "default" &&
							agentConfigOptions
								.filter((option) => !isEffortOption(option.id))
								.map((option) => {
									const choices = flattenConfigChoices(option);
									if (choices.length === 0) return null;
									const current = choices.find(
										(c) => c.value === option.currentValue,
									);
									return (
										<DropdownMenu key={option.id}>
											<Tooltip>
												<TooltipTrigger asChild>
													<DropdownMenuTrigger asChild>
														<button
															type="button"
															className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
														>
															{agentOptionIcon(option.id)}
															<span className="max-w-[100px] truncate">
																{current?.name ??
																	option.currentValue ??
																	option.name}
															</span>
															<ChevronDown size={10} />
														</button>
													</DropdownMenuTrigger>
												</TooltipTrigger>
												<TooltipContent>
													{option.name} — applies to this agent session
												</TooltipContent>
											</Tooltip>
											<DropdownMenuContent
												align="end"
												className="max-h-72 w-52 overflow-y-auto"
											>
												<DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
													{option.name}
												</DropdownMenuLabel>
												{choices.map((choice) => (
													<DropdownMenuItem
														key={choice.value}
														onClick={() => {
															setAgentOption.mutate(
																{ configId: option.id, value: choice.value },
																{
																	onError: (error) =>
																		toast.error(error.message),
																},
															);
															// Harness-scope chat changes persist the model
															// to the harness itself (session opt-out only).
															if (
																option.id === "model" &&
																modelSelectorMode === "harness" &&
																activeHarness &&
																choice.value !== activeHarness.model
															) {
																updateHarnessAgent.mutate({
																	id: activeHarness._id,
																	model: choice.value,
																});
															}
														}}
														className="flex items-center gap-2"
													>
														{choice.value === option.currentValue ? (
															<Check size={12} className="shrink-0" />
														) : (
															<span className="w-3 shrink-0" />
														)}
														<div className="flex min-w-0 flex-col">
															<span className="truncate">
																{choice.name ?? choice.value}
															</span>
															{choice.description && (
																<span className="max-w-[200px] truncate text-[10px] text-muted-foreground">
																	{choice.description}
																</span>
															)}
														</div>
													</DropdownMenuItem>
												))}
											</DropdownMenuContent>
										</DropdownMenu>
									);
								})}
						{/* Background agents panel toggle — opens the right panel's
						    Agents tab to view live subagent / workflow / command
						    activity. Only when the panel context is mounted. */}
						{activeHarness && agentMode !== "default" && sandboxPanel && (
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={toggleAgentsTab}
										className={cn(
											"flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors hover:bg-foreground/10 hover:text-foreground",
											agentsTabOpen
												? "text-foreground"
												: "text-muted-foreground",
										)}
									>
										<Layers size={12} className="shrink-0" />
										<span>Agents</span>
										{agentActivityCount > 0 && (
											<span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground tabular-nums">
												{agentActivityCount}
											</span>
										)}
									</button>
								</TooltipTrigger>
								<TooltipContent>
									Background agents — live subagent, workflow &amp; command
									activity
								</TooltipContent>
							</Tooltip>
						)}
						{activeHarness && agentMode === "default" && (
							<DropdownMenu>
								<Tooltip>
									<TooltipTrigger asChild>
										<DropdownMenuTrigger asChild>
											<button
												type="button"
												className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors hover:bg-foreground/10 hover:text-foreground ${sessionModel ? "text-foreground" : "text-muted-foreground"}`}
											>
												{sessionModel && (
													<span className="size-1.5 shrink-0 rounded-full bg-primary" />
												)}
												<span className="max-w-[110px] truncate">
													{currentModelLabel}
												</span>
												<ChevronDown size={10} />
											</button>
										</DropdownMenuTrigger>
									</TooltipTrigger>
									<TooltipContent>
										{modelSelectorMode === "harness"
											? "Set harness model"
											: sessionModel
												? `Session override: ${currentModelLabel}`
												: "Switch model for this session"}
									</TooltipContent>
								</Tooltip>
								<DropdownMenuContent
									align="end"
									className="max-h-72 overflow-y-auto"
								>
									{modelSelectorMode === "session" && sessionModel && (
										<>
											<DropdownMenuItem
												onClick={() => onSessionModelChange(null)}
												className="flex items-center gap-2"
											>
												<RotateCcw size={12} className="shrink-0" />
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
									className="ml-1"
									onClick={() => {
										if (showStopButton && conversationId) {
											handleStop(conversationId);
										} else {
											handleSend();
										}
									}}
									disabled={
										!showStopButton &&
										(disabled ||
											!activeHarness ||
											(budgetExceeded && agentMode === "default") ||
											!text.trim() ||
											hasUploading ||
											sendMessage.isPending ||
											createConvo.isPending)
									}
									variant={showStopButton ? "destructive" : "default"}
								>
									{showStopButton ? (
										<Square size={10} />
									) : (
										<ArrowUp size={14} />
									)}
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								{showStopButton
									? agentModeActive
										? "Stop the agent"
										: "Stop generation"
									: isStreaming
										? "Queue message"
										: "Send message"}
							</TooltipContent>
						</Tooltip>
					</div>
				</div>
				<p className="mt-1.5 text-center text-[10px] text-muted-foreground">
					{text.length >= CHAT_INPUT_COUNTER_THRESHOLD ? (
						<span
							className={
								text.length >= CHAT_INPUT_MAX_LENGTH
									? "text-destructive"
									: "text-amber-500"
							}
						>
							{text.length.toLocaleString()} /{" "}
							{CHAT_INPUT_MAX_LENGTH.toLocaleString()} characters
						</span>
					) : (
						"Harness may produce inaccurate information."
					)}
				</p>
			</div>
		</div>
	);
}
