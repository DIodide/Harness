import { useAuth } from "@clerk/tanstack-react-start";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type {
	Doc,
	Id,
} from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import {
	Archive,
	ArrowLeft,
	Calendar,
	Check,
	Code2,
	Cpu,
	Database,
	Files,
	GitBranch,
	HardDrive,
	Loader2,
	MemoryStick,
	Play,
	RefreshCw,
	Save,
	Square,
	Terminal,
} from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { SandboxPanel } from "../../components/sandbox/sandbox-panel";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Separator } from "../../components/ui/separator";
import { Skeleton } from "../../components/ui/skeleton";
import { createSandboxApi } from "../../lib/sandbox-api";
import {
	SandboxPanelProvider,
	type SandboxTab,
	useSandboxPanel,
} from "../../lib/sandbox-panel-context";

type Sandbox = Doc<"sandboxes">;

export const Route = createFileRoute("/sandboxes/$sandboxId")({
	beforeLoad: ({ context }) => {
		if (!context.userId) {
			throw redirect({ to: "/sign-in" });
		}
	},
	component: SandboxDetailPage,
});

function SandboxDetailPage() {
	const { sandboxId } = Route.useParams();
	const { data: sandbox, isLoading } = useQuery(
		convexQuery(api.sandboxes.get, {
			id: sandboxId as Id<"sandboxes">,
		}),
	);

	if (isLoading) {
		return <DetailSkeleton />;
	}

	if (!sandbox) {
		return (
			<div className="flex h-full flex-col items-center justify-center bg-background">
				<p className="mb-4 text-sm text-muted-foreground">Sandbox not found.</p>
				<Button size="sm" variant="outline" asChild>
					<Link to="/sandboxes">Back to Sandboxes</Link>
				</Button>
			</div>
		);
	}

	return (
		<SandboxPanelProvider sandboxId={sandbox.daytonaSandboxId}>
			<SandboxDetailContent sandbox={sandbox} />
		</SandboxPanelProvider>
	);
}

function SandboxDetailContent({ sandbox }: { sandbox: Sandbox }) {
	const { getToken } = useAuth();
	const panel = useSandboxPanel();
	const [name, setName] = useState(sandbox.name);
	const [workingDir, setWorkingDir] = useState("/home/daytona");

	const sandboxApi = useMemo(() => createSandboxApi(getToken), [getToken]);
	const updateSandboxFn = useConvexMutation(api.sandboxes.update);
	const updateSandbox = useMutation({
		mutationFn: updateSandboxFn,
		onSuccess: () => toast.success("Sandbox saved"),
		onError: () => toast.error("Failed to save sandbox"),
	});
	const updateSandboxStatus = useMutation({
		mutationFn: updateSandboxFn,
	});
	const lifecycle = useMutation({
		mutationFn: async (next: "start" | "stop") => {
			if (next === "start") {
				return sandboxApi.startSandbox(sandbox.daytonaSandboxId);
			}
			return sandboxApi.stopSandbox(sandbox.daytonaSandboxId);
		},
		onSuccess: (_, next) => {
			updateSandboxStatus.mutate({
				id: sandbox._id,
				status: next === "start" ? "running" : "stopped",
			});
			toast.success(next === "start" ? "Sandbox started" : "Sandbox stopped");
		},
		onError: () => toast.error("Sandbox lifecycle action failed"),
	});

	const hasNameChanges = name.trim() !== "" && name !== sandbox.name;
	const isRunning = sandbox.status === "running";

	const openSandboxTool = (tab: SandboxTab) => {
		panel?.setActiveTab(tab);
		if (!panel?.panelOpen) panel?.togglePanel();
	};

	const navigateToWorkingDir = () => {
		if (!workingDir.trim()) return;
		panel?.navigateTo(workingDir.trim());
	};

	const saveMetadata = () => {
		if (!hasNameChanges) return;
		updateSandbox.mutate({ id: sandbox._id, name: name.trim() });
	};

	return (
		<div className="flex h-full overflow-hidden bg-background">
			<main className="flex min-w-0 flex-1 flex-col overflow-auto">
				<header className="flex items-center justify-between border-b border-border px-6 py-4">
					<div className="flex min-w-0 items-center gap-4">
						<Button variant="ghost" size="icon-xs" asChild>
							<Link to="/sandboxes">
								<ArrowLeft size={14} />
							</Link>
						</Button>
						<div className="min-w-0">
							<div className="flex items-center gap-2">
								<h1 className="truncate text-lg font-medium tracking-tight text-foreground">
									{name || sandbox.name}
								</h1>
								<StatusBadge status={sandbox.status} />
							</div>
							<p className="truncate text-xs text-muted-foreground">
								{sandbox.daytonaSandboxId}
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<Button
							size="sm"
							variant="outline"
							onClick={() => lifecycle.mutate(isRunning ? "stop" : "start")}
							disabled={lifecycle.isPending}
						>
							{lifecycle.isPending ? (
								<Loader2 size={14} className="animate-spin" />
							) : isRunning ? (
								<Square size={14} />
							) : (
								<Play size={14} />
							)}
							{isRunning ? "Stop" : "Start"}
						</Button>
						<Button
							size="sm"
							onClick={saveMetadata}
							disabled={!hasNameChanges || updateSandbox.isPending}
						>
							{updateSandbox.isPending ? (
								<Loader2 size={14} className="animate-spin" />
							) : (
								<Save size={14} />
							)}
							Save
						</Button>
					</div>
				</header>

				<div className="flex-1 p-6">
					<div className="mx-auto max-w-5xl space-y-8">
						<motion.section
							initial={{ opacity: 0, y: 8 }}
							animate={{ opacity: 1, y: 0 }}
							className="space-y-4"
						>
							<div>
								<h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
									Edit Sandbox
								</h2>
								<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
									Rename the sandbox here. Use the workspace tools to edit
									files, create folders, run commands, inspect diffs, and commit
									changes.
								</p>
							</div>

							<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
								<div className="space-y-4">
									<div>
										<label
											htmlFor="sandbox-name"
											className="mb-1.5 block text-xs font-medium text-foreground"
										>
											Name
										</label>
										<Input
											id="sandbox-name"
											value={name}
											onChange={(e) => setName(e.target.value)}
											placeholder="Sandbox name"
											className="max-w-md"
										/>
									</div>

									<div>
										<label
											htmlFor="working-dir"
											className="mb-1.5 block text-xs font-medium text-foreground"
										>
											Working Directory
										</label>
										<div className="flex max-w-xl gap-2">
											<Input
												id="working-dir"
												value={workingDir}
												onChange={(e) => setWorkingDir(e.target.value)}
												placeholder="/home/daytona"
												className="font-mono text-xs"
											/>
											<Button
												type="button"
												size="sm"
												variant="outline"
												onClick={navigateToWorkingDir}
											>
												<RefreshCw size={13} />
												Open
											</Button>
										</div>
									</div>
								</div>

								<SandboxFacts sandbox={sandbox} />
							</div>
						</motion.section>

						<Separator />

						<motion.section
							initial={{ opacity: 0, y: 8 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.05 }}
							className="space-y-4"
						>
							<div>
								<h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
									Supported Edits
								</h2>
								<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
									These actions are supported directly because the backend
									already exposes authenticated Daytona filesystem, command, and
									git APIs.
								</p>
							</div>

							<div className="grid gap-3 md:grid-cols-3">
								<EditCapability
									icon={Files}
									title="Files"
									description="Open, edit, save, create, rename, move, delete, download, and search files and folders."
									action="Open Files"
									onClick={() => openSandboxTool("files")}
								/>
								<EditCapability
									icon={Terminal}
									title="Terminal"
									description="Run shell commands in a working directory, use an interactive PTY, and verify changes."
									action="Open Terminal"
									onClick={() => openSandboxTool("terminal")}
								/>
								<EditCapability
									icon={GitBranch}
									title="Git"
									description="Check status, inspect diffs, stage files, commit changes, and review recent history."
									action="Open Git"
									onClick={() => openSandboxTool("git")}
								/>
							</div>
						</motion.section>
					</div>
				</div>
			</main>

			{panel?.panelOpen && <SandboxPanel />}
		</div>
	);
}

