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
				authType: v.union(v.literal("none"), v.literal("bearer"), v.literal("oauth")),
				authToken: v.optional(v.string()),
			}),
		),
		skills: v.array(v.object({ name: v.string(), description: v.string() })),
		suggestedPrompts: v.optional(v.array(v.string())),
		userId: v.string(),
		lastUsedAt: v.optional(v.number()),
	}).index("by_user", ["userId"]),

	conversations: defineTable({
		title: v.string(),
		lastHarnessId: v.optional(v.id("harnesses")),
		userId: v.string(),
		lastMessageAt: v.number(),
		forkedFromConversationId: v.optional(v.id("conversations")),
		forkedAtMessageCount: v.optional(v.number()),
		editParentConversationId: v.optional(v.id("conversations")),
		editParentMessageCount: v.optional(v.number()),
	})
		.index("by_user", ["userId"])
		.index("by_user_last_message", ["userId", "lastMessageAt"])
		.searchIndex("search_title", {
			searchField: "title",
			filterFields: ["userId"],
		}),

	messages: defineTable({
		conversationId: v.id("conversations"),
		userId: v.optional(v.string()),
		role: v.union(v.literal("user"), v.literal("assistant")),
		content: v.string(),
		reasoning: v.optional(v.string()),
		toolCalls: v.optional(
			v.array(
				v.object({
					tool: v.string(),
					arguments: v.any(),
					call_id: v.string(),
					result: v.string(),
				}),
			),
		),
		parts: v.optional(
			v.array(
				v.object({
					type: v.union(
						v.literal("text"),
						v.literal("reasoning"),
						v.literal("tool_call"),
					),
					content: v.optional(v.string()),
					tool: v.optional(v.string()),
					arguments: v.optional(v.any()),
					call_id: v.optional(v.string()),
					result: v.optional(v.string()),
				}),
			),
		),
		usage: v.optional(
			v.object({
				promptTokens: v.number(),
				completionTokens: v.number(),
				totalTokens: v.number(),
				cost: v.optional(v.number()),
			}),
		),
		model: v.optional(v.string()),
		interrupted: v.optional(v.boolean()),
		attachments: v.optional(
			v.array(
				v.object({
					storageId: v.id("_storage"),
					mimeType: v.string(),
					fileName: v.string(),
					fileSize: v.number(),
				}),
			),
		),
	})
		.index("by_conversation", ["conversationId"])
		.searchIndex("search_content", {
			searchField: "content",
			filterFields: ["conversationId", "userId"]
		}),


	mcpOAuthTokens: defineTable({
		userId: v.string(),
		mcpServerUrl: v.string(),
		accessToken: v.string(),
		refreshToken: v.optional(v.string()),
		expiresAt: v.number(),
		scopes: v.string(),
		authServerUrl: v.string(),
	})
		.index("by_user_and_server", ["userId", "mcpServerUrl"])
		.index("by_user", ["userId"]),

	skillDetails: defineTable({
		name: v.string(),
		skillName: v.string(),
		description: v.string(),
		detail: v.string(),
		code: v.string(),
	}).index("by_name", ["name"]),

	skillsIndex: defineTable({
		skillId: v.string(),
		fullId: v.string(),
		source: v.string(),
		description: v.string(),
		installs: v.number(),
	})
		.index("by_fullId", ["fullId"])
		.index("by_installs", ["installs"])
		.searchIndex("search_skills", {
			searchField: "skillId",
			filterFields: [],
		}),

	userSettings: defineTable({
		userId: v.string(),
		autoSwitchHarness: v.boolean(),
		displayMode: v.optional(
			v.union(
				v.literal("zen"),
				v.literal("standard"),
				v.literal("developer"),
			),
		),
	}).index("by_user", ["userId"]),
});
