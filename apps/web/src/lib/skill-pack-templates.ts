/**
 * Pre-built skill packs. Each points at a public GitHub skills repo
 * (owner/repo with skills/<name>/SKILL.md). Choosing one runs
 * api.skills.importSkillRepo to pull every skill + the repo's AGENTS.md /
 * CLAUDE.md into a new pack.
 */
export interface SkillPackTemplate {
	id: string;
	name: string;
	description: string;
	repo: string; // owner/repo
}

export const SKILL_PACK_TEMPLATES: SkillPackTemplate[] = [
	{
		id: "gsap",
		name: "GSAP",
		description:
			"GreenSock animation — core, ScrollTrigger, React, plugins, performance, utils.",
		repo: "greensock/gsap-skills",
	},
	{
		id: "anthropic",
		name: "Anthropic Skills",
		description: "Official Anthropic agent skills (pdf, xlsx, docx, pptx…).",
		repo: "anthropics/skills",
	},
	{
		id: "superpowers",
		name: "Superpowers",
		description:
			"obra/superpowers — brainstorming, systematic debugging, code review.",
		repo: "obra/superpowers",
	},
	{
		id: "vercel",
		name: "Vercel Agent Skills",
		description: "Vercel Labs — React best practices and agent tooling.",
		repo: "vercel-labs/agent-skills",
	},
];
