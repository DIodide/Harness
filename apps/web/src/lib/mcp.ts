export interface McpServerEntry {
	name: string;
	url: string;
	authType: "none" | "bearer" | "oauth";
	authToken?: string;
}

export interface PresetMcpDefinition {
	id: string;
	name: string;
	description: string;
	iconName: string;
	category: string;
}

export const PRESET_MCPS: PresetMcpDefinition[] = [
	{
		id: "github",
		name: "GitHub",
		description: "Repos, issues, pull requests, and code search",
		iconName: "GitBranch",
		category: "dev",
	},
	{
		id: "postgres",
		name: "PostgreSQL",
		description: "Query and manage relational database tables",
		iconName: "Database",
		category: "data",
	},
	{
		id: "slack",
		name: "Slack",
		description: "Send messages and read channel history",
		iconName: "MessageSquare",
		category: "comms",
	},
	{
		id: "notion",
		name: "Notion",
		description: "Read and write pages, databases, and blocks",
		iconName: "FileText",
		category: "productivity",
	},
	{
		id: "linear",
		name: "Linear",
		description: "Issues, projects, and engineering workflows",
		iconName: "Box",
		category: "dev",
	},
	{
		id: "google-drive",
		name: "Google Drive",
		description: "Browse, read, and manage files and documents",
		iconName: "Cloud",
		category: "productivity",
	},
	{
		id: "stripe",
		name: "Stripe",
		description: "Payments, subscriptions, and billing data",
		iconName: "BarChart2",
		category: "finance",
	},
	{
		id: "jira",
		name: "Jira",
		description: "Agile sprints, tickets, and release tracking",
		iconName: "Calendar",
		category: "dev",
	},
	{
		id: "figma",
		name: "Figma",
		description: "Design files, components, and prototypes",
		iconName: "Globe",
		category: "design",
	},
	{
		id: "aws",
		name: "AWS",
		description: "Cloud infrastructure, S3, Lambda, and more",
		iconName: "Cloud",
		category: "infra",
	},
	{
		id: "zapier",
		name: "Zapier",
		description: "Trigger and manage cross-app automations",
		iconName: "Zap",
		category: "automation",
	},
	{
		id: "openapi",
		name: "OpenAPI",
		description: "Connect any REST API via OpenAPI spec",
		iconName: "Code2",
		category: "dev",
	},
	{
		id: "browserbase",
		name: "Browserbase",
		description: "Browse the web and interact with live pages",
		iconName: "Bot",
		category: "automation",
	},
];
