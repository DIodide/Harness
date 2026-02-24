import { api } from "@harness/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";

export function useConversations(userId: string | undefined) {
	const conversations = useQuery(
		api.conversations.listByUser,
		userId ? { userId } : "skip",
	);
	const createConversation = useMutation(api.conversations.create);
	const updateTitle = useMutation(api.conversations.updateTitle);
	const removeConversation = useMutation(api.conversations.remove);

	return {
		conversations: conversations ?? [],
		isLoading: conversations === undefined,
		createConversation,
		updateTitle,
		removeConversation,
	};
}

export function useConversation(id: string | undefined) {
	const conversation = useQuery(
		api.conversations.get,
		id ? { id: id as any } : "skip",
	);
	return { conversation, isLoading: conversation === undefined };
}
