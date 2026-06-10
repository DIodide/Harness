# Changelog

All notable changes to Harness are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); dates are `YYYY-MM-DD`.

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
