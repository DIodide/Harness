import { Eye, Plus, X, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { SkillEntry } from "../lib/skills";
import { SkillViewerDialog } from "./skill-viewer-dialog";
import { SkillsBrowser } from "./skills-browser";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface HeaderSkillsMenuProps {
	skills: SkillEntry[];
	onAdd: (skill: SkillEntry) => void;
	onRemove: (skill: SkillEntry) => void;
}

export function HeaderSkillsMenu({
	skills,
	onAdd,
	onRemove,
}: HeaderSkillsMenuProps) {
	const [open, setOpen] = useState(false);
	const [viewingSkillId, setViewingSkillId] = useState<string | null>(null);
	const [browseOpen, setBrowseOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (viewingSkillId || browseOpen) return;
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open, viewingSkillId, browseOpen]);

	const hasSkills = skills.length > 0;

	return (
		<div ref={ref} className="relative">
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						onClick={() => setOpen((prev) => !prev)}
						className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<Zap size={10} />
						{hasSkills
							? `${skills.length} Skill${skills.length !== 1 ? "s" : ""}`
							: "Add skills"}
					</button>
				</TooltipTrigger>
				<TooltipContent>
					{hasSkills ? "Manage skills" : "Add skills to this harness"}
				</TooltipContent>
			</Tooltip>

			<AnimatePresence>
				{open && (
					<motion.div
						initial={{ opacity: 0, y: -4, scale: 0.97 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, y: -4, scale: 0.97 }}
						transition={{ duration: 0.15 }}
						className="absolute left-0 top-full z-50 mt-1 w-64 border border-border bg-background shadow-lg"
					>
						<div className="border-b border-border px-3 py-2">
							<span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
								Skills
							</span>
						</div>
						<div className="max-h-48 overflow-y-auto py-1">
							{hasSkills ? (
								skills.map((skill) => (
									<div
										key={skill.name}
										className="group flex items-center gap-2 px-3 py-1.5 hover:bg-muted/40"
									>
										<Zap size={10} className="shrink-0 text-muted-foreground" />
										<span className="min-w-0 flex-1 truncate text-xs font-medium">
											{skill.name.split("/").pop() ?? skill.name}
										</span>
										<button
											type="button"
											onClick={() => setViewingSkillId(skill.name)}
											className="shrink-0 text-muted-foreground/40 transition-colors hover:text-foreground"
											aria-label={`View ${skill.name}`}
										>
											<Eye size={12} />
										</button>
										<button
											type="button"
											onClick={() => onRemove(skill)}
											className="shrink-0 text-muted-foreground/40 transition-colors hover:text-red-500"
											aria-label={`Remove ${skill.name}`}
										>
											<X size={12} />
										</button>
									</div>
								))
							) : (
								<p className="px-3 py-2 text-[11px] text-muted-foreground">
									No skills attached yet.
								</p>
							)}
						</div>
						<button
							type="button"
							onClick={() => {
								setOpen(false);
								setBrowseOpen(true);
							}}
							className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted"
						>
							<Plus size={12} />
							Browse skills…
						</button>
					</motion.div>
				)}
			</AnimatePresence>

			<SkillViewerDialog
				fullId={viewingSkillId}
				onClose={() => setViewingSkillId(null)}
			/>

			<Dialog open={browseOpen} onOpenChange={setBrowseOpen}>
				<DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden">
					<DialogHeader>
						<DialogTitle>Manage skills</DialogTitle>
					</DialogHeader>
					<div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
						<SkillsBrowser
							currentSkills={skills}
							onToggle={(skill) => {
								const exists = skills.some((s) => s.name === skill.name);
								if (exists) onRemove(skill);
								else onAdd(skill);
							}}
						/>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
