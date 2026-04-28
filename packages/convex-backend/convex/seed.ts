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
