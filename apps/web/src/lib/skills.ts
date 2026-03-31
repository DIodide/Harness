/** A skill as stored in the Convex skillsIndex table. */
export interface SkillRow {
	skillId: string;
	fullId: string;
	source: string;
	description: string;
	installs: number;
}

/** Paginated response shape for skill list/search queries. */
export interface SkillsResponse {
	rows: SkillRow[];
	total: number;
	offset: number;
	limit: number;
}

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
			fullId: "vercel-labs/agent-skills/vercel-react-best-practices",
			skillId: "vercel-react-best-practices",
			source: "vercel-labs/agent-skills",
			description: "",
			installs: 263727,
		},
	},
	{
		id: "brainstorming",
		skill: {
			fullId: "obra/superpowers/brainstorming",
			skillId: "brainstorming",
			source: "obra/superpowers",
			description: "",
			installs: 81413,
		},
	},
	{
		id: "agent-browser",
		skill: {
			fullId: "vercel-labs/agent-browser/agent-browser",
			skillId: "agent-browser",
			source: "vercel-labs/agent-browser",
			description: "",
			installs: 142765,
		},
	},
	{
		id: "pdf",
		skill: {
			fullId: "anthropics/skills/pdf",
			skillId: "pdf",
			source: "anthropics/skills",
			description: "",
			installs: 56560,
		},
	},
	{
		id: "systematic-debugging",
		skill: {
			fullId: "obra/superpowers/systematic-debugging",
			skillId: "systematic-debugging",
			source: "obra/superpowers",
			description: "",
			installs: 45129,
		},
	},
	{
		id: "xlsx",
		skill: {
			fullId: "anthropics/skills/xlsx",
			skillId: "xlsx",
			source: "anthropics/skills",
			description: "",
			installs: 40484,
		},
	},
	{
		id: "requesting-code-review",
		skill: {
			fullId: "obra/superpowers/requesting-code-review",
			skillId: "requesting-code-review",
			source: "obra/superpowers",
			description: "",
			installs: 36359,
		},
	},
	{
		id: "neon-postgres",
		skill: {
			fullId: "neondatabase/agent-skills/neon-postgres",
			skillId: "neon-postgres",
			source: "neondatabase/agent-skills",
			description: "",
			installs: 15318,
		},
	},
	{
		id: "git-commit",
		skill: {
			fullId: "github/awesome-copilot/git-commit",
			skillId: "git-commit",
			source: "github/awesome-copilot",
			description: "",
			installs: 19375,
		},
	},
];
