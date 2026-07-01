import { useAuth } from "@clerk/tanstack-react-start";
import { useCallback, useEffect, useState } from "react";
import { env } from "../env";
import { agentStatusLabel } from "./agent-mode";
import type { ConvoStreamState, StreamPart } from "./use-chat-stream";

const FASTAPI_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";

// Mirror of the backend cap (stream_bus / agents.py): keep a runaway terminal
// stream from bloating the rendered part.
const MAX_TOOL_RESULT_CHARS = 256_000;

const EMPTY: ConvoStreamState = {
	content: null,
	reasoning: null,
	toolCalls: [],
	parts: [],
	pendingDoneContent: null,
	usage: null,
	model: null,
	agentStatus: null,
	plan: null,
	agentUsage: null,
};

/**
 * Reduce one live-follow event into the streaming state. Faithful to the
 * ChatStreamProvider reducers so a followed (passive) render matches the
 * initiator's. Pure + exported for unit testing.
 */
export function reduceFollow(
	prev: ConvoStreamState | null,
	event: string,
	data: Record<string, unknown>,
): ConvoStreamState | null {
	const state = prev ?? EMPTY;
	switch (event) {
		case "turn_start":
			// A new turn — reset any prior partial.
			return { ...EMPTY };
		case "token": {
			const content = (data.content as string) ?? "";
			const messageId = (data.message_id ?? null) as string | null;
			const parentId = (data.parent_id ?? null) as string | null;
			const parts = [...state.parts];
			const last = parts[parts.length - 1];
			const sameMessage =
				last?.type === "text" && (last.messageId ?? null) === messageId;
			if (sameMessage && last) {
				parts[parts.length - 1] = {
					...last,
					content: (last.content ?? "") + content,
				};
			} else {
				parts.push({
					type: "text",
					content,
					messageId,
					parentId,
				} as StreamPart);
			}
			return {
				...state,
				content: (state.content ?? "") + content,
				parts,
				agentStatus: null,
			};
		}
		case "thinking": {
			const content = (data.content as string) ?? "";
			const messageId = (data.message_id ?? null) as string | null;
			const parentId = (data.parent_id ?? null) as string | null;
			const parts = [...state.parts];
			const last = parts[parts.length - 1];
			const sameMessage =
				last?.type === "reasoning" && (last.messageId ?? null) === messageId;
			if (sameMessage && last) {
				parts[parts.length - 1] = {
					...last,
					content: (last.content ?? "") + content,
				};
			} else {
				parts.push({
					type: "reasoning",
					content,
					messageId,
					parentId,
				} as StreamPart);
			}
			return {
				...state,
				reasoning: (state.reasoning ?? "") + content,
				parts,
			};
		}
		case "tool_call": {
			const call_id = data.call_id as string;
			return {
				...state,
				toolCalls: [
					...state.toolCalls,
					{
						tool: data.tool as string,
						arguments: (data.arguments ?? {}) as Record<string, unknown>,
						call_id,
						kind: (data.kind ?? "other") as string,
						locations: (data.locations ?? []) as Array<{ path?: string }>,
						parentId: (data.parent_id ?? null) as string | null,
						status: (data.status ?? null) as string | null,
						serverName: (data.server_name ?? null) as string | null,
					},
				],
				parts: [
					...state.parts,
					{
						type: "tool_call" as const,
						tool: data.tool as string,
						arguments: (data.arguments ?? {}) as Record<string, unknown>,
						call_id,
						kind: (data.kind ?? "other") as string,
						locations: (data.locations ?? []) as Array<{ path?: string }>,
						parentId: (data.parent_id ?? null) as string | null,
						status: (data.status ?? null) as string | null,
						serverName: (data.server_name ?? null) as string | null,
					},
				],
				agentStatus: null,
			};
		}
		case "tool_result": {
			const call_id = data.call_id as string;
			const append = Boolean(data.append);
			const result = (data.result ?? "") as string;
			const status = (data.status ?? null) as string | null;
			const overwrite =
				!append &&
				(Boolean(result) || status === "completed" || status === "failed");
			// Late-arriving full tool input (e.g. a terminal command, a read
			// file's path, the Workflow script) merges onto the args the initial
			// streaming tool_call didn't have yet. Mirrors the initiator's reducer
			// (chat-stream-context); without it a passive viewer is stuck showing
			// the empty/generic input until the message persists.
			const mergedArgs =
				data.arguments && Object.keys(data.arguments as object).length > 0
					? (p: StreamPart) => ({
							...((p.arguments ?? {}) as Record<string, unknown>),
							...(data.arguments as Record<string, unknown>),
						})
					: null;
			const cap = (s: string) =>
				s.length > MAX_TOOL_RESULT_CHARS
					? `…[earlier output truncated]\n${s.slice(-MAX_TOOL_RESULT_CHARS)}`
					: s;
			const patch = (p: StreamPart): StreamPart => {
				if (append) {
					const delta = (data.output_delta ?? "") as string;
					return {
						...p,
						result: delta ? cap((p.result ?? "") + delta) : p.result,
						...(data.exit_code !== null && data.exit_code !== undefined
							? { exitCode: data.exit_code as number }
							: {}),
						...(status ? { status } : {}),
						...(mergedArgs ? { arguments: mergedArgs(p) } : {}),
					};
				}
				return {
					...p,
					...(overwrite ? { result } : {}),
					diff: (data.diff ?? p.diff) as StreamPart["diff"],
					...(status ? { status } : {}),
					...(mergedArgs ? { arguments: mergedArgs(p) } : {}),
				};
			};
			return {
				...state,
				// Mirror the result onto the legacy toolCalls array too (the owner
				// reducer does), so any consumer reading toolCalls (not parts) matches.
				toolCalls: state.toolCalls.map((tc) =>
					tc.call_id === call_id && overwrite ? { ...tc, result } : tc,
				),
				parts: state.parts.map((p) =>
					p.type === "tool_call" && p.call_id === call_id ? patch(p) : p,
				),
			};
		}
		case "plan": {
			// Claude (TodoWrite) / Codex re-emit the full plan repeatedly, often
			// unchanged — skip the update when identical to avoid redundant
			// re-renders of the plan card (matches the initiator reducer).
			const entries = (data.entries ?? []) as ConvoStreamState["plan"];
			const current = state.plan;
			if (
				current &&
				entries &&
				current.length === entries.length &&
				current.every(
					(e, i) =>
						e.content === entries[i].content && e.status === entries[i].status,
				)
			) {
				return state;
			}
			return { ...state, plan: entries };
		}
		case "agent_usage":
			return {
				...state,
				agentUsage: {
					used: (data.used ?? null) as number | null,
					size: (data.size ?? null) as number | null,
					cost: (data.cost ?? null) as number | null,
					currency: (data.currency ?? "USD") as string,
				},
			};
		case "status":
			return {
				...state,
				agentStatus: agentStatusLabel(
					data as { state?: string; agent?: string },
				),
			};
		case "done":
			return {
				...state,
				content: (data.content as string) ?? state.content,
				pendingDoneContent: (data.content as string) ?? state.content ?? "",
				model: (data.model as string) ?? state.model,
				agentStatus: null,
				// Drop the plan/todo card when the turn ends (the owner does too) —
				// otherwise a finished follower keeps showing the last plan until the
				// persisted message takes over.
				plan: null,
			};
		case "error":
			// The initiator persists the interrupted partial; clear ours and let
			// the reactive message render.
			return null;
		default:
			return state;
	}
}

