import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useWorkspaceSelection } from "./use-workspace-selection";

const wid = (s: string) => s as Id<"workspaces">;
const cid = (s: string) => s as Id<"conversations">;
type WS = { _id: Id<"workspaces">; name: string; lastUsedAt: number };
const ws = (id: string, name = id, lastUsedAt = 0): WS => ({
	_id: wid(id),
	name,
	lastUsedAt,
});

describe("useWorkspaceSelection", () => {
	it("seeds activeConvoId from the URL (deep link opens directly)", () => {
		const { result } = renderHook(() =>
			useWorkspaceSelection({
				workspaces: [ws("w1")],
				initialWorkspaceId: "w1",
				initialConvoId: "c-deep",
			}),
		);
		expect(result.current.activeConvoId).toBe("c-deep");
	});

	it("resolves the active workspace from initialWorkspaceId when it exists", () => {
		const { result } = renderHook(() =>
			useWorkspaceSelection({
				workspaces: [ws("w1"), ws("w2")],
				initialWorkspaceId: "w2",
			}),
		);
		expect(result.current.activeWorkspaceId).toBe("w2");
		expect(result.current.activeWorkspace?._id).toBe("w2");
	});

	it("falls back to the most-recently-used workspace (not list order) with no URL hint", () => {
		const { result } = renderHook(() =>
			useWorkspaceSelection({
				// w1 is first in the (manually-ordered) list, but w2 was used later.
				workspaces: [ws("w1", "w1", 100), ws("w2", "w2", 200)],
			}),
		);
		expect(result.current.activeWorkspaceId).toBe("w2");
	});

	it("does NOT wipe a URL-seeded conversation while workspaces is still loading (regression)", () => {
		// The original bug: the resolution effect nulled the convo while
		// workspaces was undefined, then restore opened the wrong chat.
		const initialProps: { workspaces: WS[] | undefined } = {
			workspaces: undefined,
		};
		const { result, rerender } = renderHook(
			({ workspaces }: { workspaces: WS[] | undefined }) =>
				useWorkspaceSelection({
					workspaces,
					initialWorkspaceId: "w1",
					initialConvoId: "c-deep",
				}),
			{ initialProps },
		);
		// Loading: convo preserved, no workspace yet.
		expect(result.current.activeConvoId).toBe("c-deep");
		expect(result.current.activeWorkspaceId).toBeNull();
		// Workspaces arrive: workspace resolves, convo STILL intact.
		rerender({ workspaces: [ws("w1")] });
		expect(result.current.activeWorkspaceId).toBe("w1");
		expect(result.current.activeConvoId).toBe("c-deep");
	});

	it("keeps the current workspace selected across a workspaces refetch", () => {
		const { result, rerender } = renderHook(
			({ workspaces }: { workspaces: WS[] }) =>
				useWorkspaceSelection({ workspaces }),
			{ initialProps: { workspaces: [ws("w1"), ws("w2")] } },
		);
		act(() => result.current.selectWorkspace(wid("w2")));
		expect(result.current.activeWorkspaceId).toBe("w2");
		// A refetch returning the same set must not reset the selection to w1.
		rerender({ workspaces: [ws("w1"), ws("w2")] });
		expect(result.current.activeWorkspaceId).toBe("w2");
	});

	it("selectWorkspace switches workspace and clears the open conversation", () => {
		const { result } = renderHook(() =>
			useWorkspaceSelection({
				workspaces: [ws("w1"), ws("w2")],
				initialConvoId: "c1",
			}),
		);
		expect(result.current.activeConvoId).toBe("c1");
		act(() => result.current.selectWorkspace(wid("w2")));
		expect(result.current.activeWorkspaceId).toBe("w2");
		expect(result.current.activeConvoId).toBeNull();
	});

	it("setActiveConvoId updates the open conversation", () => {
		const { result } = renderHook(() =>
			useWorkspaceSelection({ workspaces: [ws("w1")] }),
		);
		act(() => result.current.setActiveConvoId(cid("c9")));
		expect(result.current.activeConvoId).toBe("c9");
	});
});
