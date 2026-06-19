import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	AlertCircle,
	ArrowLeft,
	Copy,
	Cpu,
	Edit,
	MessageSquare,
	MoreHorizontal,
	Play,
	Plus,
	Sparkles,
	Square,
	Terminal,
	Trash2,
	Zap,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import toast from "react-hot-toast";
import {
	ClaudeLogo,
	CursorLogo,
	OpenAILogo,
} from "../../components/agent-logos";
import { credentialDisplayName } from "../../components/agent-loop-picker";
import { HarnessCreationAssistant } from "../../components/harness-creation-assistant";
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
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "../../components/ui/tooltip";
import { useAgentCatalog } from "../../lib/use-agent-catalog";

export const Route = createFileRoute("/harnesses/")({
	beforeLoad: ({ context }) => {
		if (!context.userId) {
			// SSR can't see the Clerk session (the prod session cookies are not
			// shared to the app domain), so context.userId is null even for
			// signed-in users. Defer to the client auth gate instead of bouncing
			// to /sign-in, which loops. Mirrors /app.
			return;
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
	const [creationAssistantOpen, setCreationAssistantOpen] = useState(false);

	if (isLoading) {
		return <LoadingSkeleton />;
	}

	const handleDuplicate = (id: Id<"harnesses">) => {
		duplicateHarness.mutate(
			{ id },
			{ onSuccess: () => toast.success("Harness duplicated") },
		);
	};

	const active = harnesses?.filter((h) => h.status === "started") ?? [];
	const stopped = harnesses?.filter((h) => h.status === "stopped") ?? [];
	const drafts = harnesses?.filter((h) => h.status === "draft") ?? [];
	const duplicateHarnessNames = (() => {
		const counts = new Map<string, number>();
		for (const h of harnesses ?? []) {
			counts.set(h.name, (counts.get(h.name) ?? 0) + 1);
		}
		return [...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name);
	})();

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
				<div className="flex items-center gap-2">
					<Button
						size="sm"
						variant="outline"
						onClick={() => setCreationAssistantOpen(true)}
					>
						<Sparkles size={14} />
						Create with AI
					</Button>
					<Button size="sm" asChild>
						<Link to="/onboarding">
							<Plus size={14} />
							Create New
						</Link>
					</Button>
				</div>
			</header>

			<HarnessCreationAssistant
				open={creationAssistantOpen}
				onOpenChange={setCreationAssistantOpen}
			/>

			<div className="flex-1 p-6">
				{harnesses?.length === 0 ? (
					<EmptyState />
				) : (
					<div className="mx-auto max-w-4xl space-y-8">
						{duplicateHarnessNames.length > 0 && (
							<div className="flex items-start gap-2 border border-border bg-muted/40 px-4 py-3 text-xs text-foreground">
								<AlertCircle
									size={16}
									className="mt-0.5 shrink-0 text-muted-foreground"
								/>
								<div>
									<p className="font-medium">
										Duplicate harness name
										{duplicateHarnessNames.length > 1 ? "s" : ""}
									</p>
									<p className="mt-0.5 text-muted-foreground">
										You have multiple harnesses named{" "}
										{duplicateHarnessNames.map((n) => `"${n}"`).join(", ")}.
										This is allowed, but it can make picking the right one
										harder elsewhere — consider renaming them so each name is
										unique.
									</p>
								</div>
							</div>
						)}
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

type HarnessRow = {
	_id: Id<"harnesses">;
	name: string;
	model: string;
	status: "started" | "stopped" | "draft";
	agent?: string;
	agentCredentialId?: string;
	mcpServers: Array<{
		name: string;
		url: string;
		authType: "none" | "bearer" | "oauth" | "tiger_junction";
		authToken?: string;
	}>;
	skills: { name: string; description: string }[];
	systemPrompt?: string;
	sandboxEnabled?: boolean;
	lastUsedAt?: number;
};

const AGENT_BRAND: Record<
	string,
	{
		name: string;
		Logo: (props: { size?: number; className?: string }) => React.ReactNode;
	}
> = {
	"claude-code": { name: "Claude Code", Logo: ClaudeLogo },
	codex: { name: "Codex CLI", Logo: OpenAILogo },
	cursor: { name: "Cursor", Logo: CursorLogo },
};

function relativeTime(ts?: number): string | null {
	if (!ts) return null;
	const delta = Date.now() - ts;
	const minutes = Math.floor(delta / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	return new Date(ts).toLocaleDateString();
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
	harnesses: HarnessRow[];
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
				<span className="ml-1.5 normal-case tracking-normal text-muted-foreground/60">
					{harnesses.length}
				</span>
			</h2>
			<div className="grid gap-3 sm:grid-cols-2">
				{harnesses.map((h, i) => (
					<motion.div
						key={h._id}
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: i * 0.04 }}
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
	harness: HarnessRow;
	onToggle: (
		id: Id<"harnesses">,
		status: "started" | "stopped" | "draft",
	) => void;
	onDelete: (id: Id<"harnesses">) => void;
	onDuplicate: (id: Id<"harnesses">) => void;
	onEdit: (id: Id<"harnesses">) => void;
}) {
	const navigate = useNavigate();
	const { data: catalog } = useAgentCatalog();
	const isDraft = harness.status === "draft";
	const agentId =
		harness.agent && harness.agent !== "default" ? harness.agent : null;
	const brand = agentId ? AGENT_BRAND[agentId] : null;
	const credential = agentId
		? (catalog
				?.find((e) => e.id === agentId)
				?.credentials.find(
					(c) => c.credential_id === harness.agentCredentialId,
				) ?? null)
		: null;
	const lastUsed = relativeTime(harness.lastUsedAt);
	const mcpNames = harness.mcpServers.map((s) => s.name);
	const shownMcps = mcpNames.slice(0, 3);

	return (
		<Card
			className={`gap-0 py-0 ${isDraft ? "border-dashed border-border" : "ring-foreground/10"}`}
		>
			<CardContent className="p-4">
				{/* Header: status + name + menu */}
				<div className="mb-2.5 flex items-start justify-between gap-2">
					<div className="flex min-w-0 items-center gap-2">
						<div
							className={`h-2 w-2 shrink-0 ${
								harness.status === "started"
									? "bg-emerald-500"
									: harness.status === "stopped"
										? "bg-muted-foreground/40"
										: "bg-amber-400"
							}`}
						/>
						<h3 className="truncate text-sm font-medium text-foreground">
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

				{/* Agent loop + credential + model */}
				<div className="flex flex-wrap items-center gap-1.5">
					<Tooltip>
						<TooltipTrigger asChild>
							<Badge variant="secondary" className="text-[10px]">
								{brand ? <brand.Logo size={9} /> : <HarnessMark size={9} />}
								{brand?.name ?? "Harness"}
							</Badge>
						</TooltipTrigger>
						<TooltipContent>
							{brand
								? credential
									? `Your account — ${credentialDisplayName(credential)}`
									: "No credential linked — edit this harness to add one"
								: "Harness-provided models via OpenRouter"}
						</TooltipContent>
					</Tooltip>
					<Badge variant="secondary" className="text-[10px]">
						<Cpu size={10} />
						{harness.model}
					</Badge>
					{brand && !credential && (
						<Badge
							variant="outline"
							className="border-amber-400/60 text-[10px] text-amber-600"
						>
							<AlertCircle size={9} />
							No credential
						</Badge>
					)}
				</div>

				{/* MCP servers by name */}
				<div className="mt-2.5 flex min-h-[22px] flex-wrap items-center gap-1.5">
					{shownMcps.length > 0 ? (
						<>
							{shownMcps.map((name) => (
								<span
									key={name}
									className="border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-foreground/80"
								>
									{name}
								</span>
							))}
							{mcpNames.length > shownMcps.length && (
								<span className="text-[10px] text-muted-foreground">
									+{mcpNames.length - shownMcps.length} more
								</span>
							)}
						</>
					) : (
						<span className="text-[10px] text-muted-foreground/70">
							No MCP servers
						</span>
					)}
				</div>

				{/* Meta + open action */}
				<div className="mt-3 flex items-center gap-3 border-t border-border/60 pt-2.5 text-[10px] text-muted-foreground">
					<span className="flex items-center gap-1">
						<Zap size={10} />
						{harness.skills.length} skills
					</span>
					{harness.sandboxEnabled && (
						<span className="flex items-center gap-1">
							<Terminal size={10} />
							sandbox
						</span>
					)}
					{lastUsed && <span>Used {lastUsed}</span>}
					{!isDraft && (
						<Button
							size="sm"
							variant="outline"
							className="ml-auto h-6 px-2 text-[11px]"
							onClick={() =>
								navigate({ to: "/chat", search: { harnessId: harness._id } })
							}
						>
							<MessageSquare size={11} />
							Open in chat
						</Button>
					)}
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
