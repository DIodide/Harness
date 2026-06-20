/**
 * Shared helpers for truncating an assistant message's `parts[]` timeline —
 * used by both `messages.truncatePart` (in-place mid-message rewind) and
 * `conversations.fork` (rewind & fork into the middle of an assistant message).
 *
 * The load-bearing invariant: an assistant message stores its content TWICE —
 * the rich `parts[]` array (what the UI renders) and a flat `content` string
 * (the ONLY thing the agent transcript is rebuilt from). When we truncate
 * `parts`, we MUST recompute `content` from the kept text parts the exact same
 * way the gateway builds it, or the UI and the model disagree about what the
 * assistant said.
 *
 * Gateway reference: `content = "".join(text_parts)` — text parts only, joined
 * with no separator (session_manager.py). reasoning/tool_call parts contribute
 * nothing to `content`.
 *
 * This join is the CANONICAL faithful content for a (truncated) parts list. It
 * matches the ACP gateway exactly. The default OpenRouter path (chat.py) instead
 * persists only the LAST agentic iteration's text as `content` while appending
 * one text part per iteration to parts[], so for a multi-iteration message the
 * stored `content` can be SHORTER than this join. That divergence is pre-existing
 * (independent of rewind); the seam UI surfaces it honestly by computing
 * "does the agent's context change?" as (recomputed content !== stored content),
 * and a mid-message cut writes this canonical (faithful) join either way.
 */

type AnyPart = { type: string; content?: string };

/** Recompute the flat `content` string from a (possibly truncated) parts list,
 *  mirroring the gateway's join exactly. */
export function contentFromParts(parts: AnyPart[]): string {
	return parts
		.filter((p) => p.type === "text")
		.map((p) => p.content ?? "")
		.join("");
}
