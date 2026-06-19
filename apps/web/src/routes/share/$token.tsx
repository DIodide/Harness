import { useAuth } from "@clerk/tanstack-react-start";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { GitFork, Loader2, Lock } from "lucide-react";
import { useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { ChatMessages } from "../../components/chat/chat-messages";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "../../components/ui/avatar";
import { Button } from "../../components/ui/button";
import { FORK_INTENT_KEY, SHARE_RETURN_KEY } from "../../lib/share";

export const Route = createFileRoute("/share/$token")({
	// No beforeLoad auth guard — anonymous visitors must be able to view.
	component: SharedChatPage,
});

const noop = () => {};

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
			try {
				sessionStorage.setItem(FORK_INTENT_KEY, token);
				sessionStorage.setItem(SHARE_RETURN_KEY, `/share/${token}`);
			} catch {}
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
		let intent: string | null = null;
		try {
			intent = sessionStorage.getItem(FORK_INTENT_KEY);
		} catch {}
		if (intent === token) {
			autoForked.current = true;
			try {
				sessionStorage.removeItem(FORK_INTENT_KEY);
				sessionStorage.removeItem(SHARE_RETURN_KEY);
			} catch {}
			runFork();
		}
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
						view only
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
		</div>
	);
}
