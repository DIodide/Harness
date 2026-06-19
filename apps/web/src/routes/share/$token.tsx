import { useAuth } from "@clerk/tanstack-react-start";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { GitFork, Loader2, Lock } from "lucide-react";
import toast from "react-hot-toast";
import { ChatMessages } from "../../components/chat/chat-messages";
import { Button } from "../../components/ui/button";

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
	const { data: messages } = useQuery(
		convexQuery(api.shares.listSharedMessages, { token }),
	);

	const forkShared = useMutation({
		mutationFn: useConvexMutation(api.shares.forkSharedConversation),
	});

	const handleFork = () => {
		if (!isSignedIn) {
			// Come back to this shared chat after auth so the fork can proceed.
			navigate({ to: "/sign-in", search: { redirect: `/share/${token}` } });
			return;
		}
		forkShared.mutate(
			{ token },
			{
				onSuccess: (newConvoId) => {
					toast.success("Forked to your account");
					navigate({
						to: "/chat",
						search: { convoId: newConvoId as string },
					});
				},
				onError: (e) =>
					toast.error(
						e instanceof Error ? e.message : "Couldn't fork this chat",
					),
			},
		);
	};

	if (headerPending) {
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
			<header className="flex items-center justify-between border-b border-border px-4 py-2.5">
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
					<span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
						Shared · view only
					</span>
				</div>
				<Button
					size="sm"
					variant="default"
					onClick={handleFork}
					disabled={forkShared.isPending}
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
