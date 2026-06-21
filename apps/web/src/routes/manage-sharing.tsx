import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Link2,
	Lock,
	MessageSquare,
	Share2,
	SlidersHorizontal,
	Trash2,
	Users,
} from "lucide-react";
import toast from "react-hot-toast";
import { ManageHeader } from "../components/manage/manage-tabs";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";

export const Route = createFileRoute("/manage-sharing")({
	beforeLoad: ({ context }) => {
		if (!context.userId) return; // defer to client auth gate (mirrors /harnesses)
	},
	component: ManageSharingPage,
});

function ManageSharingPage() {
	const { data: chats } = useQuery(
		convexQuery(api.shares.listMySharedConversations, {}),
	);
	const { data: harnesses } = useQuery(
		convexQuery(api.harnessShares.listMySharedHarnesses, {}),
	);

	const total = (chats?.length ?? 0) + (harnesses?.length ?? 0);

	return (
		<div className="flex h-full flex-col overflow-auto bg-background">
			<ManageHeader count={total} />
			<div className="flex-1 p-6">
				<div className="mx-auto max-w-3xl space-y-8">
					<p className="text-sm text-muted-foreground">
						Everything you're currently sharing. Revoke a link or invite to cut
						off access immediately.
					</p>

					<SharedChats chats={chats ?? []} />
					<SharedHarnesses harnesses={harnesses ?? []} />

					{total === 0 && (
						<div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
							<Share2 size={24} className="text-muted-foreground" />
							<p className="text-sm text-muted-foreground">
								You haven't shared anything yet.
							</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

type SharedChat = {
	conversationId: Id<"conversations">;
	title: string;
	grants: {
		_id: Id<"shareGrants">;
		role: "viewer" | "editor";
		publicToken: string | null;
		grantedToUserId: string | null;
		createdAt: number;
		lastAccessedAt: number | null;
	}[];
};

function SharedChats({ chats }: { chats: SharedChat[] }) {
	const setRole = useMutation({
		mutationFn: useConvexMutation(api.shares.setShareRole),
	});
	const revoke = useMutation({
		mutationFn: useConvexMutation(api.shares.revokeShareGrant),
	});
	const unshare = useMutation({
		mutationFn: useConvexMutation(api.shares.unshareConversation),
	});

	if (chats.length === 0) return null;

	return (
		<section className="space-y-3">
			<h2 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
				<MessageSquare size={12} /> Shared chats
				<span className="normal-case tracking-normal text-muted-foreground/60">
					{chats.length}
				</span>
			</h2>
			{chats.map((c) => (
				<Card key={c.conversationId}>
					<CardContent className="space-y-2 p-4">
						<div className="flex items-center justify-between gap-2">
							<h3 className="truncate text-sm font-medium text-foreground">
								{c.title}
							</h3>
							<Button
								size="sm"
								variant="ghost"
								className="h-7 shrink-0 text-[11px] text-muted-foreground hover:text-destructive"
								onClick={() =>
									unshare.mutate(
										{ conversationId: c.conversationId },
										{ onSuccess: () => toast.success("Stopped sharing") },
									)
								}
							>
								Stop sharing
							</Button>
						</div>
						<ul className="space-y-1">
							{c.grants.map((g) => (
								<li
									key={g._id}
									className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs"
								>
									{g.publicToken ? (
										<Link2
											size={12}
											className="shrink-0 text-muted-foreground"
										/>
									) : (
										<Users
											size={12}
											className="shrink-0 text-muted-foreground"
										/>
									)}
									<span className="min-w-0 flex-1 truncate text-foreground">
										{g.publicToken ? "Anyone with the link" : "A member"}
									</span>
									<button
										type="button"
										className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
										onClick={() =>
											setRole.mutate({
												grantId: g._id,
												role: g.role === "editor" ? "viewer" : "editor",
											})
										}
									>
										{g.role === "editor" ? "Can edit" : "View only"}
									</button>
									<button
										type="button"
										className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
										title="Revoke"
										onClick={() => revoke.mutate({ grantId: g._id })}
									>
										<Trash2 size={12} />
									</button>
								</li>
							))}
						</ul>
					</CardContent>
				</Card>
			))}
		</section>
	);
}

type SharedHarness = {
	harnessId: Id<"harnesses">;
	name: string;
	locked: boolean;
	recipients: {
		_id: Id<"harnessShareGrants">;
		role: "viewer" | "editor";
		kind: "link" | "email" | "user";
		label: string | null;
		createdAt: number;
	}[];
};

function SharedHarnesses({ harnesses }: { harnesses: SharedHarness[] }) {
	const setRole = useMutation({
		mutationFn: useConvexMutation(api.harnessShares.setHarnessShareRole),
	});
	const revoke = useMutation({
		mutationFn: useConvexMutation(api.harnessShares.revokeHarnessShareGrant),
	});
	const unshare = useMutation({
		mutationFn: useConvexMutation(api.harnessShares.unshareHarness),
	});

	if (harnesses.length === 0) return null;

	return (
		<section className="space-y-3">
			<h2 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
				<SlidersHorizontal size={12} /> Shared harnesses
				<span className="normal-case tracking-normal text-muted-foreground/60">
					{harnesses.length}
				</span>
			</h2>
			{harnesses.map((h) => (
				<Card key={h.harnessId}>
					<CardContent className="space-y-2 p-4">
						<div className="flex items-center justify-between gap-2">
							<h3 className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
								{h.name}
								{h.locked && (
									<Lock size={11} className="text-muted-foreground" />
								)}
							</h3>
							<Button
								size="sm"
								variant="ghost"
								className="h-7 shrink-0 text-[11px] text-muted-foreground hover:text-destructive"
								onClick={() =>
									unshare.mutate(
										{ harnessId: h.harnessId },
										{ onSuccess: () => toast.success("Stopped sharing") },
									)
								}
							>
								Stop sharing
							</Button>
						</div>
						<ul className="space-y-1">
							{h.recipients.map((g) => (
								<li
									key={g._id}
									className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs"
								>
									{g.kind === "link" ? (
										<Link2
											size={12}
											className="shrink-0 text-muted-foreground"
										/>
									) : (
										<Users
											size={12}
											className="shrink-0 text-muted-foreground"
										/>
									)}
									<span className="min-w-0 flex-1 truncate text-foreground">
										{g.kind === "link"
											? "Anyone with the link"
											: (g.label ?? "A member")}
									</span>
									<button
										type="button"
										className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
										title="Change role"
										onClick={() =>
											setRole.mutate({
												grantId: g._id,
												role: g.role === "editor" ? "viewer" : "editor",
											})
										}
									>
										{g.role === "editor" ? "Can edit" : "View only"}
									</button>
									<button
										type="button"
										className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
										title="Revoke"
										onClick={() => revoke.mutate({ grantId: g._id })}
									>
										<Trash2 size={12} />
									</button>
								</li>
							))}
						</ul>
					</CardContent>
				</Card>
			))}
		</section>
	);
}
