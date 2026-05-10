import { convexQuery, useConvexAction } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MarkdownMessage } from "./markdown-message";
import { RoseCurveSpinner } from "./rose-curve-spinner";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "./ui/dialog";

interface SkillViewerDialogProps {
	/** The full skill ID, e.g. "vercel-labs/agent-skills/vercel-react-best-practices" */
	fullId: string | null;
	/** Short display name */
	skillId?: string;
	/** Source repo path */
	source?: string;
	/** Install count */
	installs?: number;
	onClose: () => void;
}

export function SkillViewerDialog({
	fullId,
	skillId,
	source,
	installs,
	onClose,
}: SkillViewerDialogProps) {
	const ensureSkillDetailsFn = useConvexAction(api.skills.ensureSkillDetails);
	// Track per-skill ensure status: maps fullId → { done, error }
	const ensureStatusRef = useRef(
		new Map<string, { done: boolean; error: boolean }>(),
	);
	// Force re-render when a status changes
	const [, forceUpdate] = useState(0);

	const detailQuery = useQuery({
		...convexQuery(api.skills.getByName, { name: fullId ?? "" }),
		enabled: !!fullId,
	});

	const currentStatus = fullId
		? ensureStatusRef.current.get(fullId)
		: undefined;
	const ensureDone = currentStatus?.done ?? false;
	const ensureError = currentStatus?.error ?? false;

	// Fetch details when a new fullId is opened
	useEffect(() => {
		if (!fullId) return;
		if (ensureStatusRef.current.has(fullId)) return;
		ensureStatusRef.current.set(fullId, { done: false, error: false });
		forceUpdate((n) => n + 1);
		ensureSkillDetailsFn({ names: [fullId] })
			.then(() => {
				ensureStatusRef.current.set(fullId, { done: true, error: false });
				forceUpdate((n) => n + 1);
			})
			.catch(() => {
				ensureStatusRef.current.set(fullId, { done: true, error: true });
				forceUpdate((n) => n + 1);
			});
	}, [fullId, ensureSkillDetailsFn]);

	const formatInstalls = useCallback((n: number) => {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
		return n.toString();
	}, []);

	const displayName = skillId ?? fullId?.split("/").pop() ?? "";
	const displaySource =
		source ?? (fullId ? fullId.split("/").slice(0, -1).join("/") : "");

	return (
		<Dialog
			open={!!fullId}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle className="text-sm">{displayName}</DialogTitle>
					<DialogDescription className="text-xs">
						{displaySource}
						{installs != null && installs > 0 && (
							<span className="ml-2 inline-flex items-center gap-0.5">
								<Download size={10} />
								{formatInstalls(installs)}
							</span>
						)}
					</DialogDescription>
				</DialogHeader>
				<div className="max-h-[70vh] overflow-y-auto">
					{detailQuery.data?.detail ? (
						<MarkdownMessage
							content={detailQuery.data.detail.replace(
								/^---\s*\n[\s\S]*?\n---\s*\n?/,
								"",
							)}
						/>
					) : detailQuery.isError || ensureError ? (
						<div className="flex items-center justify-center py-12">
							<span className="text-sm text-muted-foreground">
								Failed to load skill documentation.
							</span>
						</div>
					) : ensureDone &&
						!detailQuery.isLoading &&
						!detailQuery.isFetching ? (
						<div className="flex items-center justify-center py-12">
							<span className="text-sm text-muted-foreground">
								No documentation available for this skill.
							</span>
						</div>
					) : (
						<div className="flex items-center justify-center py-12">
							<RoseCurveSpinner
								size={20}
								className="text-muted-foreground"
								label="Fetching skill documentation"
							/>
							<span className="ml-2 text-sm text-muted-foreground">
								Fetching skill documentation...
							</span>
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
