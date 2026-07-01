import { createFileRoute } from "@tanstack/react-router";
import { KeyRound, Plus, Trash2 } from "lucide-react";
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
import { Input } from "../../components/ui/input";
import { Skeleton } from "../../components/ui/skeleton";
import {
	useSaveWorkspaceCredential,
	useWorkspaceCredentialMutations,
	useWorkspaceCredentials,
	type WorkspaceCredentialMeta,
} from "../../hooks/use-workspace-credentials";

export const Route = createFileRoute("/credentials/")({
	beforeLoad: ({ context }) => {
		if (!context.userId) {
			// SSR can't see the Clerk session on the app domain; defer to the
			// client auth gate instead of bouncing to /sign-in. Mirrors /harnesses.
			return;
		}
	},
	component: CredentialsPage,
});

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
// A short client-side mirror of the server denylist for instant feedback. The
// server (workspace_credentials.validate_env_credential) remains authoritative.
const RESERVED_HINT = new Set([
	"PATH",
	"HOME",
	"NODE_OPTIONS",
	"LD_PRELOAD",
	"LD_LIBRARY_PATH",
	"CLAUDE_CODE_OAUTH_TOKEN",
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"CURSOR_API_KEY",
]);

function clientNameError(name: string): string | null {
	if (!name) return null;
	if (!NAME_RE.test(name)) {
		return "Use letters, digits, and underscores; start with a letter or _.";
	}
	const upper = name.toUpperCase();
	if (
		RESERVED_HINT.has(upper) ||
		upper.startsWith("LD_") ||
		upper.startsWith("DYLD_") ||
		upper.startsWith("BASH_FUNC_")
	) {
		return "That name is reserved and can't be used as a credential.";
	}
	return null;
}

