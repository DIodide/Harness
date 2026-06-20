import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useCallback, useEffect, useRef, useState } from "react";
import { useChatStreamContext } from "../lib/chat-stream-context";

export type QueueItem = { id: number; content: string };

/**
 * The send-while-streaming message queue, shared by /chat and /workspaces (the
 * mechanics were copy-pasted in both). Messages typed during an in-flight turn
 * are queued and flushed one at a time as each turn ends.
 *
 * The actual send (save user message + build harness config + stream) is
 * route-specific and passed in as `sendQueuedMessage` — the hook owns only the
 * queue mechanics: enqueue/dequeue, send-now (interrupt + flush), drain-after-
 * turn, post-sync processing, and the post-stream drain effect.
 *
 * Note: the route's own convo-switch effect must still clear any non-queue state
 * (e.g. MCP failure banners); this hook clears only the queue.
 */
export function useMessageQueue({
	activeConvoId,
	activeHarness,
	sendQueuedMessage,
}: {
	activeConvoId: Id<"conversations"> | null;
	activeHarness: { _id: Id<"harnesses"> } | null | undefined;
	sendQueuedMessage: (convoId: string, content: string) => Promise<void>;
}): {
	messageQueue: QueueItem[];
	enqueueMessage: (content: string) => void;
	dequeueMessage: (id: number) => void;
	handleSendNow: (id: number) => void;
	/** Arm the next queued message to flush after the current turn aborts. */
	drainQueueAfterTurn: (convoId: string) => void;
	/** After a turn's state syncs to Convex, arm the next queued message. */
	processQueuedAfterSync: (convoId: string) => void;
} {
	const chatStream = useChatStreamContext();
	const [messageQueue, setMessageQueue] = useState<QueueItem[]>([]);
	const messageQueueRef = useRef<QueueItem[]>([]);
	const queueIdCounter = useRef(0);
	const pendingQueueSendRef = useRef<{
		convoId: string;
		content: string;
	} | null>(null);

	const enqueueMessage = useCallback((content: string) => {
		const item: QueueItem = { id: ++queueIdCounter.current, content };
		messageQueueRef.current = [...messageQueueRef.current, item];
		setMessageQueue([...messageQueueRef.current]);
	}, []);

	const dequeueMessage = useCallback((id: number) => {
		// Key by stable id, not array index: the queue can auto-shift between
		// render and click, which would otherwise remove the wrong item.
		messageQueueRef.current = messageQueueRef.current.filter(
			(it) => it.id !== id,
		);
		setMessageQueue([...messageQueueRef.current]);
	}, []);

	const shiftQueue = useCallback(() => {
		const [next, ...rest] = messageQueueRef.current;
		messageQueueRef.current = rest;
		setMessageQueue(rest);
		return next?.content;
	}, []);

	// Clear the queue on conversation switch.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally resets queue when active conversation changes
	useEffect(() => {
		messageQueueRef.current = [];
		setMessageQueue([]);
		pendingQueueSendRef.current = null;
	}, [activeConvoId]);

	const drainQueueAfterTurn = useCallback(
		(convoId: string) => {
			if (!pendingQueueSendRef.current && messageQueueRef.current.length > 0) {
				const next = shiftQueue();
				if (next) pendingQueueSendRef.current = { convoId, content: next };
			}
		},
		[shiftQueue],
	);

	const processQueuedAfterSync = useCallback(
		(convoId: string) => {
			// Process the next queued message now that Convex has synced.
			if (messageQueueRef.current.length > 0) {
				const next = shiftQueue();
				if (next) {
					pendingQueueSendRef.current = { convoId, content: next };
				}
			}
		},
		[shiftQueue],
	);

	const handleSendNow = useCallback(
		(id: number) => {
			if (!activeConvoId) return;
			// Key by stable id, not array index (the queue can auto-shift).
			const item = messageQueueRef.current.find((it) => it.id === id);
			if (!item) return;
			messageQueueRef.current = messageQueueRef.current.filter(
				(it) => it.id !== id,
			);
			setMessageQueue([...messageQueueRef.current]);
			// If a turn is in flight, interrupt and let the effect flush after it
			// ends; otherwise there's no controller to cancel (no-op) so send the
			// message directly rather than dropping it.
			if (chatStream.streamingConvoIds.has(activeConvoId)) {
				pendingQueueSendRef.current = {
					convoId: activeConvoId,
					content: item.content,
				};
				chatStream.cancel(activeConvoId);
			} else {
				void sendQueuedMessage(activeConvoId, item.content);
			}
		},
		[activeConvoId, chatStream, sendQueuedMessage],
	);

	// Process pending queued messages after the stream ends.
	useEffect(() => {
		const pending = pendingQueueSendRef.current;
		if (!pending || !activeHarness) return;

		const convoId = pending.convoId;
		// Wait until the conversation is no longer streaming
		if (chatStream.streamingConvoIds.has(convoId)) return;

		pendingQueueSendRef.current = null;
		void sendQueuedMessage(convoId, pending.content);
	}, [chatStream.streamingConvoIds, activeHarness, sendQueuedMessage]);

	return {
		messageQueue,
		enqueueMessage,
		dequeueMessage,
		handleSendNow,
		drainQueueAfterTurn,
		processQueuedAfterSync,
	};
}
