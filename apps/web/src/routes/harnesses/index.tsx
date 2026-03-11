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
	ArrowLeft,
	Copy,
	Cpu,
	Edit,
	Layers,
	MoreHorizontal,
	Play,
	Plus,
	Square,
	Trash2,
	Zap,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { HarnessMark } from "../../components/harness-mark";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../../components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Skeleton } from "../../components/ui/skeleton";

export const Route = createFileRoute("/harnesses/")({
	beforeLoad: ({ context }) => {
		if (!context.userId) {
			throw redirect({ to: "/sign-in" });
		}
	},
	component: HarnessesPage,
});

function HarnessesPage() {
	const navigate = useNavigate();
	const { data: harnesses, isLoading } = useQuery(
		convexQuery(api.harnesses.list, {}),
	);

	const updateHarness = useMutation({
		mutationFn: useConvexMutation(api.harnesses.update),
	});
	const removeHarness = useMutation({
		mutationFn: useConvexMutation(api.harnesses.remove),
	});
	const duplicateHarness = useMutation({
		mutationFn: useConvexMutation(api.harnesses.duplicate),
	});

	const [deleteTarget, setDeleteTarget] = useState<Id<"harnesses"> | null>(
		null,
	);

	if (isLoading) {
		return <LoadingSkeleton />;
	}

	const handleDuplicate = (id: Id<"harnesses">) => {
		duplicateHarness.mutate({ id });
	};

	const active = harnesses?.filter((h) => h.status === "started") ?? [];
	const stopped = harnesses?.filter((h) => h.status === "stopped") ?? [];
	const drafts = harnesses?.filter((h) => h.status === "draft") ?? [];

	const handleToggleStatus = (
		id: Id<"harnesses">,
		current: "started" | "stopped" | "draft",
	) => {
		const newStatus = current === "started" ? "stopped" : "started";
		updateHarness.mutate({ id, status: newStatus });
	};

	const handleDelete = () => {
		if (deleteTarget) {
			removeHarness.mutate({ id: deleteTarget });
			setDeleteTarget(null);
		}
	};

	return (
		<div className="flex h-full flex-col overflow-auto bg-background">
			<header className="flex items-center justify-between border-b border-border px-6 py-4">
				<div className="flex items-center gap-4">
					<Button variant="ghost" size="icon-xs" asChild>
						<Link to="/chat">
							<ArrowLeft size={14} />
						</Link>
					</Button>
					<div>
						<h1 className="text-lg font-medium tracking-tight text-foreground">
							Your Harnesses
						</h1>
						<p className="text-xs text-muted-foreground">
							{harnesses?.length ?? 0} total
						</p>
					</div>
				</div>
				<Button size="sm" asChild>
					<Link to="/onboarding">
						<Plus size={14} />
						Create New
					</Link>
				</Button>
			</header>

			<div className="flex-1 p-6">
				{harnesses?.length === 0 ? (
					<EmptyState />
				) : (
					<div className="mx-auto max-w-4xl space-y-8">
						{active.length > 0 && (
							<HarnessGroup
								title="Active"
								harnesses={active}
								onToggle={handleToggleStatus}
								onDelete={setDeleteTarget}
								onDuplicate={handleDuplicate}
								onEdit={(id) =>
									navigate({
										to: "/harnesses/$harnessId",
										params: { harnessId: id },
									})
								}
							/>
						)}
						{stopped.length > 0 && (
							<HarnessGroup
								title="Stopped"
								harnesses={stopped}
								onToggle={handleToggleStatus}
								onDelete={setDeleteTarget}
								onDuplicate={handleDuplicate}
								onEdit={(id) =>
									navigate({
										to: "/harnesses/$harnessId",
										params: { harnessId: id },
									})
								}
							/>
						)}
						{drafts.length > 0 && (
							<HarnessGroup
								title="Drafts"
								harnesses={drafts}
								onToggle={handleToggleStatus}
								onDelete={setDeleteTarget}
								onDuplicate={handleDuplicate}
								onEdit={(id) =>
									navigate({
										to: "/harnesses/$harnessId",
										params: { harnessId: id },
									})
								}
							/>
						)}
					</div>
				)}
			</div>

			<Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Harness</DialogTitle>
						<DialogDescription>
							This action cannot be undone. This will permanently delete the
							harness and all associated data.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button variant="outline" size="sm">
								Cancel
							</Button>
						</DialogClose>
						<Button variant="destructive" size="sm" onClick={handleDelete}>
							<Trash2 size={12} />
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function HarnessGroup({
	title,
	harnesses,
	onToggle,
	onDelete,
	onDuplicate,
	onEdit,
}: {
	title: string;
	harnesses: Array<{
		_id: Id<"harnesses">;
		name: string;
		model: string;
		status: "started" | "stopped" | "draft";
		mcpServers: Array<{
			name: string;
			url: string;
			authType: "none" | "bearer" | "oauth";
			authToken?: string;
		}>;
		skills: string[];
	}>;
	onToggle: (
		id: Id<"harnesses">,
		status: "started" | "stopped" | "draft",
	) => void;
	onDelete: (id: Id<"harnesses">) => void;
	onDuplicate: (id: Id<"harnesses">) => void;
	onEdit: (id: Id<"harnesses">) => void;
}) {
	return (
		<div>
			<h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
				{title}
			</h2>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{harnesses.map((h, i) => (
					<motion.div
						key={h._id}
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: i * 0.05 }}
					>
						<HarnessCard
							harness={h}
							onToggle={onToggle}
							onDelete={onDelete}
							onDuplicate={onDuplicate}
							onEdit={onEdit}
						/>
					</motion.div>
				))}
			</div>
		</div>
	);
}

