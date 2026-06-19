import { useUser } from "@clerk/tanstack-react-start";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	AlertTriangle,
	Check,
	Copy,
	Eye,
	Link2,
	Loader2,
	Pencil,
	RotateCcw,
} from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
	buildShareUrl,
	copyToClipboard,
	generateShareToken,
} from "../../lib/share";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Separator } from "../ui/separator";
import { Skeleton } from "../ui/skeleton";

/**
 * Owner's share + permission management for a single conversation.
 *
 * One public link per conversation, with a role: viewer (read-only) or editor
 * (collaborators can send messages, which run on the OWNER's harness and are
 * billed to them). The safe path is one click → a view-only link. Editing is a
 * deliberate, gated opt-in behind a consequences confirm, so spend/agent access
 * can never be handed out by accident. Switching role keeps the same URL
 * (`setShareRole`); only Reset (`rotatePublicLink`) changes the token.
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
	const grant = grants?.find((g) => g.publicToken) ?? null;
	const role = grant?.role ?? null;
	const shareUrl = grant?.publicToken ? buildShareUrl(grant.publicToken) : null;

	const ensureLink = useMutation({
		mutationFn: useConvexMutation(api.shares.ensurePublicLink),
	});
	const setRole = useMutation({
		mutationFn: useConvexMutation(api.shares.setShareRole),
	});
	const rotateLink = useMutation({
		mutationFn: useConvexMutation(api.shares.rotatePublicLink),
	});
	const revokeGrant = useMutation({
		mutationFn: useConvexMutation(api.shares.revokeShareGrant),
	});

	const [editConfirmOpen, setEditConfirmOpen] = useState(false);
	const [copied, setCopied] = useState(false);

	// A reopened dialog must never show a stale confirm panel / copied flash.
	useEffect(() => {
		if (!open) {
			setEditConfirmOpen(false);
			setCopied(false);
		}
	}, [open]);

	const onError = (verb: string) => (e: unknown) =>
		toast.error(
			`Couldn't ${verb} — ${e instanceof Error ? e.message : "please try again"}`,
		);

	const handleCreate = () => {
		ensureLink.mutate(
			{
				conversationId,
				role: "viewer",
				token: generateShareToken(),
				...ownerProfile,
			},
			{
				onSuccess: () => toast.success("View link created"),
				onError: onError("create the link"),
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

	const handleEnableEditing = () => {
		if (!grant) return;
		setRole.mutate(
			{ grantId: grant._id, role: "editor" },
			{
				onSuccess: () => {
					setEditConfirmOpen(false);
					toast.success(
						"Editing turned on — anyone with the link can now send messages",
					);
				},
				onError: onError("turn on editing"),
			},
		);
	};

	const handleDisableEditing = () => {
		if (!grant || role !== "editor") return;
		setRole.mutate(
			{ grantId: grant._id, role: "viewer" },
			{
				onSuccess: () => toast.success("Link is view-only again"),
				onError: onError("turn off editing"),
			},
		);
	};

	const handleReset = () => {
		if (!grant) return;
		rotateLink.mutate(
			// Preserve the current role so a reset never silently downgrades an
			// editor link to view-only.
			{
				conversationId,
				token: generateShareToken(),
				role: grant.role,
				...ownerProfile,
			},
			{
				onSuccess: () =>
					toast.success("Link reset — the old link no longer works"),
				onError: onError("reset the link"),
			},
		);
	};

	const handleRevoke = () => {
		if (!grant) return;
		revokeGrant.mutate(
			{ grantId: grant._id },
			{
				onSuccess: () => toast.success("Sharing stopped"),
				onError: onError("stop sharing"),
			},
		);
	};

	const isEditor = role === "editor";

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<div className="flex items-center justify-between gap-2">
						<DialogTitle className="flex items-center gap-2 text-sm">
							<Link2 size={15} /> Share chat
						</DialogTitle>
						{grant && !editConfirmOpen && (
							<Button
								variant="ghost"
								size="xs"
								onClick={handleRevoke}
								disabled={revokeGrant.isPending}
								className="text-destructive hover:text-destructive"
							>
								Stop sharing
							</Button>
						)}
					</div>
					<DialogDescription className="text-xs">
						{grant
							? "Anyone with the link can follow this conversation."
							: "Create a link to let other people see this conversation."}
					</DialogDescription>
				</DialogHeader>

				{grants === undefined ? (
					<div className="space-y-2">
						<Skeleton className="h-[68px] w-full rounded-md" />
						<Skeleton className="h-4 w-32" />
					</div>
				) : !grant ? (
					// ── No link yet: one click → a safe view-only link ──
					<div className="flex flex-col items-start gap-2.5 py-1">
						<Button
							size="sm"
							onClick={handleCreate}
							disabled={ensureLink.isPending}
							className="w-full"
						>
							{ensureLink.isPending ? (
								<Loader2 size={14} className="animate-spin" />
							) : (
								<Link2 size={14} />
							)}
							Create a view-only link
						</Button>
						<p className="text-[11px] text-muted-foreground">
							People with the link can read this chat — they can’t send messages
							or change anything.
						</p>
					</div>
				) : editConfirmOpen ? (
					// ── Gate: confirm the consequences before enabling editing ──
					<div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
						<div className="flex items-center gap-2 text-sm font-medium text-foreground">
							<AlertTriangle size={15} className="text-amber-500" />
							Turn on editing for this link?
						</div>
						<div className="space-y-2 text-xs text-muted-foreground">
							<p>
								Anyone signed in who has this link will be able to send messages
								into this chat. Their turns run on{" "}
								<span className="font-medium text-foreground">
									your harness
								</span>{" "}
								— your model, and your coding agent and sandbox — and are billed
								to you.
							</p>
							<p>
								You stay in control: switch back to view-only, or reset the link
								to cut off access at any time.
							</p>
							<p>Share the editing link only with people you trust.</p>
						</div>
						<div className="flex items-center justify-end gap-2">
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setEditConfirmOpen(false)}
								disabled={setRole.isPending}
							>
								Keep view-only
							</Button>
							<Button
								size="sm"
								onClick={handleEnableEditing}
								disabled={setRole.isPending}
								className="bg-amber-600 text-white hover:bg-amber-600/90"
							>
								{setRole.isPending && (
									<Loader2 size={14} className="animate-spin" />
								)}
								Enable editing
							</Button>
						</div>
					</div>
				) : (
					// ── Active link: copy + role status, with the editing toggle ──
					<div className="space-y-3">
						<div
							className={cn(
								"space-y-2 rounded-md border p-3",
								isEditor
									? "border-amber-500/40 bg-amber-500/5"
									: "border-border bg-muted/30",
							)}
						>
							<Badge
								variant="outline"
								className={cn(
									"gap-1 text-[10px]",
									isEditor &&
										"border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
								)}
							>
								{isEditor ? <Pencil size={11} /> : <Eye size={11} />}
								{isEditor ? "Editing" : "View only"}
							</Badge>
							<div className="flex items-center gap-2">
								<Input
									readOnly
									value={shareUrl ?? ""}
									onFocus={(e) => e.currentTarget.select()}
									className="h-7 flex-1 font-mono text-xs"
								/>
								<Button
									size="sm"
									variant="outline"
									onClick={handleCopy}
									className="shrink-0"
								>
									{copied ? <Check size={13} /> : <Copy size={13} />}
									{copied ? "Copied" : "Copy"}
								</Button>
							</div>
							{isEditor && (
								<p className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
									<AlertTriangle size={12} className="mt-0.5 shrink-0" />
									People with this link can send messages that run on your
									harness and are billed to you.
								</p>
							)}
						</div>

						<div className="flex justify-end">
							<Button
								size="xs"
								variant="ghost"
								onClick={handleReset}
								disabled={rotateLink.isPending}
								title="Generate a new link. The current link stops working immediately."
								className="text-muted-foreground"
							>
								<RotateCcw size={12} /> Reset link
							</Button>
						</div>

						<Separator />

						<div className="space-y-1.5">
							<div className="flex items-center justify-between gap-2">
								<span className="text-[13px] font-medium text-foreground">
									Let people edit this chat
								</span>
								<div className="inline-flex items-center rounded-md border border-border p-0.5">
									<button
										type="button"
										onClick={handleDisableEditing}
										disabled={setRole.isPending}
										className={cn(
											"rounded px-2 py-0.5 text-[11px] transition-colors disabled:opacity-60",
											!isEditor
												? "bg-muted font-medium text-foreground"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										Off
									</button>
									<button
										type="button"
										onClick={() => {
											if (!isEditor) setEditConfirmOpen(true);
										}}
										disabled={setRole.isPending}
										className={cn(
											"rounded px-2 py-0.5 text-[11px] transition-colors disabled:opacity-60",
											isEditor
												? "bg-amber-500/15 font-medium text-amber-600 dark:text-amber-400"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										Editing
									</button>
								</div>
							</div>
							<p className="text-[11px] text-muted-foreground">
								{isEditor
									? "On — visitors can send messages into this chat. Switch to Off to make the link view-only again."
									: "Off — visitors can only read. Turn on to let them send messages, which run on your harness and are billed to you."}
							</p>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
