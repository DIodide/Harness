import { convexQuery } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Copy, Cpu, Loader2, Sparkles } from "lucide-react";
import { useCallback, useState } from "react";
import { MarkdownMessage } from "../../components/markdown-message";
import { ThinkingBlock, ToolCallBlock } from "../../components/message-parts";
import { Avatar, AvatarFallback } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { cn } from "../../lib/utils";

export const Route = createFileRoute("/share/$token")({
	component: SharedConversationPage,
});

function SharedConversationPage() {
	const { token } = Route.useParams();
	const { data, isLoading } = useQuery(
		convexQuery(api.sharing.getSharedConversation, { shareToken: token }),
	);

	if (isLoading) {
		return (
			<div className="flex h-screen items-center justify-center bg-background">
				<Loader2 size={20} className="animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (!data) {
		return (
			<div className="flex h-screen flex-col items-center justify-center gap-4 bg-background px-4">
				<div className="flex h-12 w-12 items-center justify-center bg-muted">
					<Sparkles size={20} className="text-muted-foreground" />
				</div>
				<h1 className="text-lg font-medium text-foreground">
					Conversation not found
				</h1>
				<p className="text-sm text-muted-foreground">
					This shared link may have been revoked or the conversation was
					deleted.
				</p>
				<Link
					to="/"
					className="mt-2 text-sm text-foreground underline underline-offset-4 hover:text-foreground/80"
				>
					Go to Harness
				</Link>
			</div>
		);
	}

	const { conversation, messages, harnessName, harnessModel } = data;

	return (
		<div className="flex h-screen flex-col bg-background">
			{/* Header */}
			<header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
				<div className="flex items-center gap-2">
					<Link
						to="/"
						className="flex h-7 w-7 items-center justify-center bg-foreground"
					>
						<Sparkles size={12} className="text-background" />
					</Link>
					<span className="text-xs font-medium text-foreground">
						{conversation.title}
					</span>
					{harnessName && (
						<Badge variant="secondary" className="text-[10px]">
							{harnessName}
						</Badge>
					)}
					{harnessModel && (
						<Badge variant="outline" className="text-[10px]">
							<Cpu size={8} />
							{harnessModel}
						</Badge>
					)}
				</div>
				<Badge variant="outline" className="text-[10px] text-muted-foreground">
					Shared · View only
				</Badge>
			</header>

			{/* Messages */}
			<div className="flex-1 overflow-y-auto">
				<div className="mx-auto max-w-3xl px-4 py-6">
					{messages.map((msg) => (
						<div
							key={msg._id}
							className={cn(
								"group mb-6 flex gap-3",
								msg.role === "user" && "justify-end",
							)}
						>
							{msg.role === "assistant" && (
								<Avatar className="h-7 w-7 shrink-0">
									<AvatarFallback className="bg-foreground text-background text-[10px]">
										<Sparkles size={12} />
									</AvatarFallback>
								</Avatar>
							)}
							<div className="max-w-[80%]">
								<div
									className={cn(
										"text-sm leading-relaxed",
										msg.role === "user"
											? "bg-foreground px-3.5 py-2.5 text-background"
											: "text-foreground",
									)}
								>
									{msg.role === "assistant" && msg.parts ? (
										(
											msg.parts as Array<{
												type: "text" | "reasoning" | "tool_call";
												content?: string;
												tool?: string;
												arguments?: Record<string, unknown>;
												call_id?: string;
												result?: string;
											}>
										).map((part) => {
											const key =
												part.type === "tool_call"
													? (part.call_id ?? part.tool)
													: `${part.type}-${part.content?.slice(0, 32)}`;
											if (part.type === "reasoning" && part.content) {
												return (
													<ThinkingBlock
														key={key}
														content={part.content}
														isStreaming={false}
													/>
												);
											}
											if (part.type === "text" && part.content) {
												return (
													<MarkdownMessage key={key} content={part.content} />
												);
											}
											if (part.type === "tool_call" && part.tool) {
												return (
													<ToolCallBlock
														key={key}
														tool={part.tool}
														arguments={part.arguments ?? {}}
														result={part.result}
														isStreaming={false}
													/>
												);
											}
											return null;
										})
									) : (
										<>
											{msg.role === "assistant" && msg.reasoning && (
												<ThinkingBlock
													content={msg.reasoning}
													isStreaming={false}
												/>
											)}
											{msg.role === "assistant" ? (
												<MarkdownMessage content={msg.content} />
											) : (
												<p className="whitespace-pre-wrap">{msg.content}</p>
											)}
											{msg.role === "assistant" &&
												msg.toolCalls &&
												msg.toolCalls.length > 0 && (
													<div className="mt-2 space-y-1">
														{(
															msg.toolCalls as Array<{
																tool: string;
																arguments: Record<string, unknown>;
																call_id: string;
																result: string;
															}>
														).map((tc) => (
															<ToolCallBlock
																key={tc.call_id}
																tool={tc.tool}
																arguments={tc.arguments}
																result={tc.result}
																isStreaming={false}
															/>
														))}
													</div>
												)}
										</>
									)}
								</div>
								{msg.role === "assistant" && msg.interrupted && (
									<div className="mt-1 flex items-center gap-1.5 text-xs text-amber-500">
										<span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
										Response interrupted
									</div>
								)}
								{/* Copy button for assistant messages */}
								{msg.role === "assistant" && msg.content && (
									<CopyButton content={msg.content} />
								)}
							</div>
							{msg.role === "user" && (
								<Avatar className="h-7 w-7 shrink-0">
									<AvatarFallback className="bg-muted text-foreground text-[10px]">
										U
									</AvatarFallback>
								</Avatar>
							)}
						</div>
					))}
				</div>
			</div>

			{/* Footer */}
			<div className="shrink-0 border-t border-border px-4 py-2.5 text-center">
				<Link
					to="/"
					className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
				>
					Shared via Harness
				</Link>
			</div>
		</div>
	);
}

function CopyButton({ content }: { content: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(content);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}, [content]);

	return (
		<button
			type="button"
			onClick={handleCopy}
			className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground/50 transition-colors hover:text-muted-foreground"
		>
			{copied ? <Check size={10} /> : <Copy size={10} />}
			{copied ? "Copied" : "Copy"}
		</button>
	);
}
