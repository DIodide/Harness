import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Package, Plus, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import toast from "react-hot-toast";
import { ManageHeader } from "../../components/manage/manage-tabs";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../../components/ui/dialog";
import { Skeleton } from "../../components/ui/skeleton";
import type { SkillEntry } from "../../lib/skills";

export const Route = createFileRoute("/skill-packs/")({
	beforeLoad: ({ context }) => {
		if (!context.userId) return;
	},
	component: SkillPacksPage,
});

interface SkillPack {
	_id: Id<"skillPacks">;
	name: string;
	description?: string;
	skills: SkillEntry[];
	agentsMd?: string;
	claudeMd?: string;
}

function SkillPacksPage() {
	const navigate = useNavigate();
	const { data: packs, isLoading } = useQuery(
		convexQuery(api.skillPacks.list, {}),
	);
	const [deleteTarget, setDeleteTarget] = useState<SkillPack | null>(null);
	const remove = useMutation({
		mutationFn: useConvexMutation(api.skillPacks.remove),
	});

	const handleDelete = async () => {
		if (!deleteTarget) return;
		try {
			await remove.mutateAsync({ id: deleteTarget._id });
			toast.success("Skill pack deleted");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Delete failed");
		} finally {
			setDeleteTarget(null);
		}
	};

	if (isLoading) return <LoadingState />;

	return (
		<div className="flex h-full flex-col overflow-auto bg-background">
			<ManageHeader
				count={packs?.length ?? 0}
				actions={
					<Button size="sm" asChild>
						<Link to="/skill-packs/new">
							<Plus size={14} />
							New Skill Pack
						</Link>
					</Button>
				}
			/>

			<div className="flex-1 p-6">
				{packs && packs.length === 0 ? (
					<EmptyState />
				) : (
					<div className="mx-auto max-w-3xl space-y-4">
						<p className="text-sm text-muted-foreground">
							Bundle skills with optional AGENTS.md / CLAUDE.md context, then
							attach a pack to a harness. Import a whole repo (e.g.
							greensock/gsap-skills) or start from a template in the editor.
						</p>
						<div className="space-y-2">
							{packs?.map((pack) => (
								<SkillPackRow
									key={pack._id}
									pack={pack as SkillPack}
									onOpen={() =>
										navigate({
											to: "/skill-packs/$packId",
											params: { packId: pack._id },
										})
									}
									onDelete={() => setDeleteTarget(pack as SkillPack)}
								/>
							))}
						</div>
					</div>
				)}
			</div>

			<Dialog
				open={!!deleteTarget}
				onOpenChange={(open) => !open && setDeleteTarget(null)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete skill pack</DialogTitle>
						<DialogDescription>
							Delete "
							<span className="font-medium text-foreground">
								{deleteTarget?.name}
							</span>
							"? Harnesses using it will be detached. This can't be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setDeleteTarget(null)}
							disabled={remove.isPending}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleDelete}
							disabled={remove.isPending}
						>
							{remove.isPending ? "Deleting…" : "Delete"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function SkillPackRow({
	pack,
	onOpen,
	onDelete,
}: {
	pack: SkillPack;
	onOpen: () => void;
	onDelete: () => void;
}) {
	const tags: string[] = [];
	if (pack.agentsMd) tags.push("AGENTS.md");
	if (pack.claudeMd) tags.push("CLAUDE.md");
	return (
		<motion.div
			initial={{ opacity: 0, y: 4 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.15 }}
		>
			<Card>
				<CardContent className="flex items-center gap-3 py-3">
					<Package size={15} className="shrink-0 text-muted-foreground" />
					<button
						type="button"
						onClick={onOpen}
						className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<span className="truncate text-sm font-medium text-foreground">
							{pack.name}
						</span>
						<p className="mt-0.5 truncate text-[11px] text-muted-foreground">
							{pack.skills.length} skill{pack.skills.length === 1 ? "" : "s"}
							{tags.length ? ` · ${tags.join(" · ")}` : ""}
							{pack.description ? ` · ${pack.description}` : ""}
						</p>
					</button>
					<Button
						size="sm"
						variant="ghost"
						className="h-7 text-xs"
						onClick={onOpen}
					>
						Edit
					</Button>
					<button
						type="button"
						className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
						title="Delete skill pack"
						onClick={onDelete}
					>
						<Trash2 size={14} />
					</button>
				</CardContent>
			</Card>
		</motion.div>
	);
}

function EmptyState() {
	return (
		<div className="flex flex-col items-center justify-center py-20 text-center">
			<div className="mb-5 flex size-14 items-center justify-center rounded-full bg-foreground">
				<Package size={24} className="text-background" />
			</div>
			<h2 className="mb-1 text-base font-medium text-foreground">
				No skill packs yet
			</h2>
			<p className="mb-6 max-w-sm text-sm text-muted-foreground">
				Create a pack to bundle skills with AGENTS.md / CLAUDE.md context and
				attach it to your harnesses.
			</p>
			<Button asChild>
				<Link to="/skill-packs/new">
					<Plus size={14} />
					New Skill Pack
				</Link>
			</Button>
		</div>
	);
}

function LoadingState() {
	return (
		<div className="flex h-full flex-col overflow-auto bg-background">
			<ManageHeader actions={<Skeleton className="h-7 w-32" />} />
			<div className="flex-1 p-6">
				<div className="mx-auto max-w-3xl space-y-2">
					{["a", "b", "c"].map((k) => (
						<Skeleton key={k} className="h-16 w-full" />
					))}
				</div>
			</div>
		</div>
	);
}
