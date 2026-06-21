import { useUser } from "@clerk/tanstack-react-start";
import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation } from "@tanstack/react-query";
import {
	Check,
	FolderInput,
	GitFork,
	Link as LinkIcon,
	MoreVertical,
	Pin,
	PinOff,
	Share2,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import {
	buildShareUrl,
	copyToClipboard,
	generateShareToken,
} from "../../lib/share";
import { cn } from "../../lib/utils";
import { getWorkspaceColorHex } from "../../lib/workspace-colors";
import { Button } from "../ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export interface KebabConversation {
	_id: Id<"conversations">;
	title: string;
	workspaceId?: Id<"workspaces">;
	pinnedAt?: number;
}

export interface KebabWorkspace {
	_id: Id<"workspaces">;
	name: string;
	color?: string;
	isDefault?: boolean;
}

/**
 * The per-conversation actions menu (the 3-dots kebab) shared by /chat and
 * /workspaces. Self-contained: owns its mutations and a two-click delete confirm
 * (the repo's confirm idiom). Delegates only the editor-share flow to the parent
 * (`onRequestShare` → opens the gated ShareDialog) and post-fork navigation
 * (`onForked`). Reveal-on-hover is driven by the parent row's `group` + this
 * button's `group-hover:opacity-100` (forced visible while the menu is open).
 */
export function ConversationKebab({
	convo,
	workspaces,
	onRequestShare,
	onForked,
	onDeleted,
}: {
	convo: KebabConversation;
	workspaces: KebabWorkspace[];
	onRequestShare: (id: Id<"conversations">) => void;
	onForked?: (id: Id<"conversations">) => void;
	onDeleted?: (id: Id<"conversations">) => void;
}) {
	const { user } = useUser();
	const ownerProfile = {
		ownerName: user?.fullName ?? user?.firstName ?? undefined,
		ownerImageUrl: user?.imageUrl ?? undefined,
	};

	const [menuOpen, setMenuOpen] = useState(false);
	const [armedDelete, setArmedDelete] = useState(false);

	const setPinned = useMutation({
		mutationFn: useConvexMutation(api.conversations.setPinned),
	});
	const fork = useMutation({
		mutationFn: useConvexMutation(api.conversations.fork),
	});
	const move = useMutation({
		mutationFn: useConvexMutation(api.conversations.moveToWorkspace),
	});
	const remove = useMutation({
		mutationFn: useConvexMutation(api.conversations.remove),
	});
	const ensureLink = useMutation({
		mutationFn: useConvexMutation(api.shares.ensurePublicLink),
	});
	const setRole = useMutation({
		mutationFn: useConvexMutation(api.shares.setShareRole),
	});

	const isPinned = convo.pinnedAt != null;

	const handlePin = () =>
		setPinned
			.mutateAsync({ id: convo._id, pinned: !isPinned })
			.catch(() => toast.error("Couldn't update pin"));

	const handleFork = async () => {
		try {
			const newId = await fork.mutateAsync({ conversationId: convo._id });
			toast.success("Forked");
			onForked?.(newId);
		} catch {
			toast.error("Couldn't fork");
		}
	};

	const handleCopyLink = async () => {
		try {
			const { token } = await ensureLink.mutateAsync({
				conversationId: convo._id,
				role: "viewer",
				token: generateShareToken(),
				...ownerProfile,
			});
			if (await copyToClipboard(buildShareUrl(token)))
				toast.success("Link copied");
			else toast.error("Couldn't copy — use the Share dialog");
		} catch {
			toast.error("Couldn't create the link");
		}
	};

	const handleShareViewOnly = async () => {
		try {
			const { grantId, role } = await ensureLink.mutateAsync({
				conversationId: convo._id,
				role: "viewer",
				token: generateShareToken(),
				...ownerProfile,
			});
			if (role !== "viewer")
				await setRole.mutateAsync({ grantId, role: "viewer" });
			toast.success("Shared — view only");
		} catch {
			toast.error("Couldn't share");
		}
	};

	const handleMove = async (workspaceId: Id<"workspaces"> | undefined) => {
		try {
			await move.mutateAsync({ id: convo._id, workspaceId });
			toast.success("Moved");
		} catch {
			toast.error("Couldn't move");
		}
	};

	const handleDelete = async () => {
		try {
			await remove.mutateAsync({ id: convo._id });
			onDeleted?.(convo._id);
		} catch {
			toast.error("Couldn't delete");
		}
	};

	return (
		<DropdownMenu
			open={menuOpen}
			onOpenChange={(o) => {
				setMenuOpen(o);
				if (!o) setArmedDelete(false);
			}}
		>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label="Conversation actions"
					onClick={(e) => e.stopPropagation()}
					className={cn(
						"absolute top-1 right-1 transition-opacity",
						menuOpen
							? "opacity-100"
							: "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
					)}
				>
					<MoreVertical size={12} />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-44">
				<DropdownMenuItem onClick={handlePin}>
					{isPinned ? <PinOff size={12} /> : <Pin size={12} />}
					{isPinned ? "Unpin" : "Pin"}
				</DropdownMenuItem>
				<DropdownMenuItem onClick={handleFork}>
					<GitFork size={12} /> Fork
				</DropdownMenuItem>

				<DropdownMenuSeparator />

				<DropdownMenuItem onClick={handleCopyLink}>
					<LinkIcon size={12} /> Copy link
				</DropdownMenuItem>
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>
						<Share2 size={12} /> Share
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent>
						<DropdownMenuItem onClick={handleShareViewOnly}>
							View only
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => onRequestShare(convo._id)}>
							Can edit…
						</DropdownMenuItem>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>
						<FolderInput size={12} /> Move to workspace
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent className="max-h-64 overflow-y-auto">
						{workspaces.map((w) => {
							const dot = getWorkspaceColorHex(w.color);
							const here = w.isDefault
								? !convo.workspaceId || w._id === convo.workspaceId
								: w._id === convo.workspaceId;
							return (
								<DropdownMenuItem
									key={w._id}
									onClick={() => handleMove(w.isDefault ? undefined : w._id)}
								>
									{here ? (
										<Check size={12} />
									) : (
										<span className="w-3 shrink-0" />
									)}
									<span
										className="inline-block h-2 w-2 shrink-0 rounded-full border border-border"
										style={dot ? { backgroundColor: dot } : undefined}
									/>
									<span className="truncate">{w.name}</span>
								</DropdownMenuItem>
							);
						})}
					</DropdownMenuSubContent>
				</DropdownMenuSub>

				<DropdownMenuSeparator />

				<DropdownMenuItem
					variant="destructive"
					onSelect={(e) => {
						// Two-click confirm (matches the repo's delete idiom): the first
						// select arms, keeping the menu open; the second deletes.
						if (!armedDelete) {
							e.preventDefault();
							setArmedDelete(true);
							return;
						}
						handleDelete();
					}}
				>
					<Trash2 size={12} />{" "}
					{armedDelete ? "Click again to delete" : "Delete"}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
