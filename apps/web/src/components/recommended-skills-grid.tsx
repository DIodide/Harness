import { Download, Eye, Zap } from "lucide-react";
import { useState } from "react";
import type { SkillEntry } from "../lib/skills";
import { RECOMMENDED_SKILLS, type RecommendedSkill } from "../lib/skills";
import { SkillViewerDialog } from "./skill-viewer-dialog";
import { Checkbox } from "./ui/checkbox";

interface RecommendedSkillsGridProps {
	selected: SkillEntry[];
	onToggle: (skill: SkillEntry) => void;
}

export function RecommendedSkillsGrid({
	selected,
	onToggle,
}: RecommendedSkillsGridProps) {
	const [viewingSkill, setViewingSkill] = useState<RecommendedSkill | null>(
		null,
	);

	if (RECOMMENDED_SKILLS.length === 0) {
		return null;
	}

	const formatInstalls = (n: number) => {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
		return n.toString();
	};

	return (
		<>
			<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
				{RECOMMENDED_SKILLS.map((rec) => {
					const isSelected = selected.some((s) => s.name === rec.skill.fullId);
					const skillPayload = {
						name: rec.skill.fullId,
						description: rec.skill.description,
					};
					return (
						<div
							key={rec.id}
							className={`flex items-start gap-3 border p-3 transition-colors ${
								isSelected
									? "border-foreground bg-foreground/3"
									: "border-border hover:border-foreground/20"
							}`}
						>
							<Checkbox
								checked={isSelected}
								className="mt-0.5 shrink-0"
								onCheckedChange={() => onToggle(skillPayload)}
							/>
							<button
								type="button"
								onClick={() => onToggle(skillPayload)}
								className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
							>
								<div className="flex items-center gap-1.5">
									<Zap size={14} className="shrink-0 text-muted-foreground" />
									<p className="text-xs font-medium text-foreground">
										{rec.skill.skillId}
									</p>
									{rec.skill.installs > 0 && (
										<span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/60">
											<Download size={10} />
											{formatInstalls(rec.skill.installs)}
										</span>
									)}
								</div>
								<p className="text-[10px] leading-tight text-muted-foreground/50">
									{rec.skill.source}
								</p>
							</button>
							<button
								type="button"
								onClick={() => setViewingSkill(rec)}
								className="mt-0.5 shrink-0 text-muted-foreground/40 transition-colors hover:text-foreground"
							>
								<Eye size={14} />
							</button>
						</div>
					);
				})}
			</div>
			<SkillViewerDialog
				fullId={viewingSkill?.skill.fullId ?? null}
				skillId={viewingSkill?.skill.skillId}
				source={viewingSkill?.skill.source}
				installs={viewingSkill?.skill.installs}
				onClose={() => setViewingSkill(null)}
			/>
		</>
	);
}
