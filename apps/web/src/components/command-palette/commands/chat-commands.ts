import {
	MessageSquarePlus,
	PanelLeftClose,
	PanelLeftOpen,
	Square,
} from "lucide-react";
import { useMemo } from "react";
import { useRegisterCommands } from "../../../hooks/use-register-commands";
import type { Command } from "../../../lib/command-palette/types";

interface ChatPaletteCommandsInput {
	isStreaming: boolean;
	canStartNewConversation: boolean;
	sidebarOpen: boolean;
	onNewConversation: () => void;
	onCancelStream: () => void;
	onToggleSidebar: () => void;
}

/**
 * Registers the chat-scoped commands: new conversation, cancel streaming,
 * and sidebar toggle. Call from whichever route hosts the chat surface
 * (both `/chat` and `/workspaces` use this — they're mutually exclusive
 * at runtime, so the command IDs don't collide).
 */
export function useChatPaletteCommands({
	isStreaming,
	canStartNewConversation,
	sidebarOpen,
	onNewConversation,
	onCancelStream,
	onToggleSidebar,
}: ChatPaletteCommandsInput): void {
	const commands = useMemo<Command[]>(() => {
		const list: Command[] = [
			{
				id: "chat:new-conversation",
				title: "New conversation",
				group: "chat",
				icon: MessageSquarePlus,
				keywords: ["new", "chat", "convo", "message"],
				when: () => canStartNewConversation,
				perform: onNewConversation,
			},
			{
				id: "chat:toggle-sidebar",
				title: sidebarOpen ? "Hide sidebar" : "Show sidebar",
				group: "chat",
				icon: sidebarOpen ? PanelLeftClose : PanelLeftOpen,
				keywords: ["sidebar", "panel", "toggle"],
				perform: onToggleSidebar,
			},
		];
		if (isStreaming) {
			list.push({
				id: "chat:cancel-stream",
				title: "Cancel streaming response",
				group: "chat",
				icon: Square,
				keywords: ["stop", "interrupt", "abort"],
				perform: onCancelStream,
			});
		}
		return list;
	}, [
		isStreaming,
		canStartNewConversation,
		sidebarOpen,
		onNewConversation,
		onCancelStream,
		onToggleSidebar,
	]);

	useRegisterCommands(commands);
}
