import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

export const seedAll = internalMutation({
	args: { userId: v.string() },
	handler: async (ctx, { userId }) => {
		const existing = await ctx.db
			.query("harnesses")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();
		if (existing) {
			throw new Error(
				"User already has data. Run clearAll first if you want to reseed.",
			);
		}

		const h1 = await ctx.db.insert("harnesses", {
			name: "Coding Assistant",
			model: "claude-sonnet-4.6",
			status: "started",
			mcpServers: [],
			skills: [
				{ name: "coding", description: "General coding assistance" },
				{ name: "debugging", description: "Debugging and troubleshooting" },
				{ name: "devops", description: "DevOps and infrastructure" },
			],
			userId,
			lastUsedAt: Date.now(),
		});

		const h2 = await ctx.db.insert("harnesses", {
			name: "Research Agent",
			model: "gpt-5.4",
			status: "started",
			mcpServers: [],
			skills: [
				{ name: "research", description: "Research and analysis" },
				{ name: "writing", description: "Technical writing" },
			],
			userId,
			lastUsedAt: Date.now() - 86400000,
		});

		await ctx.db.insert("harnesses", {
			name: "DevOps Helper",
			model: "gemini-3.1-pro",
			status: "stopped",
			mcpServers: [],
			skills: [{ name: "devops", description: "DevOps and infrastructure" }],
			userId,
			lastUsedAt: Date.now() - 172800000,
		});

		await ctx.db.insert("harnesses", {
			name: "Data Pipeline",
			model: "gpt-5.4",
			status: "stopped",
			mcpServers: [],
			skills: [{ name: "analysis", description: "Data analysis" }],
			userId,
			lastUsedAt: Date.now() - 259200000,
		});

		await ctx.db.insert("harnesses", {
			name: "Content Writer",
			model: "claude-opus-4.7",
			status: "draft",
			mcpServers: [],
			skills: [
				{ name: "writing", description: "Technical writing" },
				{ name: "research", description: "Research and analysis" },
			],
			userId,
		});

		const c1 = await ctx.db.insert("conversations", {
			title: "Help me refactor the auth module",
			lastHarnessId: h1,
			userId,
			lastMessageAt: Date.now() - 1800000,
		});

		await ctx.db.insert("messages", {
			conversationId: c1,
			role: "user",
			content:
				"I need to refactor the auth module in our Express app. Currently it uses passport.js but I want to switch to a JWT-based approach with refresh tokens.",
		});
		await ctx.db.insert("messages", {
			conversationId: c1,
			role: "assistant",
			content:
				"I can help you migrate from Passport.js to a JWT-based auth system. Here's a plan:\n\n1. **Create a JWT utility module** — sign/verify functions using `jsonwebtoken`\n2. **Add refresh token storage** — a `refresh_tokens` table with user ID, token hash, and expiry\n3. **Replace Passport middleware** — a custom `authenticate` middleware that verifies the access token\n4. **Add token rotation** — `/auth/refresh` endpoint that issues new access + refresh tokens\n\nWant me to start with the JWT utility module?",
		});
		await ctx.db.insert("messages", {
			conversationId: c1,
			role: "user",
			content:
				"Yes, start with the JWT utility. We're using ES modules and TypeScript.",
		});
		await ctx.db.insert("messages", {
			conversationId: c1,
			role: "assistant",
			content:
				'Here\'s the JWT utility module:\n\n```typescript\nimport jwt from "jsonwebtoken";\n\nconst ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;\nconst REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;\n\nexport function signAccessToken(payload: { userId: string; role: string }) {\n  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: "15m" });\n}\n\nexport function signRefreshToken(payload: { userId: string }) {\n  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: "7d" });\n}\n\nexport function verifyAccessToken(token: string) {\n  return jwt.verify(token, ACCESS_SECRET) as { userId: string; role: string };\n}\n\nexport function verifyRefreshToken(token: string) {\n  return jwt.verify(token, REFRESH_SECRET) as { userId: string };\n}\n```\n\nShall I continue with the refresh token storage layer?',
		});

		const c2 = await ctx.db.insert("conversations", {
			title: "Write unit tests for the API",
			lastHarnessId: h1,
			userId,
			lastMessageAt: Date.now() - 7200000,
		});

		await ctx.db.insert("messages", {
			conversationId: c2,
			role: "user",
			content:
				"Write comprehensive unit tests for our REST API endpoints using vitest.",
		});
		await ctx.db.insert("messages", {
			conversationId: c2,
			role: "assistant",
			content:
				"I'll set up a test suite for your REST API. I'll use vitest with supertest for HTTP assertions. Let me start by reading your route files to understand the endpoints.\n\nWhat testing patterns do you prefer — describe/it blocks or test() functions?",
		});

		const c3 = await ctx.db.insert("conversations", {
			title: "Debug the WebSocket connection",
			lastHarnessId: h1,
			userId,
			lastMessageAt: Date.now() - 90000000,
		});

		await ctx.db.insert("messages", {
			conversationId: c3,
			role: "user",
			content:
				"My WebSocket connections keep dropping after ~30 seconds. The server is behind nginx.",
		});
		await ctx.db.insert("messages", {
			conversationId: c3,
			role: "assistant",
			content:
				'The 30-second timeout is almost certainly nginx\'s `proxy_read_timeout` default. Add these directives to your nginx location block:\n\n```nginx\nlocation /ws {\n    proxy_pass http://backend;\n    proxy_http_version 1.1;\n    proxy_set_header Upgrade $http_upgrade;\n    proxy_set_header Connection "upgrade";\n    proxy_read_timeout 86400s;\n    proxy_send_timeout 86400s;\n}\n```\n\nAlso implement ping/pong on the server side — send a ping frame every 25 seconds to keep the connection alive through any intermediary proxies.',
		});

		const c4 = await ctx.db.insert("conversations", {
			title: "Explain Kubernetes networking",
			lastHarnessId: h2,
			userId,
			lastMessageAt: Date.now() - 180000000,
		});

		await ctx.db.insert("messages", {
			conversationId: c4,
			role: "user",
			content:
				"Can you explain how Kubernetes networking works at a high level?",
		});
		await ctx.db.insert("messages", {
			conversationId: c4,
			role: "assistant",
			content:
				"Kubernetes networking has three layers:\n\n**Pod-to-Pod:** Every pod gets its own IP. Pods on the same node communicate via a virtual bridge (cbr0). Cross-node communication uses an overlay network (Flannel, Calico, Cilium) that encapsulates packets.\n\n**Service networking:** Services get a stable ClusterIP. kube-proxy programs iptables/IPVS rules that DNAT traffic from the service IP to healthy pod IPs. This gives you load balancing and service discovery via DNS (`my-svc.my-namespace.svc.cluster.local`).\n\n**External access:** Ingress controllers (nginx, Traefik) or LoadBalancer services expose traffic outside the cluster. Ingress rules map hostnames/paths to backend services.\n\nThe key insight: Kubernetes requires a flat network where every pod can reach every other pod without NAT. The CNI plugin makes this happen.",
		});

		return { harnesses: 5, conversations: 4, messages: 12 };
	},
});

export const clearAll = internalMutation({
	args: { userId: v.string() },
	handler: async (ctx, { userId }) => {
		const harnesses = await ctx.db
			.query("harnesses")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.collect();

		const conversations = await ctx.db
			.query("conversations")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.collect();

		let messageCount = 0;
		for (const convo of conversations) {
			const messages = await ctx.db
				.query("messages")
				.withIndex("by_conversation", (q) => q.eq("conversationId", convo._id))
				.collect();
			for (const msg of messages) {
				await ctx.db.delete(msg._id);
				messageCount++;
			}
			await ctx.db.delete(convo._id);
		}

		for (const h of harnesses) {
			await ctx.db.delete(h._id);
		}

		const settings = await ctx.db
			.query("userSettings")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.unique();
		if (settings) {
			await ctx.db.delete(settings._id);
		}

		return {
			deleted: {
				harnesses: harnesses.length,
				conversations: conversations.length,
				messages: messageCount,
			},
		};
	},
});

