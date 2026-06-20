import { useAuth } from "@clerk/tanstack-react-start";
import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import { useChatStreamContext } from "../lib/chat-stream-context";
import { resetAgentSessionForRewind } from "../lib/rewind";

/**
 * Shared rewind / fork-at-message handlers for the `/chat` and `/workspaces`
 * routes — one implementation so the two stay at parity.
 *
 * - `handleRewind(messageId)`: rewind the thread to a user message IN PLACE —
 *   truncate everything below it (keeping it), then reset the live agent
 *   session so its next turn rebuilds from the truncated history. Guarded
 *   against running mid-turn; no auto-stream.
 * - `forkAtMessage(messageId)`: branch a NEW conversation at a message (copies
 *   `[0..message]`) and navigate to it. Backs both the assistant "Fork" action
 *   and the user "Rewind & fork".
 *
 * Reads the stream context + Clerk token itself; callers pass only the active
 * conversation and a navigate callback.
 */
export function useRewind(
	activeConvoId: Id<"conversations"> | null,
	onNavigate: (id: Id<"conversations">) => void,
) {
	const { getToken } = useAuth();
	const chatStream = useChatStreamContext();
	const { streamStatesRef } = chatStream;

	// removeAfter (exclusive — keeps the target user message) vs removeFrom
	// (inclusive, used by regenerate).
	const truncateAfter = useMutation({
		mutationFn: useConvexMutation(api.messages.removeAfter),
	});
	const fork = useMutation({
		mutationFn: useConvexMutation(api.conversations.fork),
	});

	const handleRewind = useCallback(
		async (messageId: Id<"messages">) => {
			if (!activeConvoId) return;
			// Don't rewind while a turn is in flight, or while a just-finished
			// turn's bubble hasn't synced yet (same guard as regenerate).
			if (
				chatStream.streamingConvoIds.has(activeConvoId) ||
				streamStatesRef.current[activeConvoId]?.pendingDoneContent != null
			) {
				return;
			}
			await truncateAfter.mutateAsync({ id: messageId });
			const token = await getToken();
			await resetAgentSessionForRewind(token, activeConvoId);
		},
		[activeConvoId, chatStream, streamStatesRef, truncateAfter, getToken],
	);

	const forkAtMessage = useCallback(
		async (messageId: Id<"messages">) => {
			if (!activeConvoId) return;
			const newConvoId = await fork.mutateAsync({
				conversationId: activeConvoId,
				upToMessageId: messageId,
			});
			onNavigate(newConvoId);
		},
		[activeConvoId, fork, onNavigate],
	);

	return { handleRewind, forkAtMessage };
}
