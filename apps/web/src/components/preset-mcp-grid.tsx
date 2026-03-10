import {
	BarChart2,
	Bot,
	Box,
	Calendar,
	Cloud,
	Code2,
	Database,
	FileText,
	GitBranch,
	Globe,
	MessageSquare,
	Zap,
} from "lucide-react";
import type { ComponentType } from "react";
import { PRESET_MCPS } from "../lib/mcp";
import { Checkbox } from "./ui/checkbox";

const ICON_MAP: Record<
	string,
	ComponentType<{ size?: number; className?: string }>
> = {
	BarChart2,
	Bot,
	Box,
	Calendar,
	Cloud,
	Code2,
	Database,
	FileText,
	GitBranch,
	Globe,
	MessageSquare,
	Zap,
};

interface PresetMcpGridProps {
	selected: string[];
	onToggle: (id: string) => void;
}

export function PresetMcpGrid({ selected, onToggle }: PresetMcpGridProps) {
	return (
		<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
			{PRESET_MCPS.map((mcp) => {
				const Icon = ICON_MAP[mcp.iconName];
				const isSelected = selected.includes(mcp.id);
				return (
					<button
						key={mcp.id}
						type="button"
						onClick={() => onToggle(mcp.id)}
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
									{mcp.server.name}
								</p>
							</div>
							<p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
								{mcp.description}
							</p>
						</div>
					</button>
				);
			})}
		</div>
	);
}