export const clearAndReseed = internalMutation({
	args: { userId: v.string() },
	handler: async (ctx, { userId }) => {
		const harnesses = await ctx.db
			.query("harnesses")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.collect();
		const conversations = await ctx.db
			.query("conversations")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.collect();
		for (const convo of conversations) {
			const messages = await ctx.db
				.query("messages")
				.withIndex("by_conversation", (q) => q.eq("conversationId", convo._id))
				.collect();
			for (const msg of messages) {
				await ctx.db.delete(msg._id);
			}
			await ctx.db.delete(convo._id);
		}
		for (const h of harnesses) {
			await ctx.db.delete(h._id);
		}

		const settings = await ctx.db
			.query("userSettings")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.unique();
		if (settings) {
			await ctx.db.delete(settings._id);
		}

		// Re-run seed inline (can't call other mutations from a mutation)
		const h1 = await ctx.db.insert("harnesses", {
			name: "Coding Assistant",
			model: "claude-sonnet-4.6",
			status: "started",
			mcpServers: [],
			skills: [
				{ name: "coding", description: "General coding assistance" },
				{ name: "debugging", description: "Debugging and troubleshooting" },
				{ name: "devops", description: "DevOps and infrastructure" },
			],
			userId,
			lastUsedAt: Date.now(),
		});

		await ctx.db.insert("harnesses", {
			name: "Research Agent",
			model: "gpt-5.4",
			status: "started",
			mcpServers: [],
			skills: [
				{ name: "research", description: "Research and analysis" },
				{ name: "writing", description: "Technical writing" },
			],
			userId,
			lastUsedAt: Date.now() - 86400000,
		});

		await ctx.db.insert("harnesses", {
			name: "DevOps Helper",
			model: "gemini-3.1-pro",
			status: "stopped",
			mcpServers: [],
			skills: [{ name: "devops", description: "DevOps and infrastructure" }],
			userId,
			lastUsedAt: Date.now() - 172800000,
		});

		const c1 = await ctx.db.insert("conversations", {
			title: "Help me refactor the auth module",
			lastHarnessId: h1,
			userId,
			lastMessageAt: Date.now() - 1800000,
		});

		await ctx.db.insert("messages", {
			conversationId: c1,
			role: "user",
			content:
				"I need to refactor the auth module. Currently using passport.js, want to switch to JWT.",
		});
		await ctx.db.insert("messages", {
			conversationId: c1,
			role: "assistant",
			content:
				"I can help migrate from Passport.js to JWT. Here's the plan:\n\n1. Create a JWT utility module\n2. Add refresh token storage\n3. Replace Passport middleware\n4. Add token rotation\n\nWant me to start with the JWT utility?",
		});

		return { harnesses: 3, conversations: 1, messages: 2 };
	},
});

// Demo seeding for manual account testing. Pure append — does not delete
// existing data. Run `clearAll` first if you want a fresh slate. Does not
// create sandboxes (those live in Daytona and need API-side provisioning);
// the harnesses set sandboxEnabled=false and leave sandboxId unset.
//
// Invoke via:
//   CONVEX_DEPLOY_KEY=... bunx convex run seed:seedDemoForUser \
//     '{"userId":"user_..."}'
export const seedDemoForUser = internalMutation({
	args: { userId: v.string() },
	handler: async (ctx, { userId }) => {
		const now = Date.now();
		const HOUR = 60 * 60 * 1000;

		// MCP server presets — kept in sync with apps/web/src/lib/mcp.ts.
		// Auth tokens are not seeded; OAuth flows resolve on first use.
		const MCP = {
			github: {
				name: "GitHub",
				url: "https://api.githubcopilot.com/mcp/",
				authType: "oauth" as const,
			},
			notion: {
				name: "Notion",
				url: "https://mcp.notion.com/mcp",
				authType: "oauth" as const,
			},
			linear: {
				name: "Linear",
				url: "https://mcp.linear.app/mcp",
				authType: "oauth" as const,
			},
			exa: {
				name: "Exa",
				url: "https://mcp.exa.ai/mcp",
				authType: "none" as const,
			},
			context7: {
				name: "Context7",
				url: "https://mcp.context7.com/mcp",
				authType: "none" as const,
			},
			awsKnowledge: {
				name: "AWS Knowledge",
				url: "https://knowledge-mcp.global.api.aws",
				authType: "none" as const,
			},
			princetonCourses: {
				name: "Princeton Courses",
				url: "https://junction-engine.tigerapps.org/princetoncourses/mcp",
				authType: "tiger_junction" as const,
			},
			tigerJunction: {
				name: "TigerJunction",
				url: "https://junction-engine.tigerapps.org/junction/mcp",
				authType: "tiger_junction" as const,
			},
			tigerPath: {
				name: "TigerPath",
				url: "https://junction-engine.tigerapps.org/path/mcp",
				authType: "tiger_junction" as const,
			},
			tigerSnatch: {
				name: "TigerSnatch",
				url: "https://junction-engine.tigerapps.org/snatch/mcp",
				authType: "tiger_junction" as const,
			},
		};

		// Eight curated harnesses spanning the requested model lineup
		// (Sonnet 4.6, Opus 4.7, Opus 4.7 Thinking, Gemini 3.1 Flash Lite).
		// Returned in the order they're inserted so workspaces below can
		// reference them by index.
		const harnessSpecs = [
			{
				name: "Coding Copilot",
				model: "claude-sonnet-4.6",
				status: "started" as const,
				mcpServers: [MCP.github, MCP.context7],
				skills: [
					{ name: "coding", description: "General coding assistance" },
					{ name: "debugging", description: "Debugging and troubleshooting" },
				],
				systemPrompt:
					"You are a precise software engineering assistant. Prefer reading code and verifying with tools over guessing. Keep responses tight and reference file paths with line numbers when useful.",
				suggestedPrompts: [
					"Review my recent commits and flag anything risky",
					"Find every TODO/FIXME in this repo and group them by file",
					"Refactor the auth middleware to use JWT with refresh tokens",
				],
				lastUsedAt: now - 1 * HOUR,
			},
			{
				name: "Frontend Designer",
				model: "claude-opus-4.7-thinking",
				status: "started" as const,
				mcpServers: [MCP.github, MCP.context7],
				skills: [
					{
						name: "design",
						description: "UI/UX patterns and visual polish",
					},
					{ name: "frontend", description: "React, Tailwind, and CSS" },
				],
				systemPrompt:
					"You design distinctive, production-grade frontend interfaces. Think hard about typography, layout rhythm, and color before writing code. Prefer concrete component implementations over abstract suggestions.",
				suggestedPrompts: [
					"Design a pricing page that doesn't feel generic",
					"Audit my Tailwind config for inconsistent spacing scale",
					"Convert this Figma frame into a React component",
				],
				lastUsedAt: now - 2 * HOUR,
			},
			{
				name: "Research Analyst",
				model: "claude-opus-4.7",
				status: "started" as const,
				mcpServers: [MCP.exa, MCP.context7, MCP.awsKnowledge],
				skills: [
					{
						name: "research",
						description: "Deep research with citations",
					},
					{ name: "writing", description: "Long-form technical writing" },
				],
				systemPrompt:
					"You are a careful research analyst. Search the web for primary sources, cite each non-trivial claim, and flag where evidence conflicts. Prefer concrete data over vibes.",
				suggestedPrompts: [
					"Compare the latest pricing across major LLM providers",
					"Summarize the state-of-the-art in retrieval-augmented generation",
					"Research AWS Bedrock vs. self-hosting Llama 3 for our workload",
				],
				lastUsedAt: now - 3 * HOUR,
			},
			{
				name: "Quick Search",
				model: "gemini-3.1-flash-lite",
				status: "started" as const,
				mcpServers: [MCP.exa, MCP.context7],
				skills: [],
				systemPrompt:
					"You answer quick factual questions with one or two sentences. Use search tools when the answer might be time-sensitive. Avoid preambles.",
				suggestedPrompts: [
					"What changed in the latest Bun release?",
					"Look up the current AWS us-east-1 status",
					"Find the docs for Convex internalMutation",
				],
				lastUsedAt: now - 4 * HOUR,
			},
			{
				name: "DevOps Sidekick",
				model: "claude-sonnet-4.6",
				status: "started" as const,
				mcpServers: [MCP.github, MCP.awsKnowledge],
				skills: [
					{
						name: "devops",
						description: "Infrastructure, deploys, and incidents",
					},
				],
				systemPrompt:
					"You are an SRE-minded assistant. Diagnose root causes before suggesting fixes, prefer reversible operations, and call out blast radius for any destructive action.",
				suggestedPrompts: [
					"Walk me through canarying a new ECS service",
					"Why might my Lambda be throttled in us-east-1?",
					"Audit my GitHub Actions workflow for caching wins",
				],
				lastUsedAt: now - 5 * HOUR,
			},
			{
				name: "Princeton Course Planner",
				model: "claude-sonnet-4.6",
				status: "started" as const,
				mcpServers: [
					MCP.princetonCourses,
					MCP.tigerJunction,
					MCP.tigerPath,
					MCP.tigerSnatch,
				],
				skills: [],
				systemPrompt:
					"You help Princeton students plan their semester. Pull live registrar data via the TigerApps MCPs, surface scheduling conflicts, and give honest takes from course evaluations.",
				suggestedPrompts: [
					"Find me 4 COS electives that don't conflict on Tue/Thu mornings",
					"Plan a 4-year track for the SML certificate",
					"Show enrollment trends for COS 333",
				],
				lastUsedAt: now - 6 * HOUR,
			},
			{
				name: "Project Tracker",
				model: "claude-opus-4.7",
				status: "started" as const,
				mcpServers: [MCP.linear, MCP.notion, MCP.github],
				skills: [
					{
						name: "project-management",
						description: "Issue tracking and standups",
					},
				],
				systemPrompt:
					"You triage work across Linear, Notion, and GitHub. Connect related issues, surface blockers, and draft concise updates suitable for standups.",
				suggestedPrompts: [
					"Summarize what shipped this week across our repos",
					"Draft a standup update from my open Linear issues",
					"Find Notion docs that reference the inference-pipeline epic",
				],
				lastUsedAt: now - 7 * HOUR,
			},
			{
				name: "Notion Scribe",
				model: "gemini-3.1-flash-lite",
				status: "started" as const,
				mcpServers: [MCP.notion],
				skills: [
					{
						name: "writing",
						description: "Doc capture and cleanup",
					},
				],
				systemPrompt:
					"You capture meeting notes and clean up Notion pages. Be terse, structured, and faithful to source material — never invent facts.",
				suggestedPrompts: [
					"Reformat this meeting transcript into action items",
					"Tidy up the heading hierarchy on my onboarding doc",
					"Summarize the last week of changes in our team page",
				],
				lastUsedAt: now - 8 * HOUR,
			},
		];

		const harnessIds: Id<"harnesses">[] = [];
		for (const spec of harnessSpecs) {
			const id = await ctx.db.insert("harnesses", {
				name: spec.name,
				model: spec.model,
				status: spec.status,
				mcpServers: spec.mcpServers.map((s) => ({
					name: s.name,
					url: s.url,
					authType: s.authType,
				})),
				skills: spec.skills,
				systemPrompt: spec.systemPrompt,
				suggestedPrompts: spec.suggestedPrompts,
				userId,
				lastUsedAt: spec.lastUsedAt,
				sandboxEnabled: false,
			});
			harnessIds.push(id);
		}

		// Eight workspaces — one per color in WORKSPACE_COLORS, each linked
		// to a harness by index so the user lands in a usable state.
		// Order matches harnessSpecs above so colors line up sensibly.
		const workspaceSpecs: Array<{ name: string; color: string }> = [
			{ name: "Coding", color: "sky" },
			{ name: "Design Lab", color: "rose" },
			{ name: "Research", color: "lilac" },
			{ name: "Quick Lookups", color: "butter" },
			{ name: "Infra", color: "sand" },
			{ name: "Course Planning", color: "peach" },
			{ name: "Project Tracking", color: "mint" },
			{ name: "Writing", color: "blush" },
		];

		for (let i = 0; i < workspaceSpecs.length; i++) {
			const ws = workspaceSpecs[i];
			const harnessId = harnessIds[i];
			const lastUsedAt = now - (i + 1) * HOUR;
			await ctx.db.insert("workspaces", {
				userId,
				name: ws.name,
				color: ws.color,
				harnessId,
				createdAt: now,
				lastUsedAt,
			});
		}

		return {
			harnesses: harnessIds.length,
			workspaces: workspaceSpecs.length,
			sandboxesSkipped:
				"Sandboxes not seeded — provision manually via Daytona, then attach via workspaces:update or harnesses:setSandbox.",
		};
	},
});

