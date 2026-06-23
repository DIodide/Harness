/**
 * The ONE place a harness document becomes the snake_case HarnessConfig
 * sent to FastAPI (/api/chat/stream and the ACP agent gateway).
 *
 * Every send path — composer sends, queued messages, regenerate, and
 * edit-resend — must build its config here: the agent loop fields
 * (`agent`, `agent_credential_id`) decide whether a request runs on the
 * user's own coding agent or the default OpenRouter loop, and a path that
 * drops them silently reroutes (and re-bills) the conversation.
 */

import type { AgentMode } from "./agent-mode";

export interface HarnessDocLike {
	_id: string;
	name: string;
	model: string;
	mcpServers: Array<{
		name: string;
		url: string;
		authType: string;
		authToken?: string;
	}>;
	skills?: Array<{ name: string; description: string }>;
	skillPackIds?: string[];
	systemPrompt?: string;
	agent?: string;
	agentCredentialId?: string;
	agentMode?: string;
	reasoningEffort?: string;
	sandboxConfig?: {
		persistent: boolean;
		autoStart: boolean;
		defaultLanguage: string;
		resourceTier: string;
	};
}

export interface HarnessStreamOptions {
	/** Session-scoped model override (chatConfigScope === "session"). */
	model?: string | null;
	/** Session-scoped agent override; "default" forces the default loop. */
	agentOverride?: string | null;
	/** Resolved Daytona sandbox id, or null/undefined when none applies. */
	sandboxId?: string | null;
	/**
	 * Active workspace id. Sent so the backend can resolve and inject this
	 * workspace's assigned env-var credentials into the run's sandbox.
	 */
	workspaceId?: string | null;
}

export function buildHarnessStreamConfig(
	harness: HarnessDocLike,
	opts: HarnessStreamOptions = {},
) {
	const resolvedAgent = opts.agentOverride ?? harness.agent ?? "default";
	const agent = resolvedAgent !== "default" ? resolvedAgent : undefined;
	return {
		model: opts.model ?? harness.model,
		mcp_servers: harness.mcpServers.map((s) => ({
			name: s.name,
			url: s.url,
			auth_type: s.authType as "none" | "bearer" | "oauth" | "tiger_junction",
			auth_token: s.authToken,
		})),
		skills: harness.skills ?? [],
		// Skill packs the backend resolves into the skill manifest (default loop)
		// and into AGENTS.md / CLAUDE.md / ~/.claude/skills (agentic harnesses).
		skill_pack_ids: harness.skillPackIds ?? [],
		name: harness.name,
		harness_id: harness._id,
		system_prompt: harness.systemPrompt ?? undefined,
		agent,
		// Persisted ACP session defaults — seed the new session's mode/effort
		// (the model rides the existing `model` field above). The gateway only
		// applies a value the wrapper actually offers.
		agent_mode: harness.agentMode ?? undefined,
		reasoning_effort: harness.reasoningEffort ?? undefined,
		// Only the harness's own credential may ride along — under a
		// session-scope agent override the backend falls back to the user's
		// newest credential for that agent instead.
		agent_credential_id:
			agent && agent === harness.agent ? harness.agentCredentialId : undefined,
		sandbox_enabled: Boolean(opts.sandboxId),
		sandbox_id: opts.sandboxId ?? undefined,
		workspace_id: opts.workspaceId ?? undefined,
		sandbox_config: harness.sandboxConfig
			? {
					persistent: harness.sandboxConfig.persistent,
					auto_start: harness.sandboxConfig.autoStart,
					default_language: harness.sandboxConfig.defaultLanguage,
					resource_tier: harness.sandboxConfig.resourceTier,
				}
			: undefined,
	};
}

/** Spread into a stream() body so agent-mode routing engages. */
export function agentStreamFields(
	config: ReturnType<typeof buildHarnessStreamConfig>,
): { agent?: AgentMode } {
	return config.agent ? { agent: config.agent as AgentMode } : {};
}