/**
 * Subscribe a PASSIVE viewer to a conversation's live token feed (the owner's
 * other tabs, a sharee watching, a late joiner). Opens the read-only
 * /api/chat/follow SSE (Redis-backed) and reduces events into a ConvoStreamState
 * that renders through the SAME ChatMessages streaming props as a local stream.
 *
 * `enabled` should be false when THIS tab is the turn's initiator (its local
 * token-perfect stream renders instead — never both). `token` is the share link
 * for a sharee (signed-in users also send their Clerk JWT; anonymous viewers
 * authorize by token alone).
 */
export function useFollowStream({
	conversationId,
	token,
	enabled,
}: {
	conversationId: string | null;
	token?: string;
	enabled: boolean;
}): { followState: ConvoStreamState | null; clearFollow: () => void } {
	const { getToken } = useAuth();
	const [followState, setFollowState] = useState<ConvoStreamState | null>(null);

	useEffect(() => {
		if (!enabled || !conversationId) {
			setFollowState(null);
			return;
		}
		const controller = new AbortController();
		let cancelled = false;

		const run = async () => {
			while (!cancelled) {
				try {
					const authToken = await getToken({ template: "convex" }).catch(
						() => null,
					);
					const url =
						`${FASTAPI_URL}/api/chat/follow?conversation_id=${encodeURIComponent(conversationId)}` +
						(token ? `&token=${encodeURIComponent(token)}` : "");
					const res = await fetch(url, {
						headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
						signal: controller.signal,
					});
					if (!res.ok || !res.body) {
						await sleep(2500);
						continue;
					}
					const reader = res.body.getReader();
					const decoder = new TextDecoder();
					let buffer = "";
					let currentEvent = "message";
					while (!cancelled) {
						const { done, value } = await reader.read();
						if (done) break;
						buffer += decoder.decode(value, { stream: true });
						const lines = buffer.split("\n");
						buffer = lines.pop() ?? "";
						for (const line of lines) {
							if (line.startsWith("event: ")) {
								currentEvent = line.slice(7).trim();
								continue;
							}
							if (line.startsWith("data: ")) {
								let data: Record<string, unknown> = {};
								try {
									data = JSON.parse(line.slice(6));
								} catch {
									// skip malformed frame
								}
								const ev = currentEvent;
								setFollowState((prev) => reduceFollow(prev, ev, data));
								currentEvent = "message";
							}
						}
					}
				} catch {
					if (cancelled) return;
				}
				if (!cancelled) await sleep(2500); // reconnect backoff
			}
		};
		run();

		return () => {
			cancelled = true;
			controller.abort();
			setFollowState(null);
		};
	}, [conversationId, token, enabled, getToken]);

	const clearFollow = useCallback(() => setFollowState(null), []);
	return { followState, clearFollow };
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
