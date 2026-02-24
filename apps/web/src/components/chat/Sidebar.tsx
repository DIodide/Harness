import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import ClerkHeader from "@/integrations/clerk/header-user";
import { ConversationList } from "./ConversationList";
import { HarnessSelector } from "./HarnessSelector";

interface SidebarProps {
	userId: string;
	activeConversationId?: string;
	harnessId?: string;
	onHarnessChange: (id: string) => void;
	onConversationSelect: (id: string) => void;
	onNewChat: () => void;
}

export function Sidebar({
	userId,
	activeConversationId,
	harnessId,
	onHarnessChange,
	onConversationSelect,
	onNewChat,
}: SidebarProps) {
	return (
		<div className="flex flex-col h-full bg-sidebar border-r border-sidebar-border">
			{/* Header */}
			<div className="p-4 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<div className="size-7 rounded-md bg-primary flex items-center justify-center">
						<span className="text-primary-foreground font-bold text-sm font-mono">
							H
						</span>
					</div>
					<span className="font-semibold text-sidebar-foreground tracking-tight">
						Harness
					</span>
				</div>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onNewChat}
					className="text-sidebar-foreground hover:text-primary"
				>
					<Plus className="size-4" />
				</Button>
			</div>

			<Separator className="bg-sidebar-border" />

			{/* Harness selector -- shown prominently at top */}
			<div className="p-3 flex-shrink-0">
				<p className="text-xs uppercase tracking-widest text-muted-foreground mb-2 px-1 font-mono">
					Harness
				</p>
				<HarnessSelector
					userId={userId}
					selectedId={harnessId}
					onSelect={onHarnessChange}
				/>
			</div>

			<Separator className="bg-sidebar-border" />

			{/* Conversations */}
			<div className="flex-1 min-h-0">
				<p className="text-xs uppercase tracking-widest text-muted-foreground px-4 pt-3 pb-1 font-mono">
					Conversations
				</p>
				<ScrollArea className="h-full px-2 pb-2">
					<ConversationList
						userId={userId}
						activeConversationId={activeConversationId}
						onSelect={onConversationSelect}
					/>
				</ScrollArea>
			</div>

			<Separator className="bg-sidebar-border" />

			{/* User */}
			<div className="p-3 flex items-center gap-2 flex-shrink-0">
				<ClerkHeader />
			</div>
		</div>
	);
}
