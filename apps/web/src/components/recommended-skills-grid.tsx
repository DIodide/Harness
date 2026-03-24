import { Zap } from "lucide-react";
import type { SkillEntry } from "../lib/skills";
import { RECOMMENDED_SKILLS } from "../lib/skills";
import { Checkbox } from "./ui/checkbox";

interface RecommendedSkillsGridProps {
	selected: SkillEntry[];
	onToggle: (skill: SkillEntry) => void;
}

export function RecommendedSkillsGrid({
	selected,
	onToggle,
}: RecommendedSkillsGridProps) {
	if (RECOMMENDED_SKILLS.length === 0) {
		return null;
	}

	return (
		<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
			{RECOMMENDED_SKILLS.map((rec) => {
				const isSelected = selected.some((s) => s.name === rec.skill.name);
				return (
					<button
						key={rec.id}
						type="button"
						onClick={() =>
							onToggle({
								name: rec.skill.name,
								description: rec.skill.description,
							})
						}
						className={`flex items-start gap-3 border p-3 text-left transition-colors ${
							isSelected
								? "border-foreground bg-foreground/3"
								: "border-border hover:border-foreground/20"
						}`}
					>
						<Checkbox
							checked={isSelected}
							className="mt-0.5 shrink-0"
							tabIndex={-1}
						/>
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-1.5">
								<Zap size={14} className="shrink-0 text-muted-foreground" />
								<p className="text-xs font-medium text-foreground">
									{rec.skill.skill_name}
								</p>
							</div>
							{rec.skill.name.includes("/") && (
								<p className="text-[10px] leading-tight text-muted-foreground/50">
									{rec.skill.name.split("/").slice(0, -1).join("/")}
								</p>
							)}
							<p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
								{rec.skill.description || rec.skill.name}
							</p>
						</div>
					</button>
				);
			})}
		</div>
	);
}
