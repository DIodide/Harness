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
		id: "junctionengine",
		description:
			"Get Princeton course information with live registrar data and student reviews.",
		iconName: "https://www.google.com/s2/favicons?domain=princeton.edu&sz=64",
		category: "student",
		server: {
			name: "Junction Engine",
			url: "https://junction-engine.tigerapps.org/mcp",
			authType: "none",
		},
	},
	{
		id: "github",
		description:
			"Browse repos, manage issues and pull requests, and search code.",
		iconName: "github",
		category: "dev",
		server: {
			name: "GitHub",
			url: "https://api.githubcopilot.com/mcp/",
			authType: "oauth",
		},
	},
	{
		id: "notion",
		description:
			"Read and write pages, databases, and blocks in your workspace.",
		iconName: "notion",
		category: "productivity",
		server: {
			name: "Notion",
			url: "https://mcp.notion.com/mcp",
			authType: "oauth",
		},
	},
	{
		id: "linear",
		description:
			"Create and track issues, manage projects, and streamline engineering workflows.",
		iconName: "linear",
		category: "productivity",
		server: {
			name: "Linear",
			url: "https://mcp.linear.app/mcp",
			authType: "oauth",
		},
	},
	{
		id: "slack",
		description:
			"(wait until deployed)Send messages, read channel history, and search conversations.",
		iconName: "slack",
		category: "comms",
		server: {
			name: "Slack",
			url: "https://mcp.slack.com/mcp",
			authType: "oauth",
		},
	},
	// Not supported for none VIPs yet
	// {
	// 	id: "figma",
	// 	description: "Inspect design files, components, and prototypes.",
	// 	iconName: "figma",
	// 	category: "design",
	// 	server: {
	// 		name: "Figma",
	// 		url: "https://mcp.figma.com/mcp",
	// 		authType: "oauth",
	// 	},
	// },
	// looks like a pain
	// {
	// 	id: "cloudflare",
	// 	description: "Manage Workers, KV, R2, and DNS records.",
	// 	iconName: "cloudflare",
	// 	category: "dev",
	// 	server: {
	// 		name: "Cloudflare",
	// 		url: "https://mcp.cloudflare.com/mcp",
	// 		authType: "none",
	// 	},
	// },
	// {
	// 	id: "supabase",
	// 	description:
	// 		"Query your database, manage tables, and trigger edge functions.",
	// 	iconName: "supabase",
	// 	category: "dev",
	// 	server: {
	// 		name: "Supabase",
	// 		url: "https://mcp.supabase.com/mcp",
	// 		authType: "oauth",
	// 	},
	// },
	{
		id: "jira",
		description: "Create tickets, track sprints, and manage Agile releases.",
		iconName: "jira",
		category: "productivity",
		server: {
			name: "Jira",
			url: "https://mcp.atlassian.com/v1/mcp",
			authType: "oauth",
		},
	},
	{
		id: "awsknowledge",
		description:
			"Search AWS documentation and knowledge bases for services and best practices.",
		iconName: "https://www.google.com/s2/favicons?domain=aws.amazon.com&sz=64",
		category: "dev",
		server: {
			name: "AWS Knowledge",
			url: "https://knowledge-mcp.global.api.aws",
			authType: "none",
		},
	},
	{
		id: "exa",
		description: "AI-powered semantic web search and content retrieval.",
		iconName: "https://www.google.com/s2/favicons?domain=exa.ai&sz=64",
		category: "web",
		server: {
			name: "Exa",
			url: "https://mcp.exa.ai/mcp",
			authType: "none",
		},
	},
	{
		id: "context7",
		description:
			"Fetch up-to-date library docs and code examples for any framework.",
		iconName: "https://www.google.com/s2/favicons?domain=context7.com&sz=64",
		category: "dev",
		server: {
			name: "Context7",
			url: "https://mcp.context7.com/mcp",
			authType: "none",
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
