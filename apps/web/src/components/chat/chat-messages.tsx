import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import React, {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { AgentPlanEntry } from "../../lib/agent-mode";
import type {
	AgentUsage,
	StreamPart,
	ToolCallEvent,
	UsageData,
} from "../../lib/use-chat-stream";
import { cn } from "../../lib/utils";
import { AgentPlanCard } from "../agent-plan-card";
import { AgentToolCallBlock, KIND_LABELS, kindIcon } from "../agent-tool-call";
import { MarkdownMessage } from "../markdown-message";
import { type DisplayMode, MessageActions } from "../message-actions";
import { MessageAttachments } from "../message-attachments";
import { PendingResponseIndicator } from "../pending-response-indicator";
import { RoseCurveSpinner } from "../rose-curve-spinner";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { StreamingUsage, ThinkingBlock, ToolCallBlock } from "./message-blocks";

/** Superset of stream parts and persisted Convex parts. */
interface RenderablePart {
	type: "text" | "reasoning" | "tool_call";
	content?: string;
	tool?: string;
	arguments?: Record<string, unknown>;
	call_id?: string;
	result?: string;
	kind?: string;
	locations?: Array<{ path?: string }>;
	diff?: {
		path?: string | null;
		oldText?: string | null;
		newText?: string | null;
	} | null;
	messageId?: string | null;
	parentId?: string | null; // stream shape
	parent_id?: string | null; // persisted shape
	status?: string | null;
	exitCode?: number | null; // stream shape
	exit_code?: number | null; // persisted shape
	serverName?: string | null; // stream shape
	server_name?: string | null; // persisted shape
}

/** A tool call is finished once it has a result, a terminal status, or an
 *  exit code — terminal calls accumulate output while still running, so a
 *  truthy result alone is NOT a completion signal. */
function partFinished(part: RenderablePart): boolean {
	return (
		part.status === "completed" ||
		part.status === "failed" ||
		(part.exitCode ?? part.exit_code) != null ||
		(Boolean(part.result) && part.status == null && part.kind !== "execute")
	);
}

/**
 * At-a-glance summary of in-flight agent work, shown atop the streaming
 * bubble: a chip per running tool kind (e.g. "1 command, 2 edits, 1
 * subagent"). Lets the user see what's running — including background
 * subagents and long commands — without scanning the timeline. Counts
 * nested subagent steps too. Hidden when nothing is running.
 */
function AgentActivityStrip({ parts }: { parts: RenderablePart[] }) {
	// Flatten top-level + nested subagent calls.
	const flat: RenderablePart[] = [];
	for (const p of organizeParts(parts)) {
		flat.push(p);
		flat.push(...(p as OrganizedPart).children);
	}
	// Bucket by display LABEL (not raw kind) so kinds that share a label —
	// edit/move both read "edit" — collapse into one chip instead of two.
	const counts = new Map<string, { kind: string; n: number }>();
	for (const p of flat) {
		if (p.type !== "tool_call") continue;
		if (partFinished(p)) continue;
		const kind = p.kind ?? "other";
		const label = KIND_LABELS[kind] ?? "tool";
		const cur = counts.get(label);
		if (cur) cur.n += 1;
		else counts.set(label, { kind, n: 1 });
	}
	if (counts.size === 0) return null;
	const order = [
		"subagent",
		"command",
		"edit",
		"delete",
		"read",
		"search",
		"fetch",
		"tool search",
		"workflow",
		"step",
	];
	const entries = [...counts.entries()].sort(
		(a, b) => order.indexOf(a[0]) - order.indexOf(b[0]),
	);
	return (
		<div className="mb-2 flex flex-wrap items-center gap-1.5">
			<RoseCurveSpinner size={11} />
			<span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
				running
			</span>
			{entries.map(([label, { kind, n }]) => (
				<span
					key={label}
					className="flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] text-foreground"
				>
					{kindIcon(kind, "shrink-0 text-muted-foreground")}
					{n} {label}
					{n > 1 ? "s" : ""}
				</span>
			))}
		</div>
	);
}

/** Props common to both AgentToolCallBlock call sites. */
function agentBlockProps(part: RenderablePart, activelyStreaming: boolean) {
	return {
		kind: part.kind ?? "other",
		title: part.tool ?? "",
		arguments: (part.arguments ?? {}) as Record<string, unknown>,
		result: part.result,
		diff: part.diff,
		locations: part.locations,
		status: part.status,
		exitCode: part.exitCode ?? part.exit_code ?? null,
		serverName: part.serverName ?? part.server_name ?? null,
		isStreaming: activelyStreaming && !partFinished(part),
	};
}

interface OrganizedPart extends RenderablePart {
	children: RenderablePart[];
}

/**
 * Group background/sub-agent activity (parts tagged with a parent tool-use
 * id, e.g. Claude Code's Task tool) under the tool call that spawned it.
 */
function organizeParts(parts: RenderablePart[]): OrganizedPart[] {
	const top: OrganizedPart[] = [];
	const byCallId = new Map<string, OrganizedPart>();
	for (const part of parts) {
		const organized: OrganizedPart = { ...part, children: [] };
		if (part.type === "tool_call" && part.call_id) {
			byCallId.set(part.call_id, organized);
		}
		const parentId = part.parentId ?? part.parent_id ?? null;
		const parent = parentId ? byCallId.get(parentId) : undefined;
		if (parent) {
			parent.children.push(organized);
		} else {
			top.push(organized);
		}
	}
	return top;
}

/** A background subagent's nested timeline, with a live step count.
 *  Collapsible as a unit so a long subagent run doesn't flood the thread. */
function SubagentActivity({
	parts,
	isStreaming,
}: {
	parts: RenderablePart[];
	isStreaming: boolean;
}) {
	const [open, setOpen] = useState(true);
	const stepCount = parts.filter((p) => p.type === "tool_call").length;
	return (
		<div className="mt-1 mb-1.5 ml-4 border-l-2 border-muted-foreground/15 pl-3">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
			>
				<ChevronRight
					size={9}
					className={cn("transition-transform", open && "rotate-90")}
				/>
				<span>
					subagent activity{stepCount > 0 ? ` · ${stepCount} steps` : ""}
				</span>
			</button>
			{open && (
				<div className="space-y-1">
					{parts.map((part, idx) => {
						const key = part.call_id ?? `sub-${part.type}-${idx}`;
						if (part.type === "tool_call" && part.tool) {
							return (
								<AgentToolCallBlock
									key={key}
									{...agentBlockProps(part, isStreaming)}
								/>
							);
						}
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
								<div key={key} className="text-[11px] text-muted-foreground">
									<MarkdownMessage content={part.content} />
								</div>
							);
						}
						return null;
					})}
				</div>
			)}
		</div>
	);
}

