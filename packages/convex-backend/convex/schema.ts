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
		mcps: v.array(v.string()),
		skills: v.array(v.string()),
		userId: v.string(),
		lastUsedAt: v.optional(v.number()),
	}).index("by_user", ["userId"]),

	conversations: defineTable({
		title: v.string(),
		harnessId: v.id("harnesses"),
		userId: v.string(),
		lastMessageAt: v.number(),
	})
		.index("by_user", ["userId"])
		.index("by_harness", ["harnessId"]),

	messages: defineTable({
		conversationId: v.id("conversations"),
		role: v.union(v.literal("user"), v.literal("assistant")),
		content: v.string(),
	}).index("by_conversation", ["conversationId"]),
});
