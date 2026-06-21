import { Link, useRouterState } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { MANAGE_TABS } from "./manage-tabs";

/**
 * Compact sidebar footer rail: the three "manage" destinations as icon buttons
 * (name revealed on hover/focus via tooltip), plus Settings. Replaces the old
 * stack of four full-width text buttons in both the chat and workspaces
 * sidebars. The active route's icon uses the same `bg-muted text-foreground`
 * idiom as a selected chat row, so it reads as "you are here".
 */
export function ManageNavFooter({
	onOpenSettings,
}: {
	onOpenSettings: () => void;
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

			<Separator orientation="vertical" className="mx-1 h-4" />

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
