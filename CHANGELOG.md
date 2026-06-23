# Changelog

All notable changes to Harness are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); dates are `YYYY-MM-DD`.

## [1.0.0] — 2026-06-23 · Live Sessions, Sharing & Skill Packs

### Added

- **Live session following**: in-flight agent output now fans out to every viewer of a conversation — open the same chat in another tab, in `/workspaces`, or on a shared read-only page and watch the turn stream down token-by-token. Owners see a sharee's run live and sharees see the owner's; following is authorized like a shared read (owner login, an editor/viewer grant, or a share token for anonymous viewers).
- **Persistent streaming liveness**: the streaming bubble shows a continuous "Working…" heartbeat between steps (e.g. during long tool calls) so a quiet turn never reads as a frozen app, and surfaces elapsed time once a turn passes ~5s. Respects reduced-motion preferences.
- **Live workflow & subagent observability**: Claude's Workflow orchestration and Task subagents now stream what each agent is doing — type/description, running→done status, and an activity log — into both the timeline and the Agents panel instead of being invisible.

- **Rewind under any user message**: a Rewind action on every user message truncates the thread back to that point (keeping the message, deleting everything after) with an inline confirm, plus **Rewind & fork** to branch a new conversation at that point with the original left intact. Works for both standard chat and Claude Code agents, where rewind also resets the live agent session so its context matches what you see.
- **Mid-message rewind at "seams"**: hover an assistant message to reveal cut points between its steps (text, reasoning, tool calls); hovering a seam dims everything below as a preview, and clicking lets you Rewind or Rewind & fork partway through a turn. Seams appear only on the last message so a cut never silently drops later turns. A "Mid-message rewind" setting under Settings → Display (default on) shows or hides them; whole-message Rewind and Fork are unaffected.
- **Compaction summaries + clone-from-summary**: when a Claude Code conversation compacts its context, each summary is captured and shown inline (collapsible summary, trigger, and tokens reclaimed). On a compacted conversation you can continue the full chat or start a **New session from summary** — a fresh clone seeded with just the summary instead of the bloated transcript, carrying the harness/workspace forward.

- **Shareable chat links**: share any chat via a copyable public link from the chat or workspaces header. Anyone with the link gets a live, read-only view of the full transcript — text, reasoning, tool calls, and attachments — with a neutral "not available" page on revoked or invalid links.
- **Fork a shared chat into your account**: viewers can clone a shared conversation into their own account (sign-in gated, returns to the share after auth) to continue it independently; the copy drops the original's cost data.
- **Owner link controls**: manage a share from a Share dialog — create, copy, reset (rotate the link), set the role, and stop sharing at any time. Shared views show "Shared by …" with the owner's name and avatar (email is never exposed on public links).
- **Editor collaboration on shared chats**: holders of an editor link can send messages into the owner's conversation in real time. The assistant turn runs server-side on the owner's harness — default loop or the owner's coding agent, credentials, and sandbox — and is billed to the owner; collaborators get a composer, per-message author attribution, regenerate, and fork-at-message, while the owner's secrets never leave the server.
- **Viewer/editor role control in the share dialog**: creating a link gives a safe view-only link by default; an "Editing" toggle (behind a consequences confirmation that collaboration runs on your harness and is billed to you) upgrades the same link to editor, with an amber warning treatment. Switching roles keeps the URL while Reset rotates the token.
- **Side panel on shared chats for editors**: a right-hand panel with a background-agents tab and a view-only sandbox to browse, read, and search files and view git status/diff/log, plus a per-turn reasoning-effort override that applies only to the collaborator's turn and is restored afterward.
- **Share whole harnesses**: share a harness via public link or email invite from a Share card action, with a chromeless public viewer (redacted config) and Clone to make a private copy on your own account and credentials. Email invites surface under "Shared with you" once the recipient signs in with that verified email.
- **Manage Sharing page**: a new page (reached from the sidebar rail) lists everything you've shared — chats and harnesses — with revoke, change-role, and stop-sharing controls in one place.

- **Skill Packs**: bundle a set of skills together with optional **AGENTS.md** and **CLAUDE.md** context files into a reusable pack, managed from a new `/skill-packs` screen (create/edit/delete). Attach one or more packs to a harness from the create and edit flows — loose skills still work too.
- **Skills reach agentic harnesses**: a pack's skills are materialized into the sandbox for Claude Code / Codex / Cursor agents, and its AGENTS.md/CLAUDE.md are written to the sandbox root (with an optional `@AGENTS.md` lead-in for CLAUDE.md), the first time attached skills load for ACP agents.
- **One-click GitHub repo import**: enter an `owner/repo` (e.g. `greensock/gsap-skills`) to pull every skill plus the repo's top-level AGENTS.md/CLAUDE.md into a pack at once. Pre-built templates — GSAP, Anthropic Skills, Superpowers, and Vercel — run the same import and pre-fill the pack.

