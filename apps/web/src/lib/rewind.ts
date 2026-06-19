import { type AgentMode, forgetAgentSession } from "./agent-mode";

/**
 * Reset the live agent session after a NORMAL (in-place) rewind.
 *
 * A Convex truncation doesn't touch a running ACP agent's in-memory context,
 * so the agent would still "remember" the rewound turns. Forgetting the cached
 * session forces the next prompt to open a fresh session that re-seeds its
 * transcript from the now-truncated history (the same reset-then-replay path
 * used by harness-switch and 404 recovery).
 *
 * This is the single seam where future per-agent rewind handling would land
 * (e.g. a dedicated gateway `rewind` RPC that reuses the live session instead
 * of paying a fresh-session cold start). Keep it thin.
 *
 * No-op for the default (OpenRouter) loop: it's stateless and holds no session,
 * so its next turn rebuilds from the reactive message history automatically.
 *
 * Rewind-AND-fork needs no reset — a new conversation has no cached session and
 * seeds from the forked (already-truncated) history by construction.
 */
export function resetAgentSessionForRewind(
	conversationId: string,
	agent: AgentMode,
): void {
	if (agent === "default") return;
	forgetAgentSession(conversationId, agent);
}
