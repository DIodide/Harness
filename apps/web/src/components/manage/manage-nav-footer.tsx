import { Link, useRouterState } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { UsageRailSection } from "../usage-display";
import { MANAGE_TABS } from "./manage-tabs";

/**
 * Compact sidebar footer rail, in three divider-separated sections: the three
 * "manage" destinations as icon buttons (name revealed on hover/focus via
 * tooltip), the usage indicator, and Settings. Replaces the old stack of four
 * full-width text buttons plus a standalone usage badge in both the chat and
 * workspaces sidebars. The active route's icon uses the same
 * `bg-muted text-foreground` idiom as a selected chat row, so it reads as
 * "you are here".
 */
export function ManageNavFooter({
	onOpenSettings,
	onOpenUsage,
}: {
	onOpenSettings: () => void;
	onOpenUsage: () => void;
}) {
	const pathname = useRouterState({
		select: (s) => s.location.pathname,
	});
	return (
		<div className="flex items-center gap-0.5 p-2">
			{MANAGE_TABS.map((item) => {
				const active =
					pathname === item.to || pathname.startsWith(`${item.to}/`);
				return (
					<Tooltip key={item.to}>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon-sm"
								asChild
								className={cn(active && "bg-muted text-foreground")}
							>
								<Link
									to={item.to}
									aria-current={active ? "page" : undefined}
									aria-label={`Manage ${item.label}`}
								>
									<item.icon size={14} />
								</Link>
							</Button>
						</TooltipTrigger>
						<TooltipContent side="top">Manage {item.label}</TooltipContent>
					</Tooltip>
				);
			})}

			{/* Usage section: its leading divider + badge mount/unmount as one
			    unit (renders nothing until usage data loads), so the rail never
			    shows a dangling divider. */}
			<UsageRailSection onOpenUsage={onOpenUsage} />

			{/* Match the variant-prefixed base class so tailwind-merge dedupes it
			    and the divider actually insets to 16px (a plain h-4 loses to the
			    base data-[orientation=vertical]:h-full). */}
			<Separator
				orientation="vertical"
				className="mx-1 data-[orientation=vertical]:h-4"
			/>

			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={onOpenSettings}
						aria-label="Settings"
						aria-haspopup="dialog"
					>
						<Settings size={14} />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="top">Settings</TooltipContent>
			</Tooltip>
		</div>
	);
}
