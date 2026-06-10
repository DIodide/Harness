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
	Mic,
	Paperclip,
	RotateCcw,
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
	flattenConfigChoices,
	getCachedAgentSessionId,
	queueAgentPrompt,
} from "../../lib/agent-mode";
import {
	CHAT_INPUT_COUNTER_THRESHOLD,
	CHAT_INPUT_MAX_LENGTH,
} from "../../lib/chat-input";
import { useChatStreamContext } from "../../lib/chat-stream-context";
import type { McpAuthType, McpServerCommand } from "../../lib/mcp";
import {
	acceptString,
	allowedMimeTypes,
	MODELS,
	modelSupportsAudio,
	modelSupportsMedia,
} from "../../lib/models";
import { buildMultimodalContent } from "../../lib/multimodal";
import type { SkillEntry } from "../../lib/skills";
import { useAgentCatalog } from "../../lib/use-agent-catalog";
import { useAgentSessionConfig } from "../../lib/use-agent-session-config";
import { cn } from "../../lib/utils";
import { AgentPermissionCard } from "../agent-permission-card";
import { AttachmentChip } from "../attachment-chip";
import { SlashCommandMenu, useSlashCommandInput } from "../slash-commands";
import { Button } from "../ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

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
	onDequeue: (index: number) => void;
	onSendNow: (index: number) => void;
	pendingPrompt?: string | null;
	sessionModel?: string | null;
	modelSelectorMode?: "session" | "harness";
	onSessionModelChange: (model: string | null) => void;
	onPendingPromptConsumed?: () => void;
	budgetExceeded?: boolean;
	disabled?: boolean;
	placeholder?: string;
}) {
	const [text, setText] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [isDragOver, setIsDragOver] = useState(false);

	// ACP agent mode: route turns through an external agent (Codex CLI,
	// Claude Code) instead of the Harness default loop. Usage is billed to
	// the user's own agent account, so the budget gate doesn't apply.
	const [agentMode, setAgentMode] = useState<AgentMode>("default");
	const { getToken } = useAuth();
	const { pendingPermissions, answerPermission } = useChatStreamContext();
	const pendingPermission = conversationId
		? pendingPermissions[conversationId]
		: undefined;
	const { data: agentCatalog } = useAgentCatalog();
	const agentAvailability = useMemo(() => {
		const map = new Map<string, boolean>();
		for (const entry of agentCatalog ?? []) map.set(entry.id, entry.available);
		return map;
	}, [agentCatalog]);
	// ACP session config options (model, mode, ...) for the active agent
	// session — populated once the session exists (after the first send).
	const { options: agentConfigOptions, setOption: setAgentOption } =
		useAgentSessionConfig(conversationId, agentMode);

	const effectiveModel = sessionModel ?? activeHarness?.model;
	const currentModelLabel =
		MODELS.find((m) => m.value === effectiveModel)?.label ??
		effectiveModel ??
		"Model";

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

	// ── Slash commands ──────────────────────────────────────────────
	const slash = useSlashCommandInput({
		storedCommands: slashCommands ?? [],
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

		// ── Slash command interception ────────────────────────────────
		// If it's a slash command, trySend returns the forced tool + cleaned message.
		// We then send it through the normal chat flow with forced_tool set.
		const slashResult = slashCommands ? slash.trySend(content) : null;
		if (slashResult !== null) {
			if (!slashResult.forcedTool) return; // validation error (e.g. no message), already toasted
		}

		// Use the cleaned message for slash commands, or the raw content for normal messages
		const messageContent = slashResult ? slashResult.message : content;
		const forcedTool = slashResult?.forcedTool;

		setText("");
		setHistoryIndex(-1);
		setDraft("");
		clearAttachments();

		// If streaming: agents that support prompt queueing (Claude Code)
		// accept the message immediately and run it after the current turn —
		// no need to lock the conversation. Otherwise fall back to the
		// client-side queue.
		if (isStreaming && conversationId) {
			if (agentMode !== "default") {
				const sessionId = getCachedAgentSessionId(conversationId, agentMode);
				if (sessionId) {
					const token = await getToken({ template: "convex" });
					if (await queueAgentPrompt(token, sessionId, content)) {
						await sendMessage.mutateAsync({
							conversationId,
							role: "user",
							content,
							harnessId: activeHarness._id,
						});
						return;
					}
				}
			}
			onEnqueue(content);
			return;
		}

		const resolvedSandboxId = sandboxEnabled ? sandboxId : undefined;

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
			system_prompt: activeHarness.systemPrompt ?? undefined,
			sandbox_enabled: Boolean(resolvedSandboxId),
			sandbox_id: resolvedSandboxId,
			sandbox_config: activeHarness.sandboxConfig
				? {
						persistent: activeHarness.sandboxConfig.persistent,
						auto_start: activeHarness.sandboxConfig.autoStart,
						default_language: activeHarness.sandboxConfig.defaultLanguage,
						resource_tier: activeHarness.sandboxConfig.resourceTier,
					}
				: undefined,
		};

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
		if (slashCommands && slash.handleKeyDown(e)) return;

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
				{/* ACP agent approval — blocks the turn until answered */}
				{pendingPermission && conversationId && (
					<AgentPermissionCard
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

				{/* Slash command autocomplete menu */}
				<div className="relative">
					<SlashCommandMenu
						isOpen={slash.menuOpen}
						commands={slash.commands}
						filtered={slash.filtered}
						selectedIndex={slash.selectedIndex}
						onSelect={slash.selectCommand}
					/>
				</div>

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
						placeholder={placeholder}
						disabled={disabled}
						rows={1}
						maxLength={CHAT_INPUT_MAX_LENGTH}
						className="max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
					/>
					{activeHarness && (
						<DropdownMenu>
							<Tooltip>
								<TooltipTrigger asChild>
									<DropdownMenuTrigger asChild>
										<button
											type="button"
											className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors hover:bg-foreground/10 hover:text-foreground ${agentMode !== "default" ? "text-foreground" : "text-muted-foreground"}`}
										>
											<Bot size={11} className="shrink-0" />
											<span className="max-w-[80px] truncate">
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
														? "Connect in Settings → Agent Connections"
														: agentOption.description}
												</span>
											</div>
										</DropdownMenuItem>
									);
								})}
							</DropdownMenuContent>
						</DropdownMenu>
					)}
					{activeHarness &&
						agentMode !== "default" &&
						agentConfigOptions.map((option) => {
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
													className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
												>
													<span className="max-w-[110px] truncate">
														{current?.name ??
															option.currentValue ??
															option.name}
													</span>
													<ChevronDown size={10} />
												</button>
											</DropdownMenuTrigger>
										</TooltipTrigger>
										<TooltipContent>
											{option.name} (applies to this agent session)
										</TooltipContent>
									</Tooltip>
									<DropdownMenuContent
										align="end"
										className="max-h-72 overflow-y-auto"
									>
										{choices.map((choice) => (
											<DropdownMenuItem
												key={choice.value}
												onClick={() =>
													setAgentOption.mutate(
														{ configId: option.id, value: choice.value },
														{
															onError: (error) => toast.error(error.message),
														},
													)
												}
												className="flex items-center gap-2"
											>
												{choice.value === option.currentValue ? (
													<Check size={12} className="shrink-0" />
												) : (
													<span className="w-3 shrink-0" />
												)}
												<div className="flex flex-col">
													<span>{choice.name ?? choice.value}</span>
													{choice.description && (
														<span className="max-w-[220px] text-[10px] text-muted-foreground">
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
					{activeHarness && agentMode === "default" && (
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
											<span className="max-w-[90px] truncate">
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
								onClick={() => {
									if (showStopButton && conversationId) {
										onInterrupt(conversationId);
									} else {
										handleSend();
									}
								}}
								disabled={
									!showStopButton &&
									(disabled ||
										(budgetExceeded && agentMode === "default") ||
										!text.trim() ||
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
