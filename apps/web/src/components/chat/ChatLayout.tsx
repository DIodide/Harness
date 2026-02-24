import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

interface ChatLayoutProps {
	conversationId?: string;
	harnessId?: string;
	model: string;
	userId: string;
	onHarnessChange: (id: string) => void;
	onModelChange: (model: string) => void;
	onConversationSelect: (id: string) => void;
	onNewChat: () => void;
	children: React.ReactNode;
}

export function ChatLayout({
	conversationId,
	harnessId,
	model,
	userId,
	onHarnessChange,
	onModelChange,
	onConversationSelect,
	onNewChat,
	children,
}: ChatLayoutProps) {
	const [sidebarOpen, setSidebarOpen] = useState(false);

	return (
		<div className="flex h-screen overflow-hidden bg-background">
			{/* Desktop sidebar */}
			<div className="hidden md:flex md:w-72 lg:w-80 flex-shrink-0">
				<Sidebar
					userId={userId}
					activeConversationId={conversationId}
					harnessId={harnessId}
					onHarnessChange={onHarnessChange}
					onConversationSelect={onConversationSelect}
					onNewChat={onNewChat}
				/>
			</div>

			{/* Mobile sidebar via Sheet */}
			<Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
				<div className="md:hidden fixed top-3 left-3 z-40">
					<SheetTrigger asChild>
						<Button variant="ghost" size="icon" className="bg-card/80 backdrop-blur">
							<Menu className="size-5" />
						</Button>
					</SheetTrigger>
				</div>
				<SheetContent side="left" className="w-80 p-0 border-r-border">
					<Sidebar
						userId={userId}
						activeConversationId={conversationId}
						harnessId={harnessId}
						onHarnessChange={(id) => {
							onHarnessChange(id);
							setSidebarOpen(false);
						}}
						onConversationSelect={(id) => {
							onConversationSelect(id);
							setSidebarOpen(false);
						}}
						onNewChat={() => {
							onNewChat();
							setSidebarOpen(false);
						}}
					/>
				</SheetContent>
			</Sheet>

			{/* Main content */}
			<div className="flex-1 flex flex-col min-w-0">{children}</div>
		</div>
	);
}
