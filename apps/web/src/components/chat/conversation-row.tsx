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
	onMoved,
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
	onMoved?: (id: Id<"conversations">) => void;
}) {
	const tint = tintEnabled
		? getConversationTintHex(convo.workspaceId, workspaces)
		: null;

	return (
		// The tint wash + left accent bar live on the WRAPPER: an inset box-shadow
		// draws the 2px bar without shifting the text, and the row button stays
		// transparent over the wash so its hover overlay still reads.
		<div
			className="group relative"
			style={
				tint
					? {
							backgroundColor: `color-mix(in srgb, ${tint} 14%, transparent)`,
							boxShadow: `inset 2px 0 0 0 ${tint}`,
						}
					: undefined
			}
		>
			<button
				type="button"
				onClick={() => onSelect(convo._id)}
				className={cn(
					"flex w-full items-center gap-2 py-1.5 pr-7 pl-2 text-left text-xs transition-colors",
					tint
						? active
							? "text-foreground ring-1 ring-foreground/30 ring-inset"
							: "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
						: active
							? "bg-muted text-foreground"
							: "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
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
				{/* min-w-0 lets the flex item shrink below its content so the title
				    actually truncates. Without it a long title keeps its full
				    min-content width, which (inside Radix ScrollArea's
				    min-width:100% display:table viewport) widens every row and
				    pushes the absolutely-positioned kebab off-screen to the right. */}
				<span className="min-w-0 flex-1 truncate">{convo.title}</span>
			</button>
			<ConversationKebab
				convo={convo}
				workspaces={workspaces}
				onRequestShare={onRequestShare}
				onForked={onForked}
				onDeleted={onDeleted}
				onMoved={onMoved}
			/>
		</div>
	);
}
