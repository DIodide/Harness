import type { UserResource } from "@clerk/types";

export type McpAuthType = "none" | "bearer" | "oauth" | "tiger_junction";

export interface McpServerEntry {
	name: string;
	url: string;
	authType: McpAuthType;
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
		id: "princetoncourses",
		description:
			"Search Princeton courses, read evaluations, and explore instructors with live registrar data.",
		iconName: "https://www.google.com/s2/favicons?domain=princeton.edu&sz=64",
		category: "student",
		server: {
			name: "Princeton Courses",
			url: "https://junction-engine.tigerapps.org/princetoncourses/mcp",
			authType: "tiger_junction",
		},
	},
	{
		id: "tigerjunction",
		description:
			"Manage your course schedules — create, edit, verify conflicts, and find courses that fit.",
		iconName: "https://www.google.com/s2/favicons?domain=princeton.edu&sz=64",
		category: "student",
		server: {
			name: "TigerJunction",
			url: "https://junction-engine.tigerapps.org/junction/mcp",
			authType: "tiger_junction",
		},
	},
	{
		id: "tigersnatch",
		description:
			"Track course demand and subscribe to enrollment notifications for closed classes.",
		iconName: "https://www.google.com/s2/favicons?domain=princeton.edu&sz=64",
		category: "student",
		server: {
			name: "TigerSnatch",
			url: "https://junction-engine.tigerapps.org/snatch/mcp",
			authType: "tiger_junction",
		},
	},
	{
		id: "tigerpath",
		description:
			"Plan your 4-year course schedule, explore major requirements, and see when students typically take courses.",
		iconName: "https://www.google.com/s2/favicons?domain=princeton.edu&sz=64",
		category: "student",
		server: {
			name: "TigerPath",
			url: "https://junction-engine.tigerapps.org/path/mcp",
			authType: "tiger_junction",
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

/**
 * Extract the Princeton netid from any verified @princeton.edu email on the user's account.
 * Checks: primary email, all verified emails, and verified external accounts (Google, Microsoft, etc.).
 * Returns null if no verified Princeton email is found.
 */
export function getPrincetonNetid(
	user: UserResource | null | undefined,
): string | null {
	if (!user) return null;

	// 1. Check primary email (already verified by sign-in provider)
	const primary = user.primaryEmailAddress?.emailAddress;
	if (primary?.endsWith("@princeton.edu")) {
		return primary.split("@")[0];
	}

	// 2. Check all verified email addresses on the account
	for (const email of user.emailAddresses ?? []) {
		if (
			email.emailAddress?.endsWith("@princeton.edu") &&
			email.verification?.status === "verified"
		) {
			return email.emailAddress.split("@")[0];
		}
	}

	// 3. Check verified external accounts (Microsoft Entra ID, Google, etc.)
	const princetonExternal = user.externalAccounts?.find(
		(a) =>
			a.emailAddress?.endsWith("@princeton.edu") &&
			a.verification?.status === "verified",
	);
	if (princetonExternal) {
		return princetonExternal.emailAddress.split("@")[0];
	}

	return null;
}

/** Check whether any servers in the list require Princeton (tiger_junction) auth. */
export function hasTigerJunctionServers(servers: McpServerEntry[]): boolean {
	return servers.some((s) => s.authType === "tiger_junction");
}
