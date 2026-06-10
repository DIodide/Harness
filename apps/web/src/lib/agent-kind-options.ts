import type { AgentCredentialKind } from "./use-agent-catalog";

/** Credential input methods per agent, shared by Settings and onboarding. */
export interface KindOption {
	kind: AgentCredentialKind;
	label: string;
	hint: string;
	multiline: boolean;
}

export const KIND_OPTIONS: Record<string, KindOption[]> = {
	codex: [
		{
			kind: "auth_json",
			label: "ChatGPT login (auth.json)",
			hint: "Run `codex login` locally, then paste the contents of ~/.codex/auth.json.",
			multiline: true,
		},
		{
			kind: "api_key",
			label: "OpenAI API key",
			hint: "An OpenAI API key (sk-...). Billed to your OpenAI account.",
			multiline: false,
		},
	],
	"claude-code": [
		{
			kind: "oauth_token",
			label: "Claude Code OAuth token",
			hint: "Run `claude setup-token` locally and paste the generated token.",
			multiline: false,
		},
		{
			kind: "api_key",
			label: "Anthropic API key",
			hint: "An Anthropic API key (sk-ant-...). Billed to your Anthropic account.",
			multiline: false,
		},
	],
	cursor: [
		{
			kind: "auth_json",
			label: "Cursor login (auth.json)",
			hint: "Run `cursor-agent login` locally, then paste the contents of ~/.config/cursor/auth.json.",
			multiline: true,
		},
		{
			kind: "api_key",
			label: "Cursor API key",
			hint: "Create one at cursor.com → Dashboard → API Keys. Billed to your Cursor account.",
			multiline: false,
		},
	],
};
