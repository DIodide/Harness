import {
	Briefcase,
	Check,
	Code,
	GraduationCap,
	Layers,
	Link2,
	Link2Off,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useHarnesses } from "@/hooks/useHarnesses";
import { useMcpConnections } from "@/hooks/useMcpConnections";

const ICON_MAP: Record<string, React.ElementType> = {
	briefcase: Briefcase,
	code: Code,
	"graduation-cap": GraduationCap,
};

interface HarnessSelectorProps {
	userId: string;
	selectedId?: string;
	onSelect: (id: string) => void;
}

export function HarnessSelector({
	userId,
	selectedId,
	onSelect,
}: HarnessSelectorProps) {
	const { harnesses, isLoading } = useHarnesses();
	const { isConnected } = useMcpConnections(userId);

	if (isLoading) {
		return (
			<div className="space-y-2">
				<Skeleton key="skel-0" className="h-14 w-full rounded-md" />
				<Skeleton key="skel-1" className="h-14 w-full rounded-md" />
				<Skeleton key="skel-2" className="h-14 w-full rounded-md" />
			</div>
		);
	}

	return (
		<div className="space-y-1.5">
			{harnesses.map((harness) => {
				const isSelected = harness._id === selectedId;
				const Icon = ICON_MAP[harness.icon] ?? Layers;

				const allConnected = harness.mcpServers.every(
					(s) => s.authType === "none" || isConnected(s.name),
				);

				return (
					<button
						key={harness._id}
						type="button"
						onClick={() => onSelect(harness._id)}
						className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-all ${
							isSelected
								? "bg-primary/10 border border-primary/30 glow-teal-sm"
								: "border border-transparent hover:bg-sidebar-accent/60"
						}`}
					>
						<div
							className="size-8 rounded-md flex items-center justify-center flex-shrink-0"
							style={{
								backgroundColor: `${harness.color}20`,
								color: harness.color,
							}}
						>
							<Icon className="size-4" />
						</div>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-1.5">
								<span className="text-sm font-medium truncate text-sidebar-foreground">
									{harness.name}
								</span>
								{isSelected && (
									<Check className="size-3 text-primary flex-shrink-0" />
								)}
							</div>
							<div className="flex items-center gap-1 mt-0.5">
								{allConnected ? (
									<Link2 className="size-2.5 text-emerald-400" />
								) : (
									<Link2Off className="size-2.5 text-muted-foreground" />
								)}
								<span className="text-[10px] text-muted-foreground font-mono">
									{harness.mcpServers.length} MCP
									{harness.mcpServers.length !== 1 ? "s" : ""}
								</span>
							</div>
						</div>
					</button>
				);
			})}
		</div>
	);
}
