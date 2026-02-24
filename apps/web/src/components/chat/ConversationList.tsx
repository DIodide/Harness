import { MessageSquare, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConversations } from "@/hooks/useConversations";
import { Skeleton } from "@/components/ui/skeleton";

interface ConversationListProps {
	userId: string;
	activeConversationId?: string;
	onSelect: (id: string) => void;
}

export function ConversationList({
	userId,
	activeConversationId,
	onSelect,
}: ConversationListProps) {
	const { conversations, isLoading, removeConversation } =
		useConversations(userId);

	if (isLoading) {
		return (
			<div className="space-y-2 px-1">
				{Array.from({ length: 3 }).map((_, i) => (
					<Skeleton key={i} className="h-10 w-full rounded-md" />
				))}
			</div>
		);
	}

	if (conversations.length === 0) {
		return (
			<div className="px-3 py-8 text-center">
				<MessageSquare className="size-8 mx-auto mb-2 text-muted-foreground/40" />
				<p className="text-sm text-muted-foreground">No conversations yet</p>
			</div>
		);
	}

	return (
		<div className="space-y-0.5">
			{conversations.map((conv) => {
				const isActive = conv._id === activeConversationId;
				return (
					<div
						key={conv._id}
						className={`group flex items-center gap-2 px-2.5 py-2 rounded-md cursor-pointer transition-colors ${
							isActive
								? "bg-sidebar-accent text-sidebar-accent-foreground"
								: "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
						}`}
						onClick={() => onSelect(conv._id)}
						onKeyDown={(e) => e.key === "Enter" && onSelect(conv._id)}
						role="button"
						tabIndex={0}
					>
						<span className="truncate text-sm flex-1">{conv.title}</span>
						<Button
							variant="ghost"
							size="icon-xs"
							className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
							onClick={(e) => {
								e.stopPropagation();
								removeConversation({ id: conv._id });
							}}
						>
							<Trash2 className="size-3" />
						</Button>
					</div>
				);
			})}
		</div>
	);
}
