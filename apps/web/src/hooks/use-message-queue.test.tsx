import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Controllable stand-in for the chat-stream context. Tests mutate `mockStream`
// (and rerender) to simulate a turn streaming / ending.
const mockStream = vi.hoisted(() => ({
	value: { streamingConvoIds: new Set<string>(), cancel: vi.fn() },
}));
vi.mock("../lib/chat-stream-context", () => ({
	useChatStreamContext: () => mockStream.value,
}));

import { useMessageQueue } from "./use-message-queue";

const cid = (s: string) => s as Id<"conversations">;
const HARNESS = { _id: "h1" as Id<"harnesses"> };

type Props = {
	activeConvoId: Id<"conversations"> | null;
	activeHarness: { _id: Id<"harnesses"> } | null | undefined;
	sendQueuedMessage: (convoId: string, content: string) => Promise<void>;
};

function render(overrides: Partial<Props> & Pick<Props, "sendQueuedMessage">) {
	const initialProps: Props = {
		activeConvoId: cid("c1"),
		activeHarness: HARNESS,
		...overrides,
	};
	return renderHook((props: Props) => useMessageQueue(props), { initialProps });
}

beforeEach(() => {
	mockStream.value = { streamingConvoIds: new Set<string>(), cancel: vi.fn() };
});

describe("useMessageQueue", () => {
	it("enqueues and dequeues by stable id", () => {
		const { result } = render({ sendQueuedMessage: vi.fn() });
		act(() => result.current.enqueueMessage("first"));
		act(() => result.current.enqueueMessage("second"));
		expect(result.current.messageQueue.map((q) => q.content)).toEqual([
			"first",
			"second",
		]);
		const firstId = result.current.messageQueue[0].id;
		act(() => result.current.dequeueMessage(firstId));
		expect(result.current.messageQueue.map((q) => q.content)).toEqual([
			"second",
		]);
	});

	it("handleSendNow sends immediately when nothing is streaming", () => {
		const sendQueuedMessage = vi.fn().mockResolvedValue(undefined);
		const { result } = render({ sendQueuedMessage });
		act(() => result.current.enqueueMessage("hi"));
		const id = result.current.messageQueue[0].id;
		act(() => result.current.handleSendNow(id));
		expect(sendQueuedMessage).toHaveBeenCalledWith("c1", "hi");
		expect(result.current.messageQueue).toHaveLength(0);
	});

	it("handleSendNow interrupts (cancel) instead of sending while a turn streams", () => {
		const sendQueuedMessage = vi.fn().mockResolvedValue(undefined);
		mockStream.value.streamingConvoIds = new Set(["c1"]);
		const { result } = render({ sendQueuedMessage });
		act(() => result.current.enqueueMessage("hi"));
		const id = result.current.messageQueue[0].id;
		act(() => result.current.handleSendNow(id));
		// Cancels the in-flight turn; the message is armed, not sent yet.
		expect(mockStream.value.cancel).toHaveBeenCalledWith("c1");
		expect(sendQueuedMessage).not.toHaveBeenCalled();
		expect(result.current.messageQueue).toHaveLength(0);
	});

	it("flushes the armed message once the turn stops streaming (drain effect)", () => {
		const sendQueuedMessage = vi.fn().mockResolvedValue(undefined);
		mockStream.value.streamingConvoIds = new Set(["c1"]);
		const { result, rerender } = render({ sendQueuedMessage });
		act(() => result.current.enqueueMessage("hi"));
		const id = result.current.messageQueue[0].id;
		act(() => result.current.handleSendNow(id));
		expect(sendQueuedMessage).not.toHaveBeenCalled();
		// Turn ends → the post-stream drain effect flushes the armed message.
		mockStream.value = { streamingConvoIds: new Set(), cancel: vi.fn() };
		rerender({
			activeConvoId: cid("c1"),
			activeHarness: HARNESS,
			sendQueuedMessage,
		});
		expect(sendQueuedMessage).toHaveBeenCalledWith("c1", "hi");
	});

	it("drainQueueAfterTurn arms the next queued message; it flushes when the turn ends", () => {
		const sendQueuedMessage = vi.fn().mockResolvedValue(undefined);
		mockStream.value.streamingConvoIds = new Set(["c1"]);
		const { result, rerender } = render({ sendQueuedMessage });
		act(() => result.current.enqueueMessage("queued"));
		act(() => result.current.drainQueueAfterTurn("c1"));
		// Armed (shifted out of the visible queue) but not sent while streaming.
		expect(result.current.messageQueue).toHaveLength(0);
		expect(sendQueuedMessage).not.toHaveBeenCalled();
		// Turn ends → drain effect flushes the armed message.
		mockStream.value = { streamingConvoIds: new Set(), cancel: vi.fn() };
		rerender({
			activeConvoId: cid("c1"),
			activeHarness: HARNESS,
			sendQueuedMessage,
		});
		expect(sendQueuedMessage).toHaveBeenCalledWith("c1", "queued");
	});

	it("processQueuedAfterSync arms the next queued message and the drain flushes it deterministically", () => {
		const sendQueuedMessage = vi.fn().mockResolvedValue(undefined);
		const { result } = render({ sendQueuedMessage });
		act(() => result.current.enqueueMessage("next"));
		act(() => result.current.processQueuedAfterSync("c1"));
		// Shifted out of the visible queue and flushed on the same cycle by the
		// drain effect (armed sends bump an explicit flush signal). No longer
		// reliant on the send callback's identity changing between turns — which
		// a stabilized callback would have silently broken.
		expect(result.current.messageQueue).toHaveLength(0);
		expect(sendQueuedMessage).toHaveBeenCalledWith("c1", "next");
	});

	it("clears the queue when the active conversation changes", () => {
		const { result, rerender } = render({ sendQueuedMessage: vi.fn() });
		act(() => result.current.enqueueMessage("a"));
		expect(result.current.messageQueue).toHaveLength(1);
		rerender({
			activeConvoId: cid("c2"),
			activeHarness: HARNESS,
			sendQueuedMessage: vi.fn(),
		});
		expect(result.current.messageQueue).toHaveLength(0);
	});
});
