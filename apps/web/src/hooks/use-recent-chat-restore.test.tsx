import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	LAST_CHAT_RESTORE_WINDOW_MS,
	useRecentChatRestore,
} from "./use-recent-chat-restore";

const wid = (s: string) => s as Id<"workspaces">;
const cid = (s: string) => s as Id<"conversations">;
type Convo = {
	_id: Id<"conversations">;
	workspaceId?: Id<"workspaces">;
	lastMessageAt: number;
	editParentConversationId?: Id<"conversations">;
};
const convo = (id: string, workspaceId: string, ageMs = 0): Convo => ({
	_id: cid(id),
	workspaceId: wid(workspaceId),
	lastMessageAt: Date.now() - ageMs,
});

type Props = {
	activeWorkspaceId: Id<"workspaces"> | null;
	conversations: Convo[] | undefined;
	activeConvoId: Id<"conversations"> | null;
	onRestore: (id: Id<"conversations">) => void;
};

// Typing initialProps as Props (rather than letting TS narrow to the literal
// initial values) keeps rerender accepting the full Props shape.
function renderRestore(overrides: Partial<Props> & Pick<Props, "onRestore">) {
	const initialProps: Props = {
		activeWorkspaceId: null,
		conversations: undefined,
		activeConvoId: null,
		...overrides,
	};
	return renderHook((props: Props) => useRecentChatRestore(props), {
		initialProps,
	});
}

describe("useRecentChatRestore", () => {
	it("restores the most-recent in-window chat once the workspace + list are ready", () => {
		const onRestore = vi.fn();
		const { rerender } = renderRestore({ onRestore });
		rerender({
			activeWorkspaceId: wid("w1"),
			conversations: [convo("c1", "w1")],
			activeConvoId: null,
			onRestore,
		});
		expect(onRestore).toHaveBeenCalledWith("c1");
	});

	it("does NOT restore when a conversation is already open (deep link / explicit wins)", () => {
		const onRestore = vi.fn();
		const { rerender } = renderRestore({ onRestore });
		rerender({
			activeWorkspaceId: wid("w1"),
			conversations: [convo("c1", "w1")],
			activeConvoId: cid("c-deep"),
			onRestore,
		});
		expect(onRestore).not.toHaveBeenCalled();
	});

	it("does NOT restore a chat older than the window", () => {
		const onRestore = vi.fn();
		const { rerender } = renderRestore({ onRestore });
		rerender({
			activeWorkspaceId: wid("w1"),
			conversations: [convo("c1", "w1", LAST_CHAT_RESTORE_WINDOW_MS + 1000)],
			activeConvoId: null,
			onRestore,
		});
		expect(onRestore).not.toHaveBeenCalled();
	});

	it("does NOT restore a conversation belonging to a different workspace (stale-list guard)", () => {
		const onRestore = vi.fn();
		const { rerender } = renderRestore({ onRestore });
		// Active workspace is w2 but the list still holds w1's conversations.
		rerender({
			activeWorkspaceId: wid("w2"),
			conversations: [convo("c1", "w1")],
			activeConvoId: null,
			onRestore,
		});
		expect(onRestore).not.toHaveBeenCalled();
	});

	it("cancelRestore stops an armed-but-unapplied restore (New chat stays empty)", () => {
		const onRestore = vi.fn();
		const { result, rerender } = renderRestore({ onRestore });
		// Arm for w1, but conversations not loaded yet → apply bails, ref stays armed.
		rerender({
			activeWorkspaceId: wid("w1"),
			conversations: undefined,
			activeConvoId: null,
			onRestore,
		});
		// User clicks "New chat" → cancel the pending restore.
		act(() => result.current.cancelRestore());
		// Now the list arrives — restore must NOT fire.
		rerender({
			activeWorkspaceId: wid("w1"),
			conversations: [convo("c1", "w1")],
			activeConvoId: null,
			onRestore,
		});
		expect(onRestore).not.toHaveBeenCalled();
	});

	it("re-arms and restores again after switching to another workspace", () => {
		const onRestore = vi.fn();
		const { rerender } = renderRestore({
			activeWorkspaceId: wid("w1"),
			conversations: [convo("c1", "w1")],
			onRestore,
		});
		expect(onRestore).toHaveBeenCalledWith("c1");
		// Switch to w2 (convo cleared); its list restores w2's recent chat.
		rerender({
			activeWorkspaceId: wid("w2"),
			conversations: [convo("c2", "w2")],
			activeConvoId: null,
			onRestore,
		});
		expect(onRestore).toHaveBeenCalledWith("c2");
	});
});
