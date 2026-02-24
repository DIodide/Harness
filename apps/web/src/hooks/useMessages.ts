import { api } from "@harness/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";

export function useMessages(conversationId: string | undefined) {
	const messages = useQuery(
		api.messages.listByConversation,
		conversationId ? { conversationId: conversationId as any } : "skip",
	);
	const sendMessage = useMutation(api.messages.send);

	const isStreaming = messages?.some((m) => m.isStreaming) ?? false;

	return {
		messages: messages ?? [],
		isLoading: messages === undefined,
		isStreaming,
		sendMessage,
	};
}
