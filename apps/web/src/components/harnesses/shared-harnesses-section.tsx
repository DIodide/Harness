import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Copy, Lock, Pencil, Users } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

/** One incoming shared-harness card (the redacted projection from Convex). */
export interface IncomingShare {
	harnessId: string;
	grantId: string;
	name: string;
	model: string;
	agent: string;
	systemPrompt: string | null;
	skills: { name: string; description: string }[];
	mcpServers: { name: string; authType: string; hasAuth: boolean }[];
	locked: boolean;
	role: "viewer" | "editor";
	ownerName: string | null;
	ownerImageUrl: string | null;
}

/**
 * "Shared with you" — harnesses other users shared to this account. Recipients
 * can always CLONE (a private copy on their own account). EDITORS can edit the
 * owner's harness in place, unless the owner LOCKED it.
 */
export function SharedHarnessesSection({ items }: { items: IncomingShare[] }) {
	const navigate = useNavigate();
	const clone = useMutation({
		mutationFn: useConvexMutation(api.harnessShares.cloneSharedHarness),
	});
	const [editing, setEditing] = useState<IncomingShare | null>(null);

	if (items.length === 0) return null;

	const doClone = (h: IncomingShare) => {
		clone.mutate(
			{ grantId: h.grantId as Id<"harnessShareGrants"> },
			{
				onSuccess: (id) => {
					toast.success("Cloned to your harnesses");
					navigate({
						to: "/harnesses/$harnessId",
						params: { harnessId: id as Id<"harnesses"> },
					});
				},
				onError: (e) =>
					toast.error(e instanceof Error ? e.message : "Couldn't clone"),
			},
		);
	};

	return (
		<div>
			<h2 className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
				<Users size={12} />
				Shared with you
				<span className="ml-0.5 normal-case tracking-normal text-muted-foreground/60">
					{items.length}
				</span>
			</h2>
			<div className="grid gap-3 sm:grid-cols-2">
				{items.map((h) => (
					<Card key={h.grantId} className="gap-0 py-0 ring-foreground/10">
						<CardContent className="p-4">
							<div className="mb-2 flex items-start justify-between gap-2">
								<h3 className="truncate text-sm font-medium text-foreground">
									{h.name}
								</h3>
								<div className="flex shrink-0 items-center gap-1">
									{h.locked && (
										<Badge variant="outline" className="gap-1 text-[10px]">
											<Lock size={9} />
										</Badge>
									)}
									<Badge variant="secondary" className="text-[10px]">
										{h.role === "editor" ? "Can edit" : "View only"}
									</Badge>
								</div>
							</div>
							<p className="mb-2 truncate font-mono text-[11px] text-muted-foreground">
								{h.model}
							</p>
							{h.ownerName && (
								<div className="mb-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
									<Avatar className="h-4 w-4">
										<AvatarImage src={h.ownerImageUrl ?? undefined} />
										<AvatarFallback className="bg-muted text-[8px]">
											{h.ownerName.charAt(0).toUpperCase()}
										</AvatarFallback>
									</Avatar>
									Shared by {h.ownerName}
								</div>
							)}
							<div className="flex items-center gap-1.5">
								<Button
									size="sm"
									variant="outline"
									className="h-7 text-xs"
									onClick={() => doClone(h)}
									disabled={clone.isPending}
								>
									<Copy size={12} />
									Clone
								</Button>
								{h.role === "editor" && !h.locked && (
									<Button
										size="sm"
										variant="ghost"
										className="h-7 text-xs text-muted-foreground"
										onClick={() => setEditing(h)}
									>
										<Pencil size={12} />
										Edit
									</Button>
								)}
							</div>
						</CardContent>
					</Card>
				))}
			</div>

			<SharedHarnessEditDialog
				share={editing}
				onOpenChange={(o) => !o && setEditing(null)}
			/>
		</div>
	);
}

/** Editor-only, safe-fields edit of a shared (unlocked) harness in place. */
function SharedHarnessEditDialog({
	share,
	onOpenChange,
}: {
	share: IncomingShare | null;
	onOpenChange: (open: boolean) => void;
}) {
	const edit = useMutation({
		mutationFn: useConvexMutation(api.harnessShares.editSharedHarness),
	});
	const [name, setName] = useState("");
	const [model, setModel] = useState("");
	const [systemPrompt, setSystemPrompt] = useState("");

	// Seed the form whenever a new share opens.
	useEffect(() => {
		if (share) {
			setName(share.name);
			setModel(share.model);
			setSystemPrompt(share.systemPrompt ?? "");
		}
	}, [share]);

	const save = () => {
		if (!share) return;
		edit.mutate(
			{
				harnessId: share.harnessId as Id<"harnesses">,
				patch: { name: name.trim(), model: model.trim(), systemPrompt },
			},
			{
				onSuccess: () => {
					toast.success("Saved");
					onOpenChange(false);
				},
				onError: (e) =>
					toast.error(e instanceof Error ? e.message : "Couldn't save"),
			},
		);
	};

	return (
		<Dialog open={share !== null} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Edit shared harness</DialogTitle>
					<DialogDescription>
						You're editing {share?.ownerName ?? "the owner"}'s harness in place.
						MCP servers and credentials stay private to the owner.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-3">
					<div className="space-y-1">
						<p className="text-xs font-medium text-foreground">Name</p>
						<Input value={name} onChange={(e) => setName(e.target.value)} />
					</div>
					<div className="space-y-1">
						<p className="text-xs font-medium text-foreground">Model</p>
						<Input value={model} onChange={(e) => setModel(e.target.value)} />
					</div>
					<div className="space-y-1">
						<p className="text-xs font-medium text-foreground">System prompt</p>
						<Textarea
							value={systemPrompt}
							onChange={(e) => setSystemPrompt(e.target.value)}
							rows={5}
						/>
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						onClick={save}
						disabled={edit.isPending || !name.trim() || !model.trim()}
					>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