function CredentialsPage() {
	const { data: credentials, isLoading } = useWorkspaceCredentials();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<WorkspaceCredentialMeta | null>(null);
	const [deleteTarget, setDeleteTarget] =
		useState<WorkspaceCredentialMeta | null>(null);

	const { remove } = useWorkspaceCredentialMutations();

	const openNew = () => {
		setEditing(null);
		setDialogOpen(true);
	};
	const openRotate = (cred: WorkspaceCredentialMeta) => {
		setEditing(cred);
		setDialogOpen(true);
	};

	const handleDelete = async () => {
		if (!deleteTarget) return;
		try {
			await remove.mutateAsync({ credentialId: deleteTarget._id });
			toast.success("Credential deleted");
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
				count={credentials?.length ?? 0}
				actions={
					<Button size="sm" onClick={openNew}>
						<Plus size={14} />
						New Credential
					</Button>
				}
			/>

			<div className="flex-1 p-6">
				{credentials && credentials.length === 0 ? (
					<EmptyState onCreate={openNew} />
				) : (
					<div className="mx-auto max-w-3xl space-y-4">
						<p className="text-sm text-muted-foreground">
							Credentials are environment variables (like{" "}
							<code className="rounded bg-muted px-1 py-0.5 text-xs">
								GITHUB_TOKEN
							</code>
							) you create once and assign to workspaces. The value is
							encrypted, write-only, and injected into the sandbox that runs the
							workspace's code — never shown again after saving.
						</p>
						<div className="space-y-2">
							{credentials?.map((cred) => (
								<CredentialRow
									key={cred._id}
									cred={cred}
									onRotate={() => openRotate(cred)}
									onDelete={() => setDeleteTarget(cred)}
								/>
							))}
						</div>
					</div>
				)}
			</div>

			<CredentialDialog
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
						<DialogTitle>Delete credential</DialogTitle>
						<DialogDescription>
							Delete{" "}
							<span className="font-mono text-foreground">
								{deleteTarget?.name}
							</span>
							? It will be unassigned from {deleteTarget?.workspaceCount ?? 0}{" "}
							workspace
							{deleteTarget?.workspaceCount === 1 ? "" : "s"} and can't be
							recovered.
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

function CredentialRow({
	cred,
	onRotate,
	onDelete,
}: {
	cred: WorkspaceCredentialMeta;
	onRotate: () => void;
	onDelete: () => void;
}) {
	return (
		<motion.div
			initial={{ opacity: 0, y: 4 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.15 }}
		>
			<Card>
				<CardContent className="flex items-center gap-3 py-3">
					<KeyRound size={15} className="shrink-0 text-muted-foreground" />
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<span className="truncate font-mono text-sm text-foreground">
								{cred.name}
							</span>
							{cred.label && (
								<span className="truncate text-xs text-muted-foreground">
									{cred.label}
								</span>
							)}
						</div>
						<p className="mt-0.5 text-[11px] text-muted-foreground">
							{cred.workspaceCount} workspace
							{cred.workspaceCount === 1 ? "" : "s"}
							{cred.lastUsedAt
								? ` · last used ${new Date(cred.lastUsedAt).toLocaleDateString()}`
								: " · never used"}
						</p>
					</div>
					<Button
						size="sm"
						variant="ghost"
						className="h-7 text-xs text-muted-foreground"
						onClick={onRotate}
					>
						Rotate
					</Button>
					<button
						type="button"
						className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
						title="Delete credential"
						onClick={onDelete}
					>
						<Trash2 size={14} />
					</button>
				</CardContent>
			</Card>
		</motion.div>
	);
}

function CredentialDialog({
	open,
	onOpenChange,
	editing,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	editing: WorkspaceCredentialMeta | null;
}) {
	const save = useSaveWorkspaceCredential();
	const [name, setName] = useState("");
	const [value, setValue] = useState("");
	const [label, setLabel] = useState("");

	// Reset the form whenever the dialog opens for a new target.
	const [lastKey, setLastKey] = useState<string | null>(null);
	const key = open ? (editing?._id ?? "new") : null;
	if (key !== lastKey) {
		setLastKey(key);
		setName(editing?.name ?? "");
		setLabel(editing?.label ?? "");
		setValue("");
	}

	const isRotate = !!editing;
	const nameError = clientNameError(name);
	const canSubmit = !!name && !!value && !nameError && !save.isPending;

	const handleSubmit = async () => {
		if (!canSubmit) return;
		try {
			await save.mutateAsync({
				name: name.trim(),
				value,
				label: label.trim() || undefined,
				credential_id: editing?._id,
			});
			toast.success(isRotate ? "Credential rotated" : "Credential saved");
			onOpenChange(false);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Save failed");
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{isRotate ? "Rotate credential" : "New credential"}
					</DialogTitle>
					<DialogDescription>
						{isRotate
							? "Replace the stored value. Assignments are kept."
							: "Stored encrypted; never shown again after saving."}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					<div className="space-y-1">
						<label
							htmlFor="cred-name"
							className="text-xs font-medium text-foreground"
						>
							Name
						</label>
						<Input
							id="cred-name"
							placeholder="GITHUB_TOKEN"
							value={name}
							disabled={isRotate}
							autoComplete="off"
							spellCheck={false}
							aria-invalid={!!nameError}
							onChange={(e) => setName(e.target.value)}
						/>
						{nameError ? (
							<p className="text-[11px] text-destructive">{nameError}</p>
						) : (
							<p className="text-[11px] text-muted-foreground">
								The environment variable name injected into the sandbox.
							</p>
						)}
					</div>

					<div className="space-y-1">
						<label
							htmlFor="cred-value"
							className="text-xs font-medium text-foreground"
						>
							Value
						</label>
						<Input
							id="cred-value"
							type="password"
							placeholder={
								isRotate ? "Enter the new value" : "Paste the secret"
							}
							value={value}
							autoComplete="off"
							spellCheck={false}
							onChange={(e) => setValue(e.target.value)}
						/>
						<p className="text-[11px] text-muted-foreground">
							Encrypted server-side; we never show it again.
						</p>
					</div>

					<div className="space-y-1">
						<label
							htmlFor="cred-label"
							className="text-xs font-medium text-foreground"
						>
							Label{" "}
							<span className="font-normal text-muted-foreground">
								(optional)
							</span>
						</label>
						<Input
							id="cred-label"
							placeholder="e.g. CI bot, personal"
							value={label}
							maxLength={80}
							onChange={(e) => setLabel(e.target.value)}
						/>
					</div>
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={save.isPending}
					>
						Cancel
					</Button>
					<Button onClick={handleSubmit} disabled={!canSubmit}>
						{save.isPending
							? "Saving…"
							: isRotate
								? "Rotate"
								: "Save credential"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
	return (
		<div className="flex flex-col items-center justify-center py-20 text-center">
			<div className="mb-5 flex size-14 items-center justify-center rounded-full bg-foreground">
				<KeyRound size={24} className="text-background" />
			</div>
			<h2 className="mb-1 text-base font-medium text-foreground">
				No credentials yet
			</h2>
			<p className="mb-6 max-w-sm text-sm text-muted-foreground">
				Create a credential like{" "}
				<code className="rounded bg-muted px-1 py-0.5 text-xs">
					GITHUB_TOKEN
				</code>{" "}
				once, then assign it to any workspace. It's injected as an environment
				variable into the sandbox that runs your code.
			</p>
			<Button onClick={onCreate}>
				<Plus size={14} />
				New Credential
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
					{["a", "b", "c"].map((key) => (
						<Skeleton key={key} className="h-16 w-full" />
					))}
				</div>
			</div>
		</div>
	);
}
