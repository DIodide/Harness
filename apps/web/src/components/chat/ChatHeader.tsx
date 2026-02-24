import {
	Briefcase,
	Code,
	GraduationCap,
	Layers,
	Settings2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHarness } from "@/hooks/useHarnesses";
import ClerkHeader from "@/integrations/clerk/header-user";
import { McpConnectionStatus } from "./McpConnectionStatus";
import { ModelSelector } from "./ModelSelector";

const ICON_MAP: Record<string, React.ElementType> = {
	briefcase: Briefcase,
	code: Code,
	"graduation-cap": GraduationCap,
};

interface ChatHeaderProps {
	harnessId?: string;
	model: string;
	userId: string;
	onModelChange: (model: string) => void;
}

export function ChatHeader({
	harnessId,
	model,
	userId,
	onModelChange,
}: ChatHeaderProps) {
	const { harness } = useHarness(harnessId);
	const Icon = harness ? (ICON_MAP[harness.icon] ?? Layers) : Layers;

	return (
		<header className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-background/80 backdrop-blur">
			<div className="flex items-center gap-3 min-w-0">
				{harness && (
					<Badge
						variant="outline"
						className="gap-1.5 py-1 px-2.5 border-border/60"
						style={{ color: harness.color }}
					>
						<Icon className="size-3" />
						<span className="text-xs font-mono">{harness.name}</span>
					</Badge>
				)}
			</div>

			<div className="flex items-center gap-2">
				<ModelSelector model={model} onModelChange={onModelChange} />

				{harness && (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="icon-sm">
								<Settings2 className="size-4 text-muted-foreground" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-72 p-3">
							<p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
								MCP Connections
							</p>
							<McpConnectionStatus userId={userId} harnessId={harnessId} />
						</DropdownMenuContent>
					</DropdownMenu>
				)}

				<div className="hidden md:block">
					<ClerkHeader />
				</div>
			</div>
		</header>
	);
}
