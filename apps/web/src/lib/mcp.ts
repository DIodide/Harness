export interface McpServerEntry {
	name: string;
	url: string;
	authType: "none" | "bearer" | "oauth";
	authToken?: string;
}

export interface PresetMcpDefinition {
	id: string;
	description: string;
	iconName: string;
	category: string;
	server: McpServerEntry;
}

export const PRESET_MCPS: PresetMcpDefinition[] = [
	{
		id: "github",
		description: "Repos, issues, pull requests, and code search",
		iconName: "GitBranch",
		category: "dev",
		server: {
			name: "GitHub",
			url: "https://api.githubcopilot.com/mcp/",
			authType: "oauth",
		},
	},
	{
		id: "postgres",
		description: "Query and manage relational database tables",
		iconName: "Database",
		category: "data",
		server: {
			name: "PostgreSQL",
			url: "",
			authType: "none",
		},
	},
	{
		id: "slack",
		description: "Send messages and read channel history",
		iconName: "MessageSquare",
		category: "comms",
		server: {
			name: "Slack",
			url: "https://mcp.slack.com/sse",
			authType: "oauth",
		},
	},
	{
		id: "notion",
		description: "Read and write pages, databases, and blocks",
		iconName: "FileText",
		category: "productivity",
		server: {
			name: "Notion",
			url: "https://mcp.notion.com/sse",
			authType: "oauth",
		},
	},
	{
		id: "linear",
		description: "Issues, projects, and engineering workflows",
		iconName: "Box",
		category: "dev",
		server: {
			name: "Linear",
			url: "https://mcp.linear.app/mcp",
			authType: "oauth",
		},
	},
	{
		id: "google-drive",
		description: "Browse, read, and manage files and documents",
		iconName: "Cloud",
		category: "productivity",
		server: {
			name: "Google Drive",
			url: "https://mcp.googleapis.com/drive/sse",
			authType: "oauth",
		},
	},
	{
		id: "stripe",
		description: "Payments, subscriptions, and billing data",
		iconName: "BarChart2",
		category: "finance",
		server: {
			name: "Stripe",
			url: "https://mcp.stripe.com/sse",
			authType: "bearer",
		},
	},
	{
		id: "jira",
		description: "Agile sprints, tickets, and release tracking",
		iconName: "Calendar",
		category: "dev",
		server: {
			name: "Jira",
			url: "https://mcp.atlassian.com/jira/sse",
			authType: "oauth",
		},
	},
	{
		id: "figma",
		description: "Design files, components, and prototypes",
		iconName: "Globe",
		category: "design",
		server: {
			name: "Figma",
			url: "https://mcp.figma.com/sse",
			authType: "oauth",
		},
	},
	{
		id: "aws",
		description: "Cloud infrastructure, S3, Lambda, and more",
		iconName: "Cloud",
		category: "infra",
		server: {
			name: "AWS",
			url: "https://mcp.amazonaws.com/sse",
			authType: "bearer",
		},
	},
	{
		id: "zapier",
		description: "Trigger and manage cross-app automations",
		iconName: "Zap",
		category: "automation",
		server: {
			name: "Zapier",
			url: "https://mcp.zapier.com/sse",
			authType: "oauth",
		},
	},
	{
		id: "openapi",
		description: "Connect any REST API via OpenAPI spec",
		iconName: "Code2",
		category: "dev",
		server: {
			name: "OpenAPI",
			url: "",
			authType: "none",
		},
	},
	{
		id: "browserbase",
		description: "Browse the web and interact with live pages",
		iconName: "Bot",
		category: "automation",
		server: {
			name: "Browserbase",
			url: "https://mcp.browserbase.com/sse",
			authType: "bearer",
		},
	},
];

/** Converts an array of selected preset IDs into their McpServerEntry objects. */
export function presetIdsToServerEntries(ids: string[]): McpServerEntry[] {
	return ids.flatMap((id) => {
		const preset = PRESET_MCPS.find((p) => p.id === id);
		return preset ? [preset.server] : [];
	});
}
