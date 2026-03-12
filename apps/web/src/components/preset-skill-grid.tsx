import { BarChart2, Bug, Code2, FileText, Search, Server } from "lucide-react";
import type { ComponentType } from "react";
import { PRESET_SKILLS } from "../lib/skills";
import { Checkbox } from "./ui/checkbox";

const ICON_MAP: Record<
	string,
	ComponentType<{ size?: number; className?: string }>
> = {
	BarChart2,
	Bug,
	Code2,
	FileText,
	Search,
	Server,
};

interface PresetSkillGridProps {
	selected: string[];
	onToggle: (id: string) => void;
}

export function PresetSkillGrid({ selected, onToggle }: PresetSkillGridProps) {
	return (
		<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
			{PRESET_SKILLS.map((skill) => {
				const Icon = ICON_MAP[skill.iconName];
				const isSelected = selected.includes(skill.id);
				return (
					<button
						key={skill.id}
						type="button"
						onClick={() => onToggle(skill.id)}
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
								{Icon && (
									<Icon size={12} className="shrink-0 text-muted-foreground" />
								)}
								<p className="text-xs font-medium text-foreground">
									{skill.name}
								</p>
							</div>
							<p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
								{skill.description}
							</p>
						</div>
					</button>
				);
			})}
		</div>
	);
}
