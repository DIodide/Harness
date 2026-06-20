import { describe, expect, it, vi } from "vitest";
import { openConversation } from "./navigate-to-conversation";

// openConversation only ever calls navigate({to, search, replace}); a plain spy
// is enough to assert the route + that convoId always survives.
// biome-ignore lint/suspicious/noExplicitAny: test spy stands in for the router's NavigateFn
const navigate = () => vi.fn() as any;

describe("openConversation", () => {
	it("routes workspaces-mode users to /workspaces with workspaceId + convoId", () => {
		const nav = navigate();
		openConversation(nav, {
			workspacesMode: "workspaces",
			workspaceId: "w1",
			convoId: "c1",
		});
		expect(nav).toHaveBeenCalledWith({
			to: "/workspaces",
			search: { workspaceId: "w1", convoId: "c1" },
			replace: false,
		});
	});

	it("routes basic-mode users to /chat with only convoId", () => {
		const nav = navigate();
		openConversation(nav, {
			workspacesMode: "basic",
			workspaceId: "w1",
			convoId: "c1",
		});
		expect(nav).toHaveBeenCalledWith({
			to: "/chat",
			search: { convoId: "c1" },
			replace: false,
		});
	});

	it("treats an undefined mode as basic (defaults to /chat)", () => {
		const nav = navigate();
		openConversation(nav, { workspacesMode: undefined, convoId: "c1" });
		expect(nav).toHaveBeenCalledWith({
			to: "/chat",
			search: { convoId: "c1" },
			replace: false,
		});
	});

	it("omits workspaceId from the search when not provided, but always keeps convoId", () => {
		const nav = navigate();
		openConversation(nav, { workspacesMode: "workspaces", convoId: "c1" });
		expect(nav).toHaveBeenCalledWith({
			to: "/workspaces",
			search: { convoId: "c1" },
			replace: false,
		});
	});

	it("passes through the replace flag", () => {
		const nav = navigate();
		openConversation(nav, {
			workspacesMode: "workspaces",
			workspaceId: "w1",
			convoId: "c1",
			replace: true,
		});
		expect(nav).toHaveBeenCalledWith({
			to: "/workspaces",
			search: { workspaceId: "w1", convoId: "c1" },
			replace: true,
		});
	});
});
