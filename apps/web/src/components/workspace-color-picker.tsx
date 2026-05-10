import { Check } from "lucide-react";
import { cn } from "../lib/utils";
import { WORKSPACE_COLORS } from "../lib/workspace-colors";

interface WorkspaceColorPickerProps {
	value: string | null;
	onChange: (value: string | null) => void;
}

export function WorkspaceColorPicker({
	value,
	onChange,
}: WorkspaceColorPickerProps) {
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			<button
				type="button"
				onClick={() => onChange(null)}
				title="No color"
				aria-label="No color"
				aria-pressed={value === null}
				className={cn(
					"flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background transition-all hover:scale-110",
					value === null &&
						"ring-2 ring-foreground/60 ring-offset-1 ring-offset-background",
				)}
			>
				<span className="block h-[2px] w-3 rotate-45 rounded-full bg-muted-foreground/70" />
			</button>
			{WORKSPACE_COLORS.map((color) => (
				<button
					key={color.key}
					type="button"
					onClick={() => onChange(color.key)}
					title={color.label}
					aria-label={color.label}
					aria-pressed={value === color.key}
					style={{ backgroundColor: color.hex }}
					className={cn(
						"flex h-6 w-6 items-center justify-center rounded-full border border-border/50 transition-all hover:scale-110",
						value === color.key &&
							"ring-2 ring-foreground/60 ring-offset-1 ring-offset-background",
					)}
				>
					{value === color.key && (
						<Check size={11} className="text-foreground/70" />
					)}
				</button>
			))}
		</div>
	);
}
