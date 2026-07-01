import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useCallback, useEffect, useState } from "react";

/**
 * Owns the /workspaces route's *selection* state — which workspace is active and
 * which conversation is open — as one cohesive, testable unit.
 *
 * Why this exists: selection used to live in two bare `useState` cells written
 * by ~6 independent effects, with the precedence rule (URL deep-link > explicit
 * selection > most-recent-chat restore) existing only as prose comments and
 * emergent effect ordering. That is exactly how a regression shipped where a
 * load-order race nulled a URL-seeded conversation. Concentrating the rule here
 * makes it reviewable and unit-testable.
 *
 * Precedence, made explicit:
 *  - `activeConvoId` is SEEDED from the URL at init (so a deep link to an old
 *    conversation opens even when it's not in the recent-conversations list).
 *  - The most-recent-chat restore ({@link useRecentChatRestore}) only fires when
 *    `activeConvoId` is null, so a URL/explicit selection always wins.
 *  - Workspace resolution never touches `activeConvoId` while `workspaces` is
 *    still loading/transiently-empty, so the seed can't be wiped before its
 *    workspace loads.
 *
 * Conversation restore lives in {@link useRecentChatRestore} (it needs the
 * workspace-scoped conversations list, which the caller queries from the
 * `activeWorkspaceId` this hook returns).
 */
export function useWorkspaceSelection<
	W extends { _id: Id<"workspaces">; lastUsedAt: number },
>({
	workspaces,
	initialWorkspaceId,
	initialConvoId,
}: {
	workspaces: W[] | undefined;
	initialWorkspaceId?: string;
	initialConvoId?: string;
}): {
	activeWorkspaceId: Id<"workspaces"> | null;
	activeConvoId: Id<"conversations"> | null;
	activeWorkspace: W | undefined;
	setActiveConvoId: (id: Id<"conversations"> | null) => void;
	/** Switch workspace and clear the open conversation (restore re-runs). */
	selectWorkspace: (id: Id<"workspaces">) => void;
} {
	const [activeWorkspaceId, setActiveWorkspaceId] =
		useState<Id<"workspaces"> | null>(null);
	// Seed from the URL so a deep-linked conversation opens directly. Restore
	// (useRecentChatRestore) is gated on this being null, so the seed wins.
	const [activeConvoId, setActiveConvoId] =
		useState<Id<"conversations"> | null>(
			(initialConvoId as Id<"conversations">) ?? null,
		);

	// Resolve which workspace is active: keep the current one if still valid,
	// else the URL's initialWorkspaceId, else the most-recently-used. (The list's
	// display order is now user-controlled via drag-reorder, so we pick the MRU
	// explicitly rather than relying on list[0] — opening /workspaces fresh
	// resumes the last context regardless of manual order.) Crucially this never
	// nulls activeConvoId — while `workspaces` is undefined/transiently-empty
	// during the auth window, a URL-seeded conversation whose workspace hasn't
	// loaded yet must survive.
	useEffect(() => {
		if (!workspaces || workspaces.length === 0) {
			setActiveWorkspaceId(null);
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
		const mostRecent = workspaces.reduce((a, b) =>
			b.lastUsedAt > a.lastUsedAt ? b : a,
		);
		setActiveWorkspaceId(mostRecent._id);
	}, [workspaces, activeWorkspaceId, initialWorkspaceId]);

	const selectWorkspace = useCallback((id: Id<"workspaces">) => {
		setActiveWorkspaceId(id);
		setActiveConvoId(null);
	}, []);

	const activeWorkspace = workspaces?.find(
		(workspace) => workspace._id === activeWorkspaceId,
	);

	return {
		activeWorkspaceId,
		activeConvoId,
		activeWorkspace,
		setActiveConvoId,
		selectWorkspace,
	};
}