// ---------------------------------------------------------------------------
// Mock conversation seed
// ---------------------------------------------------------------------------
//
// Populates a user account with realistic chat history that exercises every
// part of the message renderer: text, reasoning blocks (thinking models),
// inline tool_call parts with arguments + results, the legacy `toolCalls`
// summary field, per-message `usage`, an interrupted message, and varied
// `lastMessageAt` so the conversation list looks lived-in.
//
// Depends on `seedDemoForUser` having been run first — this seed reads the
// harnesses + workspaces it created and attaches conversations to them.
// If the expected harnesses aren't found, it bails with a clear message.
//
// Pure append. Run `seed:clearAll` first if you want a fresh slate.
//
// Invoke via:
//   CONVEX_DEPLOY_KEY=... bunx convex run seed:seedConversationsForUser \
//     '{"userId":"user_..."}'

type SeededToolCallPart = {
	type: "tool_call";
	tool: string;
	arguments: unknown;
	call_id: string;
	result: string;
};

type SeededMessagePart =
	| { type: "text"; content: string }
	| { type: "reasoning"; content: string }
	| SeededToolCallPart;

type SeededUsage = {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	cost: number;
};

type SeededUserMessage = {
	role: "user";
	content: string;
};

type SeededAssistantMessage = {
	role: "assistant";
	content: string;
	reasoning?: string;
	parts: SeededMessagePart[];
	model: string;
	usage: SeededUsage;
	interrupted?: boolean;
	interruptionReason?: string;
};

type SeededMessage = SeededUserMessage | SeededAssistantMessage;

type SeededConversation = {
	title: string;
	harnessName: string;
	workspaceName: string;
	minutesAgo: number;
	messages: SeededMessage[];
};

// Approximate per-1M-token rates we use to derive plausible message costs.
// Numbers don't have to be exact — the goal is realistic-looking line items.
const MODEL_RATES: Record<string, { input: number; output: number }> = {
	"claude-sonnet-4.6": { input: 3, output: 15 },
	"claude-opus-4.7": { input: 15, output: 75 },
	"claude-opus-4.7-thinking": { input: 15, output: 75 },
	"gemini-3.1-flash-lite": { input: 0.1, output: 0.4 },
};

function buildUsage(
	model: string,
	prompt: number,
	completion: number,
): SeededUsage {
	const rates = MODEL_RATES[model] ?? { input: 1, output: 5 };
	const cost = (prompt * rates.input + completion * rates.output) / 1_000_000;
	return {
		promptTokens: prompt,
		completionTokens: completion,
		totalTokens: prompt + completion,
		cost: Number(cost.toFixed(6)),
	};
}

// Extract the flat `toolCalls` summary from a parts array. The schema requires
// every field on each entry, so we coerce missing values to empty strings.
function partsToToolCalls(parts: SeededMessagePart[]) {
	return parts
		.filter((p): p is SeededToolCallPart => p.type === "tool_call")
		.map((p) => ({
			tool: p.tool,
			arguments: p.arguments,
			call_id: p.call_id,
			result: p.result,
		}));
}

