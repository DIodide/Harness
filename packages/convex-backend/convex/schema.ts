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
				authType: v.union(
					v.literal("none"),
					v.literal("bearer"),
					v.literal("oauth"),
					v.literal("tiger_junction"),
				),
				authToken: v.optional(v.string()),
				commandIds: v.optional(v.array(v.id("commands"))),
			}),
		),
		skills: v.array(v.object({ name: v.string(), description: v.string() })),
		systemPrompt: v.optional(v.string()),
		suggestedPrompts: v.optional(v.array(v.string())),
		userId: v.string(),
		lastUsedAt: v.optional(v.number()),
		// Agent loop this harness runs on: "default" (Harness via OpenRouter)
		// or an ACP agent id ("claude-code" | "codex" | "cursor"). Absent =
		// default.
		agent: v.optional(v.string()),
		// The stored credential this harness uses for its ACP agent (one
		// credential per harness; credentials are reusable across harnesses).
		agentCredentialId: v.optional(v.id("agentCredentials")),
		// Persisted ACP session defaults (Claude Code et al), seeded into a new
		// session and editable in the harness forms / chat bar before any session
		// exists. The agent MODEL reuses the existing `model` field. Absent = the
		// agent's own default. `agentMode` = the ACP "mode" config value (e.g.
		// "default", "plan"); `reasoningEffort` = the ACP "effort" value.
		agentMode: v.optional(v.string()),
		reasoningEffort: v.optional(v.string()),
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

	commands: defineTable({
		// Owner. Optional for backward-compat with rows created before commands
		// were user-scoped; new rows always set it. Command names collide across
		// users (e.g. "GitHub__create_issue"), so without this an upsert from one
		// user would overwrite another's row and getByIds would leak it.
		userId: v.optional(v.string()),
		name: v.string(),
		server: v.string(),
		tool: v.string(),
		description: v.string(),
		parametersJson: v.string(),
	})
		.index("by_name", ["name"])
		.index("by_user_and_name", ["userId", "name"]),

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

	workspaces: defineTable({
		userId: v.string(),
		name: v.string(),
		harnessId: v.optional(v.id("harnesses")),
		sandboxId: v.optional(v.id("sandboxes")),
		color: v.optional(v.string()),
		// The account's Default workspace — exactly one per user, CANNOT be
		// deleted (its harness/sandbox stay editable). A conversation always has
		// a workspace home; the Default is the fallback.
		isDefault: v.optional(v.boolean()),
		// Manual sidebar ordering (ascending). Optional: accounts that have never
		// reordered fall back to lastUsedAt. Set for every workspace once the user
		// drags to reorder.
		order: v.optional(v.number()),
		createdAt: v.number(),
		lastUsedAt: v.number(),
	})
		.index("by_user", ["userId"])
		.index("by_user_last_used", ["userId", "lastUsedAt"]),

	conversations: defineTable({
		title: v.string(),
		lastHarnessId: v.optional(v.id("harnesses")),
		workspaceId: v.optional(v.id("workspaces")),
		userId: v.string(),
		lastMessageAt: v.number(),
		forkedFromConversationId: v.optional(v.id("conversations")),
		forkedAtMessageCount: v.optional(v.number()),
		// Share link a fork came from, so "jump to original" returns the forker to
		// the shared page instead of an empty owner-gated /chat (set only when
		// forked via a public link).
		forkedFromShareToken: v.optional(v.string()),
		editParentConversationId: v.optional(v.id("conversations")),
		editParentMessageCount: v.optional(v.number()),
		isCreationSession: v.optional(v.boolean()),
		// Set on a conversation cloned from a compaction summary ("new session
		// from summary") — provenance + lets the agent route seed its context
		// from the summary instead of the full transcript.
		seededFromCompactionId: v.optional(v.id("compactions")),
		// Timestamp the conversation was pinned (Date.now()); undefined = not
		// pinned. A number (not a bool) so pinned chats sort by most-recently
		// pinned. Pinned chats render in a dedicated "Pinned" sidebar section.
		pinnedAt: v.optional(v.number()),
	})
		.index("by_user", ["userId"])
		.index("by_user_last_message", ["userId", "lastMessageAt"])
		.index("by_workspace_last_message", ["workspaceId", "lastMessageAt"])
		// Pinned chats are fetched independently of the recency window so they
		// never fall out of the sidebar once a user has 50+ newer chats.
		.index("by_user_pinned", ["userId", "pinnedAt"])
		.index("by_workspace_pinned", ["workspaceId", "pinnedAt"])
		// Exact title-prefix scan for fork-sibling naming (avoids an unordered
		// global cap that could miss recent forks on large accounts).
		.index("by_user_title", ["userId", "title"])
		.searchIndex("search_title", {
			searchField: "title",
			filterFields: ["userId", "workspaceId"],
		}),

	// Claude Code context-compaction events. Append-only — a record per
	// /compact (manual) or auto-compaction, captured from the ACP stream. Drives
	// observability (the dev can SEE the summary) and the clone-from-summary
	// flow. Kept OUT of messages.parts so it's never copied by the fork mutation.
	compactions: defineTable({
		conversationId: v.id("conversations"),
		workspaceId: v.optional(v.id("workspaces")),
		userId: v.string(),
		// The compaction summary prose (may be "" if only metadata was captured).
		summary: v.string(),
		trigger: v.union(v.literal("manual"), v.literal("auto")),
		// Thread position when it fired — the clone-seed anchor + timeline slot.
		atMessageCount: v.optional(v.number()),
		preTokens: v.optional(v.number()),
		postTokens: v.optional(v.number()),
		model: v.optional(v.string()),
		createdAt: v.number(),
	})
		.index("by_conversation", ["conversationId"])
		.index("by_user", ["userId"]),

	messages: defineTable({
		conversationId: v.id("conversations"),
		workspaceId: v.optional(v.id("workspaces")),
		userId: v.optional(v.string()),
		// Public profile snapshot of the message's author, captured client-side
		// from Clerk when a collaborator (editor grant) sends into someone
		// else's shared conversation — there is no users table to resolve a
		// Clerk subject to a name later. Name + avatar ONLY, never email.
		// Absent for the owner's own messages (rendered as the owner).
		authorName: v.optional(v.string()),
		authorImageUrl: v.optional(v.string()),
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
					// ACP tool kind (execute|read|edit|...) for agent built-ins;
					// absent for MCP/default-agent tool calls.
					kind: v.optional(v.string()),
					parent_id: v.optional(v.string()),
					// Tool-call status (completed|failed|in_progress) and, for
					// commands, the process exit code; MCP server attribution.
					status: v.optional(v.string()),
					exit_code: v.optional(v.number()),
					server_name: v.optional(v.string()),
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
		interruptionReason: v.optional(v.string()),
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
			filterFields: ["conversationId", "userId", "workspaceId"],
		}),

	// Per-user credentials for external ACP agents (Codex CLI, Claude Code).
	// Values are AES-256-GCM ciphertext produced by the FastAPI backend —
	// Convex and the browser never see plaintext.
	agentCredentials: defineTable({
		userId: v.string(),
		agent: v.string(), // "codex" | "claude-code"
		kind: v.union(
			v.literal("auth_json"),
			v.literal("api_key"),
			v.literal("oauth_token"),
		),
		ciphertext: v.string(),
		label: v.optional(v.string()),
		createdAt: v.number(),
		lastUsedAt: v.optional(v.number()),
	})
		.index("by_user", ["userId"])
		.index("by_user_agent", ["userId", "agent"]),

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

	// Conversation sharing grants. One table covers both modes:
	//   - public link  → publicToken set, grantedToUserId undefined
	//   - per-user grant → grantedToUserId set, publicToken undefined
	// Authorization for a shared conversation is ALWAYS resolved through an
	// active grant here (never by trusting a denormalized field on the
	// message/conversation). A grant is active when not revoked and not
	// expired. `role` gates viewer (read-only) vs editor (collaborate —
	// Phase 2). The publicToken is a high-entropy client-generated secret
	// (32 bytes), looked up via the by_token index so it self-throttles
	// enumeration; the Convex _id is deliberately NOT used as the secret.
	shareGrants: defineTable({
		conversationId: v.id("conversations"),
		// = conversation.userId at mint time (denormalized so the public
		// query never has to expose the owner id and revocation is cheap).
		ownerUserId: v.string(),
		// Owner's public profile snapshot for author attribution on the shared
		// view (name + avatar ONLY — never email; captured client-side from
		// Clerk at share time since there is no users table). Best-effort.
		ownerName: v.optional(v.string()),
		ownerImageUrl: v.optional(v.string()),
		role: v.union(v.literal("viewer"), v.literal("editor")),
		// Exactly one of these identifies the grantee.
		grantedToUserId: v.optional(v.string()),
		publicToken: v.optional(v.string()),
		createdAt: v.number(),
		expiresAt: v.optional(v.number()),
		revokedAt: v.optional(v.number()),
		lastAccessedAt: v.optional(v.number()),
	})
		.index("by_token", ["publicToken"])
		.index("by_conversation", ["conversationId"])
		.index("by_grantee", ["grantedToUserId"]),

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
			v.union(v.literal("zen"), v.literal("standard"), v.literal("developer")),
		),
		// Controls whether the in-chat model selector changes only the current
		// session ("session") or persists the change to the harness ("harness").
		// Whether in-chat config changes (model, agent, modes) update the
		// harness itself (default) or only the current session.
		chatConfigScope: v.optional(
			v.union(v.literal("harness"), v.literal("session")),
		),
		modelSelectorMode: v.optional(
			v.union(v.literal("session"), v.literal("harness")),
		),
		// Control whether or not we are in basic models or workspaces modes
		workspacesMode: v.optional(
			v.union(v.literal("basic"), v.literal("workspaces")),
		),
		// Show the mid-message rewind "seams" (cut points between an assistant
		// message's blocks). Defaults on; absent = on.
		rewindSeams: v.optional(v.boolean()),
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

	harnessConfigRatings: defineTable({
		userId: v.string(),
		rating: v.union(v.literal("up"), v.literal("down")),
		configSnapshot: v.object({
			name: v.string(),
			model: v.string(),
			mcpIds: v.array(v.string()),
		}),
		conversationSnapshot: v.array(
			v.object({
				role: v.string(),
				content: v.string(),
			}),
		),
		createdAt: v.number(),
	})
		.index("by_user", ["userId"])
		.index("by_rating", ["rating"]),

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
		day: v.string(), // "2026-04-08"
		week: v.string(), // "2026-W15"
		recordedAt: v.number(),
	})
		.index("by_user_day", ["userId", "day"])
		.index("by_user_week", ["userId", "week"])
		.index("by_conversation", ["conversationId"]),

	// Per-credential usage for ACP agents (Claude Code, Codex, Cursor). Unlike
	// usageLedger/usageBudgets (OpenRouter spend Harness pays for and caps),
	// agent cost is billed to the USER's own agent account, so this is purely
	// informational — never a budget gate. Cost is the SDK's client-side
	// `total_cost_usd` ESTIMATE (per-turn), not an authoritative bill. One row
	// per (acpSession, turn); `turnKey` dedupes a usage_update that fires more
	// than once per turn or on reconnect. Period totals are summed from these
	// rows in the query (no rollup table — keeps it correct + simple).
	agentUsageLedger: defineTable({
		userId: v.string(),
		agentCredentialId: v.id("agentCredentials"),
		agent: v.string(), // "claude-code" | "codex" | "cursor"
		conversationId: v.id("conversations"),
		acpSessionId: v.optional(v.string()),
		model: v.optional(v.string()),
		usedTokens: v.number(), // usage_update.used (this turn's token total)
		contextSize: v.optional(v.number()), // usage_update.size (context window)
		costUsd: v.number(),
		currency: v.string(),
		isEstimate: v.boolean(), // SDK client-side estimate, not a bill
		// Latest Anthropic per-account rate-limit snapshot (_meta._claude/rateLimit),
		// authoritative-ish quota state; shape is upstream-defined so kept opaque.
		rateLimit: v.optional(v.any()),
		turnKey: v.string(), // "<acpSessionId>:<turnIndex>" — idempotency key
		day: v.string(), // "2026-06-19"
		week: v.string(), // "2026-W25"
		recordedAt: v.number(),
	})
		.index("by_turnKey", ["turnKey"]) // idempotency lookup
		.index("by_user", ["userId"]) // getMyAgentUsage
		.index("by_credential", ["agentCredentialId"]), // cascade-delete on credential removal
});
