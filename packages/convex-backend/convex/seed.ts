import { v } from "convex/values";
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
			content: "Yes, start with the JWT utility. We're using ES modules and TypeScript.",
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
			content: "Write comprehensive unit tests for our REST API endpoints using vitest.",
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
				"The 30-second timeout is almost certainly nginx's `proxy_read_timeout` default. Add these directives to your nginx location block:\n\n```nginx\nlocation /ws {\n    proxy_pass http://backend;\n    proxy_http_version 1.1;\n    proxy_set_header Upgrade $http_upgrade;\n    proxy_set_header Connection \"upgrade\";\n    proxy_read_timeout 86400s;\n    proxy_send_timeout 86400s;\n}\n```\n\nAlso implement ping/pong on the server side — send a ping frame every 25 seconds to keep the connection alive through any intermediary proxies.",
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
			content: "Can you explain how Kubernetes networking works at a high level?",
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
				.withIndex("by_conversation", (q) =>
					q.eq("conversationId", convo._id),
				)
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
				.withIndex("by_conversation", (q) =>
					q.eq("conversationId", convo._id),
				)
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
