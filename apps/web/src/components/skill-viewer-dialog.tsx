import { convexQuery, useConvexAction } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { useCallback, useRef } from "react";
import { MarkdownMessage } from "./markdown-message";
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
	const ensuredRef = useRef(new Set<string>());

	const detailQuery = useQuery({
		...convexQuery(api.skills.getByName, { name: fullId ?? "" }),
		enabled: !!fullId,
	});

	// Fire-and-forget ensure on first open
	if (fullId && !ensuredRef.current.has(fullId)) {
		ensuredRef.current.add(fullId);
		ensureSkillDetailsFn({ names: [fullId] }).catch(() => {});
	}

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
					{detailQuery.isLoading || !detailQuery.data?.detail ? (
						<div className="flex items-center justify-center py-12">
							<Loader2
								size={20}
								className="animate-spin text-muted-foreground"
							/>
							<span className="ml-2 text-sm text-muted-foreground">
								Fetching skill documentation...
							</span>
						</div>
					) : (
						<MarkdownMessage
							content={detailQuery.data.detail.replace(
								/^---\s*\n[\s\S]*?\n---\s*\n?/,
								"",
							)}
						/>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
