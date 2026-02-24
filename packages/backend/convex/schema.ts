import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
	harnesses: defineTable({
		name: v.string(),
		description: v.string(),
		icon: v.string(),
		color: v.string(),
		mcpServers: v.array(
			v.object({
				name: v.string(),
				url: v.string(),
				authType: v.union(v.literal("oauth"), v.literal("none")),
			}),
		),
		isActive: v.boolean(),
	}),

	conversations: defineTable({
		userId: v.string(),
		harnessId: v.id("harnesses"),
		title: v.string(),
		model: v.string(),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_user", ["userId", "updatedAt"]),

	messages: defineTable({
		conversationId: v.id("conversations"),
		role: v.union(
			v.literal("user"),
			v.literal("assistant"),
			v.literal("system"),
			v.literal("tool"),
		),
		content: v.string(),
		toolCalls: v.optional(v.any()),
		toolResults: v.optional(v.any()),
		isStreaming: v.boolean(),
		isError: v.boolean(),
		createdAt: v.number(),
	}).index("by_conversation", ["conversationId", "createdAt"]),

	userMcpConnections: defineTable({
		userId: v.string(),
		serverName: v.string(),
		serverUrl: v.string(),
		accessToken: v.string(),
		refreshToken: v.optional(v.string()),
		tokenExpiresAt: v.optional(v.number()),
		scopes: v.optional(v.array(v.string())),
		connectedAt: v.number(),
	})
		.index("by_user", ["userId"])
		.index("by_user_server", ["userId", "serverName"]),
});