export function ChatMessages({
	conversationId,
	messages,
	streamingContent,
	streamingReasoning,
	activeToolCalls,
	streamParts,
	pendingDoneContent,
	streamUsage,
	streamModel,
	agentStatus,
	streamPlan,
	agentUsage,
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
			kind?: string;
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
	agentStatus: string | null;
	streamPlan: AgentPlanEntry[] | null;
	agentUsage: AgentUsage | null;
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
	// Show the streaming bubble while we're waiting for or receiving a response
	// (content, reasoning, tool calls) but Convex hasn't synced yet. Include
	// `isStreaming` so the bubble appears immediately with a pending spinner
	// before the first chunk arrives.
	const showStreamingBubble =
		(isStreaming ||
			streamingContent !== null ||
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
												organizeParts(
													(msg as Record<string, unknown>)
														.parts as RenderablePart[],
												).map((part, partIdx) => {
													const key =
														part.type === "tool_call"
															? (part.call_id ?? part.tool)
															: `${part.type}-${partIdx}-${part.content?.slice(0, 24)}`;
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
														const block = part.kind ? (
															// biome-ignore lint/correctness/useJsxKeyInIterable: rendered inside a keyed fragment below
															<AgentToolCallBlock
																{...agentBlockProps(part, false)}
															/>
														) : (
															// biome-ignore lint/correctness/useJsxKeyInIterable: rendered inside a keyed fragment below
															<ToolCallBlock
																tool={part.tool}
																arguments={part.arguments ?? {}}
																result={part.result}
																isStreaming={false}
															/>
														);
														return (
															<React.Fragment key={key}>
																{block}
																{part.children.length > 0 && (
																	<SubagentActivity
																		parts={part.children}
																		isStreaming={false}
																	/>
																)}
															</React.Fragment>
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
							{streamPlan && streamPlan.length > 0 && (
								<AgentPlanCard entries={streamPlan} />
							)}
							{isActivelyStreaming && (
								<AgentActivityStrip parts={streamParts as RenderablePart[]} />
							)}
							<div className="text-sm leading-relaxed text-foreground">
								{streamParts.length > 0
									? (() => {
											const organized = organizeParts(
												streamParts as RenderablePart[],
											);
											return organized.map((part, idx) => {
												const isLast = idx === organized.length - 1;
												const key =
													part.type === "tool_call"
														? (part.call_id ?? `sp-tc-${idx}`)
														: `sp-${part.type}-${idx}`;
												if (part.type === "reasoning" && part.content) {
													return (
														<ThinkingBlock
															key={key}
															content={part.content}
															isStreaming={isLast && isActivelyStreaming}
														/>
													);
												}
												if (part.type === "text" && part.content) {
													return (
														<MarkdownMessage key={key} content={part.content} />
													);
												}
												if (part.type === "tool_call" && part.tool) {
													const block = part.kind ? (
														// biome-ignore lint/correctness/useJsxKeyInIterable: rendered inside a keyed fragment below
														<AgentToolCallBlock
															{...agentBlockProps(part, isActivelyStreaming)}
														/>
													) : (
														// biome-ignore lint/correctness/useJsxKeyInIterable: rendered inside a keyed fragment below
														<ToolCallBlock
															tool={part.tool}
															arguments={part.arguments ?? {}}
															result={part.result}
															isStreaming={!part.result}
														/>
													);
													return (
														<React.Fragment key={key}>
															{block}
															{part.children.length > 0 && (
																<SubagentActivity
																	parts={part.children}
																	isStreaming={isActivelyStreaming}
																/>
															)}
														</React.Fragment>
													);
												}
												return null;
											});
										})()
									: !streamingReasoning &&
										activeToolCalls.length === 0 &&
										!streamingContent && (
											<PendingResponseIndicator message={agentStatus} />
										)}
							</div>
							{displayMode === "developer" && streamUsage && (
								<div className="flex items-center gap-3 pt-1">
									<StreamingUsage usage={streamUsage} model={streamModel} />
								</div>
							)}
							{displayMode === "developer" && agentUsage && (
								<div className="flex items-center gap-2 pt-1 font-mono text-[10px] text-muted-foreground">
									{agentUsage.used != null && agentUsage.size != null && (
										<span>
											ctx {Math.round(agentUsage.used / 1000)}k /{" "}
											{Math.round(agentUsage.size / 1000)}k
										</span>
									)}
									{agentUsage.cost != null && (
										<span>
											{agentUsage.currency === "USD" ? "$" : ""}
											{agentUsage.cost.toFixed(4)} (your account)
										</span>
									)}
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
