import { Link, useRouterState } from "@tanstack/react-router";
import {
	ArrowLeft,
	Box,
	KeyRound,
	Share2,
	SlidersHorizontal,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

/**
 * The "manage" destinations, shared by the tabbed header and the sidebar
 * footer rail so they can never drift. Adding a fourth manage screen is a
 * one-line edit here.
 *
 * `as const` is load-bearing: the typed route tree makes <Link to> strict, so
 * the `to` values must be literal types, not widened `string`.
 */
export const MANAGE_TABS = [
	{ to: "/sandboxes", label: "Sandboxes", icon: Box },
	{ to: "/harnesses", label: "Harnesses", icon: SlidersHorizontal },
	{ to: "/credentials", label: "Credentials", icon: KeyRound },
	{ to: "/manage-sharing", label: "Sharing", icon: Share2 },
] as const;

/** True when `pathname` is `to` or any nested child of it (e.g. /sandboxes/$id). */
function matches(pathname: string, to: string): boolean {
	return pathname === to || pathname.startsWith(`${to}/`);
}

/**
 * Segmented tab control switching between the three manage screens. These are
 * real navigating links, so we use nav semantics + aria-current="page" rather
 * than role="tablist" (no roving-tabindex contract to honor).
 */
export function ManageTabs() {
	const pathname = useRouterState({
		select: (s) => s.location.pathname,
	});
	return (
		<nav
			aria-label="Manage"
			className="flex min-w-0 items-center gap-0.5 rounded-lg bg-muted p-0.5"
		>
			{MANAGE_TABS.map((tab) => {
				const active = matches(pathname, tab.to);
				return (
					<Link
						key={tab.to}
						to={tab.to}
						aria-current={active ? "page" : undefined}
						title={tab.label}
						className={cn(
							// Recessed bg-muted track + raised bg-background active pill —
							// the conventional segmented-control contrast, legible in both
							// light and dark mode.
							"inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
							active
								? "bg-background text-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						<tab.icon size={13} className={active ? undefined : "opacity-70"} />
						{/* Labels collapse to icons below md so the widest header
						    (/harnesses) never pushes its actions off-screen. */}
						<span className="hidden md:inline">{tab.label}</span>
					</Link>
				);
			})}
		</nav>
	);
}

/**
 * The full header band shared by all three manage routes (and their loading
 * skeletons). Owns the back arrow, the tab control, the count, and a slot for
 * each page's own action buttons — so the three screens can never drift.
 */
export function ManageHeader({
	count,
	actions,
}: {
	/** Item count shown beside the tabs; omit (e.g. while loading) to hide it. */
	count?: number;
	/** Page-specific right-side buttons, rendered verbatim. */
	actions?: ReactNode;
}) {
	const pathname = useRouterState({
		select: (s) => s.location.pathname,
	});
	const activeLabel =
		MANAGE_TABS.find((t) => matches(pathname, t.to))?.label ?? "Manage";

	return (
		<header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
			<div className="flex min-w-0 items-center gap-3">
				<Button variant="ghost" size="icon-xs" asChild>
					<Link to="/chat" aria-label="Back to chat">
						<ArrowLeft size={14} />
					</Link>
				</Button>
				{/* Preserve the page's heading landmark even though the visible
				    title is now the active tab. */}
				<h1 className="sr-only">{activeLabel}</h1>
				<ManageTabs />
				{count != null && (
					<span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
						{count} total
					</span>
				)}
			</div>
			<div className="flex shrink-0 items-center gap-2">{actions}</div>
		</header>
	);
}
