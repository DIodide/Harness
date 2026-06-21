import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { Check, MessageSquare } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "../../lib/utils";
import { getConversationTintHex } from "../../lib/workspace-colors";
import { RoseCurveSpinner } from "../rose-curve-spinner";
import {
	ConversationKebab,
	type KebabConversation,
	type KebabWorkspace,
} from "./conversation-kebab";

/**
 * A single conversation row in the sidebar — shared by /chat and /workspaces so
 * they can't drift. Owns the status icon (streaming spinner / done check /
 * idle), the optional workspace-color tint (/chat only), and the hover kebab.
 * The two routes pass route-specific callbacks; everything visual lives here.
 */
export function ConversationRow({
	convo,
	workspaces,
	active,
	streaming,
	done,
	tintEnabled = false,
	onSelect,
	onForked,
	onRequestShare,
	onDeleted,
}: {
	convo: KebabConversation;
	workspaces: KebabWorkspace[];
	active: boolean;
	streaming: boolean;
	done: boolean;
	/** Apply the workspace-color background tint (the /chat global list). */
	tintEnabled?: boolean;
	onSelect: (id: Id<"conversations">) => void;
	onForked: (id: Id<"conversations">) => void;
	onRequestShare: (id: Id<"conversations">) => void;
	onDeleted: (id: Id<"conversations">) => void;
}) {
	const tint = tintEnabled
		? getConversationTintHex(convo.workspaceId, workspaces)
		: null;

	return (
		<div className="group relative">
			<button
				type="button"
				onClick={() => onSelect(convo._id)}
				style={
					tint
						? {
								borderLeftColor: tint,
								backgroundColor: `color-mix(in srgb, ${tint} 14%, transparent)`,
							}
						: undefined
				}
				className={cn(
					"flex w-full items-center gap-2 py-1.5 pr-7 pl-2 text-left text-xs transition-colors",
					tint && "border-l-2",
					active && !tint && "bg-muted text-foreground",
					active &&
						tint &&
						"text-foreground ring-1 ring-foreground/30 ring-inset",
					!active &&
						"text-muted-foreground hover:bg-muted/50 hover:text-foreground",
				)}
			>
				<AnimatePresence mode="wait">
					{streaming ? (
						<motion.span
							key="spinner"
							initial={{ opacity: 0, scale: 0.5 }}
							animate={{ opacity: 1, scale: 1 }}
							exit={{ opacity: 0, scale: 0.5 }}
							transition={{ duration: 0.15 }}
							className="flex shrink-0"
						>
							<RoseCurveSpinner size={12} className="text-muted-foreground" />
						</motion.span>
					) : done ? (
						<motion.span
							key="check"
							initial={{ opacity: 0, scale: 0.5 }}
							animate={{ opacity: 1, scale: 1 }}
							exit={{ opacity: 0, scale: 0.5 }}
							transition={{ duration: 0.15 }}
							className="flex shrink-0"
						>
							<Check size={12} className="text-emerald-500" />
						</motion.span>
					) : (
						<motion.span
							key="icon"
							initial={{ opacity: 0, scale: 0.5 }}
							animate={{ opacity: 1, scale: 1 }}
							exit={{ opacity: 0, scale: 0.5 }}
							transition={{ duration: 0.15 }}
							className="flex shrink-0"
						>
							<MessageSquare size={12} />
						</motion.span>
					)}
				</AnimatePresence>
				<span className="truncate">{convo.title}</span>
			</button>
			<ConversationKebab
				convo={convo}
				workspaces={workspaces}
				onRequestShare={onRequestShare}
				onForked={onForked}
				onDeleted={onDeleted}
			/>
		</div>
	);
}
