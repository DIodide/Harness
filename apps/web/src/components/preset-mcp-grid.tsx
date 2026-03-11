import { useState } from "react";
import { PRESET_MCPS } from "../lib/mcp";
import { Checkbox } from "./ui/checkbox";

function McpLogo({ iconName, name }: { iconName: string; name: string }) {
	const [failed, setFailed] = useState(false);

	if (!iconName || failed) {
		return (
			<span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted text-[9px] font-bold uppercase text-muted-foreground">
				{name[0]}
			</span>
		);
	}

	const isFavicon = iconName.startsWith("http");
	const src = isFavicon ? iconName : `https://cdn.simpleicons.org/${iconName}`;

	return (
		<img
			src={src}
			alt={name}
			width={14}
			height={14}
			className={`shrink-0${isFavicon ? "" : " dark:invert"}`}
			onError={() => setFailed(true)}
		/>
	);
}

interface PresetMcpGridProps {
	selected: string[];
	onToggle: (id: string) => void;
}

export function PresetMcpGrid({ selected, onToggle }: PresetMcpGridProps) {
	return (
		<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
			{PRESET_MCPS.map((mcp) => {
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
								<McpLogo iconName={mcp.iconName} name={mcp.server.name} />
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
