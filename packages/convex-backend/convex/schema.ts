import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
	harnesses: defineTable({
		name: v.string(),
		model: v.string(),
		status: v.union(
			v.literal("started"),
			v.literal("stopped"),
			v.literal("draft"),
		),
		mcpServers: v.array(
			v.object({
				name: v.string(),
				url: v.string(),
				authType: v.union(v.literal("none"), v.literal("bearer")),
				authToken: v.optional(v.string()),
			}),
		),
		skills: v.array(v.string()),
		userId: v.string(),
		lastUsedAt: v.optional(v.number()),
	}).index("by_user", ["userId"]),

	conversations: defineTable({
		title: v.string(),
		lastHarnessId: v.optional(v.id("harnesses")),
		userId: v.string(),
		lastMessageAt: v.number(),
	})
		.index("by_user", ["userId"])
		.index("by_user_last_message", ["userId", "lastMessageAt"]),

	messages: defineTable({
		conversationId: v.id("conversations"),
		role: v.union(v.literal("user"), v.literal("assistant")),
		content: v.string(),
		reasoning: v.optional(v.string()),
	}).index("by_conversation", ["conversationId"]),

	userSettings: defineTable({
		userId: v.string(),
		autoSwitchHarness: v.boolean(),
	}).index("by_user", ["userId"]),
});
