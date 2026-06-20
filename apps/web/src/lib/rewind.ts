import { forgetAllAgentSessions, resetServerAgentSessions } from "./agent-mode";

/**
 * Reset the live agent session(s) after a NORMAL (in-place) rewind.
 *
 * A Convex truncation doesn't touch a running ACP agent's context: the gateway
 * reuses the warm session by (user, conversation, agent) and skips re-seeding
 * because its transcript is non-empty, AND the ACP session in the sandbox still
 * natively holds the rewound turns. So a CLIENT cache drop alone is not enough.
 *
 * We tear the session down SERVER-SIDE (keyed by conversation, not agent — so a
 * session-only agent override is never missed), which closes the ACP session
 * while parking the runtime warm. The next prompt then opens a fresh session
 * that re-seeds its transcript from the now-truncated history. The client cache
 * is also cleared so it doesn't try to reuse the torn-down session id.
 *
 * This is the single seam where future per-agent rewind handling would land
 * (e.g. a dedicated gateway rewind RPC). Idempotent + best-effort: a no-op for
 * the stateless OpenRouter loop (the server simply has no session to reset).
 *
 * Rewind-AND-fork needs no reset — a new conversation has no session and seeds
 * from the forked (already-truncated) history by construction.
 *
 * Returns whether the server-side reset succeeded (200, including the stateless
 * OpenRouter no-session case which resets 0 sessions). `false` means a genuine
 * network/5xx failure left a warm session that still holds the rewound turns —
 * the caller should warn the user, since the view and the agent now disagree.
 */
export async function resetAgentSessionForRewind(
	token: string | null,
	conversationId: string,
): Promise<boolean> {
	const ok = await resetServerAgentSessions(token, conversationId);
	forgetAllAgentSessions(conversationId);
	return ok;
}
