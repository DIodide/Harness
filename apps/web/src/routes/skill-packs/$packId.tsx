import {
	convexQuery,
	useConvexAction,
	useConvexMutation,
} from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import toast from "react-hot-toast";
import {
	type SkillPackDraft,
	SkillPackEditor,
} from "../../components/skill-pack-editor";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";

export const Route = createFileRoute("/skill-packs/$packId")({
	beforeLoad: ({ context }) => {
		if (!context.userId) return;
	},
	component: EditSkillPackPage,
});

function EditSkillPackPage() {
	const navigate = useNavigate();
	const { packId } = Route.useParams();
	const { data: pack, isLoading } = useQuery(
		convexQuery(api.skillPacks.get, { id: packId as Id<"skillPacks"> }),
	);
	const update = useMutation({
		mutationFn: useConvexMutation(api.skillPacks.update),
	});
	const ensureSkillDetails = useConvexAction(api.skills.ensureSkillDetails);

	const handleSave = async (draft: SkillPackDraft) => {
		try {
			await update.mutateAsync({
				id: packId as Id<"skillPacks">,
				name: draft.name.trim(),
				description: draft.description.trim() || undefined,
				skills: draft.skills,
				agentsMd: draft.agentsMd,
				claudeMd: draft.claudeMd,
				claudeImportsAgents: draft.claudeImportsAgents,
			});
			if (draft.skills.length > 0) {
				ensureSkillDetails({ names: draft.skills.map((s) => s.name) }).catch(
					() => {},
				);
			}
			toast.success("Skill pack updated");
			navigate({ to: "/skill-packs" });
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Save failed");
		}
	};

	if (isLoading) {
		return (
			<div className="flex h-full flex-col bg-background">
				<div className="border-b border-border px-6 py-4">
					<Skeleton className="h-6 w-44" />
				</div>
				<div className="flex-1 p-6">
					<Skeleton className="h-full w-full" />
				</div>
			</div>
		);
	}

	if (!pack) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 bg-background">
				<p className="text-sm text-muted-foreground">Skill pack not found.</p>
				<Button size="sm" variant="outline" asChild>
					<Link to="/skill-packs">Back to Skill Packs</Link>
				</Button>
			</div>
		);
	}

	const initial: SkillPackDraft = {
		name: pack.name,
		description: pack.description ?? "",
		skills: pack.skills,
		agentsMd: pack.agentsMd ?? "",
		claudeMd: pack.claudeMd ?? "",
		claudeImportsAgents: pack.claudeImportsAgents ?? false,
	};

	return (
		<SkillPackEditor
			key={packId}
			mode="edit"
			initial={initial}
			saving={update.isPending}
			onSave={handleSave}
		/>
	);
}
