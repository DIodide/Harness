import { useUser } from "@clerk/tanstack-react-start";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, Globe, Link2, RotateCw, Trash2 } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import {
	buildShareUrl,
	copyToClipboard,
	generateShareToken,
} from "../../lib/share";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

/**
 * Owner's share + permission management for a single conversation.
 *
 * Phase 1: a public, copyable, view-only link (anyone with the link can read
 * the transcript) that the owner can create, copy, reset (rotate), or revoke.
 * Per-user invites and editor (collaborate) roles arrive in later phases; the
 * `shareGrants` model already supports them.
 */
export function ShareDialog({
	conversationId,
	open,
	onOpenChange,
}: {
	conversationId: Id<"conversations">;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { user } = useUser();
	// Author attribution snapshot — name + avatar only (no email).
	const ownerProfile = {
		ownerName: user?.fullName ?? user?.firstName ?? undefined,
		ownerImageUrl: user?.imageUrl ?? undefined,
	};
	const { data: grants } = useQuery(
		convexQuery(api.shares.listShareGrants, open ? { conversationId } : "skip"),
	);
	const ensureLink = useMutation({
		mutationFn: useConvexMutation(api.shares.ensurePublicLink),
	});
	const rotateLink = useMutation({
		mutationFn: useConvexMutation(api.shares.rotatePublicLink),
	});
	const revokeGrant = useMutation({
		mutationFn: useConvexMutation(api.shares.revokeShareGrant),
	});

	const [copied, setCopied] = useState(false);

	const publicGrant = grants?.find((g) => g.publicToken);
	const shareUrl = publicGrant?.publicToken
		? buildShareUrl(publicGrant.publicToken)
		: null;

	const handleCreate = () => {
		ensureLink.mutate(
			{
				conversationId,
				role: "viewer",
				token: generateShareToken(),
				...ownerProfile,
			},
			{
				onError: (e) =>
					toast.error(e instanceof Error ? e.message : "Could not share"),
			},
		);
	};

	const handleCopy = async () => {
		if (!shareUrl) return;
		if (await copyToClipboard(shareUrl)) {
			setCopied(true);
			toast.success("Link copied");
			setTimeout(() => setCopied(false), 1500);
		} else {
			toast.error("Couldn't copy — copy it manually");
		}
	};

	const handleRotate = () => {
		rotateLink.mutate(
			{ conversationId, token: generateShareToken(), ...ownerProfile },
			{
				onSuccess: () =>
					toast.success("New link generated — the old one stopped working"),
				onError: (e) =>
					toast.error(e instanceof Error ? e.message : "Could not reset"),
			},
		);
	};

	const handleRevoke = () => {
		if (!publicGrant) return;
		revokeGrant.mutate(
			{ grantId: publicGrant._id },
			{
				onSuccess: () => toast.success("Sharing turned off"),
				onError: (e) =>
					toast.error(e instanceof Error ? e.message : "Could not revoke"),
			},
		);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Link2 size={16} /> Share chat
					</DialogTitle>
					<DialogDescription>
						Anyone with the link can view this conversation’s full transcript.
						You can reset or turn off the link at any time.
					</DialogDescription>
				</DialogHeader>

				{shareUrl ? (
					<div className="space-y-3">
						<div className="flex items-center gap-2">
							<div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5">
								<Globe size={13} className="shrink-0 text-muted-foreground" />
								<Input
									readOnly
									value={shareUrl}
									onFocus={(e) => e.currentTarget.select()}
									className="h-auto border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-0"
								/>
							</div>
							<Button
								size="sm"
								variant="default"
								onClick={handleCopy}
								className="shrink-0"
							>
								{copied ? <Check size={13} /> : <Copy size={13} />}
								{copied ? "Copied" : "Copy"}
							</Button>
						</div>

						<div className="flex items-center justify-between">
							<span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
								<Globe size={12} /> Anyone with the link can view
							</span>
							<div className="flex items-center gap-1">
								<Button
									size="xs"
									variant="ghost"
									onClick={handleRotate}
									disabled={rotateLink.isPending}
									className="text-muted-foreground"
								>
									<RotateCw size={12} /> Reset link
								</Button>
								<Button
									size="xs"
									variant="ghost"
									onClick={handleRevoke}
									disabled={revokeGrant.isPending}
									className="text-destructive hover:text-destructive"
								>
									<Trash2 size={12} /> Unshare
								</Button>
							</div>
						</div>
					</div>
				) : (
					<div className="flex flex-col items-start gap-3 py-1">
						<p className="text-xs text-muted-foreground">
							This chat is private. Create a link to let others view it.
						</p>
						<Button
							size="sm"
							onClick={handleCreate}
							disabled={ensureLink.isPending}
						>
							<Link2 size={14} /> Create share link
						</Button>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
