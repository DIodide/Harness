import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
	args: {},
	handler: async (ctx) => {
		return await ctx.db
			.query("harnesses")
			.filter((q) => q.eq(q.field("isActive"), true))
			.collect();
	},
});

export const get = query({
	args: { id: v.id("harnesses") },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.id);
	},
});

export const seed = mutation({
	args: {},
	handler: async (ctx) => {
		const existing = await ctx.db.query("harnesses").first();
		if (existing) return;

		await ctx.db.insert("harnesses", {
			name: "Productivity",
			description:
				"Manage your docs and tasks with Notion and Linear integration.",
			icon: "briefcase",
			color: "#06b6d4",
			mcpServers: [
				{
					name: "notion",
					url: "https://mcp.notion.com/mcp",
					authType: "oauth",
				},
				{
					name: "linear",
					url: "https://mcp.linear.app/mcp",
					authType: "oauth",
				},
			],
			isActive: true,
		});

		await ctx.db.insert("harnesses", {
			name: "Developer",
			description:
				"Code and project management with GitHub and Linear integration.",
			icon: "code",
			color: "#8b5cf6",
			mcpServers: [
				{
					name: "github",
					url: "https://api.githubcopilot.com/mcp/",
					authType: "oauth",
				},
				{
					name: "linear",
					url: "https://mcp.linear.app/mcp",
					authType: "oauth",
				},
			],
			isActive: true,
		});

		await ctx.db.insert("harnesses", {
			name: "Princeton",
			description:
				"Access Princeton OIT data sources via the JunctionEngine.",
			icon: "graduation-cap",
			color: "#f97316",
			mcpServers: [
				{
					name: "junction-engine",
					url: "https://placeholder.junction-engine.example.com/mcp",
					authType: "none",
				},
			],
			isActive: true,
		});
	},
});
