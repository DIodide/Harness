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
				authType: v.union(v.literal("none"), v.literal("bearer"), v.literal("oauth"), v.literal("tiger_junction")),
				authToken: v.optional(v.string()),
			}),
		),
		skills: v.array(v.object({ name: v.string(), description: v.string() })),
		systemPrompt: v.optional(v.string()),
		suggestedPrompts: v.optional(v.array(v.string())),
		userId: v.string(),
		lastUsedAt: v.optional(v.number()),
		// Daytona sandbox configuration
		sandboxEnabled: v.optional(v.boolean()),
		sandboxId: v.optional(v.id("sandboxes")),
		daytonaSandboxId: v.optional(v.string()),
		sandboxConfig: v.optional(
			v.object({
				persistent: v.boolean(),
				autoStart: v.boolean(),
				defaultLanguage: v.string(),
				resourceTier: v.union(
					v.literal("basic"),
					v.literal("standard"),
					v.literal("performance"),
				),
				snapshotId: v.optional(v.string()),
				gitRepo: v.optional(v.string()),
				networkRestricted: v.optional(v.boolean()),
			}),
		),
	}).index("by_user", ["userId"]),

	sandboxes: defineTable({
		userId: v.string(),
		harnessId: v.optional(v.id("harnesses")),
		daytonaSandboxId: v.string(),
		name: v.string(),
		status: v.union(
			v.literal("creating"),
			v.literal("starting"),
			v.literal("running"),
			v.literal("stopping"),
			v.literal("stopped"),
			v.literal("archived"),
			v.literal("error"),
		),
		language: v.optional(v.string()),
		ephemeral: v.boolean(),
		resources: v.object({
			cpu: v.number(),
			memoryGB: v.number(),
			diskGB: v.number(),
		}),
		labels: v.optional(v.any()),
		snapshotId: v.optional(v.string()),
		gitRepo: v.optional(v.string()),
		lastAccessedAt: v.optional(v.number()),
		createdAt: v.number(),
		errorMessage: v.optional(v.string()),
	})
		.index("by_user", ["userId"])
		.index("by_harness", ["harnessId"])
		.index("by_daytona_id", ["daytonaSandboxId"]),

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
		})
		.searchIndex("search_skills_description", {
			searchField: "description",
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
		// Controls whether the in-chat model selector changes only the current
		// session ("session") or persists the change to the harness ("harness").
		modelSelectorMode: v.optional(
			v.union(v.literal("session"), v.literal("harness")),
		),
		// Control whether or not we are in basic models or workspaces modes
		workspacesMode: v.optional(
			v.union(
				v.literal("basic"),
				v.literal("workspaces")
			)
		),
	}).index("by_user", ["userId"]),

	usageBudgets: defineTable({
		userId: v.string(),
		periodType: v.union(v.literal("daily"), v.literal("weekly")),
		period: v.string(), // "2026-04-08" (daily) or "2026-W15" (weekly)
		totalCostUsed: v.number(),
		costLimit: v.number(),
		totalTokensUsed: v.number(),
		perModelUsage: v.array(
			v.object({
				model: v.string(),
				tokensUsed: v.number(),
				costUsed: v.number(),
			}),
		),
		perHarnessUsage: v.array(
			v.object({
				harnessId: v.string(),
				harnessName: v.string(),
				tokensUsed: v.number(),
				costUsed: v.number(),
			}),
		),
		updatedAt: v.number(),
	}).index("by_user_period", ["userId", "periodType", "period"]),

	usageLedger: defineTable({
		userId: v.string(),
		conversationId: v.id("conversations"),
		harnessId: v.optional(v.string()),
		harnessName: v.optional(v.string()),
		model: v.string(),
		promptTokens: v.number(),
		completionTokens: v.number(),
		totalTokens: v.number(),
		cost: v.number(),
		day: v.string(),  // "2026-04-08"
		week: v.string(), // "2026-W15"
		recordedAt: v.number(),
	})
		.index("by_user_day", ["userId", "day"])
		.index("by_user_week", ["userId", "week"])
		.index("by_conversation", ["conversationId"]),
});