function HarnessCard({
	harness,
	onToggle,
	onDelete,
	onDuplicate,
	onEdit,
}: {
	harness: {
		_id: Id<"harnesses">;
		name: string;
		model: string;
		status: "started" | "stopped" | "draft";
		mcpServers: Array<{
			name: string;
			url: string;
			authType: "none" | "bearer";
			authToken?: string;
		}>;
		skills: string[];
	};
	onToggle: (
		id: Id<"harnesses">,
		status: "started" | "stopped" | "draft",
	) => void;
	onDelete: (id: Id<"harnesses">) => void;
	onDuplicate: (id: Id<"harnesses">) => void;
	onEdit: (id: Id<"harnesses">) => void;
}) {
	const isDraft = harness.status === "draft";

	return (
		<Card
			className={`gap-0 py-0 ${isDraft ? "border-dashed border-border" : "ring-foreground/10"}`}
		>
			<CardContent className="p-4">
				<div className="mb-3 flex items-start justify-between">
					<div className="flex items-center gap-2">
						<div
							className={`h-2 w-2 ${
								harness.status === "started"
									? "bg-emerald-500"
									: harness.status === "stopped"
										? "bg-muted-foreground/40"
										: "bg-amber-400"
							}`}
						/>
						<h3 className="text-sm font-medium text-foreground">
							{harness.name}
						</h3>
					</div>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="icon-xs">
								<MoreHorizontal size={14} />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={() => onEdit(harness._id)}>
								<Edit size={12} />
								Edit
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => onDuplicate(harness._id)}>
								<Copy size={12} />
								Duplicate
							</DropdownMenuItem>
							{!isDraft && (
								<DropdownMenuItem
									onClick={() => onToggle(harness._id, harness.status)}
								>
									{harness.status === "started" ? (
										<>
											<Square size={12} />
											Stop
										</>
									) : (
										<>
											<Play size={12} />
											Start
										</>
									)}
								</DropdownMenuItem>
							)}
							<DropdownMenuSeparator />
							<DropdownMenuItem
								className="text-destructive"
								onClick={() => onDelete(harness._id)}
							>
								<Trash2 size={12} />
								Delete
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>

				<div className="flex items-center gap-2">
					<Badge variant="secondary" className="text-[10px]">
						<Cpu size={10} />
						{harness.model}
					</Badge>
				</div>

				<div className="mt-3 flex items-center gap-3 text-[10px] text-muted-foreground">
					<span className="flex items-center gap-1">
						<Layers size={10} />
						{harness.mcpServers.length} MCPs
					</span>
					<span className="flex items-center gap-1">
						<Zap size={10} />
						{harness.skills.length} Skills
					</span>
				</div>
			</CardContent>
		</Card>
	);
}

function EmptyState() {
	return (
		<div className="flex flex-col items-center justify-center py-24 text-center">
			<div className="mb-6 flex h-16 w-16 items-center justify-center bg-foreground">
				<HarnessMark size={28} className="text-background" />
			</div>
			<h2 className="mb-2 text-lg font-medium text-foreground">
				No harnesses yet
			</h2>
			<p className="mb-6 max-w-sm text-sm text-muted-foreground">
				Create your first harness to equip your AI agent with tools, MCPs, and
				skills.
			</p>
			<Button size="sm" asChild>
				<Link to="/onboarding">
					<Plus size={14} />
					Create Your First Harness
				</Link>
			</Button>
		</div>
	);
}

function LoadingSkeleton() {
	return (
		<div className="flex h-full flex-col bg-background">
			<header className="flex items-center justify-between border-b border-border px-6 py-4">
				<Skeleton className="h-6 w-40" />
				<Skeleton className="h-8 w-24" />
			</header>
			<div className="flex-1 p-6">
				<div className="mx-auto max-w-4xl">
					<Skeleton className="mb-4 h-4 w-20" />
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{["sk1", "sk2", "sk3"].map((key) => (
							<Skeleton key={key} className="h-32 w-full" />
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
