# Changelog

All notable changes to Harness are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); dates are `YYYY-MM-DD`.

## [0.2.1] — 2026-06-10 · Hardening the Agent Gateway

Fixes for all 25 findings from the 0.2.0 deep code review
([PR #72 review](https://github.com/DIodide/Harness/pull/72)).

### Security

- **Sandbox attach ownership**: creating an agent session with a harness
  sandbox now verifies the requesting user owns the Daytona sandbox id —
  previously any authenticated user could attach their agent inside
  another user's sandbox.
- **Credential rotation integrity**: `agentCredentials.updateSecret`
  rejects rotations whose stored row belongs to a different agent, so a
  mismatched rotation can no longer rewrite a credential's kind (e.g. a
  codex auth.json exported as `ANTHROPIC_API_KEY`).
- **Sandbox cap enforced up front**: owned agent sandboxes check
  `MAX_SANDBOXES_PER_USER` *before* the Daytona sandbox is created, not in
  the fire-and-forget registration that swallowed the limit error.

### Fixed — gateway

- Regenerate, queued messages, and edit-resend now run on the configured
  agent loop: the harness stream config is built by one shared helper
  (`lib/harness-stream.ts`) that always carries `agent` /
  `agent_credential_id` — these paths previously fell back silently to the
  default OpenRouter loop.
- Session lifecycle races: a turn now guards its whole startup (steal
  protection from the generator's first statement); the abandoned
  `event_queue.get()` waiter is cancelled on disconnect (it used to eat
  the next turn's first event — often a permission request, stalling it
  to the 300s timeout); SSE disconnects send `session/cancel` so the
  agent stops producing output nobody will persist; one live session per
  conversation (second tabs/reloads share it).
- Attached sandboxes: a second conversation on the same sandbox-attached
  harness takes the agent over deterministically (turn cancelled, stream
  notified, runtime adopted) instead of killing the other session's shim
  under it; teardown of attached shims no longer relies on `pkill`,
  which doesn't exist in the sandbox images.
- MCP relay: handler failures of any type now answer the shim instead of
  stranding requests until the 120s timeout; relay endpoints are stamped
  with a per-ACP-session generation so requests from a previous session's
  MCP clients are rejected rather than misrouted after a harness switch;
  the live-session switch key includes server name/auth so static-token
  edits propagate.
- Shim: signal-killed agents are now reported as exited
  (`child.exitCode` stays null on signals — healthz said "running" and
  prompts hung for 600s); replay-buffer eviction emits a `gap` event that
  fails pending requests fast and triggers a revive instead of a silent
  hang.
- Aborted turns no longer persist twice (server skips the save on client
  disconnect — the frontend's interrupted save is authoritative, matching
  `/api/chat/stream`); status-only `tool_call_update`s no longer fabricate
  a `"{}"` result that marked running tools as finished; sub-agent
  reasoning keeps its parent linkage after reload; prompt `history` is
  capped server-side.

### Fixed — web app

- Switching the agent loop in chat unlinks the old agent's credential on
  the harness (resolution falls back to the newest credential for the new
  agent) instead of failing every send with a 409.
- The harness edit page now has the full agent-loop section (agent cards,
  credential library with inline add, agent-aware model list) — the same
  picker as creation, so the "no credential linked" badge and gateway
  errors finally point somewhere that can fix them.
- Duplicating a harness copies its agent, credential link, and suggested
  prompts.
- Concurrent agent permission/question requests queue per conversation
  (FIFO) instead of clobbering each other into a silent deny; question
  cards are keyed by request id so a new question never inherits the
  previous stepper's state.
- Users who chose session-scoped model switching before `chatConfigScope`
  existed keep that behavior (legacy `modelSelectorMode` fallback).
- Claude agent sessions merge `availableModels` into the sandbox's
  existing `~/.claude/settings.json` instead of overwriting user-managed
  hooks/permissions; stale Manage Sandboxes rows tolerate duplicate
  records on cleanup.

## [0.2.0] — 2026-06-10 · ACP Agent Gateway

Harness becomes the chat + tool control plane for the coding agents you
already use. This release introduces the Agent Client Protocol (ACP)
gateway: bring your own Claude Code, Codex CLI, or Cursor — Harness equips
it with your MCP servers and skills, runs it in an isolated cloud sandbox,
and lets you swap its entire toolset mid-conversation.

### Added — Agent gateway (backend)

- **ACP gateway** (`/api/agents`): runs ACP-compliant agents
  ([claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp),
  [codex-acp](https://github.com/zed-industries/codex-acp),
  `cursor-agent acp`) inside Daytona sandboxes. A zero-dependency Node shim
  bridges each agent's stdio JSON-RPC to HTTP/SSE behind the sandbox
  preview URL; sessions stream normalized events (tokens, thinking, tool
  calls, plans, permissions, usage, status) to the web app.
- **MCP relay**: agents reach MCP servers through the backend
  (`http://127.0.0.1:<shim>/mcp/<n>` → tunneled to Harness, which executes
  the real HTTPS call). Sandbox egress restrictions become irrelevant and
  MCP credentials (OAuth, bearer, Tiger Junction) never enter the sandbox.
  Cursor variant: MCP config + allowlist written to `~/.cursor/` since
  `cursor-agent` ignores `session/new` mcpServers.
- **Mid-conversation MCP context switching**: switching harnesses re-opens
  the ACP session with the new toolset and transparently replays the
  transcript — tools change, the conversation continues.
- **Daytona snapshot** `harness-acp-v2` (node 22 + all three adapters
  pre-installed) with an idempotent bootstrap for attaching agents to
  existing harness sandboxes; IPv4-first networking (sandboxes blackhole
  outbound IPv6).
- **Per-user encrypted credentials**: AES-256-GCM in FastAPI (key never
  leaves the server), ciphertext-only storage in Convex, write-only from
  the browser. Multiple credentials per agent (work/personal); each
  harness links exactly one; credentials are reusable across harnesses
  and deletions unlink referencing harnesses.
- **Harness-level agent configuration**: `harnesses.agent` +
  `harnesses.agentCredentialId`; per-agent model lists with the harness
  model applied to live sessions via ACP config options.
- **Session config options**: model / mode (permissions) / effort
  selectors driven entirely by ACP `configOptions` — any future agent's
  options render with zero new code. Fable exposed in Claude Code via the
  `availableModels` allowlist.
- **Claude Code first-class metadata**: distinct message boundaries,
  background-agent (Task) activity nested under its parent tool call,
  live context/cost usage chip, and prompt queueing mid-turn.
- **Agent slash commands** (`/review`, `/compact`, …) surfaced in the
  composer with argument hints; image attachments forwarded as ACP image
  blocks; real `session/cancel` interrupt.
- **Sandbox unification**: harnesses with a sandbox run their agent
  *inside* that sandbox (the user's real files); session sandboxes are
  registered in Manage Sandboxes with a live terminal for free, and
  records are cleaned up on teardown.

### Added — Web app

- **Onboarding redesign**: first-run flow starts with "connect your coding
  agent" (brand-logo cards; OpenCode + Gemini CLI marked coming soon),
  then an optional harness wizard with a starter-harness skip. Post-auth
  redirect race fixed (no more bouncing to the landing page).
- **Two-row composer** with per-option config selector chips, the agent
  picker, and full-width input; the agent picker is driven by the
  harness's configured agent.
- **First-class agent activity rendering**: shell commands as terminal
  blocks (argv noise stripped), file edits as red/green diffs, reads/
  searches/fetches summarized by target, plans as live checklists,
  ExitPlanMode as a markdown "plan ready for review" document, and
  AskUserQuestion as a one-question-at-a-time stepper with per-question
  custom answers — answered Q&A persists into the transcript.
- **Permission approval cards** rendered by tool kind (command, file
  edit, …) with the agent's own options; resolved inline.
- **Harness creation flow**: agent-loop picker (Harness default, Claude
  Code, Codex, Cursor with brand logos), reusable-credential picker with
  inline "add credential", and model choices linked to the chosen agent.
- **Settings**: Agent Credentials library (add/remove; per-harness
  linking lives in the harness flow) and a "Chat changes" scope — in-chat
  model/agent/mode switches update the harness by default, or only the
  session if opted in (`chatConfigScope`).
- **Manage Harnesses redesign**: cards show agent (logo + credential),
  model, MCP servers by name, skills, sandbox, last-used, and a direct
  "Open in chat" action.
- **Chat headers** show the harness's agent with its credential in a
  tooltip; a harness is now required before the composer accepts input.
- **Landing page redesign** around bring-your-own-agent and rapid MCP
  context switching, with an ACP-registry compatibility callout.
- **Workspaces layout parity**: every ACP feature is wired into the
  advanced workspaces layout as well as basic chat.

### Performance

- **Warm sandbox reuse**: closing or idling a session parks its runtime
  (sandbox + running agent) for the user's next conversation; new
  conversations adopt parked runtimes or steal an idle session's.
  Measured: new-conversation start drops from ~4.5–30s to **~1s**
  (cold 3.0s → steal 0.95s → park+adopt 1.07s → stale revive 4.0s).
- Shim health polling tightened; sandbox registration moved off the
  cold-start critical path.

### Fixed

- **Self-healing agent sessions**: sandboxes auto-stop after idling,
  which killed the shim and rotated the Daytona preview token — the next
  message failed with 401/502. Sessions now health-check and revive in
  place (same sandbox, fresh tokens, transcript replayed).
- **Stale shim after gateway restart**: `pkill` doesn't exist in the slim
  sandbox images, so the old shim survived and the new one died with
  EADDRINUSE (endless 401s). Replaced with a dependency-free pid-file
  kill + `/proc` scan.
- **Lost slash commands**: `available_commands_update` arriving before
  `session/new` resolved was dropped; out-of-session notifications are
  now buffered and replayed.
- Daytona networking: IPv4-first resolution (sandboxes blackhole
  outbound IPv6); transient toolbox connection resets retried.
- Post-auth redirect race that intermittently bounced sign-ins to the
  landing page; settings dialog overflow on paste; question-card forms
  capped so they can't consume the viewport; stop-button persistence;
  per-question custom answers no longer clobber earlier picks.

### Security

- Agent credentials are AES-256-GCM encrypted with a server-only key,
  write-only from the browser, ciphertext-only in Convex, and never
  written to sandbox disk — launcher scripts hold no secrets (passed via
  exec environment); credential files are chmod 600.
- MCP auth (OAuth/bearer) is resolved per relayed request on the backend
  and never enters the sandbox.

### Infrastructure

- Automated PR review via Claude Code on PRs into `staging`/`main`
  (draft-aware, superseded runs cancelled, repo-specific review focus).
- `@claude` mention support on issues/PRs; CI tests (vitest, pytest,
  convex-test) on pushes and PRs to `staging`/`main`; staged backend +
  frontend deploys.
- E2E scripts for codex, cursor, and Claude Code feature coverage; cold
  start profiler.
