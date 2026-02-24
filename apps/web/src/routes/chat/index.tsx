import { useUser } from "@clerk/tanstack-react-start";
import {
	createFileRoute,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatLayout } from "@/components/chat/ChatLayout";
import { MessageList } from "@/components/chat/MessageList";
import { useConversations } from "@/hooks/useConversations";
import { useHarness, useHarnesses } from "@/hooks/useHarnesses";
import { useMessages } from "@/hooks/useMessages";
import { useSendMessage } from "@/hooks/useSendMessage";

export const Route = createFileRoute("/chat/")({
	component: ChatPage,
	validateSearch: (search: Record<string, unknown>) => ({
		connected: (search.connected as string) || undefined,
		c: (search.c as string) || undefined,
	}),
});

function ChatPage() {
	const { isSignedIn, user, isLoaded } = useUser();
	const navigate = useNavigate();
	const search = useSearch({ from: "/chat/" });

	const userId = user?.id ?? "";
	const [harnessId, setHarnessId] = useState<string | undefined>();
	const [model, setModel] = useState("openai/gpt-4o");
	const [activeConversationId, setActiveConversationId] = useState<
		string | undefined
	>(search.c || undefined);

	const { harnesses } = useHarnesses();
	const { harness } = useHarness(harnessId);
	const { conversations, createConversation } = useConversations(userId);
	const { messages, isStreaming } = useMessages(activeConversationId);
	const { sendMessage, isSending } = useSendMessage();

	// Auto-select first harness
	useEffect(() => {
		if (!harnessId && harnesses.length > 0) {
			setHarnessId(harnesses[0]._id);
		}
	}, [harnesses, harnessId]);

	// Show toast on OAuth callback
	useEffect(() => {
		if (search.connected) {
			toast.success(`Connected to ${search.connected}`, {
				className: "bg-card text-foreground border border-border",
			});
		}
	}, [search.connected]);

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

		let convId: string | undefined = activeConversationId;

		if (!convId) {
			const title =
				content.length > 50 ? `${content.slice(0, 50)}...` : content;
			convId = await createConversation({
				userId,
				harnessId: harnessId as any,
				title,
				model,
			});
			setActiveConversationId(convId);
		}

		if (!convId) return;

		try {
			await sendMessage({
				conversationId: convId,
				harnessId,
				model,
				userId,
				content,
			});
		} catch (_err) {
			toast.error("Failed to send message", {
				className: "bg-card text-foreground border border-border",
			});
		}
	};

	const handleNewChat = () => {
		setActiveConversationId(undefined);
	};

	const handleConversationSelect = (id: string) => {
		setActiveConversationId(id);
		const conv = conversations.find(
			(c: { _id: string; harnessId: string; model: string }) => c._id === id,
		);
		if (conv) {
			setHarnessId(conv.harnessId);
			setModel(conv.model);
		}
	};

	return (
		<ChatLayout
			conversationId={activeConversationId}
			harnessId={harnessId}
			model={model}
			userId={userId}
			onHarnessChange={setHarnessId}
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
