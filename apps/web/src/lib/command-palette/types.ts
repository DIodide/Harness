import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

export type CommandGroupId =
	| "recent"
	| "navigation"
	| "workspace"
	| "chat"
	| "harness"
	| "sandbox"
	| "account";

export const COMMAND_GROUP_LABELS: Record<CommandGroupId, string> = {
	recent: "Recently used",
	navigation: "Navigate",
	workspace: "Workspaces",
	chat: "Chat",
	harness: "Harnesses",
	sandbox: "Sandboxes",
	account: "Account",
};

export const COMMAND_GROUP_ORDER: CommandGroupId[] = [
	"recent",
	"navigation",
	"workspace",
	"chat",
	"harness",
	"sandbox",
	"account",
];

export type CommandIcon = LucideIcon | ComponentType<{ className?: string }>;

export interface Command {
	/** Stable ID used for dedup and recent-commands tracking. */
	id: string;
	/** Primary label — the line users read and match against. */
	title: string;
	/** Secondary text rendered right-aligned in muted tone. */
	subtitle?: string;
	/** Which group this command renders under. */
	group: CommandGroupId;
	/** Extra terms that should match but aren't shown. */
	keywords?: string[];
	/** Leading icon. */
	icon?: CommandIcon;
	/** Hex color rendered as a 8px leading dot (e.g. workspace color). */
	colorDot?: string;
	/** Right-aligned keyboard hint like `⌘⌥1`. */
	shortcut?: string;
	/** Handler invoked when the command is activated. Return a promise to show loading. */
	perform: () => void | Promise<void>;
	/** If false, the command is hidden. Evaluated at palette-open time. */
	when?: () => boolean;
}
