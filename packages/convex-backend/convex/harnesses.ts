import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { resolveConversationRole } from "./shares";

/** Match apps/web `SYSTEM_PROMPT_MAX_LENGTH` and FastAPI `HarnessConfig.system_prompt`. */
export const SYSTEM_PROMPT_MAX_CHARS = 4000;

export function assertSystemPromptLength(systemPrompt: string | undefined) {
	if (systemPrompt !== undefined && systemPrompt.length > SYSTEM_PROMPT_MAX_CHARS) {
		throw new Error(
			`System prompt must be at most ${SYSTEM_PROMPT_MAX_CHARS} characters`,
		);
	}
}
const mcpServerValidator = v.object({
	name: v.string(),
	url: v.string(),
	authType: v.union(v.literal("none"), v.literal("bearer"), v.literal("oauth"), v.literal("tiger_junction")),
	authToken: v.optional(v.string()),
	commandIds: v.optional(v.array(v.id("commands"))),
});

export const list = query({
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		return await ctx.db
			.query("harnesses")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.collect();
	},
});

export const get = query({
	args: { id: v.id("harnesses") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const harness = await ctx.db.get(args.id);
		if (!harness || harness.userId !== identity.subject) return null;
		return harness;
	},
});

/**
 * Resolve the OWNER's current harness for a conversation so the FastAPI backend
 * can run a collaborator's turn server-side, billed to and configured as the
 * owner. The collaborator's browser NEVER calls this and NEVER receives the
 * harness — it's an internalQuery (deploy-key only), so returning the owner's
 * secrets (MCP authToken, agentCredentialId, sandbox id) to the backend is
 * safe; they stay server-side and are re-injected against the owner's identity.
 *
 * Re-authorizes the requester against the conversation (owner or active editor
 * grant) and returns null on any denial — fail closed. The backend must treat
 * null as "not authorized / nothing to run".
 */
export const resolveForCollab = internalQuery({
	args: {
		conversationId: v.id("conversations"),
		requesterUserId: v.string(),
		token: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const role = await resolveConversationRole(
			ctx,
			args.requesterUserId,
			args.conversationId,
			args.token,
		);
		if (role !== "owner" && role !== "editor") return null;

		const convo = await ctx.db.get(args.conversationId);
		if (!convo?.lastHarnessId) return null;
		const harness = await ctx.db.get(convo.lastHarnessId);
		if (!harness) return null;

		return {
			// Bill, resolve credentials/MCP-OAuth, and verify the sandbox against
			// THIS id — never the collaborator's.
			ownerUserId: convo.userId,
			harnessId: harness._id,
			name: harness.name,
			model: harness.model,
			systemPrompt: harness.systemPrompt ?? null,
			skills: harness.skills,
			skillPackIds: harness.skillPackIds ?? [],
			// "default" | "claude-code" | "codex" | ... | null
			agent: harness.agent ?? null,
			agentCredentialId: harness.agentCredentialId ?? null,
			// Persisted ACP session defaults (seed the collaborator's server run).
			agentMode: harness.agentMode ?? null,
			reasoningEffort: harness.reasoningEffort ?? null,
			mcpServers: harness.mcpServers.map((s) => ({
				name: s.name,
				url: s.url,
				authType: s.authType,
				authToken: s.authToken ?? null,
			})),
			sandboxEnabled: harness.sandboxEnabled ?? false,
			// FastAPI HarnessConfig.sandbox_id is the Daytona sandbox id string
			// (verify_sandbox_owner looks it up via getOwnerByDaytonaId).
			sandboxId: harness.daytonaSandboxId ?? null,
			sandboxConfig: harness.sandboxConfig ?? null,
			// The conversation's workspace, so a collaborator's run unifies on the
			// same per-workspace sandbox as the owner (owner runs send it from the
			// client; the collab path has no client harness, so resolve it here).
			workspaceId: convo.workspaceId ?? null,
		};
	},
});

export const create = mutation({
	args: {
		name: v.string(),
		model: v.string(),
		status: v.union(
			v.literal("started"),
			v.literal("stopped"),
			v.literal("draft"),
		),
		mcpServers: v.array(mcpServerValidator),
		skills: v.array(v.object({ name: v.string(), description: v.string() })),
		skillPackIds: v.optional(v.array(v.id("skillPacks"))),
		systemPrompt: v.optional(v.string()),
		agent: v.optional(v.string()),
		agentCredentialId: v.optional(v.id("agentCredentials")),
		agentMode: v.optional(v.string()),
		reasoningEffort: v.optional(v.string()),
		sandboxEnabled: v.optional(v.boolean()),
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
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		assertSystemPromptLength(args.systemPrompt);
		return await ctx.db.insert("harnesses", {
			...args,
			userId: identity.subject,
			lastUsedAt: Date.now(),
		});
	},
});

export const update = mutation({
	args: {
		id: v.id("harnesses"),
		name: v.optional(v.string()),
		model: v.optional(v.string()),
		status: v.optional(
			v.union(
				v.literal("started"),
				v.literal("stopped"),
				v.literal("draft"),
			),
		),
		mcpServers: v.optional(v.array(mcpServerValidator)),
		skills: v.optional(v.array(v.object({ name: v.string(), description: v.string() }))),
		skillPackIds: v.optional(v.array(v.id("skillPacks"))),
		systemPrompt: v.optional(v.string()),
		suggestedPrompts: v.optional(v.array(v.string())),
		agent: v.optional(v.string()),
		agentCredentialId: v.optional(v.id("agentCredentials")),
		agentMode: v.optional(v.string()),
		reasoningEffort: v.optional(v.string()),
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
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const harness = await ctx.db.get(args.id);
		if (!harness || harness.userId !== identity.subject) {
			throw new Error("Not found");
		}
		const { id, ...updates } = args;
		assertSystemPromptLength(updates.systemPrompt);
		const filtered = Object.fromEntries(
			Object.entries(updates).filter(([, v]) => v !== undefined),
		);
		// Credentials are agent-specific: switching the agent without
		// explicitly linking a new credential must unlink the old agent's
		// (FastAPI rejects mismatched links; with none it falls back to the
		// user's newest credential for the new agent).
		if (
			args.agent !== undefined &&
			args.agent !== harness.agent &&
			args.agentCredentialId === undefined
		) {
			await ctx.db.patch(id, { ...filtered, agentCredentialId: undefined });
			return;
		}
		await ctx.db.patch(id, filtered);
	},
});

export const duplicate = mutation({
	args: { id: v.id("harnesses") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const harness = await ctx.db.get(args.id);
		if (!harness || harness.userId !== identity.subject) {
			throw new Error("Not found");
		}
		return await ctx.db.insert("harnesses", {
			name: `Copy of ${harness.name}`,
			model: harness.model,
			status: harness.status,
			mcpServers: harness.mcpServers,
			skills: harness.skills,
			skillPackIds: harness.skillPackIds,
			systemPrompt: harness.systemPrompt,
			// The agent loop and its credential are part of what the user
			// is duplicating — dropping them silently turned the copy into
			// a default-loop harness with an agent-only model id.
			agent: harness.agent,
			agentCredentialId: harness.agentCredentialId,
			agentMode: harness.agentMode,
			reasoningEffort: harness.reasoningEffort,
			suggestedPrompts: harness.suggestedPrompts,
			userId: identity.subject,
			lastUsedAt: Date.now(),
		});
	},
});

export const remove = mutation({
	args: { id: v.id("harnesses") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const harness = await ctx.db.get(args.id);
		if (!harness || harness.userId !== identity.subject) {
			throw new Error("Not found");
		}
		await ctx.db.delete(args.id);
	},
});