- **Unified workspace agent sandbox**: a harness running an ACP agent (Claude Code / Codex / Cursor) now runs inside the workspace's own sandbox — named `{Agent} · {Harness}`, reused across the workspace's chats and shared with code execution — instead of a separate throwaway box, so there are no more orphan agent sandboxes; the per-user sandbox cap was raised 5 → 20.
- **Default workspace for every account**: an undeletable "Default" workspace is guaranteed for each user; legacy workspace-less conversations are adopted into it (and their messages re-stamped so workspace-scoped search finds them).
- **Drag-and-drop workspace reordering**: manually order the `/workspaces` sidebar by dragging a row's grip or with ↑/↓ keyboard moves; new workspaces appear at the top, the order persists once on drop, and a reorder from another tab/device is picked up automatically.

- **Workspace credentials**: create a named secret once (e.g. `GITHUB_TOKEN`, `LINEAR_API_KEY`) and assign it to any workspace from the Edit Workspace dialog; assigned credentials are injected as environment variables into whichever sandbox runs that workspace's code — both the agent sandbox and standalone code-exec (chat sandbox tools and `/sandbox` routes). Values are write-only, AES-256-GCM encrypted, and never shown again after saving.
- **Manage Credentials** entry: a Credentials view at `/credentials` to create, rotate, and delete secrets, reachable from a KeyRound button in the sidebar footer (next to Manage Harnesses) on both `/workspaces` and `/chat`, plus the command palette.

- **Claude Code pre-session controls**: Mode, Model, and Effort now render and are editable before the first message (previously they required a live session), backed by static defaults plus a per-agent cache of the real options from prior sessions.
- **Harness-level agent defaults**: agent Mode, Model, and reasoning Effort are now saved on the harness and applied to new sessions, configurable from both the onboarding (create) and manage (edit) forms. Adds the **opus[1m]** model and cleaner model labels (Sonnet, Opus, Opus (1M), Fable, Haiku).
- **Bypass Permissions mode for Claude Code**: a "Bypass Permissions" mode is now selectable and actually applies in the sandbox, instead of erroring on switch or silently reverting to Default.
- **Effort slider in the agent composer**: reasoning effort is now a boxed full-width slider with stops for the agent's live effort levels (low → max) and a distinct rightmost **Ultracode** stop. The active stop derives from the draft, snaps back after a send, and the config mutation fires once on release rather than per drag step.
- **Background agents panel**: every background task for the current turn — subagents, workflows, and long-running commands — is shown with a live status chip (running / done / failed), a steps count, and expandable detail, under a `N running · M done · K failed` summary header.

- **Per-credential agent usage**: the usage dialog now has an Agent usage section that breaks down cost, tokens, and turns per agent credential (Claude Agent, Codex) over a weekly window, so you can see what each linked account spent.
- **Claude account rate limits surfaced**: when running on your own Claude subscription, the usage dialog shows your real session (5-hour) and weekly limit consumption with live reset countdowns — the same numbers as Claude Code's `/usage` — plus a Sonnet weekly window, each as its own progress bar.

- **Per-chat context menu**: hovering a conversation row in the `/chat` and `/workspaces` sidebars reveals a ⋮ menu with Pin/Unpin, Fork, Copy link, Share (View only / Can edit), Move to workspace, and Delete (two-click confirm).
- **Pin conversations**: pinned chats render in a dedicated Pinned section above the date groups, sort newest-pin-first, and are fetched independently of the recency window so they're never truncated out of the list.
- **Fork naming**: forking a chat yields "X (fork)", then "X (fork 2)", "X (fork 3)"… — gap-filling and case-insensitive, and a fork-of-a-fork continues the sequence instead of stacking suffixes. A sidebar Fork copies the whole conversation.
- **Workspace tint in /chat**: chat rows belonging to a non-Default, colored workspace get a subtle color wash and an inset left accent bar, so you can tell at a glance which workspace a chat lives in. The chat list now shows all of your chats, including workspace-assigned ones.

### Changed

