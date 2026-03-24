import type { SkillRow } from "../components/skills-browser";

/** A skill entry as stored on a harness — name + description. */
export interface SkillEntry {
	name: string;
	description: string;
}

export interface RecommendedSkill {
	id: string;
	skill: SkillRow;
}

export const RECOMMENDED_SKILLS: RecommendedSkill[] = [
	{
		id: "vercel-react-best-practices",
		skill: {
			name: "supercent-io/skills-template/vercel-react-best-practices",
			skill_name: "vercel-react-best-practices",
			description:
				"React and Next.js performance optimization guidelines from Vercel Engineering.",
			code: "npx skills add https://github.com/supercent-io/skills-template --skill vercel-react-best-practices",
		},
	},
	{
		id: "brainstorming",
		skill: {
			name: "wireless25/agentic-coding/brainstorming",
			skill_name: "brainstorming",
			description:
				"Collaborative ideation and exploration before implementation. Encourages brainstorming options and discussing trade-offs before diving into code.",
			code: "npx skills add https://github.com/wireless25/agentic-coding --skill brainstorming",
		},
	},
	{
		id: "browser-use",
		skill: {
			name: "davila7/claude-code-templates/browser-automation",
			skill_name: "browser-automation",
			description:
				"Browser automation for web testing, scraping, and agentic interactions using Playwright and Puppeteer.",
			code: "npx skills add https://github.com/davila7/claude-code-templates --skill browser-automation",
		},
	},
	{
		id: "pdf",
		skill: {
			name: "childbamboo/claude-code-marketplace-sample/pdf-vision-reader",
			skill_name: "pdf-vision-reader",
			description:
				"Converts PDF pages to images and uses vision analysis to extract content including diagrams, charts, and visual elements.",
			code: "npx skills add https://github.com/childbamboo/claude-code-marketplace-sample --skill pdf-vision-reader",
		},
	},
	{
		id: "systematic-debugging",
		skill: {
			name: "bobmatnyc/claude-mpm-skills/systematic-debugging",
			skill_name: "systematic-debugging",
			description:
				"Systematic debugging methodology emphasizing root cause analysis over quick fixes.",
			code: "npx skills add https://github.com/bobmatnyc/claude-mpm-skills --skill systematic-debugging",
		},
	},
	{
		id: "xlsx",
		skill: {
			name: "bobmatnyc/claude-mpm-skills/xlsx",
			skill_name: "xlsx",
			description: "Working with Excel files programmatically.",
			code: "npx skills add https://github.com/bobmatnyc/claude-mpm-skills --skill xlsx",
		},
	},
	{
		id: "code-review",
		skill: {
			name: "alinaqi/claude-bootstrap/code-review",
			skill_name: "code-review",
			description:
				"Mandatory code reviews via /code-review before commits and deploys.",
			code: "npx skills add https://github.com/alinaqi/claude-bootstrap --skill code-review",
		},
	},
	{
		id: "database-schema-design",
		skill: {
			name: "omer-metin/skills-for-antigravity/database-schema-design",
			skill_name: "database-schema-design",
			description:
				"Database schema design covering data modeling, migrations, relationships, and scaling patterns.",
			code: "npx skills add https://github.com/omer-metin/skills-for-antigravity --skill database-schema-design",
		},
	},
	{
		id: "git-best-practices",
		skill: {
			name: "0xbigboss/claude-code/git-best-practices",
			skill_name: "git-best-practices",
			description:
				"Git workflow patterns for commits, branching, PRs, and history management.",
			code: "npx skills add https://github.com/0xbigboss/claude-code --skill git-best-practices",
		},
	},
];
