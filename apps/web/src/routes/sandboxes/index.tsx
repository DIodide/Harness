import { useAuth } from "@clerk/tanstack-react-start";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type {
	Doc,
	Id,
} from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import {
	AlertTriangle,
	Archive,
	ArrowLeft,
	Calendar,
	Clock,
	Code2,
	Cpu,
	Database,
	Edit,
	GitBranch,
	HardDrive,
	Hash,
	MemoryStick,
	MoreHorizontal,
	Play,
	Plus,
	RefreshCw,
	Square,
	Trash2,
} from "lucide-react";
import { motion } from "motion/react";
import type { ComponentType } from "react";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
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
import { createSandboxApi } from "../../lib/sandbox-api";

type Sandbox = Doc<"sandboxes">;
type SandboxStatus = Sandbox["status"];

export const Route = createFileRoute("/sandboxes/")({
	beforeLoad: ({ context }) => {
		if (!context.userId) {
			throw redirect({ to: "/sign-in" });
		}
	},
	component: SandboxesPage,
});

function SandboxesPage() {
	const navigate = useNavigate();
	const { getToken } = useAuth();
	const sandboxApi = useMemo(() => createSandboxApi(getToken), [getToken]);
	const { data: sandboxes, isLoading } = useQuery(
		convexQuery(api.sandboxes.list, {}),
	);

	const startStop = useMutation({
		mutationFn: ({
			daytonaId,
			next,
		}: {
			daytonaId: string;
			next: "start" | "stop";
		}) =>
			next === "start"
				? sandboxApi.startSandbox(daytonaId)
				: sandboxApi.stopSandbox(daytonaId),
		onSuccess: (_, { next }) =>
			toast.success(next === "start" ? "Sandbox started" : "Sandbox stopped"),
		onError: (_, { next }) => toast.error(`Failed to ${next} sandbox`),
	});
	const archive = useMutation({
		mutationFn: (daytonaId: string) => sandboxApi.archiveSandbox(daytonaId),
		onSuccess: () => toast.success("Sandbox archived"),
		onError: () => toast.error("Failed to archive sandbox"),
	});
	const remove = useMutation({
		mutationFn: (daytonaId: string) => sandboxApi.deleteSandbox(daytonaId),
		onSuccess: () => toast.success("Sandbox deleted"),
		onError: () => toast.error("Failed to delete sandbox"),
	});
	const sync = useMutation({
		mutationFn: (daytonaId: string) => sandboxApi.syncSandbox(daytonaId),
		onSuccess: () => toast.success("Sandbox status synced"),
		onError: () => toast.error("Failed to sync sandbox"),
	});

	const [deleteTarget, setDeleteTarget] = useState<Sandbox | null>(null);
	const [stopTarget, setStopTarget] = useState<Sandbox | null>(null);

	if (isLoading) {
		return <LoadingSkeleton />;
	}

	const ephemeralSandboxes = sandboxes?.filter((s) => s.ephemeral) ?? [];
	const persistentSandboxes = sandboxes?.filter((s) => !s.ephemeral) ?? [];

	const handleToggleStatus = (sandbox: Sandbox) => {
		if (sandbox.status === "running" || sandbox.status === "starting") {
			// Confirm before stopping a running sandbox — terminates in-flight work.
			setStopTarget(sandbox);
			return;
		}
		startStop.mutate({ daytonaId: sandbox.daytonaSandboxId, next: "start" });
	};

	const confirmStop = () => {
		if (!stopTarget) return;
		startStop.mutate({
			daytonaId: stopTarget.daytonaSandboxId,
			next: "stop",
		});
		setStopTarget(null);
	};

	const handleArchive = (sandbox: Sandbox) => {
		archive.mutate(sandbox.daytonaSandboxId);
	};

	const handleSync = (sandbox: Sandbox) => {
		sync.mutate(sandbox.daytonaSandboxId);
	};

	const handleDelete = () => {
		if (deleteTarget) {
			remove.mutate(deleteTarget.daytonaSandboxId);
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
							Your Sandboxes
						</h1>
						<p className="text-xs text-muted-foreground">
							{sandboxes?.length ?? 0} total
						</p>
					</div>
				</div>
				<Button size="sm" asChild>
					<Link to="/sandboxes/create_sandbox">
						<Plus size={14} />
						Create New Sandbox
					</Link>
				</Button>
			</header>

			<div className="flex-1 p-6">
				{sandboxes?.length === 0 ? (
					<EmptyState />
				) : (
					<div className="mx-auto max-w-4xl space-y-8">
						{persistentSandboxes.length > 0 && (
							<SandboxGroup
								title="Persistent"
								sandboxes={persistentSandboxes}
								onToggle={handleToggleStatus}
								onArchive={handleArchive}
								onSync={handleSync}
								onDelete={setDeleteTarget}
								onEdit={(id) =>
									navigate({
										to: "/sandboxes/$sandboxId",
										params: { sandboxId: id },
									})
								}
							/>
						)}
						{ephemeralSandboxes.length > 0 && (
							<SandboxGroup
								title="Ephemeral"
								sandboxes={ephemeralSandboxes}
								onToggle={handleToggleStatus}
								onArchive={handleArchive}
								onSync={handleSync}
								onDelete={setDeleteTarget}
								onEdit={(id) =>
									navigate({
										to: "/sandboxes/$sandboxId",
										params: { sandboxId: id },
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
						<DialogTitle>Delete Sandbox</DialogTitle>
						<DialogDescription>
							{deleteTarget?.name
								? `"${deleteTarget.name}" will be permanently deleted in Daytona and removed from this list. This cannot be undone.`
								: "This action cannot be undone."}
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

			<Dialog open={!!stopTarget} onOpenChange={() => setStopTarget(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Stop sandbox?</DialogTitle>
						<DialogDescription>
							Any running commands will be terminated. Files, git state, and the
							working tree are preserved — you can start the sandbox again
							later.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button variant="outline" size="sm">
								Cancel
							</Button>
						</DialogClose>
						<Button size="sm" onClick={confirmStop}>
							<Square size={12} />
							Stop
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function SandboxGroup({
	title,
	sandboxes,
	onToggle,
	onArchive,
	onSync,
	onDelete,
	onEdit,
}: {
	title: string;
	sandboxes: Array<Sandbox>;
	onToggle: (sandbox: Sandbox) => void;
	onArchive: (sandbox: Sandbox) => void;
	onSync: (sandbox: Sandbox) => void;
	onDelete: (sandbox: Sandbox) => void;
	onEdit: (id: Id<"sandboxes">) => void;
}) {
	return (
		<div>
			<h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
				{title}
			</h2>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{sandboxes.map((s, i) => (
					<motion.div
						key={s._id}
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: i * 0.05 }}
					>
						<SandboxCard
							sandbox={s}
							onToggle={onToggle}
							onArchive={onArchive}
							onSync={onSync}
							onDelete={onDelete}
							onEdit={onEdit}
						/>
					</motion.div>
				))}
			</div>
		</div>
	);
}

function SandboxCard({
	sandbox,
	onToggle,
	onArchive,
	onSync,
	onDelete,
	onEdit,
}: {
	sandbox: Sandbox;
	onToggle: (sandbox: Sandbox) => void;
	onArchive: (sandbox: Sandbox) => void;
	onSync: (sandbox: Sandbox) => void;
	onDelete: (sandbox: Sandbox) => void;
	onEdit: (id: Id<"sandboxes">) => void;
}) {
	const statusMeta = getStatusMeta(sandbox.status);
	const sandboxType = sandbox.ephemeral ? "Ephemeral" : "Persistent";
	const language = formatLanguage(sandbox.language);
	const createdAt = formatDate(sandbox.createdAt);
	const lastAccessedAt = sandbox.lastAccessedAt
		? formatDate(sandbox.lastAccessedAt)
		: "Never";
	const shortDaytonaId = shortenId(sandbox.daytonaSandboxId);
	const inTransition =
		sandbox.status === "starting" ||
		sandbox.status === "stopping" ||
		sandbox.status === "creating";
	const isRunning = sandbox.status === "running";
	const canArchive =
		sandbox.status === "running" || sandbox.status === "stopped";

	return (
		<Card className="gap-0 py-0 ring-foreground/10">
			<CardContent className="p-4">
				<div className="mb-3 flex items-start justify-between">
					<div className="min-w-0 space-y-1">
						<div className="flex items-center gap-2">
							<div className={`h-2 w-2 shrink-0 ${statusMeta.dotClass}`} />
							<h3 className="truncate text-sm font-medium text-foreground">
								{sandbox.name}
							</h3>
						</div>
						<div className="flex flex-wrap items-center gap-1.5">
							<Badge variant={statusMeta.badgeVariant} className="text-[10px]">
								<statusMeta.icon size={10} />
								{statusMeta.label}
							</Badge>
							<Badge variant="outline" className="text-[10px]">
								<Database size={10} />
								{sandboxType}
							</Badge>
						</div>
					</div>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="icon-xs">
								<MoreHorizontal size={14} />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={() => onEdit(sandbox._id)}>
								<Edit size={12} />
								Edit
							</DropdownMenuItem>
							{!sandbox.ephemeral && (
								<>
									<DropdownMenuItem
										disabled={inTransition}
										onClick={() => onToggle(sandbox)}
									>
										{isRunning ? (
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
									<DropdownMenuItem
										disabled={!canArchive || inTransition}
										onClick={() => onArchive(sandbox)}
									>
										<Archive size={12} />
										Archive
									</DropdownMenuItem>
								</>
							)}
							<DropdownMenuItem onClick={() => onSync(sandbox)}>
								<RefreshCw size={12} />
								Sync status
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								className="text-destructive"
								onClick={() => onDelete(sandbox)}
							>
								<Trash2 size={12} />
								Delete
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>

				<div className="grid grid-cols-2 gap-2 text-[10px]">
					<SandboxInfoItem icon={Code2} label="Language" value={language} />
					<SandboxInfoItem
						icon={Cpu}
						label="CPU"
						value={`${sandbox.resources.cpu} vCPU`}
					/>
					<SandboxInfoItem
						icon={MemoryStick}
						label="Memory"
						value={`${sandbox.resources.memoryGB} GB`}
					/>
					<SandboxInfoItem
						icon={HardDrive}
						label="Disk"
						value={`${sandbox.resources.diskGB} GB`}
					/>
				</div>

				<div className="mt-3 space-y-1.5 border-t border-border pt-3 text-[10px] text-muted-foreground">
					<div className="flex items-center justify-between gap-2">
						<span className="flex min-w-0 items-center gap-1.5">
							<Calendar size={10} className="shrink-0" />
							<span>Created</span>
						</span>
						<span className="truncate text-foreground">{createdAt}</span>
					</div>
					<div className="flex items-center justify-between gap-2">
						<span className="flex min-w-0 items-center gap-1.5">
							<Clock size={10} className="shrink-0" />
							<span>Last used</span>
						</span>
						<span className="truncate text-foreground">{lastAccessedAt}</span>
					</div>
					{sandbox.gitRepo && (
						<div className="flex items-center justify-between gap-2">
							<span className="flex min-w-0 items-center gap-1.5">
								<GitBranch size={10} className="shrink-0" />
								<span>Repo</span>
							</span>
							<span className="truncate text-foreground">
								{formatRepoName(sandbox.gitRepo)}
							</span>
						</div>
					)}
					<div className="flex items-center justify-between gap-2">
						<span className="flex min-w-0 items-center gap-1.5">
							<Hash size={10} className="shrink-0" />
							<span>Daytona ID</span>
						</span>
						<span className="truncate font-mono text-foreground">
							{shortDaytonaId}
						</span>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

function SandboxInfoItem({
	icon: Icon,
	label,
	value,
}: {
	icon: ComponentType<{ size?: number; className?: string }>;
	label: string;
	value: string;
}) {
	return (
		<div className="flex min-w-0 items-center gap-2 border border-border px-2 py-1.5">
			<Icon size={12} className="shrink-0 text-muted-foreground" />
			<div className="min-w-0">
				<p className="text-[9px] uppercase text-muted-foreground">{label}</p>
				<p className="truncate font-medium text-foreground">{value}</p>
			</div>
		</div>
	);
}

function getStatusMeta(status: SandboxStatus): {
	label: string;
	dotClass: string;
	badgeVariant: "secondary" | "outline" | "destructive";
	icon: ComponentType<{ size?: number }>;
} {
	switch (status) {
		case "running":
			return {
				label: "Running",
				dotClass: "bg-emerald-500",
				badgeVariant: "secondary",
				icon: Play,
			};
		case "stopped":
			return {
				label: "Stopped",
				dotClass: "bg-muted-foreground/40",
				badgeVariant: "outline",
				icon: Square,
			};
		case "archived":
			return {
				label: "Archived",
				dotClass: "bg-muted-foreground/40",
				badgeVariant: "outline",
				icon: Archive,
			};
		case "error":
			return {
				label: "Error",
				dotClass: "bg-destructive",
				badgeVariant: "destructive",
				icon: AlertTriangle,
			};
		case "creating":
			return {
				label: "Creating",
				dotClass: "bg-amber-400",
				badgeVariant: "secondary",
				icon: Database,
			};
		case "starting":
			return {
				label: "Starting",
				dotClass: "bg-amber-400",
				badgeVariant: "secondary",
				icon: Play,
			};
		case "stopping":
			return {
				label: "Stopping",
				dotClass: "bg-amber-400",
				badgeVariant: "secondary",
				icon: Square,
			};
	}
}

function formatLanguage(language?: string) {
	if (!language) return "Not set";
	return language.charAt(0).toUpperCase() + language.slice(1);
}

function formatDate(timestamp: number) {
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(new Date(timestamp));
}

function shortenId(id: string) {
	if (id.length <= 12) return id;
	return `${id.slice(0, 6)}...${id.slice(-4)}`;
}

function formatRepoName(repo: string) {
	const trimmed = repo.replace(/\.git$/, "").replace(/\/$/, "");
	const parts = trimmed.split("/");
	return parts.slice(-2).join("/");
}

function EmptyState() {
	return (
		<div className="flex flex-col items-center justify-center py-24 text-center">
			<div className="mb-6 flex h-16 w-16 items-center justify-center bg-foreground">
				<HarnessMark size={28} className="text-background" />
			</div>
			<h2 className="mb-2 text-lg font-medium text-foreground">
				No sandboxes yet
			</h2>
			<p className="mb-6 max-w-sm text-sm text-muted-foreground">
				Create your first sandbox to equip your AI agent with sandboxes to
				execute code and a local filesystem.
			</p>
			<Button size="sm" asChild>
				<Link to="/sandboxes/create_sandbox">
					<Plus size={14} />
					Create Your First Sandbox
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
