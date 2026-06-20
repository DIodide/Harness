import type { useNavigate } from "@tanstack/react-router";

type NavigateFn = ReturnType<typeof useNavigate>;

/**
 * The single place that maps a user's `workspacesMode` to the route that opens a
 * conversation — `/workspaces?workspaceId&convoId` for workspaces users, plain
 * `/chat?convoId` otherwise.
 *
 * This rule was copy-pasted across the share page (owner redirect + fork) and
 * elsewhere, and a copy that dropped `convoId` from the search params is exactly
 * how a deep-linked conversation got lost. Centralizing it makes "convoId must
 * always survive" a property of one function instead of an invariant re-typed by
 * hand at every call site.
 */
export function openConversation(
	navigate: NavigateFn,
	{
		workspacesMode,
		workspaceId,
		convoId,
		replace = false,
	}: {
		workspacesMode: string | undefined;
		workspaceId?: string | null;
		convoId: string;
		replace?: boolean;
	},
): void {
	if (workspacesMode !== "workspaces") {
		navigate({ to: "/chat", search: { convoId }, replace });
		return;
	}
	navigate({
		to: "/workspaces",
		search: {
			...(workspaceId ? { workspaceId } : {}),
			convoId,
		},
		replace,
	});
}
