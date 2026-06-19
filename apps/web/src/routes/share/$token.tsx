import { useAuth, useUser } from "@clerk/tanstack-react-start";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { GitFork, Loader2, Lock, Send, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { AgentPermissionCard } from "../../components/agent-permission-card";
import { AgentQuestionCard } from "../../components/agent-question-card";
import { ChatMessages } from "../../components/chat/chat-messages";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "../../components/ui/avatar";
import { Button } from "../../components/ui/button";
import {
	EMPTY_STREAM_STATE,
	useChatStreamContext,
} from "../../lib/chat-stream-context";
import {
	clearForkIntent,
	peekForkIntent,
	setForkIntent,
} from "../../lib/share";

export const Route = createFileRoute("/share/$token")({
	// No beforeLoad auth guard — anonymous visitors must be able to view.
	component: SharedChatPage,
});

const noop = () => {};

type ShareHeader = {
	conversationId: string;
	title: string;
	role: "viewer" | "editor";
	viewerIsOwner: boolean;
	ownerName: string | null;
	ownerImageUrl: string | null;
	agent: string | null;
};

type SharedMessage = {
	_id: Id<"messages">;
	role: "user" | "assistant";
	content: string;
};

function SharedChatPage() {
	const { token } = Route.useParams();
	const navigate = useNavigate();
	const { isSignedIn } = useAuth();

	const { data: header, isPending: headerPending } = useQuery(
		convexQuery(api.shares.getSharedConversation, { token }),
	);
	const { data: messages, isPending: messagesPending } = useQuery(
		convexQuery(api.shares.listSharedMessages, { token }),
	);
	const forkShared = useMutation({
		mutationFn: useConvexMutation(api.shares.forkSharedConversation),
	});

	const runFork = () => {
		forkShared.mutate(
			{ token },
			{
				onSuccess: (newConvoId) => {
					toast.success("Forked to your account");
					navigate({ to: "/chat", search: { convoId: newConvoId as string } });
				},
				onError: (e) =>
					toast.error(
						e instanceof Error ? e.message : "Couldn't fork this chat",
					),
			},
		);
	};

	const handleFork = () => {
		if (!isSignedIn) {
			// Persist the intent (sign-up + onboarding can be several redirects)
			// so the fork resumes automatically when we return here.
			setForkIntent(token);
			navigate({ to: "/sign-in", search: { redirect: `/share/${token}` } });
			return;
		}
		runFork();
	};

	// Owner opened their OWN link → send them to their editable chat, not the
	// read-only view. (/chat?convoId opens in the chat view regardless of mode.)
	const ownerRedirected = useRef(false);
	useEffect(() => {
		if (header?.viewerIsOwner && !ownerRedirected.current) {
			ownerRedirected.current = true;
			navigate({
				to: "/chat",
				search: { convoId: header.conversationId as string },
			});
		}
	}, [header, navigate]);

	// Resume an intended fork once the visitor is back and signed in.
	const autoForked = useRef(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: fire once when auth+header settle
	useEffect(() => {
		if (autoForked.current || !isSignedIn || !header || header.viewerIsOwner) {
			return;
		}
		// Consume the intent on the first qualifying landing regardless of match,
		// so an abandoned/stale intent can't silently re-arm a fork on a later
		// organic revisit of this token.
		autoForked.current = true;
		const intentToken = peekForkIntent();
		clearForkIntent();
		if (intentToken === token) runFork();
	}, [isSignedIn, header, token]);

	// Hold the spinner until the header AND transcript are loaded (so the
	// read-only viewer never flashes the "send a message" empty state), and
	// while an owner is being redirected to their own chat.
	if (headerPending || (header && messagesPending) || header?.viewerIsOwner) {
		return (
			<div className="flex h-screen items-center justify-center bg-background">
				<Loader2 className="animate-spin text-muted-foreground" size={20} />
			</div>
		);
	}

	if (!header) {
		return (
			<div className="flex h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
				<Lock className="text-muted-foreground" size={28} />
				<h1 className="text-lg font-medium text-foreground">
					This shared chat isn’t available
				</h1>
				<p className="max-w-sm text-sm text-muted-foreground">
					The link may have been turned off, reset, or never existed.
				</p>
				<Button
					variant="outline"
					size="sm"
					onClick={() => navigate({ to: "/" })}
				>
					Go to Harness
				</Button>
			</div>
		);
	}

	// A signed-in holder of an active editor link collaborates; everyone else
	// (anonymous, or a viewer grant) gets the read-only transcript.
	const isEditor = Boolean(isSignedIn) && header.role === "editor";

	return (
		<div className="flex h-screen flex-col overflow-hidden bg-background">
			<header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
				<div className="flex min-w-0 items-center gap-3">
					<a
						href="/"
						className="shrink-0 font-semibold tracking-tight text-foreground"
					>
						Harness
					</a>
					<span className="text-border">/</span>
					<span className="truncate text-sm text-foreground">
						{header.title}
					</span>
					{header.ownerName && (
						<span className="hidden shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
							<Avatar className="h-5 w-5">
								<AvatarImage src={header.ownerImageUrl ?? undefined} />
								<AvatarFallback className="bg-muted text-[9px]">
									{header.ownerName.charAt(0).toUpperCase()}
								</AvatarFallback>
							</Avatar>
							Shared by {header.ownerName}
						</span>
					)}
					<span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
						{isEditor ? "can edit" : "view only"}
					</span>
				</div>
				<Button
					size="sm"
					variant="default"
					onClick={handleFork}
					disabled={forkShared.isPending}
					className="shrink-0"
				>
					<GitFork size={14} />
					{isSignedIn ? "Fork to my account" : "Sign in to fork"}
				</Button>
			</header>

			{isEditor ? (
				<ShareEditorChat
					token={token}
					header={header as ShareHeader}
					messages={(messages ?? []) as SharedMessage[]}
				/>
			) : (
				<div className="flex flex-1 flex-col overflow-hidden">
					<ChatMessages
						conversationId={header.conversationId as Id<"conversations">}
						messages={messages ?? []}
						readOnly
						shareToken={token}
						streamingContent={null}
						streamingReasoning={null}
						activeToolCalls={[]}
						streamParts={[]}
						pendingDoneContent={null}
						streamUsage={null}
						streamModel={null}
						agentStatus={null}
						streamPlan={null}
						agentUsage={null}
						isStreaming={false}
						displayMode="standard"
						editingMessageId={null}
						editingContent=""
						allConversations={[]}
						activeConversation={undefined}
						scrollToMessageId={null}
						onStreamSynced={noop}
						onRegenerate={noop}
						onFork={noop}
						onStartEditPrompt={noop}
						onCancelEditPrompt={noop}
						onSaveEditPrompt={noop}
						onEditContentChange={noop}
						onNavigateToConversation={noop}
						onClearScrollTarget={noop}
					/>
				</div>
			)}
		</div>
	);
}

/**
 * The collaborator (editor-grant) experience: the live transcript + a composer
 * that sends into the OWNER's conversation. The assistant turn runs server-side
 * on the owner's harness, billed to the owner — the browser only ever sends
 * {conversation_id, token, message}. Reuses the root ChatStreamProvider so
 * streaming, agent permission/question prompts, and state handling are shared
 * with the owner's own chat.
 */
function ShareEditorChat({
	token,
	header,
	messages,
}: {
	token: string;
	header: ShareHeader;
	messages: SharedMessage[];
}) {
	const navigate = useNavigate();
	const { user } = useUser();
	const convoId = header.conversationId;
	// Omit the agent field for the default OpenRouter loop; pass it through for
	// ACP agents so the stream routes to the agent gateway.
	const agent =
		header.agent && header.agent !== "default" ? header.agent : undefined;

	const {
		stream,
		cancel,
		streamStates,
		clearStreamState,
		streamingConvoIds,
		pendingPermissions,
		answerPermission,
		pendingQuestions,
		answerQuestion,
	} = useChatStreamContext();
	const streamState = streamStates[convoId] ?? EMPTY_STREAM_STATE;
	const isStreaming = streamingConvoIds.has(convoId);

	const sendShared = useMutation({
		mutationFn: useConvexMutation(api.shares.sendShared),
	});
	const truncateFrom = useMutation({
		mutationFn: useConvexMutation(api.messages.removeFrom),
	});
	const forkShared = useMutation({
		mutationFn: useConvexMutation(api.shares.forkSharedConversation),
	});

	const [input, setInput] = useState("");

	// Name + avatar snapshot for attribution (never email).
	const authorSnapshot = () => ({
		authorName: user?.fullName ?? user?.firstName ?? undefined,
		authorImageUrl: user?.imageUrl ?? undefined,
	});

	const runTurn = (history: Array<{ role: string; content: string }>) => {
		stream({
			messages: history,
			conversation_id: convoId,
			token,
			...(agent ? { agent: agent as never } : {}),
		});
	};

	const handleSend = async () => {
		const content = input.trim();
		if (!content || isStreaming) return;
		setInput("");
		try {
			await sendShared.mutateAsync({
				token,
				conversationId: convoId as Id<"conversations">,
				content,
				...authorSnapshot(),
			});
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Couldn't send message");
			setInput(content);
			return;
		}
		const history = [
			...messages.map((m) => ({ role: m.role, content: m.content })),
			{ role: "user", content },
		];
		runTurn(history);
	};

	const handleRegenerate = async (
		messageId: Id<"messages">,
		history: Array<{ role: string; content: string }>,
	) => {
		if (isStreaming || streamState.pendingDoneContent != null) return;
		try {
			await truncateFrom.mutateAsync({ id: messageId, token });
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Couldn't regenerate");
			return;
		}
		runTurn(history);
	};

	const handleForkAt = (messageId: Id<"messages">) => {
		forkShared.mutate(
			{ token, upToMessageId: messageId },
			{
				onSuccess: (newConvoId) => {
					toast.success("Forked to your account");
					navigate({ to: "/chat", search: { convoId: newConvoId as string } });
				},
				onError: (e) =>
					toast.error(e instanceof Error ? e.message : "Couldn't fork"),
			},
		);
	};

	const pendingPermission = pendingPermissions[convoId]?.[0];
	const pendingQuestion = pendingQuestions[convoId]?.[0];

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<ChatMessages
				conversationId={convoId as Id<"conversations">}
				messages={messages}
				shareToken={token}
				streamingContent={streamState.content}
				streamingReasoning={streamState.reasoning}
				activeToolCalls={streamState.toolCalls}
				streamParts={streamState.parts}
				pendingDoneContent={streamState.pendingDoneContent}
				streamUsage={streamState.usage}
				streamModel={streamState.model}
				agentStatus={streamState.agentStatus}
				streamPlan={streamState.plan}
				agentUsage={streamState.agentUsage}
				isStreaming={isStreaming}
				displayMode="standard"
				editingMessageId={null}
				editingContent=""
				allConversations={[]}
				activeConversation={undefined}
				scrollToMessageId={null}
				onStreamSynced={() => clearStreamState(convoId)}
				onRegenerate={handleRegenerate}
				onFork={handleForkAt}
				onStartEditPrompt={noop}
				onCancelEditPrompt={noop}
				onSaveEditPrompt={noop}
				onEditContentChange={noop}
				onNavigateToConversation={noop}
				onClearScrollTarget={noop}
			/>

			<div className="border-t border-border p-3">
				{/* ACP agent question (AskUserQuestion) — blocks until answered. */}
				{pendingQuestion && (
					<div className="mb-2">
						<AgentQuestionCard
							key={pendingQuestion.request.request_id}
							request={pendingQuestion.request}
							onAnswer={(action, content) =>
								answerQuestion(convoId, action, content)
							}
						/>
					</div>
				)}
				{/* ACP agent approval — blocks the turn until answered. */}
				{pendingPermission && (
					<div className="mb-2">
						<AgentPermissionCard
							key={pendingPermission.request.request_id}
							request={pendingPermission.request}
							onAnswer={(optionId) => answerPermission(convoId, optionId)}
						/>
					</div>
				)}
				<div className="flex items-end gap-2">
					<textarea
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								handleSend();
							}
						}}
						rows={1}
						placeholder="Message this shared chat…"
						className="max-h-40 min-h-[40px] flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30"
					/>
					{isStreaming ? (
						<Button
							size="icon"
							variant="outline"
							onClick={() => cancel(convoId)}
							title="Stop"
						>
							<Square size={14} />
						</Button>
					) : (
						<Button
							size="icon"
							onClick={handleSend}
							disabled={!input.trim() || sendShared.isPending}
							title="Send"
						>
							<Send size={14} />
						</Button>
					)}
				</div>
				<p className="mt-1.5 px-0.5 text-[10px] text-muted-foreground">
					Replies run on{" "}
					{header.ownerName ? `${header.ownerName}’s` : "the owner’s"} harness
					and are billed to them.
				</p>
			</div>
		</div>
	);
}
