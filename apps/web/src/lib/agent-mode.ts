/**
 * ACP agent mode — run conversations through an external agent (Codex CLI,
 * Claude Code) in a Daytona sandbox via the FastAPI agent gateway, instead
 * of the Harness-provided OpenRouter loop.
 *
 * In agent mode, usage is incurred on the user's own agent subscription —
 * no OpenRouter usage or budget accounting applies.
 */
import { env } from "../env";

const FASTAPI_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";

export type AgentMode = "default" | "codex" | "claude-code" | "cursor";

export const AGENT_MODES: Array<{
	id: AgentMode;
	label: string;
	description: string;
}> = [
	{
		id: "default",
		label: "Harness",
		description: "Harness-provided models via OpenRouter",
	},
	{
		id: "codex",
		label: "Codex CLI",
		description: "OpenAI Codex via ACP (your account)",
	},
	{
		id: "claude-code",
		label: "Claude Code",
		description: "Anthropic Claude Code via ACP (your account)",
	},
	{
		id: "cursor",
		label: "Cursor",
		description: "Cursor CLI via ACP (your account)",
	},
];

export interface AgentPermissionOption {
	optionId: string;
	name: string;
	kind?: string;
}

export interface AgentPermissionRequest {
	request_id: string;
	tool_call: Record<string, unknown>;
	options: AgentPermissionOption[];
}

/** One entry of an ACP agent plan (session/update "plan"). */
export interface AgentPlanEntry {
	content: string;
	status: "pending" | "in_progress" | "completed";
	priority?: "high" | "medium" | "low";
}

const AGENT_LABELS: Record<string, string> = {
	cursor: "Cursor",
	codex: "Codex",
	"claude-code": "Claude Code",
};

/** Friendly label for gateway status events shown in the pending indicator. */
export function agentStatusLabel(data: {
	state?: string;
	agent?: string;
}): string {
	const agent = AGENT_LABELS[data.agent ?? ""] ?? "agent";
	switch (data.state) {
		case "provisioning":
			return `Starting ${agent} sandbox… (first message takes ~30s)`;
		case "ready":
			return `${agent} is thinking…`;
		default:
			return `${agent}: ${data.state ?? "working"}…`;
	}
}

// FastAPI HarnessConfig (snake_case) — same shape sent to /api/chat/stream.
export type AgentHarnessConfig = Record<string, unknown> & {
	harness_id?: string;
	mcp_servers: Array<{ name: string; url: string }>;
};

interface AgentSessionEntry {
	sessionId: string;
	harnessKey: string;
}

// One live agent session per (conversation, agent). Module-level so the
// session survives component remounts within the SPA lifetime.
const sessionCache = new Map<string, AgentSessionEntry>();

function cacheKey(conversationId: string, agent: AgentMode): string {
	return `${conversationId}:${agent}`;
}

function harnessKey(harness: AgentHarnessConfig): string {
	return JSON.stringify([
		harness.harness_id ?? null,
		harness.mcp_servers.map((s) => s.url).sort(),
	]);
}

async function api(
	token: string | null,
	path: string,
	init?: RequestInit,
): Promise<Response> {
	const response = await fetch(`${FASTAPI_URL}/api/agents${path}`, {
		...init,
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(init?.headers ?? {}),
		},
	});
	return response;
}

/**
 * Ensure a live agent session for this conversation, creating it or
 * switching its harness (MCP quick-switch) as needed.
 * Returns the gateway session id.
 */
export async function ensureAgentSession(
	token: string | null,
	agent: AgentMode,
	harness: AgentHarnessConfig,
	conversationId: string,
): Promise<string> {
	const key = cacheKey(conversationId, agent);
	const wantedHarness = harnessKey(harness);
	const cached = sessionCache.get(key);

	if (cached) {
		// Verify the session is still alive server-side (reaper, restarts).
		const status = await api(token, `/sessions/${cached.sessionId}`);
		if (status.ok) {
			if (cached.harnessKey !== wantedHarness) {
				const switched = await api(
					token,
					`/sessions/${cached.sessionId}/harness`,
					{ method: "POST", body: JSON.stringify({ harness }) },
				);
				if (switched.ok) {
					sessionCache.set(key, {
						sessionId: cached.sessionId,
						harnessKey: wantedHarness,
					});
					return cached.sessionId;
				}
				// Switch failed (e.g. mid-turn) — fall through to recreate.
			} else {
				return cached.sessionId;
			}
		}
		sessionCache.delete(key);
	}

	const created = await api(token, "/sessions", {
		method: "POST",
		body: JSON.stringify({
			agent,
			harness,
			conversation_id: conversationId,
		}),
	});
	if (!created.ok) {
		const detail = await created.text();
		throw new Error(detail || `Failed to start ${agent} session`);
	}
	const payload = (await created.json()) as { session_id: string };
	sessionCache.set(key, {
		sessionId: payload.session_id,
		harnessKey: wantedHarness,
	});
	return payload.session_id;
}

/** Session id from the cache without any network round trip. */
export function getCachedAgentSessionId(
	conversationId: string,
	agent: AgentMode,
): string | null {
	return sessionCache.get(cacheKey(conversationId, agent))?.sessionId ?? null;
}

/**
 * Queue an extra prompt onto an in-flight turn (promptQueueing agents,
 * e.g. Claude Code). Returns false when the gateway can't queue it
 * (unsupported agent, turn already over, session gone) — the caller
 * should fall back to client-side queueing.
 */
export async function queueAgentPrompt(
	token: string | null,
	sessionId: string,
	message: string,
): Promise<boolean> {
	const response = await api(token, `/sessions/${sessionId}/queue`, {
		method: "POST",
		body: JSON.stringify({ message }),
	});
	return response.ok;
}

export function forgetAgentSession(
	conversationId: string,
	agent: AgentMode,
): void {
	sessionCache.delete(cacheKey(conversationId, agent));
}

export async function answerAgentPermission(
	token: string | null,
	sessionId: string,
	requestId: string,
	optionId: string | null,
): Promise<void> {
	const response = await api(token, `/sessions/${sessionId}/permission`, {
		method: "POST",
		body: JSON.stringify({
			request_id: requestId,
			option_id: optionId,
			cancelled: optionId === null,
		}),
	});
	if (!response.ok) {
		// 404 here usually means the gateway restarted (in-memory session
		// gone) or the request already timed out — the agent never got the
		// answer, so the user must know.
		throw new Error(
			response.status === 404
				? "This approval is no longer pending (the agent session may have restarted)."
				: `Failed to send approval (HTTP ${response.status})`,
		);
	}
}

export async function cancelAgentTurn(
	token: string | null,
	sessionId: string,
): Promise<void> {
	await api(token, `/sessions/${sessionId}/cancel`, { method: "POST" });
}
