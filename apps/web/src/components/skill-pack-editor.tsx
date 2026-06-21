import { useConvexAction } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import { Link } from "@tanstack/react-router";
import {
	ArrowLeft,
	Check,
	Eye,
	Github,
	Loader2,
	Package,
	X,
} from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import type { SkillPackTemplate } from "../lib/skill-pack-templates";
import { SKILL_PACK_TEMPLATES } from "../lib/skill-pack-templates";
import type { SkillEntry } from "../lib/skills";
import { RecommendedSkillsGrid } from "./recommended-skills-grid";
import { SkillViewerDialog } from "./skill-viewer-dialog";
import { SkillsBrowser } from "./skills-browser";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

export interface SkillPackDraft {
	name: string;
	description: string;
	skills: SkillEntry[];
	agentsMd: string;
	claudeMd: string;
	claudeImportsAgents: boolean;
}

export const EMPTY_DRAFT: SkillPackDraft = {
	name: "",
	description: "",
	skills: [],
	agentsMd: "",
	claudeMd: "",
	claudeImportsAgents: false,
};

export function SkillPackEditor({
	mode,
	initial,
	saving,
	onSave,
}: {
	mode: "new" | "edit";
	initial: SkillPackDraft;
	saving: boolean;
	onSave: (draft: SkillPackDraft) => void;
}) {
	const [name, setName] = useState(initial.name);
	const [description, setDescription] = useState(initial.description);
	const [skills, setSkills] = useState<SkillEntry[]>(initial.skills);
	const [agentsMd, setAgentsMd] = useState(initial.agentsMd);
	const [claudeMd, setClaudeMd] = useState(initial.claudeMd);
	const [claudeImportsAgents, setClaudeImportsAgents] = useState(
		initial.claudeImportsAgents,
	);
	const [viewingSkillId, setViewingSkillId] = useState<string | null>(null);

	const importRepo = useConvexAction(api.skills.importSkillRepo);
	const [repoInput, setRepoInput] = useState("");
	const [importingRepo, setImportingRepo] = useState<string | null>(null);

	const toggleSkill = (skill: SkillEntry) =>
		setSkills((prev) =>
			prev.some((s) => s.name === skill.name)
				? prev.filter((s) => s.name !== skill.name)
				: [...prev, skill],
		);

	const importFromRepo = async (
		source: string,
		template?: SkillPackTemplate,
	) => {
		const repo = source.trim();
		if (!repo || importingRepo) return;
		setImportingRepo(repo);
		try {
			const res = await importRepo({ source: repo });
			if (res.imported === 0) {
				toast.error(`No skills found in ${res.source}.`);
				return;
			}
			setSkills((prev) => {
				const seen = new Set(prev.map((s) => s.name));
				return [...prev, ...res.skills.filter((s) => !seen.has(s.name))];
			});
			// Prefill empty fields from the repo / template so a one-click import
			// yields a usable pack; never clobber what the user already typed.
			if (template && !name.trim()) setName(template.name);
			if (template && !description.trim()) setDescription(template.description);
			if (res.agentsMd && !agentsMd.trim()) setAgentsMd(res.agentsMd);
			if (res.claudeMd && !claudeMd.trim()) setClaudeMd(res.claudeMd);
			toast.success(
				`Imported ${res.imported} skill${res.imported === 1 ? "" : "s"} from ${res.source}`,
			);
			setRepoInput("");
		} catch (e) {
			// A ConvexError carries the human-readable reason on `.data`; a plain
			// Error from Convex is the masked, generic "Server Error".
			const data =
				e && typeof e === "object" && "data" in e
					? (e as { data: unknown }).data
					: undefined;
			toast.error(
				typeof data === "string"
					? data
					: e instanceof Error
						? e.message
						: "Import failed",
			);
		} finally {
			setImportingRepo(null);
		}
	};

	const handleSave = () => {
		if (!name.trim()) {
			toast.error("Pack name is required");
			return;
		}
		onSave({
			name,
			description,
			skills,
			agentsMd,
			claudeMd,
			claudeImportsAgents,
		});
	};

	return (
		<div className="flex h-full flex-col overflow-hidden bg-background">
			<header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
				<div className="flex min-w-0 items-center gap-3">
					<Button variant="ghost" size="icon-xs" asChild>
						<Link to="/skill-packs" aria-label="Back to skill packs">
							<ArrowLeft size={14} />
						</Link>
					</Button>
					<Package size={16} className="shrink-0 text-muted-foreground" />
					<h1 className="truncate text-base font-medium text-foreground">
						{mode === "new" ? "New Skill Pack" : "Edit Skill Pack"}
					</h1>
				</div>
				<Button
					size="sm"
					onClick={handleSave}
					disabled={saving || !name.trim()}
				>
					{saving ? (
						<Loader2 size={14} className="animate-spin" />
					) : (
						<Check size={14} />
					)}
					{mode === "new" ? "Create pack" : "Save changes"}
				</Button>
			</header>

			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
				{/* Left: pack form + selected skills */}
				<div className="w-full shrink-0 space-y-5 border-border p-6 lg:w-[420px] lg:overflow-y-auto lg:border-r">
					<div className="space-y-1.5">
						<label
							htmlFor="pack-name"
							className="text-xs font-medium text-foreground"
						>
							Name
						</label>
						<Input
							id="pack-name"
							placeholder="Frontend essentials"
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					</div>

					<div className="space-y-1.5">
						<label
							htmlFor="pack-desc"
							className="text-xs font-medium text-foreground"
						>
							Description{" "}
							<span className="text-muted-foreground">(optional)</span>
						</label>
						<Input
							id="pack-desc"
							placeholder="What this pack is for"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
						/>
					</div>

					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
								Skills in this pack
							</h3>
							<span className="text-[11px] text-muted-foreground">
								{skills.length}
							</span>
						</div>
						{skills.length === 0 ? (
							<p className="rounded-md border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">
								Add skills from the catalog on the right, or import a whole
								repo.
							</p>
						) : (
							<div className="space-y-1">
								{skills.map((skill) => {
									const display = skill.name.split("/").pop() ?? skill.name;
									return (
										<div
											key={skill.name}
											className="flex items-center gap-2 border border-border bg-foreground/3 px-2.5 py-1.5"
										>
											<span className="min-w-0 flex-1 truncate text-xs text-foreground">
												{display}
											</span>
											<button
												type="button"
												aria-label={`View ${display}`}
												onClick={() => setViewingSkillId(skill.name)}
												className="shrink-0 text-muted-foreground/40 transition-colors hover:text-foreground"
											>
												<Eye size={13} />
											</button>
											<button
												type="button"
												aria-label={`Remove ${display}`}
												onClick={() => toggleSkill(skill)}
												className="shrink-0 text-muted-foreground/40 transition-colors hover:text-destructive"
											>
												<X size={13} />
											</button>
										</div>
									);
								})}
							</div>
						)}
					</div>

					<div className="space-y-1.5">
						<label
							htmlFor="pack-agents"
							className="text-xs font-medium text-foreground"
						>
							AGENTS.md{" "}
							<span className="text-muted-foreground">(optional)</span>
						</label>
						<Textarea
							id="pack-agents"
							placeholder="Conventions written to <sandbox>/AGENTS.md for agentic harnesses…"
							value={agentsMd}
							onChange={(e) => setAgentsMd(e.target.value)}
							className="min-h-24 font-mono text-xs"
						/>
					</div>

					<div className="space-y-1.5">
						<label
							htmlFor="pack-claude"
							className="text-xs font-medium text-foreground"
						>
							CLAUDE.md{" "}
							<span className="text-muted-foreground">(Claude Code only)</span>
						</label>
						<Textarea
							id="pack-claude"
							placeholder="Written to <sandbox>/CLAUDE.md for Claude Code harnesses…"
							value={claudeMd}
							onChange={(e) => setClaudeMd(e.target.value)}
							className="min-h-24 font-mono text-xs"
						/>
						<label
							htmlFor="pack-import-agents"
							className="flex items-center gap-2 pt-1 text-xs text-foreground"
						>
							<Checkbox
								id="pack-import-agents"
								checked={claudeImportsAgents}
								onCheckedChange={(c) => setClaudeImportsAgents(c === true)}
							/>
							Import AGENTS.md into CLAUDE.md via{" "}
							<code className="rounded bg-muted px-1 text-[11px]">
								@AGENTS.md
							</code>
						</label>
					</div>
				</div>

				{/* Right: catalog (templates, repo import, recommended, search) */}
				<div className="flex min-w-0 flex-1 flex-col gap-5 p-6 lg:overflow-y-auto">
					{mode === "new" && (
						<section className="space-y-2">
							<h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
								Start from a template
							</h3>
							<div className="grid gap-2 sm:grid-cols-2">
								{SKILL_PACK_TEMPLATES.map((t) => (
									<button
										key={t.id}
										type="button"
										disabled={!!importingRepo}
										onClick={() => importFromRepo(t.repo, t)}
										className="flex flex-col gap-0.5 border border-border bg-foreground/3 p-2.5 text-left transition-colors hover:border-foreground/30 disabled:opacity-50"
									>
										<span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
											{importingRepo === t.repo ? (
												<Loader2 size={12} className="animate-spin" />
											) : (
												<Package size={12} />
											)}
											{t.name}
										</span>
										<span className="line-clamp-2 text-[11px] text-muted-foreground">
											{t.description}
										</span>
									</button>
								))}
							</div>
						</section>
					)}

					<section className="space-y-2">
						<h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
							Import a GitHub repo
						</h3>
						<div className="flex gap-2">
							<div className="relative flex-1">
								<Github
									size={13}
									className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 text-muted-foreground"
								/>
								<Input
									value={repoInput}
									onChange={(e) => setRepoInput(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") importFromRepo(repoInput);
									}}
									placeholder="owner/repo (e.g. greensock/gsap-skills)"
									className="pl-7"
								/>
							</div>
							<Button
								size="sm"
								variant="outline"
								disabled={!repoInput.trim() || !!importingRepo}
								onClick={() => importFromRepo(repoInput)}
							>
								{importingRepo === repoInput.trim() ? (
									<Loader2 size={14} className="animate-spin" />
								) : (
									"Import all"
								)}
							</Button>
						</div>
						<p className="text-[11px] text-muted-foreground">
							Adds every skill in the repo's <code>skills/</code> folder, plus
							its AGENTS.md / CLAUDE.md.
						</p>
					</section>

					<section className="space-y-2">
						<h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
							Recommended
						</h3>
						<RecommendedSkillsGrid selected={skills} onToggle={toggleSkill} />
					</section>

					<section className="flex min-h-0 flex-1 flex-col space-y-2">
						<h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
							Browse catalog
						</h3>
						<SkillsBrowser currentSkills={skills} onToggle={toggleSkill} />
					</section>
				</div>
			</div>

			<SkillViewerDialog
				fullId={viewingSkillId}
				onClose={() => setViewingSkillId(null)}
			/>
		</div>
	);
}
