import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import toast from "react-hot-toast";
import { useChatStreamContext } from "../lib/chat-stream-context";
import { toPersistableParts } from "../lib/use-chat-stream";

/**
 * Persists a turn that ended without a clean "done" — a user Stop (onAbort) or
 * an agent connection drop surfacing as onError — so the streamed-so-far content
 * isn't lost. Shared by /chat and /workspaces (the body was copy-pasted in both).
 *
 * Reads the live stream state from the chat-stream context; the only route-
 * specific input is the fallback model (`state.model` only arrives in "done").
 *
 * @param getFallbackModel returns the model to attribute when the stream never
 *        reported one — typically `sessionModel ?? activeHarness?.model ?? null`.
 *        Pass a stable (useCallback-wrapped) callback.
 */
export function usePersistInterruptedTurn(
	getFallbackModel: () => string | null,
): {
	persistInterruptedTurn: (convoId: string) => void;
} {
	const { streamStatesRef, clearStreamState, setStreamState } =
		useChatStreamContext();
	const saveInterruptedMsg = useMutation({
		mutationFn: useConvexMutation(api.messages.saveInterruptedMessage),
	});

	const persistInterruptedTurn = useCallback(
		(convoId: string) => {
			const state = streamStatesRef.current[convoId];
			if (state?.pendingDoneContent != null) return; // onDone already saved
			if (
				!state ||
				(!state.content && !state.reasoning && state.toolCalls.length === 0)
			) {
				clearStreamState(convoId);
				return;
			}
			// Keep only completed tool calls (those with a result).
			const completedToolCalls = state.toolCalls.filter(
				(tc) => tc.result,
			) as Array<{
				tool: string;
				arguments: Record<string, unknown>;
				call_id: string;
				result: string;
			}>;
			const cleanedParts = state.parts.filter(
				(p) => p.type !== "tool_call" || p.result,
			);
			const partialContent = state.content ?? "";
			// model only arrives in "done"; fall back to session then harness model.
			const model = state.model ?? getFallbackModel();
			saveInterruptedMsg.mutate(
				{
					conversationId: convoId as Id<"conversations">,
					content: partialContent,
					...(state.reasoning ? { reasoning: state.reasoning } : {}),
					...(completedToolCalls.length > 0
						? { toolCalls: completedToolCalls }
						: {}),
					...(cleanedParts.length > 0
						? { parts: toPersistableParts(cleanedParts) }
						: {}),
					...(state.usage ? { usage: state.usage } : {}),
					...(model ? { model } : {}),
				},
				{
					// If the write fails, clear the bubble so it doesn't wedge (it
					// otherwise only clears on a matching persisted row).
					onError: () => {
						clearStreamState(convoId);
						toast.error("Couldn't save the interrupted response.");
					},
				},
			);
			// Keep the bubble until Convex syncs the interrupted message (set
			// pendingDoneContent so convexHasMessage can match).
			setStreamState(convoId, () => ({
				...state,
				toolCalls: completedToolCalls,
				parts: cleanedParts,
				pendingDoneContent: partialContent,
				model,
			}));
		},
		[
			streamStatesRef,
			clearStreamState,
			setStreamState,
			saveInterruptedMsg,
			getFallbackModel,
		],
	);

	return { persistInterruptedTurn };
}