function SandboxFacts({ sandbox }: { sandbox: Sandbox }) {
	return (
		<div className="space-y-2 border border-border p-3">
			<Fact
				icon={Archive}
				label="Type"
				value={sandbox.ephemeral ? "Ephemeral" : "Persistent"}
			/>
			<Fact icon={Code2} label="Language" value={sandbox.language ?? "Any"} />
			<Fact icon={Cpu} label="CPU" value={`${sandbox.resources.cpu} vCPU`} />
			<Fact
				icon={MemoryStick}
				label="Memory"
				value={`${sandbox.resources.memoryGB} GB`}
			/>
			<Fact
				icon={HardDrive}
				label="Disk"
				value={`${sandbox.resources.diskGB} GB`}
			/>
			<Fact
				icon={Calendar}
				label="Created"
				value={new Date(sandbox.createdAt).toLocaleDateString()}
			/>
			{sandbox.gitRepo && (
				<Fact icon={Database} label="Repository" value={sandbox.gitRepo} />
			)}
		</div>
	);
}

function Fact({
	icon: Icon,
	label,
	value,
}: {
	icon: typeof Archive;
	label: string;
	value: string;
}) {
	return (
		<div className="flex items-center gap-2 text-xs">
			<Icon size={12} className="shrink-0 text-muted-foreground" />
			<span className="w-20 shrink-0 text-muted-foreground">{label}</span>
			<span className="min-w-0 truncate text-foreground">{value}</span>
		</div>
	);
}

function EditCapability({
	icon: Icon,
	title,
	description,
	action,
	onClick,
}: {
	icon: typeof Files;
	title: string;
	description: string;
	action: string;
	onClick: () => void;
}) {
	return (
		<div className="flex min-h-44 flex-col border border-border p-4">
			<div className="mb-3 flex items-center gap-2">
				<Icon size={15} className="text-muted-foreground" />
				<h3 className="text-sm font-medium text-foreground">{title}</h3>
			</div>
			<p className="min-h-0 flex-1 text-xs leading-5 text-muted-foreground">
				{description}
			</p>
			<Button type="button" size="sm" variant="outline" onClick={onClick}>
				{action}
			</Button>
		</div>
	);
}

function StatusBadge({ status }: { status: Sandbox["status"] }) {
	const variant = status === "running" ? "default" : "secondary";
	return (
		<Badge variant={variant} className="shrink-0 text-[10px] capitalize">
			{status === "running" && <Check size={10} />}
			{status}
		</Badge>
	);
}

function DetailSkeleton() {
	return (
		<div className="flex h-full flex-col bg-background">
			<header className="flex items-center justify-between border-b border-border px-6 py-4">
				<div className="flex items-center gap-4">
					<Skeleton className="h-6 w-6" />
					<div className="space-y-2">
						<Skeleton className="h-5 w-48" />
						<Skeleton className="h-3 w-64" />
					</div>
				</div>
				<div className="flex gap-2">
					<Skeleton className="h-8 w-20" />
					<Skeleton className="h-8 w-20" />
				</div>
			</header>
			<div className="flex-1 p-6">
				<div className="mx-auto max-w-5xl space-y-8">
					<Skeleton className="h-40 w-full" />
					<Skeleton className="h-44 w-full" />
				</div>
			</div>
		</div>
	);
}
