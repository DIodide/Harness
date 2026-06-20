import { useAuth } from "@clerk/tanstack-react-start";
import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import toast from "react-hot-toast";
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
 * - `handleRewindToPart(messageId, keepPartCount)`: rewind into the MIDDLE of an
 *   assistant message IN PLACE — keep the first `keepPartCount` flat parts of
 *   that message, drop the rest + every later message, then reset the agent.
 * - `forkAtPart(messageId, keepPartCount)`: branch a NEW conversation whose last
 *   message is that assistant message TRUNCATED to `keepPartCount` parts. The
 *   safe (non-destructive, reset-free) primary for mid-message rewind.
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
	const truncatePart = useMutation({
		mutationFn: useConvexMutation(api.messages.truncatePart),
	});
	const fork = useMutation({
		mutationFn: useConvexMutation(api.conversations.fork),
	});

	// In-flight guard shared by both in-place rewind paths: don't mutate while a
	// turn is streaming, or before a just-finished turn's bubble has synced.
	const isBusy = useCallback(() => {
		if (!activeConvoId) return true;
		return (
			chatStream.streamingConvoIds.has(activeConvoId) ||
			streamStatesRef.current[activeConvoId]?.pendingDoneContent != null
		);
	}, [activeConvoId, chatStream, streamStatesRef]);

	const handleRewind = useCallback(
		async (messageId: Id<"messages">) => {
			if (!activeConvoId || isBusy()) return;
			await truncateAfter.mutateAsync({ id: messageId });
			const token = await getToken();
			await resetAgentSessionForRewind(token, activeConvoId);
		},
		[activeConvoId, isBusy, truncateAfter, getToken],
	);

	const handleRewindToPart = useCallback(
		async (messageId: Id<"messages">, keepPartCount: number) => {
			if (!activeConvoId || isBusy()) return;
			try {
				await truncatePart.mutateAsync({ id: messageId, keepPartCount });
				const token = await getToken();
				await resetAgentSessionForRewind(token, activeConvoId);
			} catch (err) {
				console.error("rewind-to-part failed", err);
				toast.error("Couldn't rewind to that point.");
			}
		},
		[activeConvoId, isBusy, truncatePart, getToken],
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

	const forkAtPart = useCallback(
		async (messageId: Id<"messages">, keepPartCount: number) => {
			if (!activeConvoId) return;
			try {
				const newConvoId = await fork.mutateAsync({
					conversationId: activeConvoId,
					upToMessageId: messageId,
					truncateLastPartCount: keepPartCount,
				});
				onNavigate(newConvoId);
			} catch (err) {
				console.error("fork-at-part failed", err);
				toast.error("Couldn't fork at that point.");
			}
		},
		[activeConvoId, fork, onNavigate],
	);

	return { handleRewind, forkAtMessage, handleRewindToPart, forkAtPart };
}
