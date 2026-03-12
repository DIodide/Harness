export interface PresetSkillDefinition {
	id: string;
	name: string;
	description: string;
	iconName: string;
	category: string;
}

export const PRESET_SKILLS: PresetSkillDefinition[] = [
	{
		id: "coding",
		name: "Coding",
		description:
			"Write clean, secure, well-structured code with best practices for style and documentation.",
		iconName: "Code2",
		category: "engineering",
	},
	{
		id: "research",
		name: "Research",
		description:
			"Gather information from multiple sources, evaluate credibility, and synthesize findings.",
		iconName: "Search",
		category: "knowledge",
	},
	{
		id: "writing",
		name: "Writing",
		description:
			"Draft clear, well-organized documents, emails, and technical content.",
		iconName: "FileText",
		category: "communication",
	},
	{
		id: "analysis",
		name: "Data Analysis",
		description:
			"Analyze datasets, identify trends, and present insights with appropriate visualizations.",
		iconName: "BarChart2",
		category: "knowledge",
	},
	{
		id: "debugging",
		name: "Debugging",
		description:
			"Systematically isolate bugs, trace root causes, and verify fixes across the stack.",
		iconName: "Bug",
		category: "engineering",
	},
	{
		id: "devops",
		name: "DevOps",
		description:
			"Manage infrastructure, CI/CD pipelines, containers, and deployment workflows.",
		iconName: "Server",
		category: "engineering",
	},
];

/** Converts an array of selected preset IDs into their skill names. */
export function presetIdsToSkillNames(ids: string[]): string[] {
	return ids.flatMap((id) => {
		const skill = PRESET_SKILLS.find((s) => s.id === id);
		return skill ? [skill.name] : [];
	});
}
