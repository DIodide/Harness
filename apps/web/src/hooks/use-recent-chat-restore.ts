import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useCallback, useEffect, useRef } from "react";

/** Restore the workspace's most-recent chat only if it was touched this recently. */
export const LAST_CHAT_RESTORE_WINDOW_MS = 8 * 60 * 60 * 1000;

type RestorableConversation = {
	_id: Id<"conversations">;
	workspaceId?: Id<"workspaces">;
	lastMessageAt: number;
	editParentConversationId?: Id<"conversations">;
};

/**
 * When the active workspace changes, queues a one-shot attempt to re-open that
 * workspace's most-recent conversation (if touched within the window) — but only
 * when nothing is already open, so a URL deep-link or an explicit selection is
 * never overridden.
 *
 * Extracted from the /workspaces route so the arming/applying handshake (two
 * effects coordinating through refs) lives in one testable place. Two notes:
 *  - `cancelRestore()` lets an explicit "New chat" cancel an armed-but-not-yet-
 *    applied restore, so dismissing a chat never silently re-opens it. (This
 *    fixes a real bug the inline version had.)
 *  - The applied conversation is verified to belong to `activeWorkspaceId`. This
 *    is defensive: today the list goes `undefined` on a workspace switch (the
 *    query has no keepPreviousData), so a previous-workspace list is never
 *    served — but if that ever changed, the guard keeps restore from opening the
 *    wrong workspace's chat.
 *
 * @param onRestore called with the conversation id to open (typically a
 *        setActiveConvoId). Only ever called with a conversation in the active
 *        workspace.
 */
export function useRecentChatRestore({
	activeWorkspaceId,
	conversations,
	activeConvoId,
	onRestore,
	windowMs = LAST_CHAT_RESTORE_WINDOW_MS,
}: {
	activeWorkspaceId: Id<"workspaces"> | null;
	conversations: RestorableConversation[] | undefined;
	activeConvoId: Id<"conversations"> | null;
	onRestore: (id: Id<"conversations">) => void;
	windowMs?: number;
}): { cancelRestore: () => void } {
	const prevWorkspaceIdRef = useRef<Id<"workspaces"> | null>(null);
	const pendingRestoreWorkspaceIdRef = useRef<Id<"workspaces"> | null>(null);

	const cancelRestore = useCallback(() => {
		pendingRestoreWorkspaceIdRef.current = null;
	}, []);

	// Arm a one-shot restore whenever the active workspace changes. Tracked via a
	// ref so nulling activeConvoId (e.g. "New chat") doesn't re-arm it.
	useEffect(() => {
		if (prevWorkspaceIdRef.current === activeWorkspaceId) return;
		prevWorkspaceIdRef.current = activeWorkspaceId;
		pendingRestoreWorkspaceIdRef.current = activeWorkspaceId;
	}, [activeWorkspaceId]);

	useEffect(() => {
		const pending = pendingRestoreWorkspaceIdRef.current;
		if (!pending || pending !== activeWorkspaceId) return;
		if (!conversations) return;
		// Something is already open (URL deep-link / explicit selection) — it wins.
		if (activeConvoId) {
			pendingRestoreWorkspaceIdRef.current = null;
			return;
		}
		pendingRestoreWorkspaceIdRef.current = null;
		const cutoff = Date.now() - windowMs;
		const mostRecent = conversations.find(
			(c) =>
				// Defensive: only restore a conversation that belongs to the active
				// workspace (live rows always do; this just protects against ever
				// being handed a stale previous-workspace list).
				(c.workspaceId === undefined || c.workspaceId === activeWorkspaceId) &&
				!c.editParentConversationId &&
				c.lastMessageAt >= cutoff,
		);
		if (mostRecent) {
			onRestore(mostRecent._id);
		}
	}, [activeWorkspaceId, conversations, activeConvoId, windowMs, onRestore]);

	return { cancelRestore };
}
