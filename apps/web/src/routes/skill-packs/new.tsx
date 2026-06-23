import { useConvexAction, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import toast from "react-hot-toast";
import {
	EMPTY_DRAFT,
	type SkillPackDraft,
	SkillPackEditor,
} from "../../components/skill-pack-editor";

export const Route = createFileRoute("/skill-packs/new")({
	beforeLoad: ({ context }) => {
		if (!context.userId) return;
	},
	component: NewSkillPackPage,
});

function NewSkillPackPage() {
	const navigate = useNavigate();
	const create = useMutation({
		mutationFn: useConvexMutation(api.skillPacks.create),
	});
	const ensureSkillDetails = useConvexAction(api.skills.ensureSkillDetails);

	const handleSave = async (draft: SkillPackDraft) => {
		try {
			await create.mutateAsync({
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
			toast.success("Skill pack created");
			navigate({ to: "/skill-packs" });
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Create failed");
		}
	};

	return (
		<SkillPackEditor
			mode="new"
			initial={EMPTY_DRAFT}
			saving={create.isPending}
			onSave={handleSave}
		/>
	);
}