- **Following stays private where it should**: only display output is relayed to passive viewers — interactive prompts (permissions/questions), owner-only infra signals (MCP errors, sandbox status), and cost/usage details are never streamed to followers.
- **Reused sandboxes prune only Harness-managed context** before re-writing the current set, so removing a skill or detaching a pack actually clears it from the sandbox on the next session — user-authored AGENTS.md/CLAUDE.md and skill files are never touched.
- **Full-page skills catalog/editor**: the catalog and editor are now full pages (`/skill-packs/new` and `/skill-packs/$packId`) with the form and an inline catalog side by side, replacing the old stacked nested modals. Toggling multiple skills accumulates them in one pass.
- **Immediate credential revocation**: assigning or unassigning a credential takes effect at once for new sessions, code-exec, and warm/parked runtimes; an in-flight agent session keeps its spawn-time env until it re-provisions rather than being force-killed.
- **Workspace-aware share routing**: opening your own share link lands in `/workspaces` on the conversation's own workspace (falling back to `/chat` only for non-workspaces users), and forking a shared chat lets you pick which of your workspaces to fork into.
- **Honest budget labels**: the daily/weekly bars are relabelled "Harness budget" with a clarifying note (they only track Harness's own spend, which is $0 on your own agent account), replacing the misleading "0% used" headline with a gauge badge that colors by the real signal and turns red when a Claude account limit is reached.
- **Decluttered, wider composer**: the standalone "Workflow" button is gone (folded into the slider's Ultracode stop), effort is pulled out of the per-option chips, and the composer is widened to match the message column. The workflow card's raw brief is now gated behind a "View raw content" toggle.
- **Background agents moved to a right-panel "Agents" tab**: live subagent / workflow / command activity now sits next to Files / Terminal / Git instead of a bottom dock that covered the chat. The tab is always available (even without a sandbox), carries a live running-count badge, and opens from either the sandbox toggle or the composer's Agents button.
- **Tabbed Manage header**: the Sandboxes, Harnesses, and Credentials screens share a header with a segmented control to switch between them directly, plus a back arrow and count.
- **Compact sidebar rail**: the four stacked full-width manage buttons in both sidebars are replaced by a tight row of icon buttons that reveal their name on hover/focus, with the active route highlighted; usage now sits as its own divider-separated section (Sandboxes · Harnesses · Credentials | Usage | Settings) and collapses cleanly when no usage data is present.
- **No false "Reconnect" for refreshable OAuth**: connected servers with a merely-expired-but-refreshable token no longer show as expired, since the gateway auto-refreshes them on use; "expired" now appears only when there is genuinely no refresh token.

### Fixed

- **Live viewers see real tool inputs**: in a shared view-only session, followers no longer get stuck on generic tool-call placeholders (empty terminal commands, missing file paths) while a message is in flight — the real arguments merge in as they arrive, matching the agent's own tab. A finished follower also clears its stale plan/todo card immediately instead of waiting for the message to persist.
- **Rewind no longer silently desyncs the agent**: if resetting the live agent session fails (network/5xx) during an in-place rewind, you now get a warning suggesting Fork instead of the view and agent quietly disagreeing. Rewinding or forking while a turn is still finishing now shows a clear "Can't rewind/fork while the turn is finishing" message instead of doing nothing or omitting the just-finished turn.
- **Compaction capture no longer stalls the live stream**: saving a compaction summary is now non-blocking, so a slow backend write can't pause token/tool output mid-turn. The clone's "Branched from" banner (with its jump-to-original link) shows correctly, and the continue-vs-clone prompt is hidden while a response is streaming so you can't navigate away from an in-flight turn.
- **Owner opening their own share link** now lands in their editable chat instead of the read-only viewer.
- **Fork survives sign-up and onboarding**: starting a fork before creating a new account no longer loses your place — the fork auto-resumes on return, with no second click.
- **"Branched from …" on a forked shared chat** now routes back to the original share link instead of an empty chat; a since-revoked link lands on the neutral "not available" page.
- **Freshly-added skills no longer silently fail to reach Claude Code**: the gateway back-fills any missing SKILL.md from GitHub on demand (bounded so it can never stall a session start) instead of skipping it and racing the frontend. Distinct skills sharing a trailing id no longer collide in the same skills directory.
- **Actionable skill-import errors**: repo and template imports that hit GitHub's API rate limit now show an actionable message (e.g. set a `GITHUB_TOKEN` to raise the limit), and invalid-repo / repo-not-found / no-skills cases surface their real reason in the toast — replacing the cryptic generic "Server Error".
- **Bounded sandbox lifetime + self-heal of a vanished sandbox**: agent/code-exec sandboxes now get an auto-delete clock (scratch boxes ~1 day, persistent workspace boxes ~14 days) so archived boxes no longer pile up; if an attached sandbox has been deleted out from under a session, the workspace transparently provisions a fresh one (explicit user-chosen sandboxes surface the loss but still clear the dead link).
- **Smoother workspace drag**: the dragged row now tracks the pointer cleanly instead of lagging and rubber-banding, with a subtle lift while dragging and correct behavior once the list is scrolled.
- **Accurate agent cost and tokens**: agent usage now records the authoritative per-turn cost and full token accounting (including cache read/creation tokens) from the SDK result message, fixing a large undercount where a session that cost ~$61 / 69M tokens was reported as ~$2.92 / 486k. Work tokens are shown with cache called out separately.
- **Limit shown exactly when it matters**: hitting your Claude session or weekly limit now reflects in the usage dialog — the rate-limit snapshot is persisted onto the credential the instant it arrives (with a "limit reached" banner), instead of being silently dropped on the very turn that got limited; the banner self-heals once the reset time passes.
- **Subscription usage scoped to Claude agents**: the live rate-limit fetch no longer fires for non-Claude credentials (Codex/Cursor), eliminating a repeated per-minute error while streaming and avoiding stale or empty snapshots overwriting good data.
- **Mode/Model dropdown truncation fixed**: option descriptions now wrap instead of being clipped.
- **Conversation kebab hidden with long titles**: in workspaces with long chat titles, the hover ⋮ menu was pushed off-screen and titles overflowed the list; titles now truncate with an ellipsis and the menu stays in view.
- **Header border seam**: aligned the `/workspaces` sidebar and main header bottom borders so the divider junction no longer shows a ~2px jog when the window is fully expanded.
- **Hardened send path against message loss and races**: sending no longer clears your composer before the network call succeeds (a failed send restores the draft and falls back to the client queue), double-pressing Enter no longer spawns two conversations/streams, Stop keeps working when a newer turn replaces an in-flight one, and queued-message chips act on the right item even as the queue shifts.
- **Streamed turns survive connection drops**: a mid-turn disconnect now saves the interrupted response instead of losing it, stuck streaming bubbles clear properly, and stale permission/question cards are dismissed when a turn ends or drops instead of lingering and erroring on answer.
- **Slash-commands scoped per user**: previously one user's command sync could overwrite another's and leak its parameters into the composer; commands are now owned and isolated per user.
- **Agent config preserved across harness switches**: your live model, effort, and mode picks are no longer reset to defaults when switching MCP servers or reviving a sandbox.
- **Harness system prompt reaches Claude Code**: a harness's configured system prompt is now forwarded to Claude Code agent sessions (appended to its preset) instead of being silently dropped on the ACP path.
- **Regenerate no longer strands later messages**: regenerating a mid-conversation message now truncates the conversation from that point instead of orphaning everything after it, and is disabled while a turn is still in flight.
- **Fixed a login wedge on the workspaces page**: signing in no longer hangs on a spinner when default-workspace creation fired before auth was ready; the page now waits for authentication and retries after a transient failure.
- **Stopped the post-sign-in redirect loop**: protected routes (workspaces, chat, onboarding, harnesses, sandboxes) no longer bounce a signed-in user back to sign-in when server-side auth lags behind the client; they now defer to the client auth gate to render and route.
- **Auto-recovery from stale app versions after a redeploy**: instead of a dead "Something went wrong" error when a lazily-loaded chunk 404s after a deploy, the app detects the stale chunk and reloads once to fetch the latest version (guarded against reload loops).
- **Faithful message content on every save path**: multi-step (tool-using) assistant turns now persist the full text of every step rather than only the last paragraph, so prior turns are sent to the model in full, search indexes the whole message, and rewind/fork stay consistent.
- **Chat sidebar no longer blanks out right after a deploy**: while a newly-added index is still backfilling, the chat list degrades gracefully to recency order and forking still works, instead of throwing and appearing to lose your chat history (no data was ever lost).

### Security

- **Shared content is served through a strict redacted projection**: public chat and harness views never expose owner identity, cost, workspace, auth tokens, MCP URLs, credential ids, or sandbox ids. Editor and view-only-sandbox access is fail-closed and bound to the specific conversation, link revocation takes effect immediately, message content is size-capped, and avatar image URLs are restricted to an allowlist.
- **Credential plaintext never leaks**: secrets are encrypted by the backend before storage — Convex and the browser only ever see the name, never the value — and decrypted values are passed only to the sandbox process env, never written to disk, snapshots, Daytona create metadata, or logs.
- **Reserved-name protection for credentials**: names like `PATH`, `NODE_OPTIONS`, `LD_*`/`DYLD_*`/`BASH_FUNC_` prefixes, agent-auth keys (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, …), `IS_SANDBOX`, and server secrets are rejected at creation, validated with whole-string matching so control-char/newline smuggling can't sneak a reserved name past the gate. Agent-auth keys also win over workspace credentials in the env merge.
- **Skill repo import is host-pinned and validated**: import input is validated and pinned to GitHub, rejecting `.`/`..` path segments to prevent SSRF and path traversal.

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