export const seedConversationsForUser = internalMutation({
	args: { userId: v.string() },
	handler: async (ctx, { userId }) => {
		const harnesses = await ctx.db
			.query("harnesses")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.collect();
		const workspaces = await ctx.db
			.query("workspaces")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.collect();

		const harnessByName = new Map(harnesses.map((h) => [h.name, h._id]));
		const workspaceByName = new Map(workspaces.map((w) => [w.name, w._id]));

		const requireHarness = (name: string): Id<"harnesses"> => {
			const id = harnessByName.get(name);
			if (!id) {
				throw new Error(
					`Harness '${name}' not found for user '${userId}'. ` +
						`Run seed:seedDemoForUser first.`,
				);
			}
			return id;
		};

		const now = Date.now();
		const MINUTE = 60 * 1000;

		// Conversations are declared in chronological order from oldest to
		// newest so the time math is easy to skim. minutesAgo is converted
		// to a wall-clock lastMessageAt below.
		const seedData: SeededConversation[] = [
			// === A. Coding Copilot — auth refactor (multi-turn, GitHub tools)
			{
				title: "Migrate auth middleware from passport to JWT",
				harnessName: "Coding Copilot",
				workspaceName: "Coding",
				minutesAgo: 90,
				messages: [
					{
						role: "user",
						content:
							"I want to rip out passport.js from our Express app and switch to JWTs with refresh tokens. Can you look at the current middleware and give me a migration plan?",
					},
					{
						role: "assistant",
						content:
							"Let me pull the current auth middleware to see what we're working with.\n\nI read `src/middleware/auth.js`. Here's the migration plan:\n\n1. **JWT utility module** — `src/lib/jwt.ts` with `signAccessToken`, `signRefreshToken`, `verifyAccessToken`, `verifyRefreshToken`\n2. **Refresh token store** — new `refresh_tokens` table keyed by user ID, with token hash + expiry; old sessions table can stay until cutover\n3. **Replacement middleware** — `requireAuth` that pulls the bearer token, verifies, attaches `req.user`\n4. **Token rotation endpoint** — `POST /auth/refresh` that swaps refresh→access\n5. **Cutover plan** — flip a feature flag per route, deprecate passport once 100% rolled\n\nWant me to draft the JWT utility first?",
						parts: [
							{
								type: "text",
								content:
									"Let me pull the current auth middleware to see what we're working with.",
							},
							{
								type: "tool_call",
								tool: "GitHub__get_file_contents",
								arguments: {
									owner: "acme",
									repo: "api",
									path: "src/middleware/auth.js",
								},
								call_id: "call_01HZAUTH",
								result:
									"const passport = require('passport');\nconst LocalStrategy = require('passport-local').Strategy;\n\npassport.use(new LocalStrategy(async (username, password, done) => {\n  const user = await User.findOne({ username });\n  if (!user || !(await user.verifyPassword(password))) return done(null, false);\n  return done(null, user);\n}));\n\nmodule.exports = { authenticate: passport.authenticate('local', { session: true }) };",
							},
							{
								type: "text",
								content:
									"I read `src/middleware/auth.js`. Here's the migration plan:\n\n1. **JWT utility module** — `src/lib/jwt.ts` with `signAccessToken`, `signRefreshToken`, `verifyAccessToken`, `verifyRefreshToken`\n2. **Refresh token store** — new `refresh_tokens` table keyed by user ID, with token hash + expiry; old sessions table can stay until cutover\n3. **Replacement middleware** — `requireAuth` that pulls the bearer token, verifies, attaches `req.user`\n4. **Token rotation endpoint** — `POST /auth/refresh` that swaps refresh→access\n5. **Cutover plan** — flip a feature flag per route, deprecate passport once 100% rolled\n\nWant me to draft the JWT utility first?",
							},
						],
						model: "claude-sonnet-4.6",
						usage: buildUsage("claude-sonnet-4.6", 1840, 412),
					},
					{
						role: "user",
						content:
							"Yes — start with the JWT utility. Use TypeScript and ES modules. Put it on a feature branch.",
					},
					{
						role: "assistant",
						content:
							'Cut a feature branch and pushed the JWT utility:\n\n```typescript\n// src/lib/jwt.ts\nimport jwt from "jsonwebtoken";\n\nconst ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;\nconst REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;\n\nexport function signAccessToken(payload: { userId: string; role: string }) {\n  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: "15m" });\n}\n\nexport function signRefreshToken(payload: { userId: string }) {\n  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: "7d" });\n}\n\nexport function verifyAccessToken(token: string) {\n  return jwt.verify(token, ACCESS_SECRET) as { userId: string; role: string };\n}\n\nexport function verifyRefreshToken(token: string) {\n  return jwt.verify(token, REFRESH_SECRET) as { userId: string };\n}\n```\n\nBranch `feat/jwt-auth` is up. Want me to wire the refresh token storage layer next?',
						parts: [
							{
								type: "tool_call",
								tool: "GitHub__create_branch",
								arguments: {
									owner: "acme",
									repo: "api",
									branch: "feat/jwt-auth",
									from_branch: "main",
								},
								call_id: "call_01HZBRNCH",
								result:
									'{"ref":"refs/heads/feat/jwt-auth","object":{"sha":"7a1b2c3d4e5f6a7b8c9d0e1f","type":"commit"}}',
							},
							{
								type: "tool_call",
								tool: "GitHub__create_or_update_file",
								arguments: {
									owner: "acme",
									repo: "api",
									path: "src/lib/jwt.ts",
									branch: "feat/jwt-auth",
									message: "feat(auth): add JWT sign/verify utility",
								},
								call_id: "call_01HZJWT01",
								result:
									'{"commit":{"sha":"f0e1d2c3b4a5","html_url":"https://github.com/acme/api/commit/f0e1d2c3b4a5"}}',
							},
							{
								type: "text",
								content:
									'Cut a feature branch and pushed the JWT utility:\n\n```typescript\n// src/lib/jwt.ts\nimport jwt from "jsonwebtoken";\n\nconst ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;\nconst REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;\n\nexport function signAccessToken(payload: { userId: string; role: string }) {\n  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: "15m" });\n}\n\nexport function signRefreshToken(payload: { userId: string }) {\n  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: "7d" });\n}\n\nexport function verifyAccessToken(token: string) {\n  return jwt.verify(token, ACCESS_SECRET) as { userId: string; role: string };\n}\n\nexport function verifyRefreshToken(token: string) {\n  return jwt.verify(token, REFRESH_SECRET) as { userId: string };\n}\n```\n\nBranch `feat/jwt-auth` is up. Want me to wire the refresh token storage layer next?',
							},
						],
						model: "claude-sonnet-4.6",
						usage: buildUsage("claude-sonnet-4.6", 2310, 538),
					},
				],
			},
			// === B. Frontend Designer (thinking) — pricing page redesign
			{
				title: "Pricing page redesign — typography + layout",
				harnessName: "Frontend Designer",
				workspaceName: "Design Lab",
				minutesAgo: 60 * 22,
				messages: [
					{
						role: "user",
						content:
							"Our pricing page feels generic — three columns of feature checks. Help me design something distinctive without throwing out the SaaS conventions completely.",
					},
					{
						role: "assistant",
						content:
							"Pulling the frontend-design skill so I'm reasoning from our actual design language.\n\nHere's where I'd push: the *layout* can stay three-column because that's what users scan, but *typography* and *rhythm* can do all the lifting.\n\n**Typography stack**\n- Display: Fraunces (variable, optical sizes) at the tier names — gives editorial weight without feeling corporate\n- Body: Inter at 15/22 — generous line height makes feature lists breathable\n- Numerics: Tabular figures on the price; this is the single thing that reads as \"professional\" instantly\n\n**Layout moves**\n- Drop the card borders entirely — use background tone alone (warm cream, neutral, near-black for the recommended tier)\n- Asymmetric scale: middle tier 12% taller than its neighbors, not centered horizontally — slight offset right\n- Feature checks become small caps labels with a single hairline rule between groups\n\n**One distinctive thing**\nReplace the \"Most popular\" badge with a marginal annotation — set in italic Fraunces, hanging in the left margin like a footnote. Read once, never seen on other SaaS pricing pages.\n\nWant me to mock the middle (recommended) tier first?",
						reasoning:
							"The user wants distinctive pricing without abandoning conventions. The convention exists because it works for scanning — three cards, price, features, CTA. So I shouldn't fight that. Where I have room: typography (the single biggest lever for premium-feeling SaaS), color tonality (away from gradient/neon defaults), and one small unexpected detail (the marginal annotation idea — references editorial design without being pastiche). I should be opinionated and concrete; the model often hedges with 'consider...' but the user wants direction.",
						parts: [
							{
								type: "reasoning",
								content:
									"The user wants distinctive pricing without abandoning conventions. The convention exists because it works for scanning — three cards, price, features, CTA. So I shouldn't fight that. Where I have room: typography (the single biggest lever for premium-feeling SaaS), color tonality (away from gradient/neon defaults), and one small unexpected detail (the marginal annotation idea — references editorial design without being pastiche). I should be opinionated and concrete; the model often hedges with 'consider...' but the user wants direction.",
							},
							{
								type: "text",
								content:
									"Pulling the frontend-design skill so I'm reasoning from our actual design language.",
							},
							{
								type: "tool_call",
								tool: "get_skill_content",
								arguments: { name: "anthropics/skills/frontend-design" },
								call_id: "call_01HZSKILLF",
								result:
									"---\nname: frontend-design\ndescription: Create distinctive, production-grade frontend interfaces with high design quality.\n---\n\n# Principles\n\n1. Avoid AI defaults: gradients, glass-morphism, generic blue.\n2. Lean into typography — display + body + numerics.\n3. Asymmetry is interesting; perfect centering is forgettable.\n4. Use color sparingly — one accent, one neutral scale.\n5. Production code: Tailwind utility classes, no styled-components.",
							},
							{
								type: "tool_call",
								tool: "Context7__get-library-docs",
								arguments: {
									context7CompatibleLibraryID: "fontsource/fraunces",
									topic: "variable font axes",
									tokens: 2000,
								},
								call_id: "call_01HZCTX7A",
								result:
									"Fraunces is a variable font with axes for opsz (9-144), wght (100-900), and SOFT (0-100). For display sizes use opsz=72-96 with wght=600. For inline italics use slnt=-10. Loading the variable file (Fraunces[opsz,wght].woff2) is ~75KB gzip.",
							},
							{
								type: "text",
								content:
									'Here\'s where I\'d push: the *layout* can stay three-column because that\'s what users scan, but *typography* and *rhythm* can do all the lifting.\n\n**Typography stack**\n- Display: Fraunces (variable, optical sizes) at the tier names — gives editorial weight without feeling corporate\n- Body: Inter at 15/22 — generous line height makes feature lists breathable\n- Numerics: Tabular figures on the price; this is the single thing that reads as "professional" instantly\n\n**Layout moves**\n- Drop the card borders entirely — use background tone alone (warm cream, neutral, near-black for the recommended tier)\n- Asymmetric scale: middle tier 12% taller than its neighbors, not centered horizontally — slight offset right\n- Feature checks become small caps labels with a single hairline rule between groups\n\n**One distinctive thing**\nReplace the "Most popular" badge with a marginal annotation — set in italic Fraunces, hanging in the left margin like a footnote. Read once, never seen on other SaaS pricing pages.\n\nWant me to mock the middle (recommended) tier first?',
							},
						],
						model: "claude-opus-4.7-thinking",
						usage: buildUsage("claude-opus-4.7-thinking", 4280, 1820),
					},
				],
			},
			// === C. Research Analyst — LLM provider comparison
			{
				title: "LLM pricing — Claude vs OpenAI vs Gemini, current cuts",
				harnessName: "Research Analyst",
				workspaceName: "Research",
				minutesAgo: 60 * 56,
				messages: [
					{
						role: "user",
						content:
							"I need a current snapshot of frontier LLM pricing across Anthropic, OpenAI, and Google for our Q2 budget proposal. Input + output rates, context windows, anything that matters. Cite sources.",
					},
					{
						role: "assistant",
						content:
							'Searched primary sources for current pricing. Here\'s the snapshot — all rates per 1M tokens, USD, as of search results below.\n\n| Provider | Model | Input | Output | Context |\n|---|---|---|---|---|\n| Anthropic | Claude Opus 4.7 | $15 | $75 | 1M (extended) |\n| Anthropic | Claude Sonnet 4.6 | $3 | $15 | 200K |\n| OpenAI | GPT-5.5 | $5 | $20 | 256K |\n| OpenAI | GPT-5.4 | $2.50 | $10 | 128K |\n| Google | Gemini 3.1 Pro | $1.25 | $5 | 1M |\n| Google | Gemini 3.1 Flash Lite | $0.10 | $0.40 | 1M |\n\n**Things that matter for budgeting**\n\n1. **Output is the bigger lever.** For agentic workloads, output dominates spend (3–5× input on average). Opus 4.7\'s $75/M output is the line item to watch.\n2. **Cache vs no-cache.** Anthropic\'s prompt caching cuts input by 90% on cache hits — relevant if you\'re repeatedly sending the same system prompt + context. OpenAI auto-caches on `>=1024` token prefixes.\n3. **Context price.** Gemini\'s 1M window is now standard for the family; OpenAI charges flat across context length, Anthropic ramps after 200K.\n\n**Caveats**\nAll three providers run private discount tiers for committed spend ("capacity reservations" on Google, "Scale" tier on Anthropic, "Enterprise" on OpenAI). The rate card is the floor — assume 15-30% better at scale.\n\nSources cited above; raw search results follow.',
						parts: [
							{
								type: "text",
								content: "Searching for current pricing data.",
							},
							{
								type: "tool_call",
								tool: "Exa__web_search_exa",
								arguments: {
									query: "Anthropic Claude API pricing per million tokens 2026",
									numResults: 5,
								},
								call_id: "call_01HZRES01",
								result:
									'[{"title":"Pricing — Anthropic","url":"https://www.anthropic.com/pricing","snippet":"Claude Opus 4.7: $15 input / $75 output per million tokens. Claude Sonnet 4.6: $3 input / $15 output. Prompt caching: 90% input discount on cache reads. Extended context (>200K) charged at 2x base."},{"title":"Anthropic announces Claude 4.7 — TechCrunch","url":"https://techcrunch.com/2026/03/...","snippet":"Opus 4.7 expands context to 1M tokens for select customers..."}]',
							},
							{
								type: "tool_call",
								tool: "Exa__web_search_exa",
								arguments: {
									query: "OpenAI GPT-5.5 GPT-5.4 API pricing context window",
									numResults: 5,
								},
								call_id: "call_01HZRES02",
								result:
									'[{"title":"OpenAI Pricing","url":"https://openai.com/api/pricing/","snippet":"GPT-5.5: $5/$20 per 1M input/output tokens, 256K context. GPT-5.4: $2.50/$10, 128K context. Cached input prices reduced 50%. Batch API: 50% discount, 24h SLA."}]',
							},
							{
								type: "tool_call",
								tool: "Exa__web_search_exa",
								arguments: {
									query:
										"Google Gemini 3.1 Pro Flash Lite API pricing token cost",
									numResults: 5,
								},
								call_id: "call_01HZRES03",
								result:
									'[{"title":"Vertex AI Pricing","url":"https://cloud.google.com/vertex-ai/pricing","snippet":"Gemini 3.1 Pro: $1.25/$5 per 1M tokens. Gemini 3.1 Flash Lite: $0.10/$0.40 per 1M. All Gemini 3 models support 1M context. Context caching via Vertex AI: $0.025/M tokens/hour storage."}]',
							},
							{
								type: "tool_call",
								tool: "AWS_Knowledge__search",
								arguments: {
									query: "AWS Bedrock pricing Claude Opus comparison",
								},
								call_id: "call_01HZRESAWS",
								result:
									"AWS Bedrock charges the same model rates as the upstream provider. Cross-region inference adds no premium. Bedrock provides reserved capacity (Provisioned Throughput) at ~30% discount for sustained load (model unit purchases, hourly).",
							},
							{
								type: "text",
								content:
									'Here\'s the snapshot — all rates per 1M tokens, USD, as of search results below.\n\n| Provider | Model | Input | Output | Context |\n|---|---|---|---|---|\n| Anthropic | Claude Opus 4.7 | $15 | $75 | 1M (extended) |\n| Anthropic | Claude Sonnet 4.6 | $3 | $15 | 200K |\n| OpenAI | GPT-5.5 | $5 | $20 | 256K |\n| OpenAI | GPT-5.4 | $2.50 | $10 | 128K |\n| Google | Gemini 3.1 Pro | $1.25 | $5 | 1M |\n| Google | Gemini 3.1 Flash Lite | $0.10 | $0.40 | 1M |\n\n**Things that matter for budgeting**\n\n1. **Output is the bigger lever.** For agentic workloads, output dominates spend (3–5× input on average). Opus 4.7\'s $75/M output is the line item to watch.\n2. **Cache vs no-cache.** Anthropic\'s prompt caching cuts input by 90% on cache hits — relevant if you\'re repeatedly sending the same system prompt + context. OpenAI auto-caches on `>=1024` token prefixes.\n3. **Context price.** Gemini\'s 1M window is now standard for the family; OpenAI charges flat across context length, Anthropic ramps after 200K.\n\n**Caveats**\nAll three providers run private discount tiers for committed spend ("capacity reservations" on Google, "Scale" tier on Anthropic, "Enterprise" on OpenAI). The rate card is the floor — assume 15-30% better at scale.\n\nSources cited above; raw search results follow.',
							},
						],
						model: "claude-opus-4.7",
						usage: buildUsage("claude-opus-4.7", 6420, 2840),
					},
					{
						role: "user",
						content:
							"Good. What's the breakeven point where Bedrock Provisioned Throughput beats on-demand for Sonnet 4.6?",
					},
					{
						role: "assistant",
						content:
							"On AWS Bedrock, Provisioned Throughput (PT) is sold in *model units*. Each PT unit guarantees a fixed tokens/min throughput; PT is billed hourly regardless of utilization, while on-demand is per-token.\n\nFor Sonnet 4.6 on Bedrock (as of last published rates):\n- On-demand: $3/$15 per 1M tokens\n- 1-month PT commitment: ~$32/hr per model unit (~150K output tok/min throughput)\n- 6-month PT: ~$22/hr per model unit\n\n**Breakeven (1-month PT, output-heavy workload, $15/M):**\n$32/hr × 730 hr/month = $23,360/month fixed.\n$23,360 / ($15/M output) = ~1.55B output tokens/month before PT pays off.\n\n**Breakeven (6-month PT):** ~1.07B output tokens/month.\n\n**Practical read:** PT only makes sense for production workloads sustaining tens of millions of output tokens per day, every day. Below that, the unused capacity penalty buries the per-token savings. For burstier or unpredictable workloads, stick with on-demand and accept the headline rate.",
						model: "claude-opus-4.7",
						usage: buildUsage("claude-opus-4.7", 7180, 720),
						parts: [
							{
								type: "text",
								content:
									"On AWS Bedrock, Provisioned Throughput (PT) is sold in *model units*. Each PT unit guarantees a fixed tokens/min throughput; PT is billed hourly regardless of utilization, while on-demand is per-token.\n\nFor Sonnet 4.6 on Bedrock (as of last published rates):\n- On-demand: $3/$15 per 1M tokens\n- 1-month PT commitment: ~$32/hr per model unit (~150K output tok/min throughput)\n- 6-month PT: ~$22/hr per model unit\n\n**Breakeven (1-month PT, output-heavy workload, $15/M):**\n$32/hr × 730 hr/month = $23,360/month fixed.\n$23,360 / ($15/M output) = ~1.55B output tokens/month before PT pays off.\n\n**Breakeven (6-month PT):** ~1.07B output tokens/month.\n\n**Practical read:** PT only makes sense for production workloads sustaining tens of millions of output tokens per day, every day. Below that, the unused capacity penalty buries the per-token savings. For burstier or unpredictable workloads, stick with on-demand and accept the headline rate.",
							},
						],
					},
				],
			},
			// === D. Quick Search — Bun release notes (snap)
			{
				title: "What changed in the latest Bun release",
				harnessName: "Quick Search",
				workspaceName: "Quick Lookups",
				minutesAgo: 60 * 5,
				messages: [
					{
						role: "user",
						content: "What's new in the latest Bun release?",
					},
					{
						role: "assistant",
						content:
							"Bun 1.3.4 (latest):\n\n- `bun install` now uses a content-addressable global cache — reinstalls across projects are 30-50% faster.\n- Native SQLite driver added under `bun:sqlite` with full WAL mode and FTS5 support.\n- HTTP server gained `Bun.serve({ tls })` with automatic HTTP/3 negotiation.\n- Fixed a long-standing memory leak in `fetch()` keep-alive pools.\n- Node-API compatibility bumped to v9; `better-sqlite3` and `bcrypt` now load without rebuilds.",
						parts: [
							{
								type: "tool_call",
								tool: "Exa__web_search_exa",
								arguments: {
									query: "Bun 1.3 release notes changelog 2026",
									numResults: 3,
								},
								call_id: "call_01HZBUN01",
								result:
									'[{"title":"Bun v1.3.4 — Bun Blog","url":"https://bun.sh/blog/bun-v1.3.4","snippet":"Bun 1.3.4 ships a new content-addressable install cache, native bun:sqlite, HTTP/3 in Bun.serve, and Node-API v9 compatibility. Install ~40% faster on repeat installs."}]',
							},
							{
								type: "text",
								content:
									"Bun 1.3.4 (latest):\n\n- `bun install` now uses a content-addressable global cache — reinstalls across projects are 30-50% faster.\n- Native SQLite driver added under `bun:sqlite` with full WAL mode and FTS5 support.\n- HTTP server gained `Bun.serve({ tls })` with automatic HTTP/3 negotiation.\n- Fixed a long-standing memory leak in `fetch()` keep-alive pools.\n- Node-API compatibility bumped to v9; `better-sqlite3` and `bcrypt` now load without rebuilds.",
							},
						],
						model: "gemini-3.1-flash-lite",
						usage: buildUsage("gemini-3.1-flash-lite", 1240, 280),
					},
				],
			},
			// === E. DevOps Sidekick — Lambda throttling
			{
				title: "Lambda throttling spike in us-east-1",
				harnessName: "DevOps Sidekick",
				workspaceName: "Infra",
				minutesAgo: 60 * 8,
				messages: [
					{
						role: "user",
						content:
							"My `inference-router` Lambda is throwing 429s in us-east-1 since this morning. Concurrency limit at 1000, peaking around 700. What am I missing?",
					},
					{
						role: "assistant",
						content:
							"Pulled the AWS docs on Lambda concurrency. The 1000 limit you see is the *account-level* unreserved concurrency — that pool is shared across **all** functions in the account that don't have reserved concurrency configured.\n\nIf any other function (cron job, log processor, async fanout) burst at the same time, they eat into the 1000 even though `inference-router` peaked at 700.\n\nLook for:\n\n1. **CloudWatch → Lambda → Account concurrent executions metric** — if this hit 1000, that's your smoking gun.\n2. Other Lambdas in the same account/region. Especially anything triggered by SQS or EventBridge.\n3. Provisioned concurrency on `inference-router` itself: setting reserved concurrency = 800 carves it out of the shared pool *and* protects it from noisy neighbors.\n\n**Fix path**\n- Short-term: bump the account-level limit (request via Service Quotas, default 1000 → 5000 is usually granted within an hour)\n- Right-term: set reserved concurrency on `inference-router` so it has a dedicated 800, leaving 200 for everything else\n\nWant me to check what other functions in this account were active at the time?",
						parts: [
							{
								type: "tool_call",
								tool: "AWS_Knowledge__search",
								arguments: {
									query:
										"Lambda 429 throttling concurrent execution limit account",
								},
								call_id: "call_01HZAWS01",
								result:
									"AWS Lambda enforces concurrent execution limits at two levels: (1) account-level (default 1000 per region, shared across all functions without reserved concurrency), and (2) function-level (reserved concurrency, optional). 429 TooManyRequestsException is thrown when *either* limit is exceeded. Reserved concurrency carves capacity out of the account pool; provisioned concurrency pre-warms execution environments. Increase via Service Quotas: L-B99A9384.",
							},
							{
								type: "text",
								content:
									"Pulled the AWS docs on Lambda concurrency. The 1000 limit you see is the *account-level* unreserved concurrency — that pool is shared across **all** functions in the account that don't have reserved concurrency configured.\n\nIf any other function (cron job, log processor, async fanout) burst at the same time, they eat into the 1000 even though `inference-router` peaked at 700.\n\nLook for:\n\n1. **CloudWatch → Lambda → Account concurrent executions metric** — if this hit 1000, that's your smoking gun.\n2. Other Lambdas in the same account/region. Especially anything triggered by SQS or EventBridge.\n3. Provisioned concurrency on `inference-router` itself: setting reserved concurrency = 800 carves it out of the shared pool *and* protects it from noisy neighbors.\n\n**Fix path**\n- Short-term: bump the account-level limit (request via Service Quotas, default 1000 → 5000 is usually granted within an hour)\n- Right-term: set reserved concurrency on `inference-router` so it has a dedicated 800, leaving 200 for everything else\n\nWant me to check what other functions in this account were active at the time?",
							},
						],
						model: "claude-sonnet-4.6",
						usage: buildUsage("claude-sonnet-4.6", 2120, 690),
					},
					{
						role: "user",
						content:
							"Yes — and check if our Terraform repo already has reserved concurrency wired up.",
					},
					{
						role: "assistant",
						content:
							"Reserved concurrency is wired in your Terraform module but **commented out** at `infra/lambda/inference_router.tf:38`:\n\n```hcl\n# reserved_concurrent_executions = 800   # disabled 2025-11-12 during cost cutdown\n```\n\nThat's almost certainly the regression — someone disabled it during a cost-cutting pass and never re-enabled it after traffic recovered.\n\n**Recommended action**\n1. Uncomment the line, set to 800.\n2. Verify the account quota is still at 1000 — if so, request 2000 to give yourself headroom.\n3. Add a CloudWatch alarm on `ConcurrentExecutions` >= 80% of reserved.\n\nI can open a PR on the Terraform repo if you want.",
						parts: [
							{
								type: "tool_call",
								tool: "GitHub__get_file_contents",
								arguments: {
									owner: "acme",
									repo: "infra",
									path: "lambda/inference_router.tf",
								},
								call_id: "call_01HZTF01",
								result:
									'resource "aws_lambda_function" "inference_router" {\n  function_name = "inference-router"\n  runtime       = "python3.12"\n  handler       = "app.lambda_handler"\n  memory_size   = 1024\n  timeout       = 30\n\n  # reserved_concurrent_executions = 800   # disabled 2025-11-12 during cost cutdown\n\n  environment {\n    variables = {\n      OPENAI_API_KEY = var.openai_api_key\n    }\n  }\n}',
							},
							{
								type: "text",
								content:
									"Reserved concurrency is wired in your Terraform module but **commented out** at `infra/lambda/inference_router.tf:38`:\n\n```hcl\n# reserved_concurrent_executions = 800   # disabled 2025-11-12 during cost cutdown\n```\n\nThat's almost certainly the regression — someone disabled it during a cost-cutting pass and never re-enabled it after traffic recovered.\n\n**Recommended action**\n1. Uncomment the line, set to 800.\n2. Verify the account quota is still at 1000 — if so, request 2000 to give yourself headroom.\n3. Add a CloudWatch alarm on `ConcurrentExecutions` >= 80% of reserved.\n\nI can open a PR on the Terraform repo if you want.",
							},
						],
						model: "claude-sonnet-4.6",
						usage: buildUsage("claude-sonnet-4.6", 2710, 480),
					},
				],
			},
			// === F. Princeton Course Planner — Spring 2026
			{
				title: "Plan Spring 2026 — COS electives + SML cert",
				harnessName: "Princeton Course Planner",
				workspaceName: "Course Planning",
				minutesAgo: 60 * 36,
				messages: [
					{
						role: "user",
						content:
							"Help me plan Spring 2026. I'm finishing the SML certificate and need 2 more COS electives. Avoid Tuesday/Thursday 11-12:30 — I have a recurring conflict.",
					},
					{
						role: "assistant",
						content:
							"Pulled SML cert requirements + COS electives offered Spring 2026 outside your blocked slot.\n\n**SML certificate — what you're missing**\nBased on TigerPath, you've completed 4/6 SML courses (COS 324, COS 484, ORF 309, COS 226). Two left from the elective bucket.\n\n**Eligible COS electives, Spring 2026, excluding T/Th 11-12:30**\n\n| Course | Days/Time | Counts for SML | Eval avg |\n|---|---|---|---|\n| COS 433 — Cryptography | MW 1:30-2:50 | No | 4.6 |\n| COS 461 — Computer Networks | MW 11-12:20 | No | 4.4 |\n| COS 484 — NLP | TTh 1:30-2:50 | Yes | 4.7 |\n| COS 485 — Neural Networks | MW 3-4:20 | Yes | 4.5 |\n| COS 511 — Theoretical ML | TTh 3-4:20 | Yes (count once) | 4.3 |\n\nYou've already taken 484 — drop it from consideration.\n\n**Suggested pairing**\n- **COS 485 (Neural Networks)** + **COS 511 (Theoretical ML)** — both count for SML, no conflicts, complementary (485 is hands-on PyTorch, 511 is proofs)\n- Eval avg ~4.4, workload moderate (10-12 hr/wk each per evaluations)\n\nSecond option: **COS 485 + COS 461** if you want one non-SML breadth course; you'd then need to find one more SML elective in Fall 2026.\n\nWant me to check section conflicts across your other Spring courses?",
						parts: [
							{
								type: "tool_call",
								tool: "TigerPath__view_major",
								arguments: {
									major: "SML certificate",
								},
								call_id: "call_01HZTPATH",
								result:
									'{"requirements":[{"name":"Foundations","completed":true,"taken":["COS 324","ORF 309"]},{"name":"Methods","completed":true,"taken":["COS 484","COS 226"]},{"name":"Electives","completed":false,"required":2,"taken":0,"options":["COS 485","COS 511","COS 484","ORF 363","ECE 364"]}]}',
							},
							{
								type: "tool_call",
								tool: "TigerJunction__search_courses",
								arguments: {
									query: "COS",
									term: "S2026",
									department: "COS",
									level: "300+",
								},
								call_id: "call_01HZTJ01",
								result:
									'[{"code":"COS 433","title":"Cryptography","days":"MW","time":"1:30-2:50"},{"code":"COS 461","title":"Computer Networks","days":"MW","time":"11-12:20"},{"code":"COS 484","title":"Natural Language Processing","days":"TTh","time":"1:30-2:50"},{"code":"COS 485","title":"Neural Networks","days":"MW","time":"3-4:20"},{"code":"COS 511","title":"Theoretical Machine Learning","days":"TTh","time":"3-4:20"},{"code":"COS 521","title":"Advanced Algorithm Design","days":"TTh","time":"11-12:20"}]',
							},
							{
								type: "tool_call",
								tool: "PrincetonCourses__get_course_evaluations",
								arguments: { courses: ["COS 485", "COS 511"] },
								call_id: "call_01HZPC01",
								result:
									'[{"course":"COS 485","overall":4.5,"workload":11.2,"comments":["Excellent pacing.","Heavy but rewarding."]},{"course":"COS 511","overall":4.3,"workload":12.1,"comments":["Theory-heavy, prepare for proofs.","Pset-heavy."]}]',
							},
							{
								type: "text",
								content:
									"Pulled SML cert requirements + COS electives offered Spring 2026 outside your blocked slot.\n\n**SML certificate — what you're missing**\nBased on TigerPath, you've completed 4/6 SML courses (COS 324, COS 484, ORF 309, COS 226). Two left from the elective bucket.\n\n**Eligible COS electives, Spring 2026, excluding T/Th 11-12:30**\n\n| Course | Days/Time | Counts for SML | Eval avg |\n|---|---|---|---|\n| COS 433 — Cryptography | MW 1:30-2:50 | No | 4.6 |\n| COS 461 — Computer Networks | MW 11-12:20 | No | 4.4 |\n| COS 484 — NLP | TTh 1:30-2:50 | Yes | 4.7 |\n| COS 485 — Neural Networks | MW 3-4:20 | Yes | 4.5 |\n| COS 511 — Theoretical ML | TTh 3-4:20 | Yes (count once) | 4.3 |\n\nYou've already taken 484 — drop it from consideration.\n\n**Suggested pairing**\n- **COS 485 (Neural Networks)** + **COS 511 (Theoretical ML)** — both count for SML, no conflicts, complementary (485 is hands-on PyTorch, 511 is proofs)\n- Eval avg ~4.4, workload moderate (10-12 hr/wk each per evaluations)\n\nSecond option: **COS 485 + COS 461** if you want one non-SML breadth course; you'd then need to find one more SML elective in Fall 2026.\n\nWant me to check section conflicts across your other Spring courses?",
							},
						],
						model: "claude-sonnet-4.6",
						usage: buildUsage("claude-sonnet-4.6", 3640, 1280),
					},
				],
			},
			// === G. Project Tracker — weekly summary
			{
				title: "Weekly engineering summary",
				harnessName: "Project Tracker",
				workspaceName: "Project Tracking",
				minutesAgo: 60 * 14,
				messages: [
					{
						role: "user",
						content:
							"Pull together what shipped this week — Linear issues closed, PRs merged. Format as a standup-friendly summary.",
					},
					{
						role: "assistant",
						content:
							"Cross-referenced Linear and GitHub for the last 7 days.\n\n## Shipped this week\n\n**Inference pipeline (ENG-414, ENG-417, ENG-421)**\n- ENG-414: chunked streaming for long responses → PR #287, merged Tue\n- ENG-417: cost ledger backfill migration → PR #289, merged Wed\n- ENG-421: max_tokens truncation auto-continue → PR #291, merged Fri\n\n**Frontend (DSN-103, DSN-106)**\n- DSN-103: dialog max-h on short viewports → PR #293, merged Fri\n- DSN-106: skills browser pagination → PR #285, merged Mon\n\n**Infra (OPS-58)**\n- OPS-58: Lambda reserved concurrency restored → PR #292, merged Thu\n\n## In-flight\n- ENG-425: Convex schema migration for workspace search index — review pending\n- DSN-108: chat-input attachment redesign — design draft posted, no PR yet\n\n## Blockers\n- ENG-419 (Daytona snapshot persistence) — waiting on upstream Daytona ticket DTN-2204",
						parts: [
							{
								type: "tool_call",
								tool: "Linear__list_issues",
								arguments: {
									teamKey: "ENG",
									status: "Done",
									updatedAfter: "2026-04-21",
								},
								call_id: "call_01HZLIN01",
								result:
									'[{"id":"ENG-414","title":"Chunked streaming for long responses","status":"Done","completedAt":"2026-04-22"},{"id":"ENG-417","title":"Cost ledger backfill migration","status":"Done","completedAt":"2026-04-23"},{"id":"ENG-421","title":"max_tokens truncation auto-continue","status":"Done","completedAt":"2026-04-25"}]',
							},
							{
								type: "tool_call",
								tool: "Linear__list_issues",
								arguments: {
									teamKey: "DSN",
									status: "Done",
									updatedAfter: "2026-04-21",
								},
								call_id: "call_01HZLIN02",
								result:
									'[{"id":"DSN-103","title":"Dialog max-h on short viewports","status":"Done","completedAt":"2026-04-25"},{"id":"DSN-106","title":"Skills browser pagination","status":"Done","completedAt":"2026-04-21"}]',
							},
							{
								type: "tool_call",
								tool: "GitHub__list_pull_requests",
								arguments: {
									owner: "acme",
									repo: "harness",
									state: "closed",
									sort: "updated",
									perPage: 20,
								},
								call_id: "call_01HZGH01",
								result:
									'[{"number":287,"title":"feat(stream): chunked streaming","mergedAt":"2026-04-22"},{"number":289,"title":"chore(migrate): backfill usage_ledger","mergedAt":"2026-04-23"},{"number":291,"title":"fix(chat): auto-continue on max_tokens","mergedAt":"2026-04-25"},{"number":292,"title":"chore(infra): re-enable reserved concurrency","mergedAt":"2026-04-24"},{"number":293,"title":"fix(skills): cap dialog height","mergedAt":"2026-04-25"}]',
							},
							{
								type: "text",
								content:
									"Cross-referenced Linear and GitHub for the last 7 days.\n\n## Shipped this week\n\n**Inference pipeline (ENG-414, ENG-417, ENG-421)**\n- ENG-414: chunked streaming for long responses → PR #287, merged Tue\n- ENG-417: cost ledger backfill migration → PR #289, merged Wed\n- ENG-421: max_tokens truncation auto-continue → PR #291, merged Fri\n\n**Frontend (DSN-103, DSN-106)**\n- DSN-103: dialog max-h on short viewports → PR #293, merged Fri\n- DSN-106: skills browser pagination → PR #285, merged Mon\n\n**Infra (OPS-58)**\n- OPS-58: Lambda reserved concurrency restored → PR #292, merged Thu\n\n## In-flight\n- ENG-425: Convex schema migration for workspace search index — review pending\n- DSN-108: chat-input attachment redesign — design draft posted, no PR yet\n\n## Blockers\n- ENG-419 (Daytona snapshot persistence) — waiting on upstream Daytona ticket DTN-2204",
							},
						],
						model: "claude-opus-4.7",
						usage: buildUsage("claude-opus-4.7", 5120, 1480),
					},
				],
			},
			// === H. Notion Scribe — meeting notes cleanup
			{
				title: "Clean up sprint planning notes",
				harnessName: "Notion Scribe",
				workspaceName: "Writing",
				minutesAgo: 60 * 26,
				messages: [
					{
						role: "user",
						content:
							"My sprint planning page in Notion is a mess — random formatting, half-finished bullets. Can you find it and clean it up?",
					},
					{
						role: "assistant",
						content:
							'Found and cleaned the sprint planning page (Notion: Engineering / Sprint 2026-04-21).\n\n**What I changed**\n- Promoted the meeting date to an H1 and removed the inline emoji\n- Converted the mixed `-`/`*` bullet styles to a single `-` bullet\n- Grouped action items under H2 "Action items" with assignee + due date\n- Stripped half-finished sentences ("@ibraheem to investigate" with no further context — left them but added [TODO: clarify])\n- Pulled all decisions into an H2 "Decisions made" section at the top so it\'s findable later\n\nThe page is preserved verbatim except for these structural edits. No content removed.',
						parts: [
							{
								type: "tool_call",
								tool: "Notion__search",
								arguments: { query: "sprint planning" },
								call_id: "call_01HZNOTI01",
								result:
									'[{"id":"abc-123","title":"Sprint Planning 2026-04-21","parent":"Engineering","lastEdited":"2026-04-21T18:30:00Z"},{"id":"def-456","title":"Sprint Planning 2026-04-14","parent":"Engineering","lastEdited":"2026-04-14T18:30:00Z"}]',
							},
							{
								type: "tool_call",
								tool: "Notion__update-page",
								arguments: {
									pageId: "abc-123",
									operation: "replace",
								},
								call_id: "call_01HZNOTI02",
								result:
									'{"status":"updated","blocks_modified":47,"page":"Sprint Planning 2026-04-21"}',
							},
							{
								type: "text",
								content:
									'Found and cleaned the sprint planning page (Notion: Engineering / Sprint 2026-04-21).\n\n**What I changed**\n- Promoted the meeting date to an H1 and removed the inline emoji\n- Converted the mixed `-`/`*` bullet styles to a single `-` bullet\n- Grouped action items under H2 "Action items" with assignee + due date\n- Stripped half-finished sentences ("@ibraheem to investigate" with no further context — left them but added [TODO: clarify])\n- Pulled all decisions into an H2 "Decisions made" section at the top so it\'s findable later\n\nThe page is preserved verbatim except for these structural edits. No content removed.',
							},
						],
						model: "gemini-3.1-flash-lite",
						usage: buildUsage("gemini-3.1-flash-lite", 2840, 540),
					},
				],
			},
			// === I. Frontend Designer — interrupted (max_tokens reached)
			{
				title: "Build a Kanban board UI",
				harnessName: "Frontend Designer",
				workspaceName: "Design Lab",
				minutesAgo: 60 * 4,
				messages: [
					{
						role: "user",
						content:
							"Build me a full Kanban board component with drag-and-drop, swimlanes, WIP limits, and inline card editing. React + Tailwind.",
					},
					{
						role: "assistant",
						content:
							'Pulled the frontend-design skill and the dnd-kit docs to ground the implementation.\n\nLet me start with the data model and column shell:\n\n```tsx\n// src/components/kanban/Board.tsx\nimport { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";\nimport { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";\nimport { useState } from "react";\n\nexport type Card = { id: string; title: string; assignee?: string };\nexport type Column = { id: string; title: string; wipLimit?: number; cards: Card[] };\n\nexport function Board({ initial }: { initial: Column[] }) {\n  const [columns, setColumns] = useState(initial);\n\n  function onDragEnd(event: DragEndEvent) {\n    const { active, over } = event;\n    if (!over || active.id === over.id) return;\n    // ... cross-column move logic\n  }\n\n  return (\n    <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>\n      <div className="grid h-full grid-flow-col auto-cols-[20rem] gap-4 overflow-x-auto p-6">\n        {columns.map((col) => (\n          <ColumnView key={col.id} column={col} />\n        ))}\n      </div>\n    </DndContext>\n  );\n}\n```\n\nNext, the column with WIP limit indicator. I\'ll set it',
						parts: [
							{
								type: "reasoning",
								content:
									"This is a big spec — let me think about ordering. The data model first (Card, Column), then the DnD wrapper, then the column shell with WIP styling, then card edit, then swimlanes (cross-cutting groupings — usually rows of columns). I should pull the frontend-design skill and dnd-kit docs first so the example uses the actual Tailwind tokens we have.",
							},
							{
								type: "tool_call",
								tool: "get_skill_content",
								arguments: { name: "anthropics/skills/frontend-design" },
								call_id: "call_01HZKBN01",
								result:
									"---\nname: frontend-design\n---\n\n# Tokens\n- Surface: bg-background, border-border\n- Accent: bg-foreground for emphasis\n- Use auto-cols + overflow-x-auto for horizontal scroll patterns",
							},
							{
								type: "tool_call",
								tool: "Context7__get-library-docs",
								arguments: {
									context7CompatibleLibraryID: "clauderic/dnd-kit",
									topic: "sortable cross-container",
									tokens: 3500,
								},
								call_id: "call_01HZKBN02",
								result:
									"@dnd-kit/sortable supports cross-container sorting via SortableContext per container plus a shared DndContext. Use `closestCorners` collision detection for column-style layouts. The over.id will be the container id when hovering empty space, otherwise the card id over which the drag is hovering.",
							},
							{
								type: "text",
								content:
									'Pulled the frontend-design skill and the dnd-kit docs to ground the implementation.\n\nLet me start with the data model and column shell:\n\n```tsx\n// src/components/kanban/Board.tsx\nimport { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";\nimport { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";\nimport { useState } from "react";\n\nexport type Card = { id: string; title: string; assignee?: string };\nexport type Column = { id: string; title: string; wipLimit?: number; cards: Card[] };\n\nexport function Board({ initial }: { initial: Column[] }) {\n  const [columns, setColumns] = useState(initial);\n\n  function onDragEnd(event: DragEndEvent) {\n    const { active, over } = event;\n    if (!over || active.id === over.id) return;\n    // ... cross-column move logic\n  }\n\n  return (\n    <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>\n      <div className="grid h-full grid-flow-col auto-cols-[20rem] gap-4 overflow-x-auto p-6">\n        {columns.map((col) => (\n          <ColumnView key={col.id} column={col} />\n        ))}\n      </div>\n    </DndContext>\n  );\n}\n```\n\nNext, the column with WIP limit indicator. I\'ll set it',
							},
						],
						model: "claude-opus-4.7-thinking",
						usage: buildUsage("claude-opus-4.7-thinking", 3920, 16384),
						interrupted: true,
						interruptionReason: "Response truncated (max_tokens reached)",
					},
				],
			},
		];

		// Insert in order; track insertion counts for the return value.
		let conversationCount = 0;
		let messageCount = 0;
		let toolCallCount = 0;

		for (const conv of seedData) {
			const harnessId = requireHarness(conv.harnessName);
			const workspaceId = workspaceByName.get(conv.workspaceName);
			const lastMessageAt = now - conv.minutesAgo * MINUTE;

			const conversationId = await ctx.db.insert("conversations", {
				title: conv.title,
				userId,
				lastHarnessId: harnessId,
				lastMessageAt,
				...(workspaceId ? { workspaceId } : {}),
			});
			conversationCount++;

			for (const msg of conv.messages) {
				if (msg.role === "user") {
					await ctx.db.insert("messages", {
						conversationId,
						userId,
						role: "user",
						content: msg.content,
						...(workspaceId ? { workspaceId } : {}),
					});
					messageCount++;
				} else {
					const toolCalls = partsToToolCalls(msg.parts);
					toolCallCount += toolCalls.length;
					await ctx.db.insert("messages", {
						conversationId,
						userId,
						role: "assistant",
						content: msg.content,
						parts: msg.parts,
						...(toolCalls.length > 0 ? { toolCalls } : {}),
						...(msg.reasoning ? { reasoning: msg.reasoning } : {}),
						model: msg.model,
						usage: msg.usage,
						...(workspaceId ? { workspaceId } : {}),
						...(msg.interrupted
							? {
									interrupted: true,
									interruptionReason: msg.interruptionReason ?? "Interrupted",
								}
							: {}),
					});
					messageCount++;
				}
			}

			// Touch the harness's lastUsedAt so the conversation feels real
			// (the harness list orders by recency).
			await ctx.db.patch(harnessId, { lastUsedAt: lastMessageAt });
		}

		return {
			conversations: conversationCount,
			messages: messageCount,
			toolCalls: toolCallCount,
			note: "Append-only seed. Run seed:clearAll first if you want a clean slate.",
		};
	},
});
