import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, User, Bot } from "lucide-react";
import { ToolCallDisplay } from "./ToolCallDisplay";

interface Message {
	_id: string;
	role: "user" | "assistant" | "system" | "tool";
	content: string;
	toolCalls?: any;
	toolResults?: any;
	isStreaming: boolean;
	isError: boolean;
}

interface MessageBubbleProps {
	message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
	const isUser = message.role === "user";

	if (message.role === "tool" || message.role === "system") return null;

	return (
		<div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
			{/* Avatar */}
			<div
				className={`size-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
					isUser
						? "bg-secondary"
						: "bg-primary/10"
				}`}
			>
				{isUser ? (
					<User className="size-4 text-muted-foreground" />
				) : (
					<Bot className="size-4 text-primary" />
				)}
			</div>

			{/* Content */}
			<div
				className={`flex-1 min-w-0 ${isUser ? "flex justify-end" : ""}`}
			>
				<div
					className={`inline-block max-w-full ${
						isUser
							? "bg-secondary rounded-2xl rounded-tr-sm px-4 py-2.5"
							: ""
					}`}
				>
					{message.isError && (
						<div className="flex items-center gap-2 text-destructive text-sm mb-2">
							<AlertTriangle className="size-3.5" />
							<span className="font-medium">Error</span>
						</div>
					)}

					{isUser ? (
						<p className="text-sm whitespace-pre-wrap">{message.content}</p>
					) : (
						<div className="prose-chat text-sm">
							<ReactMarkdown remarkPlugins={[remarkGfm]}>
								{message.content}
							</ReactMarkdown>
						</div>
					)}

					{message.isStreaming && !message.content && (
						<div className="flex gap-1 py-1">
							<span className="size-1.5 bg-primary/60 rounded-full animate-pulse" />
							<span className="size-1.5 bg-primary/60 rounded-full animate-pulse [animation-delay:150ms]" />
							<span className="size-1.5 bg-primary/60 rounded-full animate-pulse [animation-delay:300ms]" />
						</div>
					)}
				</div>

				{/* Tool calls */}
				{message.toolCalls && message.toolResults && (
					<div className="mt-2 space-y-1.5">
						{(message.toolResults as any[]).map((result: any, i: number) => (
							<ToolCallDisplay
								key={i}
								toolCall={message.toolCalls[i]}
								toolResult={result}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
