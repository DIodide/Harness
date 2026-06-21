import { useUser } from "@clerk/tanstack-react-start";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	Check,
	Copy,
	Link2,
	Lock,
	LockOpen,
	Mail,
	RotateCcw,
	Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
	buildHarnessShareUrl,
	copyToClipboard,
	generateHarnessShareToken,
} from "../../lib/share";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../ui/select";
import { Separator } from "../ui/separator";

type Role = "viewer" | "editor";

/**
 * Owner's share + permission management for a single harness. Mirrors the chat
 * ShareDialog: one public link (with a viewer/editor role), email invites
 * (bound on the recipient's first verified sign-in), and an optional LOCK that
 * stops editor-recipients from editing the harness in place (clone is always
 * allowed). Secrets (MCP tokens, credentials) are never shared — recipients see
 * a redacted config and re-auth on clone.
 */
export function HarnessShareDialog({
	harnessId,
	open,
	onOpenChange,
}: {
	harnessId: Id<"harnesses">;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { user } = useUser();
	const ownerProfile = {
		ownerName: user?.fullName ?? user?.firstName ?? undefined,
		ownerImageUrl: user?.imageUrl ?? undefined,
	};

	const { data } = useQuery(
		convexQuery(
			api.harnessShares.listHarnessShareGrants,
			open ? { harnessId } : "skip",
		),
	);
	const grants = data?.grants ?? [];
	const locked = data?.locked ?? false;
	const linkGrant = grants.find((g) => g.publicToken) ?? null;
	const emailGrants = grants.filter((g) => g.granteeEmail || g.grantedToUserId);
	const shareUrl = linkGrant?.publicToken
		? buildHarnessShareUrl(linkGrant.publicToken)
		: null;

	const ensureLink = useMutation({
		mutationFn: useConvexMutation(api.harnessShares.ensureHarnessPublicLink),
	});
	const setRole = useMutation({
		mutationFn: useConvexMutation(api.harnessShares.setHarnessShareRole),
	});
	const rotateLink = useMutation({
		mutationFn: useConvexMutation(api.harnessShares.rotateHarnessPublicLink),
	});
	const revokeGrant = useMutation({
		mutationFn: useConvexMutation(api.harnessShares.revokeHarnessShareGrant),
	});
	const inviteEmail = useMutation({
		mutationFn: useConvexMutation(api.harnessShares.inviteHarnessByEmail),
	});
	const setLock = useMutation({
		mutationFn: useConvexMutation(api.harnessShares.setHarnessLock),
	});

	const [copied, setCopied] = useState(false);
	const [email, setEmail] = useState("");
	const [emailRole, setEmailRole] = useState<Role>("viewer");

	useEffect(() => {
		if (!open) {
			setCopied(false);
			setEmail("");
			setEmailRole("viewer");
		}
	}, [open]);

	const onErr = (verb: string) => (e: unknown) =>
		toast.error(
			`Couldn't ${verb} — ${e instanceof Error ? e.message : "please try again"}`,
		);

	const createLink = () =>
		ensureLink.mutate(
			{
				harnessId,
				role: "viewer",
				token: generateHarnessShareToken(),
				...ownerProfile,
			},
			{
				onSuccess: () => toast.success("Link created"),
				onError: onErr("create the link"),
			},
		);

	const copyLink = async () => {
		if (!shareUrl) return;
		if (await copyToClipboard(shareUrl)) {
			setCopied(true);
			toast.success("Link copied");
			setTimeout(() => setCopied(false), 1500);
		} else toast.error("Couldn't copy — copy it manually");
	};

	const toggleLinkRole = () => {
		if (!linkGrant) return;
		setRole.mutate(
			{
				grantId: linkGrant._id,
				role: linkGrant.role === "editor" ? "viewer" : "editor",
			},
			{ onError: onErr("change the role") },
		);
	};

	const resetLink = () =>
		rotateLink.mutate(
			{ harnessId, token: generateHarnessShareToken(), ...ownerProfile },
			{
				onSuccess: () => toast.success("Link reset"),
				onError: onErr("reset the link"),
			},
		);

	const stopLink = () => {
		if (!linkGrant) return;
		revokeGrant.mutate(
			{ grantId: linkGrant._id },
			{ onError: onErr("stop sharing") },
		);
	};

	const sendInvite = () => {
		const trimmed = email.trim();
		if (!trimmed) return;
		inviteEmail.mutate(
			{ harnessId, email: trimmed, role: emailRole, ...ownerProfile },
			{
				onSuccess: () => {
					toast.success(`Invited ${trimmed}`);
					setEmail("");
				},
				onError: onErr("send the invite"),
			},
		);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Share harness</DialogTitle>
					<DialogDescription>
						Share a read-only copy of this harness. Your MCP credentials and
						agent secrets are never shared — recipients re-connect their own
						when they clone it.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					{/* ── Public link ─────────────────────────────── */}
					<section className="space-y-2">
						<p className="text-xs font-medium text-foreground">
							Anyone with the link
						</p>
						{!shareUrl ? (
							<Button
								size="sm"
								variant="outline"
								className="w-full justify-start"
								onClick={createLink}
								disabled={ensureLink.isPending}
							>
								<Link2 size={14} />
								Create a shareable link
							</Button>
						) : (
							<>
								<div className="flex items-center gap-1.5">
									<Input readOnly value={shareUrl} className="h-8 text-xs" />
									<Button size="icon-sm" variant="outline" onClick={copyLink}>
										{copied ? <Check size={14} /> : <Copy size={14} />}
									</Button>
								</div>
								<div className="flex items-center justify-between">
									<Badge variant="secondary" className="text-[10px]">
										{linkGrant?.role === "editor" ? "Can edit" : "View only"}
									</Badge>
									<div className="flex items-center gap-1">
										<Button
											size="sm"
											variant="ghost"
											className="h-7 text-[11px] text-muted-foreground"
											onClick={toggleLinkRole}
											disabled={setRole.isPending}
										>
											{linkGrant?.role === "editor"
												? "Make view-only"
												: "Allow editing"}
										</Button>
										<Button
											size="icon-sm"
											variant="ghost"
											title="Reset link"
											onClick={resetLink}
											disabled={rotateLink.isPending}
										>
											<RotateCcw size={13} />
										</Button>
										<Button
											size="icon-sm"
											variant="ghost"
											title="Stop sharing the link"
											className="text-muted-foreground hover:text-destructive"
											onClick={stopLink}
											disabled={revokeGrant.isPending}
										>
											<Trash2 size={13} />
										</Button>
									</div>
								</div>
							</>
						)}
					</section>

					<Separator />

					{/* ── Email invite ────────────────────────────── */}
					<section className="space-y-2">
						<p className="text-xs font-medium text-foreground">
							Invite by email
						</p>
						<div className="flex items-center gap-1.5">
							<Input
								type="email"
								placeholder="person@example.com"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										sendInvite();
									}
								}}
								className="h-8 text-xs"
							/>
							<Select
								value={emailRole}
								onValueChange={(v) => setEmailRole(v as Role)}
							>
								<SelectTrigger className="h-8 w-[7.5rem] text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="viewer">View only</SelectItem>
									<SelectItem value="editor">Can edit</SelectItem>
								</SelectContent>
							</Select>
							<Button
								size="icon-sm"
								onClick={sendInvite}
								disabled={inviteEmail.isPending}
							>
								<Mail size={14} />
							</Button>
						</div>
						<p className="text-[10px] text-muted-foreground">
							They’ll see it under “Shared with you” after signing in with this
							email — even if they don’t have an account yet.
						</p>
						{emailGrants.length > 0 && (
							<ul className="space-y-1">
								{emailGrants.map((g) => (
									<li
										key={g._id}
										className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs"
									>
										<span className="min-w-0 flex-1 truncate text-foreground">
											{g.granteeEmail ?? "Member"}
										</span>
										<span className="shrink-0 text-[10px] text-muted-foreground">
											{g.granteeEmail && !g.grantedToUserId ? "Pending · " : ""}
											{g.role === "editor" ? "Can edit" : "View only"}
										</span>
										<button
											type="button"
											className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
											title="Revoke"
											onClick={() => revokeGrant.mutate({ grantId: g._id })}
										>
											<Trash2 size={12} />
										</button>
									</li>
								))}
							</ul>
						)}
					</section>

					<Separator />

					{/* ── Lock ────────────────────────────────────── */}
					<section className="flex items-start justify-between gap-3">
						<div className="min-w-0">
							<p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
								{locked ? <Lock size={12} /> : <LockOpen size={12} />}
								Lock editing
							</p>
							<p className="mt-0.5 text-[10px] text-muted-foreground">
								{locked
									? "Recipients can view and clone, but can’t edit your harness."
									: "Editors can change this harness in place. Lock to make it view-only."}
							</p>
						</div>
						<Button
							size="sm"
							variant={locked ? "default" : "outline"}
							className="shrink-0"
							onClick={() => setLock.mutate({ harnessId, locked: !locked })}
							disabled={setLock.isPending}
						>
							{locked ? "Locked" : "Lock"}
						</Button>
					</section>
				</div>
			</DialogContent>
		</Dialog>
	);
}
