import { useClerk } from "@clerk/tanstack-react-start";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import {
	ArrowUp,
	ChevronDown,
	Cpu,
	LogOut,
	MessageSquare,
	PanelLeftClose,
	PanelLeftOpen,
	Plus,
	Settings,
	Sparkles,
	Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { HarnessMark } from "../../components/harness-mark";
import { MarkdownMessage } from "../../components/markdown-message";
import { Avatar, AvatarFallback } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "../../components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Separator } from "../../components/ui/separator";
import { Skeleton } from "../../components/ui/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "../../components/ui/tooltip";
import { cn } from "../../lib/utils";

export const Route = createFileRoute("/chat/")({
	beforeLoad: ({ context }) => {
		if (!context.userId) {
			throw redirect({ to: "/sign-in" });
		}
	},
	component: ChatPage,
});

const SUGGESTED_PROMPTS = [
	"Help me write a Python script to process CSV files",
	"Explain how WebSockets work in simple terms",
	"Review my API design and suggest improvements",
	"Create a deployment checklist for production",
];

function ChatPage() {
	const navigate = useNavigate();

	const { data: harnesses, isLoading: harnessesLoading } = useQuery(
		convexQuery(api.harnesses.list, {}),
	);
	const { data: conversations } = useQuery(
		convexQuery(api.conversations.list, {}),
	);
	const { data: userSettings } = useQuery(
		convexQuery(api.userSettings.get, {}),
	);

	const [activeHarnessId, setActiveHarnessId] =
		useState<Id<"harnesses"> | null>(null);
	const [activeConvoId, setActiveConvoId] =
		useState<Id<"conversations"> | null>(null);
	const [sidebarOpen, setSidebarOpen] = useState(true);

	useEffect(() => {
		if (harnesses && harnesses.length > 0 && !activeHarnessId) {
			const started = harnesses.find((h) => h.status === "started");
			setActiveHarnessId(started?._id ?? harnesses[0]._id);
		}
	}, [harnesses, activeHarnessId]);

	useEffect(() => {
		if (harnesses && harnesses.length === 0) {
			navigate({ to: "/onboarding" });
		}
	}, [harnesses, navigate]);

	const handleSelectConversation = useCallback(
		(convoId: Id<"conversations"> | null) => {
			setActiveConvoId(convoId);

			if (
				convoId &&
				userSettings?.autoSwitchHarness &&
				conversations &&
				harnesses
			) {
				const convo = conversations.find((c) => c._id === convoId);
				if (
					convo?.lastHarnessId &&
					harnesses.some((h) => h._id === convo.lastHarnessId)
				) {
					setActiveHarnessId(convo.lastHarnessId);
				}
			}
		},
		[userSettings, conversations, harnesses],
	);

	if (harnessesLoading || !harnesses || harnesses.length === 0) {
		return <ChatSkeleton />;
	}

	const activeHarness = harnesses?.find((h) => h._id === activeHarnessId);

	return (
		<div className="flex h-full overflow-hidden bg-background">
			<AnimatePresence>
				{sidebarOpen && (
					<motion.aside
						initial={{ width: 0, opacity: 0 }}
						animate={{ width: 280, opacity: 1 }}
						exit={{ width: 0, opacity: 0 }}
						transition={{ duration: 0.2 }}
						className="flex h-full flex-col overflow-hidden border-r border-border"
					>
						<ChatSidebar
							conversations={conversations ?? []}
							activeConvoId={activeConvoId}
							onSelect={handleSelectConversation}
							harnessId={activeHarnessId}
							onClose={() => setSidebarOpen(false)}
						/>
					</motion.aside>
				)}
			</AnimatePresence>

			<div className="flex flex-1 flex-col overflow-hidden">
				<ChatHeader
					harness={activeHarness}
					harnesses={harnesses ?? []}
					onSwitchHarness={setActiveHarnessId}
					sidebarOpen={sidebarOpen}
					onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
				/>

				{activeConvoId ? (
					<ChatMessages conversationId={activeConvoId} />
				) : (
					<EmptyChat />
				)}

				<ChatInput
					conversationId={activeConvoId}
					harnessId={activeHarnessId}
					onConvoCreated={handleSelectConversation}
				/>
			</div>
		</div>
	);
}

function ChatSidebar({
	conversations,
	activeConvoId,
	onSelect,
	harnessId,
	onClose,
}: {
	conversations: Array<{
		_id: Id<"conversations">;
		title: string;
		lastMessageAt: number;
		lastHarnessId?: Id<"harnesses">;
	}>;
	activeConvoId: Id<"conversations"> | null;
	onSelect: (id: Id<"conversations"> | null) => void;
	harnessId: Id<"harnesses"> | null;
	onClose: () => void;
}) {
	const removeConvo = useMutation({
		mutationFn: useConvexMutation(api.conversations.remove),
		onSuccess: () => {
			if (activeConvoId) onSelect(null);
		},
	});

	const handleNew = () => {
		if (!harnessId) return;
		onSelect(null);
	};

	const grouped = groupByDate(conversations);

	const [settingsOpen, setSettingsOpen] = useState(false);

	return (
		<div className="flex h-full w-[280px] flex-col bg-background">
			<div className="flex items-center justify-between px-3 py-3">
				<div className="flex items-center gap-2">
					<HarnessMark size={18} className="text-foreground" />
					<span className="text-sm font-semibold tracking-tight text-foreground">
						Harness
					</span>
				</div>
				<div className="flex items-center gap-1">
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon-xs" onClick={handleNew}>
								<Plus size={14} />
							</Button>
						</TooltipTrigger>
						<TooltipContent>New chat</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon-xs" onClick={onClose}>
								<PanelLeftClose size={14} />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Close sidebar</TooltipContent>
					</Tooltip>
				</div>
			</div>

			<Separator />

			<ScrollArea className="flex-1 px-2 py-2">
				{conversations.length === 0 ? (
					<p className="px-2 py-8 text-center text-xs text-muted-foreground">
						No conversations yet
					</p>
				) : (
					<div className="space-y-4">
						{grouped.map((group) => (
							<div key={group.label}>
								<p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
									{group.label}
								</p>
								{group.items.map((convo) => (
									<div key={convo._id} className="group relative">
										<button
											type="button"
											onClick={() => onSelect(convo._id)}
											className={cn(
												"flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors",
												activeConvoId === convo._id
													? "bg-muted text-foreground"
													: "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
											)}
										>
											<MessageSquare size={12} className="shrink-0" />
											<span className="truncate">{convo.title}</span>
										</button>
										<Button
											variant="ghost"
											size="icon-xs"
											className="absolute right-1 top-1 opacity-0 group-hover:opacity-100"
											onClick={(e) => {
												e.stopPropagation();
												removeConvo.mutate({
													id: convo._id,
												});
											}}
										>
											<Trash2 size={10} />
										</Button>
									</div>
								))}
							</div>
						))}
					</div>
				)}
			</ScrollArea>

			<Separator />
			<div className="space-y-0.5 p-2">
				<Button
					variant="ghost"
					size="sm"
					className="w-full justify-start"
					asChild
				>
					<Link to="/harnesses">
						<Settings size={12} />
						Manage Harnesses
					</Link>
				</Button>
				<Button
					variant="ghost"
					size="sm"
					className="w-full justify-start"
					onClick={() => setSettingsOpen(true)}
				>
					<Settings size={12} />
					Settings
				</Button>
			</div>

			<SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
		</div>
	);
}

function SettingsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { signOut } = useClerk();
	const navigate = useNavigate();
	const { data: userSettings } = useQuery(
		convexQuery(api.userSettings.get, {}),
	);
	const updateSettings = useMutation({
		mutationFn: useConvexMutation(api.userSettings.update),
	});

	const handleSignOut = async () => {
		await signOut();
		navigate({ to: "/sign-in" });
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle className="text-sm">Settings</DialogTitle>
					<DialogDescription>Manage your preferences.</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div>
						<p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
							Behavior
						</p>
						<label
							htmlFor="auto-switch"
							className="flex items-center justify-between gap-3 py-1.5"
						>
							<div>
								<p className="text-xs font-medium text-foreground">
									Auto-switch harness
								</p>
								<p className="text-[11px] text-muted-foreground">
									Switch to a conversation's harness when selected.
								</p>
							</div>
							<Checkbox
								id="auto-switch"
								checked={userSettings?.autoSwitchHarness ?? true}
								onCheckedChange={(checked) => {
									updateSettings.mutate({
										autoSwitchHarness: checked === true,
									});
								}}
							/>
						</label>
					</div>

					<Separator />

					<div>
						<p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
							Account
						</p>
						<Button
							variant="ghost"
							size="sm"
							className="w-full justify-start text-muted-foreground hover:text-foreground"
							onClick={handleSignOut}
						>
							<LogOut size={12} />
							Sign out
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function ChatHeader({
	harness,
	harnesses,
	onSwitchHarness,
	sidebarOpen,
	onToggleSidebar,
}: {
	harness?: {
		_id: Id<"harnesses">;
		name: string;
		model: string;
		status: string;
	};
	harnesses: Array<{
		_id: Id<"harnesses">;
		name: string;
		model: string;
		status: string;
	}>;
	onSwitchHarness: (id: Id<"harnesses">) => void;
	sidebarOpen: boolean;
	onToggleSidebar: () => void;
}) {
	return (
		<header className="flex items-center justify-between border-b border-border px-4 py-2.5">
			<div className="flex items-center gap-2">
				{!sidebarOpen && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon-xs" onClick={onToggleSidebar}>
								<PanelLeftOpen size={14} />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Open sidebar</TooltipContent>
					</Tooltip>
				)}

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="sm" className="gap-1.5">
							<span className="text-xs font-medium">
								{harness?.name ?? "Select Harness"}
							</span>
							{harness && (
								<Badge variant="secondary" className="text-[10px]">
									<Cpu size={8} />
									{harness.model}
								</Badge>
							)}
							<ChevronDown size={12} className="text-muted-foreground" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start">
						{harnesses
							.filter((h) => h.status !== "draft")
							.map((h) => (
								<DropdownMenuItem
									key={h._id}
									onClick={() => onSwitchHarness(h._id)}
								>
									<div
										className={`h-1.5 w-1.5 ${h.status === "started" ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
									/>
									{h.name}
									<span className="ml-auto text-[10px] text-muted-foreground">
										{h.model}
									</span>
								</DropdownMenuItem>
							))}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</header>
	);
}

function ChatMessages({
	conversationId,
}: {
	conversationId: Id<"conversations">;
}) {
	const { data: messages, isLoading } = useQuery(
		convexQuery(api.messages.list, { conversationId }),
	);
	const scrollRef = useRef<HTMLDivElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new messages
	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [messages]);

	if (isLoading) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<div className="h-5 w-5 animate-spin border-2 border-foreground border-t-transparent" />
			</div>
		);
	}

	if (!messages || messages.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<p className="text-sm text-muted-foreground">
					Send a message to start the conversation.
				</p>
			</div>
		);
	}

	return (
		<div ref={scrollRef} className="flex-1 overflow-y-auto">
			<div className="mx-auto max-w-3xl px-4 py-6">
				{messages.map((msg, i) => (
					<motion.div
						key={msg._id}
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: i * 0.03 }}
						className={cn(
							"mb-6 flex gap-3",
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
						<div
							className={cn(
								"max-w-[80%] text-sm leading-relaxed",
								msg.role === "user"
									? "bg-foreground px-3.5 py-2.5 text-background"
									: "text-foreground",
							)}
						>
							{msg.role === "assistant" ? (
								<MarkdownMessage content={msg.content} />
							) : (
								<p className="whitespace-pre-wrap">{msg.content}</p>
							)}
						</div>
						{msg.role === "user" && (
							<Avatar className="h-7 w-7 shrink-0">
								<AvatarFallback className="bg-muted text-foreground text-[10px]">
									U
								</AvatarFallback>
							</Avatar>
						)}
					</motion.div>
				))}
			</div>
		</div>
	);
}

function EmptyChat() {
	return (
		<div className="flex flex-1 flex-col items-center justify-center px-4">
			<motion.div
				initial={{ opacity: 0, y: 12 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.4 }}
				className="text-center"
			>
				<div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center bg-foreground">
					<HarnessMark size={24} className="text-background" />
				</div>
				<h2 className="mb-2 text-lg font-medium text-foreground">
					Start a conversation
				</h2>
				<p className="mb-8 text-sm text-muted-foreground">
					Ask anything — your agent is equipped and ready.
				</p>
				<div className="grid max-w-lg gap-2 sm:grid-cols-2">
					{SUGGESTED_PROMPTS.map((prompt) => (
						<div
							key={prompt}
							className="border border-border p-3 text-left text-xs text-muted-foreground"
						>
							{prompt}
						</div>
					))}
				</div>
			</motion.div>
		</div>
	);
}

function ChatInput({
	conversationId,
	harnessId,
	onConvoCreated,
}: {
	conversationId: Id<"conversations"> | null;
	harnessId: Id<"harnesses"> | null;
	onConvoCreated: (id: Id<"conversations">) => void;
}) {
	const [text, setText] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const createConvo = useMutation({
		mutationFn: useConvexMutation(api.conversations.create),
	});
	const sendMessage = useMutation({
		mutationFn: useConvexMutation(api.messages.send),
	});

	const adjustHeight = useCallback(() => {
		const ta = textareaRef.current;
		if (ta) {
			ta.style.height = "auto";
			ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
		}
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: resize on text change
	useEffect(() => {
		adjustHeight();
	}, [text, adjustHeight]);

	const handleSend = async () => {
		const content = text.trim();
		if (!content || !harnessId) return;

		setText("");

		let convoId = conversationId;
		if (!convoId) {
			const newId = await createConvo.mutateAsync({
				title: content.slice(0, 60),
				harnessId,
			});
			convoId = newId;
			onConvoCreated(newId);
		}

		const activeConvoId = convoId;
		await sendMessage.mutateAsync({
			conversationId: activeConvoId,
			role: "user",
			content,
			harnessId: harnessId ?? undefined,
		});

		setTimeout(async () => {
			await sendMessage.mutateAsync({
				conversationId: activeConvoId,
				role: "assistant",
				content: `This is a placeholder response. In production, this would be streamed from the ${harnessId ? "configured" : "default"} LLM.\n\nYour message: "${content}"`,
				harnessId: harnessId ?? undefined,
			});
		}, 800);
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	return (
		<div className="border-t border-border px-4 py-3">
			<div className="mx-auto max-w-3xl">
				<div className="flex items-end gap-2 border border-border bg-background px-3 py-2 focus-within:border-foreground/30">
					<textarea
						ref={textareaRef}
						value={text}
						onChange={(e) => setText(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Send a message..."
						rows={1}
						className="max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
					/>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								size="icon-xs"
								onClick={handleSend}
								disabled={
									!text.trim() || sendMessage.isPending || createConvo.isPending
								}
							>
								<ArrowUp size={14} />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Send message</TooltipContent>
					</Tooltip>
				</div>
				<p className="mt-1.5 text-center text-[10px] text-muted-foreground">
					Harness may produce inaccurate information.
				</p>
			</div>
		</div>
	);
}

function ChatSkeleton() {
	return (
		<div className="flex h-full bg-background">
			<div className="w-[280px] border-r border-border p-3">
				<Skeleton className="mb-4 h-6 w-24" />
				<div className="space-y-2">
					{["s1", "s2", "s3", "s4", "s5"].map((key) => (
						<Skeleton key={key} className="h-7 w-full" />
					))}
				</div>
			</div>
			<div className="flex flex-1 flex-col">
				<div className="border-b border-border px-4 py-2.5">
					<Skeleton className="h-6 w-40" />
				</div>
				<div className="flex flex-1 items-center justify-center">
					<div className="h-5 w-5 animate-spin border-2 border-foreground border-t-transparent" />
				</div>
			</div>
		</div>
	);
}

function groupByDate(
	conversations: Array<{
		_id: Id<"conversations">;
		title: string;
		lastMessageAt: number;
		lastHarnessId?: Id<"harnesses">;
	}>,
) {
	const now = Date.now();
	const dayMs = 86400000;
	const todayStart = now - (now % dayMs);

	const groups: { label: string; items: typeof conversations }[] = [];
	const today: typeof conversations = [];
	const yesterday: typeof conversations = [];
	const week: typeof conversations = [];
	const older: typeof conversations = [];

	for (const c of conversations) {
		if (c.lastMessageAt >= todayStart) today.push(c);
		else if (c.lastMessageAt >= todayStart - dayMs) yesterday.push(c);
		else if (c.lastMessageAt >= todayStart - 7 * dayMs) week.push(c);
		else older.push(c);
	}

	if (today.length) groups.push({ label: "Today", items: today });
	if (yesterday.length) groups.push({ label: "Yesterday", items: yesterday });
	if (week.length) groups.push({ label: "Previous 7 Days", items: week });
	if (older.length) groups.push({ label: "Older", items: older });

	return groups;
}
