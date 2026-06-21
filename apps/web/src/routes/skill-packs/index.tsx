import {
	convexQuery,
	useConvexAction,
	useConvexMutation,
} from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Eye, Package, Plus, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import toast from "react-hot-toast";
import { ManageHeader } from "../../components/manage/manage-tabs";
import { RecommendedSkillsGrid } from "../../components/recommended-skills-grid";
import { SkillViewerDialog } from "../../components/skill-viewer-dialog";
import { SkillsBrowser } from "../../components/skills-browser";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Skeleton } from "../../components/ui/skeleton";
import { Textarea } from "../../components/ui/textarea";
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
	claudeImportsAgents?: boolean;
}

function SkillPacksPage() {
	const { data: packs, isLoading } = useQuery(
		convexQuery(api.skillPacks.list, {}),
	);
	const [editing, setEditing] = useState<SkillPack | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<SkillPack | null>(null);

	const remove = useMutation({
		mutationFn: useConvexMutation(api.skillPacks.remove),
	});

	const openNew = () => {
		setEditing(null);
		setDialogOpen(true);
	};
	const openEdit = (pack: SkillPack) => {
		setEditing(pack);
		setDialogOpen(true);
	};

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
					<Button size="sm" onClick={openNew}>
						<Plus size={14} />
						New Skill Pack
					</Button>
				}
			/>

			<div className="flex-1 p-6">
				{packs && packs.length === 0 ? (
					<EmptyState onCreate={openNew} />
				) : (
					<div className="mx-auto max-w-3xl space-y-4">
						<p className="text-sm text-muted-foreground">
							Bundle skills with optional AGENTS.md / CLAUDE.md context, then
							attach a pack to a harness instead of picking loose skills. For
							agentic harnesses the context is written to the sandbox root and
							each skill is materialized so the agent can load it.
						</p>
						<div className="space-y-2">
							{packs?.map((pack) => (
								<SkillPackRow
									key={pack._id}
									pack={pack as SkillPack}
									onEdit={() => openEdit(pack as SkillPack)}
									onDelete={() => setDeleteTarget(pack as SkillPack)}
								/>
							))}
						</div>
					</div>
				)}
			</div>

			<SkillPackDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				editing={editing}
			/>

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
	onEdit,
	onDelete,
}: {
	pack: SkillPack;
	onEdit: () => void;
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
						onClick={onEdit}
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
						onClick={onEdit}
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

function SkillPackDialog({
	open,
	onOpenChange,
	editing,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	editing: SkillPack | null;
}) {
	const create = useMutation({
		mutationFn: useConvexMutation(api.skillPacks.create),
	});
	const update = useMutation({
		mutationFn: useConvexMutation(api.skillPacks.update),
	});
	const ensureSkillDetails = useConvexAction(api.skills.ensureSkillDetails);

	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [skills, setSkills] = useState<SkillEntry[]>([]);
	const [agentsMd, setAgentsMd] = useState("");
	const [claudeMd, setClaudeMd] = useState("");
	const [claudeImportsAgents, setClaudeImportsAgents] = useState(false);
	const [browserOpen, setBrowserOpen] = useState(false);
	const [viewingSkillId, setViewingSkillId] = useState<string | null>(null);

	// Reset the form whenever the dialog (re)opens for a different target.
	const [lastKey, setLastKey] = useState<string | null>(null);
	const key = open ? (editing?._id ?? "new") : null;
	if (key !== lastKey) {
		setLastKey(key);
		setName(editing?.name ?? "");
		setDescription(editing?.description ?? "");
		setSkills(editing?.skills ?? []);
		setAgentsMd(editing?.agentsMd ?? "");
		setClaudeMd(editing?.claudeMd ?? "");
		setClaudeImportsAgents(editing?.claudeImportsAgents ?? false);
	}

	const toggleSkill = (skill: SkillEntry) => {
		setSkills((prev) =>
			prev.some((s) => s.name === skill.name)
				? prev.filter((s) => s.name !== skill.name)
				: [...prev, skill],
		);
	};

	const isEdit = !!editing;
	const pending = create.isPending || update.isPending;
	const canSubmit = !!name.trim() && !pending;

	const handleSubmit = async () => {
		if (!canSubmit) return;
		const payload = {
			name: name.trim(),
			description: description.trim() || undefined,
			skills,
			agentsMd,
			claudeMd,
			claudeImportsAgents,
		};
		try {
			if (isEdit && editing) {
				await update.mutateAsync({ id: editing._id, ...payload });
			} else {
				await create.mutateAsync(payload);
			}
			// Warm the SKILL.md cache so agentic harnesses can materialize these
			// skills on their next session. Fire-and-forget.
			if (skills.length) {
				ensureSkillDetails({ names: skills.map((s) => s.name) }).catch(
					() => {},
				);
			}
			toast.success(isEdit ? "Skill pack updated" : "Skill pack created");
			onOpenChange(false);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Save failed");
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						{isEdit ? "Edit skill pack" : "New skill pack"}
					</DialogTitle>
					<DialogDescription>
						A reusable bundle of skills plus optional AGENTS.md / CLAUDE.md
						context for agentic harnesses.
					</DialogDescription>
				</DialogHeader>

				<div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
					<div className="space-y-1">
						<label
							htmlFor="pack-name"
							className="text-xs font-medium text-foreground"
						>
							Name
						</label>
						<Input
							id="pack-name"
							placeholder="Frontend essentials"
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					</div>

					<div className="space-y-1">
						<label
							htmlFor="pack-desc"
							className="text-xs font-medium text-foreground"
						>
							Description{" "}
							<span className="text-muted-foreground">(optional)</span>
						</label>
						<Input
							id="pack-desc"
							placeholder="What this pack is for"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
						/>
					</div>

					<div className="space-y-2">
						<h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
							Skills
						</h3>
						<RecommendedSkillsGrid selected={skills} onToggle={toggleSkill} />
						{skills.length > 0 && (
							<div className="space-y-1.5">
								{skills.map((skill) => {
									const displayName = skill.name.split("/").pop() ?? skill.name;
									return (
										<div
											key={skill.name}
											className="flex w-full items-start gap-3 border border-border bg-foreground/3 p-2.5"
										>
											<Checkbox
												checked={true}
												className="mt-0.5 shrink-0"
												onCheckedChange={() => toggleSkill(skill)}
											/>
											<span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
												{displayName}
											</span>
											<button
												type="button"
												aria-label={`View skill ${displayName}`}
												onClick={() => setViewingSkillId(skill.name)}
												className="mt-0.5 shrink-0 text-muted-foreground/40 transition-colors hover:text-foreground"
											>
												<Eye size={14} />
											</button>
										</div>
									);
								})}
							</div>
						)}
						<Dialog open={browserOpen} onOpenChange={setBrowserOpen}>
							<DialogTrigger asChild>
								<Button
									variant="outline"
									size="sm"
									className="w-full border-dashed"
								>
									<Plus size={14} />
									Browse Skills Catalog
								</Button>
							</DialogTrigger>
							<DialogContent className="flex max-h-[80vh] flex-col overflow-hidden sm:max-w-3xl">
								<DialogHeader>
									<DialogTitle>Skills Catalog</DialogTitle>
									<DialogDescription>
										Browse and search {"≈"}50,000 skills from skills.sh
									</DialogDescription>
								</DialogHeader>
								<div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
									<SkillsBrowser
										currentSkills={skills}
										onToggle={toggleSkill}
									/>
								</div>
							</DialogContent>
						</Dialog>
					</div>

					<div className="space-y-1">
						<label
							htmlFor="pack-agents"
							className="text-xs font-medium text-foreground"
						>
							AGENTS.md{" "}
							<span className="text-muted-foreground">(optional)</span>
						</label>
						<Textarea
							id="pack-agents"
							placeholder="Project conventions written to <sandbox>/AGENTS.md for every agentic harness…"
							value={agentsMd}
							onChange={(e) => setAgentsMd(e.target.value)}
							className="min-h-24 font-mono text-xs"
						/>
					</div>

					<div className="space-y-1">
						<label
							htmlFor="pack-claude"
							className="text-xs font-medium text-foreground"
						>
							CLAUDE.md{" "}
							<span className="text-muted-foreground">(Claude Code only)</span>
						</label>
						<Textarea
							id="pack-claude"
							placeholder="Written to <sandbox>/CLAUDE.md for Claude Code harnesses…"
							value={claudeMd}
							onChange={(e) => setClaudeMd(e.target.value)}
							className="min-h-24 font-mono text-xs"
						/>
						<label
							htmlFor="pack-import-agents"
							className="flex items-center gap-2 pt-1 text-xs text-foreground"
						>
							<Checkbox
								id="pack-import-agents"
								checked={claudeImportsAgents}
								onCheckedChange={(c) => setClaudeImportsAgents(c === true)}
							/>
							Import AGENTS.md into CLAUDE.md via{" "}
							<code className="rounded bg-muted px-1 text-[11px]">
								@AGENTS.md
							</code>
						</label>
					</div>
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={pending}
					>
						Cancel
					</Button>
					<Button onClick={handleSubmit} disabled={!canSubmit}>
						{pending ? "Saving…" : isEdit ? "Update" : "Create"}
					</Button>
				</DialogFooter>
				<SkillViewerDialog
					fullId={viewingSkillId}
					onClose={() => setViewingSkillId(null)}
				/>
			</DialogContent>
		</Dialog>
	);
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
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
			<Button onClick={onCreate}>
				<Plus size={14} />
				New Skill Pack
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
