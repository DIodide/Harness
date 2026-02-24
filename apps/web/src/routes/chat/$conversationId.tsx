import { useState, useEffect } from "react";
import { useUser } from "@clerk/tanstack-react-start";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { ChatLayout } from "@/components/chat/ChatLayout";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { MessageList } from "@/components/chat/MessageList";
import { ChatInput } from "@/components/chat/ChatInput";
import { useHarness } from "@/hooks/useHarnesses";
import { useConversations, useConversation } from "@/hooks/useConversations";
import { useMessages } from "@/hooks/useMessages";
import { useSendMessage } from "@/hooks/useSendMessage";
import toast from "react-hot-toast";

export const Route = createFileRoute("/chat/$conversationId")({
	component: ConversationPage,
});

function ConversationPage() {
	const { isSignedIn, user, isLoaded } = useUser();
	const navigate = useNavigate();
	const { conversationId } = useParams({ from: "/chat/$conversationId" });

	const userId = user?.id ?? "";

	const { conversation } = useConversation(conversationId);
	const [model, setModel] = useState("openai/gpt-4o");
	const harnessId = conversation?.harnessId;

	const { harness } = useHarness(harnessId);
	const { conversations, createConversation } = useConversations(userId);
	const { messages, isStreaming } = useMessages(conversationId);
	const { sendMessage, isSending } = useSendMessage();

	useEffect(() => {
		if (conversation?.model) {
			setModel(conversation.model);
		}
	}, [conversation?.model]);

	if (!isLoaded) {
		return (
			<div className="flex items-center justify-center h-screen bg-background">
				<div className="flex gap-1">
					<span className="size-2 bg-primary/50 rounded-full animate-pulse" />
					<span className="size-2 bg-primary/50 rounded-full animate-pulse [animation-delay:200ms]" />
					<span className="size-2 bg-primary/50 rounded-full animate-pulse [animation-delay:400ms]" />
				</div>
			</div>
		);
	}

	if (!isSignedIn) {
		navigate({ to: "/" });
		return null;
	}

	const handleSend = async (content: string) => {
		if (!harnessId || !userId) return;

		try {
			await sendMessage({
				conversationId,
				harnessId,
				model,
				userId,
				content,
			});
		} catch {
			toast.error("Failed to send message", {
				className: "bg-card text-foreground border border-border",
			});
		}
	};

	const handleNewChat = () => {
		navigate({ to: "/chat" });
	};

	const handleConversationSelect = (id: string) => {
		navigate({ to: "/chat/$conversationId", params: { conversationId: id } });
	};

	const handleHarnessChange = (id: string) => {
		// Can't change harness on existing conversation
	};

	return (
		<ChatLayout
			conversationId={conversationId}
			harnessId={harnessId}
			model={model}
			userId={userId}
			onHarnessChange={handleHarnessChange}
			onModelChange={setModel}
			onConversationSelect={handleConversationSelect}
			onNewChat={handleNewChat}
		>
			<ChatHeader
				harnessId={harnessId}
				model={model}
				userId={userId}
				onModelChange={setModel}
			/>
			<MessageList messages={messages} isStreaming={isStreaming} />
			<ChatInput
				onSend={handleSend}
				disabled={isSending || isStreaming || !harnessId}
				harnessName={harness?.name}
			/>
		</ChatLayout>
	);
}
