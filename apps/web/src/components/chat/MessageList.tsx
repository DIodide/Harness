import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble } from "./MessageBubble";
import { StreamingIndicator } from "./StreamingIndicator";

interface Message {
	_id: string;
	role: "user" | "assistant" | "system" | "tool";
	content: string;
	toolCalls?: any;
	toolResults?: any;
	isStreaming: boolean;
	isError: boolean;
	createdAt: number;
}

interface MessageListProps {
	messages: Message[];
	isStreaming: boolean;
}

export function MessageList({ messages, isStreaming }: MessageListProps) {
	const bottomRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages, isStreaming]);

	if (messages.length === 0) {
		return (
			<div className="flex-1 flex items-center justify-center">
				<div className="text-center max-w-md px-4">
					<div className="size-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
						<span className="text-2xl font-bold text-primary font-mono">H</span>
					</div>
					<h2 className="text-xl font-semibold mb-2">Start a conversation</h2>
					<p className="text-muted-foreground text-sm">
						Select a harness from the sidebar and start chatting. Your AI
						assistant will have access to the tools defined in your harness.
					</p>
				</div>
			</div>
		);
	}

	return (
		<ScrollArea className="flex-1">
			<div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
				{messages.map((msg) => (
					<MessageBubble key={msg._id} message={msg} />
				))}
				{isStreaming && <StreamingIndicator />}
				<div ref={bottomRef} />
			</div>
		</ScrollArea>
	);
}
