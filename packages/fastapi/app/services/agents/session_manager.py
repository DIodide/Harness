"""ACP agent session manager.

Owns the lifecycle of external-agent sessions: Daytona sandbox provisioning,
ACP initialize/session setup, prompt turns (streamed as normalized events),
permission requests, and mid-session harness (MCP configuration) switching.

Harness switching — our bread and butter — works by opening a *new* ACP
session on the same live agent process with the new harness's mcpServers,
then transparently replaying the conversation transcript as a context
preamble on the next prompt. Approximate, but seamless from the UI.

Sessions are in-memory (single API instance). Usage/budgets are intentionally
NOT tracked here: in ACP mode the cost is incurred by the user's own agent
subscription, not Harness's OpenRouter key.
"""

import asyncio
import contextlib
import hashlib
import json
import logging
import re
import time
import uuid
from dataclasses import dataclass, field

import httpx
from daytona_sdk import DaytonaNotFoundError

from app.config import settings
from app.models import HarnessConfig, McpServer
from app.services.agents.acp_client import AcpConnection, AcpError, AcpTransportError
from app.services.agents.daytona_runtime import (
    ProvisionedRuntime,
    is_transient_daytona_error,
    provision_agent_sandbox,
    shim_port,
    stop_agent_shim,
    teardown_sandbox,
    write_cursor_mcp_config,
)

from app.services.agents.credentials import resolve_agent_credentials
from app.services.agents.registry import SANDBOX_WORKSPACE, get_agent
from app.services.mcp_client import UserContext
from app.services.workspace_credentials import resolve_workspace_env

logger = logging.getLogger(__name__)

PERMISSION_TIMEOUT_SECONDS = 300.0

# Mirrors MAX_SANDBOXES_PER_USER in convex/sandboxes.ts — enforced here
# BEFORE the Daytona sandbox exists (the Convex-side check fires only at
# registration, after the compute is already spent).
MAX_SANDBOXES_PER_USER = 5


def _workspace_env_fingerprint(env: dict[str, str]) -> str:
    """Stable fingerprint of a workspace env dict (names + values).

    Used only to detect change between a parked runtime's spawn-time env and a
    claiming session's — adding, removing, or rotating any credential yields a
    different digest. Not a security boundary; never logged with values.
    """
    if not env:
        return ""
    h = hashlib.sha256()
    for name in sorted(env):
        h.update(name.encode("utf-8"))
        h.update(b"\x00")
        h.update(env[name].encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()


class SandboxAccessError(Exception):
    """Client-supplied sandbox id that the requesting user does not own."""


class SessionProvisioningError(Exception):
    """A provisioning failure whose message is already user-actionable and
    should be surfaced verbatim (e.g. the per-user sandbox cap), rather than
    genericized by classify_agent_error.
    """

    def __init__(self, user_message: str):
        super().__init__(user_message)
        self.user_message = user_message


def _log_background_error(task: asyncio.Task) -> None:
    if not task.cancelled() and task.exception() is not None:
        logger.warning("Background ACP task failed: %s", task.exception())


def classify_agent_error(e: BaseException) -> str:
    """Map a raw provisioning/transport exception to a user-facing message.

    The raw exception (ACP protocol codes, multi-line shim logs, Daytona
    stack traces) is kept in the server log; the user sees something
    actionable instead.
    """
    if isinstance(e, SessionProvisioningError):
        return e.user_message
    if isinstance(e, DaytonaNotFoundError):
        # Owned session sandboxes auto re-provision (this message isn't shown);
        # an attached harness sandbox can't be fabricated, so stay neutral.
        return "Your agent sandbox is no longer available. Start a new session to continue."
    if isinstance(e, asyncio.TimeoutError):
        return (
            "The agent sandbox is taking longer than usual to start. "
            "Please try again."
        )
    # Only TRANSIENT failures get the "restarted, reconnect" copy — a
    # permanent DaytonaError (e.g. 401/403/422) would mislead the user into
    # resending something that will deterministically fail again.
    if isinstance(e, AcpTransportError) or is_transient_daytona_error(e):
        return (
            "Lost connection to the agent sandbox — it may have restarted. "
            "Send your message again to reconnect."
        )
    if isinstance(e, AcpError):
        return f"The agent reported an error: {e}"
    # Permanent DaytonaError (non-404 4xx), provisioning RuntimeError (shim
    # never became healthy), and anything else.
    return "The agent failed to start in its sandbox. Please try again."


# A session in one of these states is mid-flight, not idle — the reaper and
# runtime-stealing must never touch it (tearing down a provisioning/reviving
# session races its setup coroutine and corrupts runtime/connection state).
_ACTIVE_STATUSES = frozenset({"prompting", "provisioning", "reviving"})


def _session_is_reapable(
    status: str,
    turn_guard: int,
    last_activity: float,
    now: float,
    ttl: float,
    lock_held: bool,
) -> bool:
    """True when an idle session is safe to park/destroy.

    Provisioning/reviving sessions are NOT idle (last_activity isn't bumped
    during a cold start, so a slow provision would otherwise look stale); a
    non-zero turn_guard means a turn is in its pre-lock awaits; and a held
    session.lock means mid-flight ACP work (e.g. switch_harness opening a new
    ACP session under status 'ready') that a teardown would corrupt — the
    same guard _claim_parked uses to avoid stealing a busy runtime.
    """
    if status in _ACTIVE_STATUSES:
        return False
    if turn_guard > 0 or lock_held:
        return False
    return now - last_activity > ttl


@dataclass
class AgentSession:
    id: str
    user_id: str
    agent_id: str
    harness: HarnessConfig
    conversation_id: str
    status: str = "provisioning"  # provisioning|reviving|ready|prompting|error|closed
    error: str | None = None
    runtime: ProvisionedRuntime | None = None
    connection: AcpConnection | None = None
    acp_session_id: str | None = None
    agent_capabilities: dict = field(default_factory=dict)
    # ACP session config options (model, mode, effort, ...) — generic across
    # agents; the UI renders a selector per option.
    config_options: list[dict] = field(default_factory=list)
    # Agent-advertised slash commands (available_commands_update). Invoked by
    # sending "/name args" as plain prompt text; surfaced in the slash menu.
    available_commands: list[dict] = field(default_factory=list)
    # session/update notifications that arrived before acp_session_id was
    # assigned (they race the session/new response); replayed afterwards.
    early_notifications: list[dict] = field(default_factory=list)
    # Pending AskUserQuestion / MCP elicitations (elicitation/create).
    pending_questions: dict[str, asyncio.Future] = field(default_factory=dict)
    # message + parsed fields per pending question (for Q→A rendering).
    question_meta: dict[str, dict] = field(default_factory=dict)
    # Harness-side transcript for context replay across harness switches.
    transcript: list[dict] = field(default_factory=list)
    pending_replay: bool = False
    # Compaction metadata from the most recent `compact_boundary` SDK message,
    # held until the summary user-message arrives so the two can be merged into
    # one `compaction` event. None between compactions.
    pending_compaction: dict | None = None
    # MCP relay: index → real server config. The agent only ever sees
    # http://127.0.0.1:<shim>/mcp/<generation>/<index>; Daytona egress
    # restrictions and MCP credentials are both handled backend-side.
    relay_targets: list[McpServer] = field(default_factory=list)
    # Random token regenerated on every ACP session open: requests from MCP
    # clients of a PREVIOUS ACP session (the agent process outlives harness
    # switches) carry the old generation and are rejected instead of being
    # misrouted to whatever server now sits at that index.
    relay_generation: str = ""
    user_ctx: UserContext | None = None
    # Queue of normalized events for the currently streaming prompt turn.
    event_queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    # Prompts queued onto an in-flight turn (agents advertising
    # promptQueueing, e.g. Claude Code). Their events flow into the same
    # event_queue; the active stream ends only when all turns complete.
    extra_turns: list[asyncio.Task] = field(default_factory=list)
    pending_permissions: dict[str, asyncio.Future] = field(default_factory=dict)
    # JSON-RPC id floor this session's connection started counting from —
    # bumped on every adoption so ids never collide across connections that
    # share one agent process's stdio stream.
    msg_id_floor: int = 1
    ready_event: asyncio.Event = field(default_factory=asyncio.Event)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    last_activity: float = field(default_factory=time.monotonic)
    # Number of prompt() generators currently alive for this session.
    # Non-zero from the generator's very first statement — unlike status/
    # lock, which only flip after the pre-turn awaits (ready_event, healthz)
    # — so _claim_parked can never steal a session whose turn is starting.
    turn_guard: int = 0
    # Monotonic per-turn counter; combined with acp_session_id into the usage
    # ledger's idempotency key so a usage_update can't be double-counted.
    turn_index: int = 0
    # The SDK's total_cost_usd is CUMULATIVE across the ACP session (one
    # long-lived query() per session — only token usage resets per prompt), so
    # we persist per-turn DELTAs. Tracks the last cumulative cost seen; reset to
    # 0 whenever a fresh ACP session opens (the SDK cost restarts there).
    last_cost_usd: float = 0.0
    # Latest Anthropic per-account rate-limit snapshot seen on a usage_update
    # (_meta._claude/rateLimit); carried onto the authoritative result row.
    last_rate_limit: object | None = None
    # Editor-grant collaborators authorized on this session (the session always
    # runs under the OWNER's user_id; collaborators are authorized separately).
    # Maps a collaborator's Clerk subject → the share token they joined with,
    # so every action RE-VERIFIES the live grant (revocation takes effect at
    # once). The owner is never in this map.
    collaborator_tokens: dict[str, str] = field(default_factory=dict)
    # Fingerprint of the workspace credentials (env vars) the agent process was
    # LAUNCHED with — they're baked into the sandbox at spawn. Set when creds
    # are resolved; a parked runtime whose fingerprint differs from a claiming
    # session's must not be adopted (the env would be stale after a credential
    # change). "" means no workspace credentials.
    workspace_env_version: str = ""

    @property
    def supports_prompt_queueing(self) -> bool:
        meta = self.agent_capabilities.get("_meta") or {}
        claude = meta.get("claudeCode") or {}
        return bool(claude.get("promptQueueing"))


async def resolve_mcp_auth_headers(
    http_client: httpx.AsyncClient,
    server: McpServer,
    user_ctx: UserContext | None,
) -> dict[str, str]:
    """Resolve auth headers for one MCP server (mirrors mcp_client._build_headers).

    Called per relayed request so OAuth tokens are always fresh. Harness is
    the credential broker — these headers are attached backend-side and
    never enter the sandbox.
    """
    headers: dict[str, str] = {}
    if server.auth_type == "bearer" and server.auth_token:
        headers["Authorization"] = f"Bearer {server.auth_token}"
    elif server.auth_type == "tiger_junction":
        if settings.tiger_junction_mcp_token:
            headers["Authorization"] = f"Bearer {settings.tiger_junction_mcp_token}"
        if user_ctx and user_ctx.princeton_netid:
            headers["x-user-netid"] = user_ctx.princeton_netid
    elif server.auth_type == "oauth" and user_ctx and user_ctx.user_id:
        from app.services.mcp_oauth import get_valid_token

        token = await get_valid_token(http_client, user_ctx.user_id, server.url)
        if token:
            headers["Authorization"] = f"Bearer {token}"
        else:
            logger.warning(
                "No OAuth token for MCP '%s'; relaying without auth", server.name
            )
    return headers


def _content_block_text(block: dict) -> str:
    if block.get("type") == "text":
        return block.get("text", "")
    return ""


def _claude_meta(update: dict) -> dict:
    """claude-agent-acp tucks subagent parentage under _meta.claudeCode."""
    meta = update.get("_meta") or {}
    claude = meta.get("claudeCode") or {}
    return claude if isinstance(claude, dict) else {}


def _is_subagent_call(kind: str, title: str, raw_input: dict) -> bool:
    """True for an Agent/Task tool that spawns a background subagent.

    claude-agent-acp maps Agent/Task to kind "think" (same as TodoWrite and
    the Task* tools). It titles the call from `input.description`, falling
    back to the literal "Task"/"Agent" when there is none — so we match
    either that fallback title or the subagent brief signature (a `prompt`).
    TodoWrite ("Update todos (N)") and TaskCreate ("Create task: X") have
    neither and stay plain "think".
    """
    if kind != "think":
        return False
    if title in ("Task", "Agent"):
        return True
    return isinstance(raw_input, dict) and "prompt" in raw_input and (
        "description" in raw_input or "subagent_type" in raw_input
    )


def _is_tool_search(title: str, raw_input: dict) -> bool:
    """True for a tool-discovery call (Claude's ToolSearch / server tool)."""
    if (title or "").startswith("mcp__"):
        return False  # an MCP tool named *ToolSearch* is still an MCP call
    t = (title or "").lower()
    return "toolsearch" in t or "tool search" in t or "tool_search" in t


def _parse_mcp_title(title: str) -> tuple[str, str] | None:
    """Split an MCP tool title into (server, clean_tool).

    Claude names MCP tools `mcp__<server>__<tool>`; this is the unambiguous
    form. Returns None for non-MCP titles (slash/path forms are too risky to
    parse — the frontend keeps its own light heuristic for those).
    """
    if not title or not title.startswith("mcp__"):
        return None
    rest = title[len("mcp__") :]
    if "__" not in rest:
        return None
    server, tool = rest.split("__", 1)
    return server, tool.replace("_", " ").strip()


def _extract_balanced(text: str, start: int, open_ch: str, close_ch: str) -> str | None:
    """Return text[start:end] spanning a balanced open/close pair, or None.

    Skips braces inside JS string literals ('...', "...", `...`) so brace
    characters in workflow meta values (e.g. a phase detail) aren't counted.
    """
    depth = 0
    quote: str | None = None
    escaped = False
    for i in range(start, len(text)):
        c = text[i]
        if quote is not None:
            if escaped:
                escaped = False
            elif c == "\\":
                escaped = True
            elif c == quote:
                quote = None
            continue
        if c in ("'", '"', "`"):
            quote = c
        elif c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


_WF_NAME = re.compile(r"""name\s*:\s*["'`]([^"'`]+)""")
_WF_DESC = re.compile(r"""description\s*:\s*["'`]([^"'`]*)""")
_WF_TITLE = re.compile(r"""title\s*:\s*["'`]([^"'`]+)""")
_WF_DETAIL = re.compile(r"""detail\s*:\s*["'`]([^"'`]*)""")


def _parse_workflow_script(raw_input: dict) -> dict | None:
    """Parse a Claude Workflow tool's script (JS) into {name, description,
    phases:[{title,detail}], script}. Tolerant + string-only (the script is
    untrusted agent output — never eval). Returns None when there is no
    script; always preserves the raw script so the disclosure still works.
    """
    if not isinstance(raw_input, dict):
        return None
    script = raw_input.get("script")
    if not isinstance(script, str) or not script.strip():
        script = next(
            (v for v in raw_input.values() if isinstance(v, str) and v.strip()),
            None,
        )
    if not script:
        return None
    out: dict = {"script": script[:20000]}
    try:
        midx = script.find("meta")
        brace = script.find("{", midx) if midx != -1 else -1
        meta_block = (
            _extract_balanced(script, brace, "{", "}") if brace != -1 else None
        )
        if meta_block:
            m = _WF_NAME.search(meta_block)
            if m:
                out["name"] = m.group(1)
            d = _WF_DESC.search(meta_block)
            if d and d.group(1):
                out["description"] = d.group(1)
            pidx = meta_block.find("phases")
            pbr = meta_block.find("[", pidx) if pidx != -1 else -1
            arr = (
                _extract_balanced(meta_block, pbr, "[", "]") if pbr != -1 else None
            )
            phases: list[dict] = []
            if arr:
                i = 0
                while len(phases) < 40:
                    ob = arr.find("{", i)
                    if ob == -1:
                        break
                    obj = _extract_balanced(arr, ob, "{", "}")
                    if not obj:
                        break
                    t = _WF_TITLE.search(obj)
                    if t:
                        ph = {"title": t.group(1)}
                        de = _WF_DETAIL.search(obj)
                        if de and de.group(1):
                            ph["detail"] = de.group(1)
                        phases.append(ph)
                    i = ob + len(obj)
            out["phases"] = phases
    except Exception:
        logger.debug("workflow meta parse failed", exc_info=True)
    return out


def _with_workflow(raw_input: dict) -> dict:
    """Inject parsed workflow metadata into a tool's arguments when present.

    Also caps the raw `script` (which is persisted with the tool call) to the
    same bound as the parsed copy so a very large generated script can't bloat
    the persisted message.
    """
    wf = _parse_workflow_script(raw_input)
    if wf is None:
        return raw_input
    out = {**raw_input, "workflow": wf}
    if isinstance(out.get("script"), str):
        out["script"] = out["script"][:20000]
    return out


def normalize_session_update(update: dict) -> dict | None:
    """Map an ACP session/update payload to a Harness SSE event."""
    kind = update.get("sessionUpdate")
    parent_id = _claude_meta(update).get("parentToolUseId")
    if kind == "agent_message_chunk":
        return {
            "event": "token",
            "data": {
                "content": _content_block_text(update.get("content") or {}),
                # Distinct assistant messages within one turn (e.g. before and
                # after a background task completes) carry distinct messageIds;
                # the UI starts a new text part on change.
                "message_id": update.get("messageId"),
                **({"parent_id": parent_id} if parent_id else {}),
            },
        }
    if kind == "agent_thought_chunk":
        return {
            "event": "thinking",
            "data": {
                "content": _content_block_text(update.get("content") or {}),
                "message_id": update.get("messageId"),
                **({"parent_id": parent_id} if parent_id else {}),
            },
        }
    if kind == "tool_call":
        raw_input = update.get("rawInput") or {}
        title = update.get("title") or update.get("kind") or "tool"
        tool_kind = update.get("kind") or "other"
        extra: dict = {}
        # Refine the kind so the UI can render each flow first-class. These
        # are synthetic kinds the frontend branches on; no ACP agent emits
        # them, but they are deterministic from title/rawInput.
        if title == "Workflow":
            # Claude's multi-agent orchestration tool (ultracode). The script
            # (meta.name/description/phases) is usually empty on this initial
            # tool_call and arrives on a later tool_call_update rawInput; parse
            # whatever is here and let the update branch fill it in.
            tool_kind = "workflow"
            raw_input = _with_workflow(raw_input)
        elif _is_subagent_call(tool_kind, title, raw_input):
            tool_kind = "subagent"
        elif _is_tool_search(title, raw_input):
            tool_kind = "tool_search"
        else:
            mcp = _parse_mcp_title(title)
            if mcp is not None:
                extra["server_name"] = mcp[0]
                title = mcp[1]  # show the clean tool name; server in the badge
        return {
            "event": "tool_call",
            "data": {
                "call_id": update.get("toolCallId", ""),
                "tool": title,
                "arguments": raw_input,
                # ACP tool kind (execute|read|edit|delete|move|search|fetch|
                # think|switch_mode|other) plus our synthetic subagent/
                # tool_search — drives first-class rendering.
                "kind": tool_kind,
                "status": update.get("status"),
                "locations": update.get("locations") or [],
                **extra,
                # Set for tool calls made by a background/sub agent — the UI
                # nests these under the spawning Task tool call.
                **({"parent_id": parent_id} if parent_id else {}),
            },
        }
    if kind == "tool_call_update":
        status = update.get("status")
        # Display-only live command output (codex exec deltas / claude bash).
        # The agent ran the command in its own sandbox and streams output bytes
        # via _meta.terminal_output (per-chunk) and _meta.terminal_exit (at end).
        # These APPEND to the call's output instead of replacing it — and we
        # must NOT fall through to the rawOutput fallback below, which would
        # overwrite the streamed terminal with a JSON dump at completion.
        meta = update.get("_meta") or {}
        term_out = meta.get("terminal_output") or {}
        term_exit = meta.get("terminal_exit") or {}
        output_delta = term_out.get("data") if isinstance(term_out, dict) else None
        exit_code = term_exit.get("exit_code") if isinstance(term_exit, dict) else None
        if output_delta is not None or exit_code is not None:
            data: dict = {
                "call_id": update.get("toolCallId", ""),
                "append": True,
                "status": status,
            }
            if output_delta:
                data["output_delta"] = output_delta
            if exit_code is not None:
                data["exit_code"] = exit_code
            return {"event": "tool_result", "data": data}

        content = update.get("content") or []
        result_text = "\n".join(
            _content_block_text(c.get("content") or {})
            for c in content
            if isinstance(c, dict) and c.get("type") == "content"
        )
        # Structured diff content (file edits) gets first-class rendering.
        diff = next(
            (
                {
                    "path": c.get("path"),
                    "oldText": c.get("oldText"),
                    "newText": c.get("newText"),
                }
                for c in content
                if isinstance(c, dict) and c.get("type") == "diff"
            ),
            None,
        )
        raw_output = update.get("rawOutput")
        # Only terminal updates may fabricate a result from rawOutput: a
        # truthy result marks the call finished in the UI, and ACP allows
        # status-only progress updates carrying no content at all.
        fallback = (
            json.dumps(raw_output)[:4000]
            if raw_output and status in ("completed", "failed")
            else ""
        )
        # The initial tool_call often streams with empty/partial rawInput
        # (content_block_start); the COMPLETE input arrives here on the
        # refining tool_call_update. Forward it so the UI can fill in args it
        # didn't have yet — notably the Workflow tool's script (meta.phases),
        # which we parse into a structured `workflow` field here.
        refined_input = update.get("rawInput")
        if isinstance(refined_input, dict) and refined_input.get("script"):
            refined_input = _with_workflow(refined_input)
        # A content-bearing update with no explicit status IS a completion —
        # mark it so the UI stops showing it as "running" (notably execute
        # calls, which the frontend won't treat truthy-result alone as done
        # because their output also streams via the append path).
        effective_status = status or ("completed" if (result_text or fallback) else None)
        return {
            "event": "tool_result",
            "data": {
                "call_id": update.get("toolCallId", ""),
                "status": effective_status,
                "result": result_text or fallback,
                **({"diff": diff} if diff else {}),
                **(
                    {"arguments": refined_input}
                    if isinstance(refined_input, dict) and refined_input
                    else {}
                ),
            },
        }
    if kind == "config_option_update":
        return {
            "event": "config_update",
            "data": {"options": update.get("configOptions") or []},
        }
    if kind == "usage_update":
        # Context window + cost, billed to the user's own agent account.
        cost = update.get("cost") or {}
        return {
            "event": "agent_usage",
            "data": {
                "used": update.get("used"),
                "size": update.get("size"),
                "cost": cost.get("amount"),
                "currency": cost.get("currency", "USD"),
            },
        }
    if kind == "plan":
        return {"event": "plan", "data": {"entries": update.get("entries") or []}}
    if kind == "available_commands_update":
        return {
            "event": "commands_update",
            "data": {"commands": update.get("availableCommands") or []},
        }
    if kind == "current_mode_update":
        return {"event": "mode_update", "data": {"mode_id": update.get("currentModeId")}}
    # user_message_chunk and unknown kinds: nothing to surface.
    return None


# claude-agent-acp re-emits raw Claude Agent SDK messages as a `_claude/sdkMessage`
# notification when session/new opts in via `_meta.claudeCode.emitRawSDKMessages`.
# `type` is a plain string in the filter schema, so listing both the documented
# top-level shape (`type: "task_*"`) and the older system+subtype shape costs
# nothing — whichever the running SDK uses matches, the other matches nothing.
SDK_TASK_MESSAGE_FILTERS = [
    {"type": "task_started"},
    {"type": "task_progress"},
    {"type": "task_updated"},
    {"type": "task_notification"},
    {"type": "system", "subtype": "task_started"},
    {"type": "system", "subtype": "task_progress"},
    {"type": "system", "subtype": "task_updated"},
    {"type": "system", "subtype": "task_notification"},
    # Context compaction. Verified live on claude-agent-acp@0.44.0: the
    # `compact_boundary` system message carries the metadata (trigger,
    # pre/post tokens) but NOT the summary; the summary prose arrives as a
    # synthetic `type:"user"` message (string content) that the adapter
    # normally drops from session/update but DOES forward raw here. We filter
    # to the actual compaction summary in normalize on the receiving side.
    {"type": "system", "subtype": "compact_boundary"},
    {"type": "compact_boundary"},
    {"type": "user"},
    # The SDK result message (terminal message of a turn) carries the
    # authoritative total_cost_usd + full token usage (incl. cache), which the
    # thin ACP usage_update lacks. We record agent usage from it for claude-code.
    {"type": "result"},
    {"type": "system", "subtype": "result"},
]

_TASK_PHASES = {"task_started", "task_progress", "task_updated", "task_notification"}
_TASK_TERMINAL = {"completed", "failed", "killed", "cancelled"}


def _first_str(message: dict, *keys: str) -> str | None:
    """First present, non-empty string value among `keys` (defensive: the SDK
    task-message schema varies across versions / camel vs snake case)."""
    for key in keys:
        value = message.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def normalize_sdk_task_message(message: dict) -> list[dict]:
    """Map a Claude Agent SDK task-lifecycle message into Harness SSE events.

    Claude's Workflow tool (multi-agent orchestration) and Task subagents run
    *inside* the agent; claude-agent-acp drops their ``task_started/progress/
    updated/notification`` SDK messages, so their activity is otherwise
    invisible. With emitRawSDKMessages on we receive them here and reuse the
    existing subagent ``tool_call``/``tool_result`` vocabulary so each workflow
    agent renders in the timeline and the Agents panel with live status.

    Every field is read permissively — the exact schema is external and
    version-dependent — and anything unrecognized degrades to ``[]``.
    """
    if not isinstance(message, dict):
        return []
    mtype = message.get("type")
    phase = message.get("subtype") if mtype == "system" else mtype
    if phase not in _TASK_PHASES:
        return []
    task_id = _first_str(message, "task_id", "taskId", "uuid")
    if not task_id:
        return []
    # Namespaced so it can never collide with an ACP toolCallId from the normal
    # session/update path (these are a parallel id space).
    call_id = f"wf-task:{task_id}"
    # If the spawning tool-use id is known, nest under it; the frontend falls
    # back to top-level when the parent isn't present in the turn.
    parent = _first_str(
        message, "tool_use_id", "toolUseId", "parent_tool_use_id", "parentToolUseId"
    )
    parent_field = {"parent_id": parent} if parent else {}

    if phase == "task_started":
        subagent_type = _first_str(message, "subagent_type", "subagentType", "task_type")
        desc = _first_str(message, "description", "prompt")
        # Lead the row title with the agent type so "what each agent is" is
        # visible at a glance (e.g. "reviewer: audit the diff").
        if subagent_type and desc and subagent_type not in desc:
            description = f"{subagent_type}: {desc}"
        else:
            description = desc or subagent_type or "Subagent"
        args = {
            k: v
            for k, v in {
                "subagent_type": subagent_type,
                "description": _first_str(message, "description"),
                "prompt": _first_str(message, "prompt"),
            }.items()
            if v
        }
        return [
            {
                "event": "tool_call",
                "data": {
                    "call_id": call_id,
                    "tool": description,
                    "arguments": args,
                    "kind": "subagent",
                    "status": "in_progress",
                    "locations": [],
                    **parent_field,
                },
            }
        ]

    # task_updated / task_notification can be terminal; task_progress never is.
    status = message.get("status")
    if isinstance(status, dict):  # tolerate a {status: {status: ...}} patch shape
        status = status.get("status")
    if not isinstance(status, str):
        status = None
    summary = _first_str(
        message, "summary", "result", "description", "last_tool_name", "output"
    )
    output_file = _first_str(message, "output_file", "outputFile")

    if phase != "task_progress" and status in _TASK_TERMINAL:
        # The terminal `status` already marks the call done in the UI, so leave
        # the result empty (rather than echoing the bare status word) when the
        # message carries no real summary.
        result = summary or ""
        if output_file:
            result = f"{result}\n\n→ {output_file}".strip()
        return [
            {
                "event": "tool_result",
                "data": {
                    "call_id": call_id,
                    "status": "failed" if status in {"failed", "killed"} else "completed",
                    "result": result,
                },
            }
        ]

    # Non-terminal progress: append a live activity line, keep the call running.
    # `append` never blanks an existing result and won't mark the call finished.
    data: dict = {"call_id": call_id, "append": True, "status": "in_progress"}
    if summary:
        data["output_delta"] = summary.rstrip("\n") + "\n"
    return [{"event": "tool_result", "data": data}]


# Claude Code injects the post-compaction summary as a synthetic user message
# whose content begins with this exact preamble (verified live on
# claude-agent-acp@0.44.0). It's the reliable, version-stable signature that
# distinguishes the compaction summary from an ordinary user-message echo.
COMPACTION_SUMMARY_PREAMBLE = (
    "This session is being continued from a previous conversation"
)
# Generous cap so a pathological summary can't bloat an event / Convex doc.
_MAX_COMPACTION_SUMMARY_CHARS = 100_000


def _sdk_user_message_text(message: dict) -> str:
    """Extract the text of a raw SDK `type:"user"` message. Content is a string
    for the compaction-summary message and a list of blocks for normal echoes."""
    inner = message.get("message")
    content = inner.get("content") if isinstance(inner, dict) else None
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            b.get("text") or ""
            for b in content
            if isinstance(b, dict) and b.get("type") == "text"
        )
    return ""


def parse_sdk_compaction(message: dict) -> dict | None:
    """Classify a raw SDK message as a compaction `boundary` (metadata) or
    `summary` (the prose), or None. Defensive — degrades to None on any
    unexpected shape (the notification handler swallows exceptions anyway)."""
    if not isinstance(message, dict):
        return None
    mtype = message.get("type")
    subtype = message.get("subtype")
    if subtype == "compact_boundary" or mtype == "compact_boundary":
        cm = message.get("compact_metadata")
        cm = cm if isinstance(cm, dict) else {}
        trigger = cm.get("trigger")
        return {
            "kind": "boundary",
            "trigger": trigger if trigger in ("manual", "auto") else None,
            "pre_tokens": cm.get("pre_tokens"),
            "post_tokens": cm.get("post_tokens"),
        }
    if mtype == "user":
        text = _sdk_user_message_text(message)
        if text.lstrip().startswith(COMPACTION_SUMMARY_PREAMBLE):
            return {"kind": "summary", "summary": text[:_MAX_COMPACTION_SUMMARY_CHARS]}
    return None


def parse_elicitation_fields(requested_schema: dict) -> list[dict]:
    """Flatten an ACP form-elicitation JSON schema into UI-friendly fields.

    claude-agent-acp encodes AskUserQuestion as one property per question
    (string+oneOf for single-select, array+items.anyOf for multi-select)
    plus an optional free-text "customAnswer" property. Generic MCP
    elicitations may also use plain string/number/boolean properties.
    """
    fields: list[dict] = []
    for key, prop in (requested_schema.get("properties") or {}).items():
        if not isinstance(prop, dict):
            continue
        base = {
            "key": key,
            "title": prop.get("title"),
            "description": prop.get("description"),
        }
        one_of = prop.get("oneOf")
        any_of = (prop.get("items") or {}).get("anyOf") if prop.get("type") == "array" else None
        choices = one_of if isinstance(one_of, list) else any_of
        if isinstance(choices, list) and choices:
            fields.append(
                {
                    **base,
                    "kind": "multiselect" if any_of else "select",
                    "options": [
                        {
                            "value": c.get("const"),
                            "label": c.get("title") or str(c.get("const")),
                        }
                        for c in choices
                        if isinstance(c, dict) and c.get("const") is not None
                    ],
                }
            )
        elif prop.get("type") == "boolean":
            fields.append({**base, "kind": "boolean"})
        else:
            # Plain string/number inputs (incl. the customAnswer free-text).
            fields.append({**base, "kind": "text"})
    return fields


def _build_replay_preamble(transcript: list[dict]) -> str:
    """Context block replayed into a fresh ACP session.

    Two shapes: the usual harness-switch replay of the recent conversation, or
    a "new session from summary" clone seeded with a single compaction summary
    — detected by its canonical preamble and replayed IN FULL (not truncated at
    4000 like the per-message switch replay) with summary-appropriate framing.
    """
    if (
        len(transcript) == 1
        and isinstance(transcript[0].get("content"), str)
        and transcript[0]["content"].lstrip().startswith(COMPACTION_SUMMARY_PREAMBLE)
    ):
        summary = transcript[0]["content"]
        if len(summary) > 16000:
            summary = summary[:16000] + " …[truncated]"
        return "\n".join(
            [
                "<conversation_history>",
                "You are continuing a previous conversation. Below is a compacted",
                "summary of everything that happened so far — treat it as full",
                "context and continue naturally; do not mention this restoration:",
                "",
                summary,
                "</conversation_history>",
            ]
        )
    lines = [
        "<conversation_history>",
        "You are continuing an ongoing conversation. The user has switched the",
        "available tool configuration (MCP servers), which required a fresh",
        "session. Here is the conversation so far — continue it naturally and",
        "do not mention this restoration:",
        "",
    ]
    for msg in transcript[-40:]:
        role = "User" if msg["role"] == "user" else "Assistant"
        content = msg["content"]
        if len(content) > 4000:
            content = content[:4000] + " …[truncated]"
        lines.append(f"{role}: {content}")
    lines.append("</conversation_history>")
    return "\n".join(lines)


@dataclass
class ParkedRuntime:
    """A live sandbox + running agent process awaiting its next conversation.

    Parking instead of destroying is the cold-start fix: adopting a parked
    runtime skips sandbox creation, file pushes, and agent boot (~4-30s)
    and goes straight to a fresh ACP session (~1s)."""

    runtime: ProvisionedRuntime
    agent_id: str
    user_id: str
    agent_capabilities: dict
    msg_id_floor: int
    # Credential link the runtime's agent process was LAUNCHED with (env
    # vars are baked in at spawn) — a session wanting different credentials
    # must never adopt this runtime.
    credential_id: str | None = None
    # Fingerprint of the workspace env baked into the runtime at spawn. A
    # session whose workspace credentials changed (different fingerprint) must
    # not adopt this runtime — its env would be stale.
    workspace_env_version: str = ""
    parked_at: float = field(default_factory=time.monotonic)


def _result_token_categories(
    usage: object, model_usage: object
) -> dict[str, int]:
    """Cumulative token counts by category from an SDK result message.

    Prefers the top-level `usage` (snake_case, Messages-API shape); falls back to
    summing the per-model `modelUsage` block (camelCase). Defensive: any missing
    field reads as 0, so an unexpected shape degrades to zeros rather than error.
    """
    if isinstance(usage, dict):
        return {
            "input": int(usage.get("input_tokens") or 0),
            "output": int(usage.get("output_tokens") or 0),
            "cache_read": int(usage.get("cache_read_input_tokens") or 0),
            "cache_creation": int(usage.get("cache_creation_input_tokens") or 0),
        }
    out = {"input": 0, "output": 0, "cache_read": 0, "cache_creation": 0}
    if isinstance(model_usage, dict):
        for m in model_usage.values():
            if not isinstance(m, dict):
                continue
            out["input"] += int(m.get("inputTokens") or 0)
            out["output"] += int(m.get("outputTokens") or 0)
            out["cache_read"] += int(m.get("cacheReadInputTokens") or 0)
            out["cache_creation"] += int(m.get("cacheCreationInputTokens") or 0)
    return out


def _result_primary_model(model_usage: object) -> str | None:
    """The model that produced the most output tokens in this result."""
    if not isinstance(model_usage, dict):
        return None
    best: str | None = None
    best_out = -1
    for name, m in model_usage.items():
        if not isinstance(m, dict):
            continue
        out = int(m.get("outputTokens") or 0)
        if out > best_out:
            best_out = out
            best = name if isinstance(name, str) else None
    return best


def _session_model(session: "AgentSession") -> str | None:
    """The model currently selected on the session's ACP config options."""
    for opt in session.config_options:
        if isinstance(opt, dict) and opt.get("id") == "model":
            value = opt.get("currentValue")
            return value if isinstance(value, str) else None
    return None


def _is_sdk_result_message(message: dict) -> bool:
    """True for the SDK result message in either shape the adapter may use."""
    if message.get("type") == "result":
        return True
    return message.get("type") == "system" and message.get("subtype") == "result"


class AgentSessionManager:
    def __init__(self):
        self._sessions: dict[str, AgentSession] = {}
        # Warm runtimes by (user, agent, scope) — scope is the attached
        # sandbox id, or "owned" for session-owned sandboxes. One per key;
        # a newer parked runtime replaces (and destroys) an older one.
        self._parked: dict[tuple[str, str, str], ParkedRuntime] = {}
        self._reaper_task: asyncio.Task | None = None
        self._http: httpx.AsyncClient | None = None
        # Fire-and-forget usage-recording tasks; held so they aren't GC'd
        # mid-flight, discarded on completion.
        self._usage_tasks: set[asyncio.Task] = set()

    @staticmethod
    def _runtime_key(
        user_id: str, agent_id: str, attach_sandbox_id: str | None,
    ) -> tuple[str, str, str]:
        return (user_id, agent_id, attach_sandbox_id or "owned")

    @staticmethod
    def _session_attach_id(session: AgentSession) -> str | None:
        if session.runtime is not None and not session.runtime.owns_sandbox:
            return session.runtime.sandbox_id
        return None

    def _http_client(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(timeout=30.0)
        return self._http

    async def _inject_workspace_env(
        self, creds, harness: HarnessConfig, user_id: str,
    ) -> str:
        """Merge the workspace's assigned credential env into `creds.env` and
        return a fingerprint of that env.

        Agent-auth keys win over workspace credentials (defense-in-depth — the
        reserved-name denylist already prevents collisions). The fingerprint
        identifies the exact env baked into the sandbox at spawn so a parked
        runtime with stale credentials is never adopted. Returns "" when the
        harness has no workspace or no assigned credentials.

        NEVER log `creds.env` or the resolved values.
        """
        workspace_id = getattr(harness, "workspace_id", None)
        if not workspace_id:
            return ""
        try:
            ws_env = await resolve_workspace_env(
                self._http_client(), workspace_id, user_id,
            )
        except Exception:
            # Supplementary env must never block a session from starting.
            logger.exception(
                "Failed to resolve workspace credentials for workspace '%s'",
                workspace_id,
            )
            return ""
        if not ws_env:
            return ""
        # Agent auth (creds.env) overrides workspace-supplied names.
        creds.env = {**ws_env, **creds.env}
        return _workspace_env_fingerprint(ws_env)

    def get(self, session_id: str, user_id: str) -> AgentSession:
        session = self._sessions.get(session_id)
        if session is None or session.user_id != user_id:
            raise KeyError(session_id)
        return session

    def peek(self, session_id: str) -> AgentSession | None:
        """Look up a session WITHOUT an ownership check. The route layer is
        responsible for authorization (owner fast-path or a re-verified editor
        grant). Never expose this result without authorizing first."""
        return self._sessions.get(session_id)

    def note_collaborator(self, session_id: str, user_id: str, token: str) -> None:
        """Record that an editor-grant collaborator joined this session with
        `token`, so later actions can re-verify the live grant. No-op if the
        user is the owner (sessions run under the owner's id)."""
        session = self._sessions.get(session_id)
        if session is None or session.user_id == user_id:
            return
        session.collaborator_tokens[user_id] = token

    # ── Creation ───────────────────────────────────────────

    async def create(
        self,
        user_id: str,
        agent_id: str,
        harness: HarnessConfig,
        conversation_id: str,
        user_ctx: UserContext | None,
    ) -> AgentSession:
        agent = get_agent(agent_id)  # raises KeyError for unknown agents

        # One live session per conversation: a reload or second tab must
        # share the existing runtime, not race it for the same sandbox and
        # double-persist assistant messages.
        for existing in self._sessions.values():
            if (
                existing.user_id == user_id
                and existing.conversation_id == conversation_id
                and existing.agent_id == agent_id
                and existing.status not in ("error", "closed")
            ):
                if existing.harness.harness_id != harness.harness_id:
                    logger.info(
                        "Reusing session '%s' for conversation '%s' despite a "
                        "different harness — the client switches explicitly",
                        existing.id, conversation_id,
                    )
                return existing

        # The sandbox id is client-supplied: never attach an agent to a
        # sandbox the requesting user does not own.
        if harness.sandbox_enabled and harness.sandbox_id:
            from app.services.convex import verify_sandbox_owner

            if not await verify_sandbox_owner(harness.sandbox_id, user_id):
                raise SandboxAccessError(
                    "Sandbox not found or not owned by this user"
                )

        creds = await resolve_agent_credentials(
            self._http_client(), agent_id, user_id,
            credential_id=harness.agent_credential_id,
        )
        session = AgentSession(
            id=uuid.uuid4().hex,
            user_id=user_id,
            agent_id=agent.id,
            harness=harness,
            conversation_id=conversation_id,
        )
        # Inject the workspace's assigned env-var credentials and record the
        # fingerprint BEFORE provisioning so _claim_parked can compare it.
        session.workspace_env_version = await self._inject_workspace_env(
            creds, harness, user_id,
        )
        self._sessions[session.id] = session
        self._ensure_reaper()
        asyncio.create_task(self._provision(session, creds, user_ctx))
        return session

    def _claim_parked(self, session: AgentSession, attach_sandbox_id: str | None):
        """Pop a warm runtime for this session, stealing from an idle live
        session of the same (user, agent, scope) when none is parked.

        Stealing is what makes "new chat" fast: the previous conversation's
        session usually still holds a perfectly warm agent. Its frontend
        cache will 404 on next use and recreate (possibly stealing back) —
        each hop costs ~1s instead of a full cold start. Sessions that are
        mid-prompt are never touched.
        """
        key = self._runtime_key(session.user_id, session.agent_id, attach_sandbox_id)
        parked = self._parked.pop(key, None)
        if parked is not None:
            if (
                parked.credential_id == session.harness.agent_credential_id
                and parked.workspace_env_version == session.workspace_env_version
            ):
                return parked
            # The runtime's agent was launched with DIFFERENT credentials or
            # workspace env (both fixed at spawn) — adopting it would keep e.g.
            # a rotated-away token alive. Destroy it and provision fresh.
            logger.info(
                "Discarding parked %s runtime (sandbox=%s): credentials "
                "changed", parked.agent_id, parked.runtime.sandbox_id,
            )
            destroy = asyncio.create_task(
                self._destroy_runtime(parked.runtime, parked.agent_id)
            )
            destroy.add_done_callback(_log_background_error)
        victims = [
            s
            for s in self._sessions.values()
            if s.id != session.id
            and s.user_id == session.user_id
            and s.agent_id == session.agent_id
            and s.harness.agent_credential_id == session.harness.agent_credential_id
            and s.workspace_env_version == session.workspace_env_version
            and s.status == "ready"
            and not s.lock.locked()
            and s.turn_guard == 0
            and s.runtime is not None
            and self._runtime_key(s.user_id, s.agent_id, self._session_attach_id(s))
            == key
        ]
        if not victims:
            return None
        victim = max(victims, key=lambda s: s.last_activity)
        logger.info(
            "Stealing idle session '%s' runtime for new conversation '%s'",
            victim.id, session.conversation_id,
        )
        return victim, key

    async def _adopt(self, session: AgentSession, parked: ParkedRuntime) -> bool:
        """Bind this session to a warm runtime: new connection (skipping the
        shim's buffered history), fresh ACP session on the already-running
        agent. Falls back to revive-in-place when the runtime went stale
        (e.g. sandbox auto-stopped). Returns False only on hard failure."""
        runtime = parked.runtime
        conn = AcpConnection(
            runtime.base_url, runtime.headers, start_msg_id=parked.msg_id_floor,
        )
        info = await conn.probe()
        if info and info.get("agentRunning"):
            conn.start_from(int(info.get("seq") or 0))
            session.runtime = runtime
            session.msg_id_floor = parked.msg_id_floor
            session.agent_capabilities = parked.agent_capabilities
            session.connection = conn
            conn.on_notification = self._make_notification_handler(session)
            conn.on_request = self._make_request_handler(session)
            conn.on_relay_request = self._make_relay_handler(session)
            await conn.start()
            logger.info(
                "Adopted warm %s runtime (sandbox=%s) for session '%s'",
                session.agent_id, runtime.sandbox_id, session.id,
            )
            return True
        # Stale (sandbox auto-stopped / token rotated): revive in place —
        # still reuses the same sandbox, just relaunches the shim + agent.
        await conn.close()
        session.runtime = runtime
        try:
            await self._revive(session)
            return True
        except Exception:
            logger.exception(
                "Adoption revive failed for sandbox '%s'; falling back to fresh",
                runtime.sandbox_id,
            )
            with contextlib.suppress(Exception):
                await self._destroy_runtime(runtime, session.agent_id)
            session.runtime = None
            session.connection = None
            return False

    async def _provision(self, session: AgentSession, creds, user_ctx) -> None:
        """Bring a session to 'ready', bounded and transient-retrying.

        A cold Daytona provision can wedge (slow control plane) or blip
        (429/5xx/connection reset). Cap the whole attempt with a wall-clock
        timeout so awaiters of ready_event never hang forever, and retry a
        transient cold-start once before giving up. Either way the user gets
        an actionable message, not a raw stack trace.
        """
        try:
            await asyncio.wait_for(
                self._provision_with_retry(session, creds, user_ctx),
                timeout=settings.acp_provision_timeout_seconds,
            )
        except asyncio.TimeoutError:
            # to_thread can't truly cancel the underlying Daytona call, so a
            # sandbox may still be created and then orphaned (the session ends
            # with runtime=None, so neither the reaper nor the per-user cap
            # tracks it; Daytona only auto-stops it). The win here is purely
            # that ready_event awaiters unblock now instead of hanging forever.
            logger.error(
                "Provisioning for session '%s' exceeded %ss — marking errored",
                session.id, settings.acp_provision_timeout_seconds,
            )
            session.status = "error"
            session.error = classify_agent_error(asyncio.TimeoutError())
        except Exception as e:
            logger.exception("Provisioning failed for session '%s'", session.id)
            session.status = "error"
            session.error = classify_agent_error(e)
        finally:
            session.ready_event.set()

    async def _provision_with_retry(self, session, creds, user_ctx) -> None:
        attempts = 2
        for attempt in range(1, attempts + 1):
            try:
                await self._provision_once(session, creds, user_ctx)
                return
            except Exception as e:
                if attempt >= attempts or not is_transient_daytona_error(e):
                    raise
                logger.warning(
                    "Transient cold-start failure for session '%s' "
                    "(attempt %d/%d): %s — retrying",
                    session.id, attempt, attempts, e,
                )
                # Drop any half-open connection before a fresh attempt.
                if session.connection is not None:
                    with contextlib.suppress(Exception):
                        await session.connection.close()
                    session.connection = None
                await asyncio.sleep(1.0 * attempt)

    async def _provision_once(self, session: AgentSession, creds, user_ctx) -> None:
        agent = get_agent(session.agent_id)
        # Deeper unification: harnesses with a sandbox run the agent
        # INSIDE that sandbox (user's real files, persistent), instead
        # of a session-owned scratch sandbox.
        attach_sandbox_id = (
            session.harness.sandbox_id
            if session.harness.sandbox_enabled and session.harness.sandbox_id
            else None
        )

        # Warm path: adopt a parked runtime (or steal an idle session's)
        # before paying for a cold sandbox.
        session.user_ctx = user_ctx  # revive-during-adopt opens with it
        adopted = False
        claim = self._claim_parked(session, attach_sandbox_id)
        if isinstance(claim, tuple):
            victim, key = claim
            await self._teardown(victim, park=True)
            claim = self._parked.pop(key, None)
        if claim is None and attach_sandbox_id is not None:
            claim = await self._take_over_attached(session, attach_sandbox_id)
        if claim is not None:
            adopted = await self._adopt(session, claim)
            if adopted and session.acp_session_id is None:
                # Warm adopt skips _revive's open — open the ACP session.
                await self._open_acp_session(session, user_ctx)

        if not adopted:
            if attach_sandbox_id is None:
                await self._check_sandbox_cap(session.user_id)
            session.runtime = await asyncio.to_thread(
                provision_agent_sandbox,
                session.user_id,
                agent,
                creds,
                attach_sandbox_id,
            )
            conn = AcpConnection(
                session.runtime.base_url, session.runtime.headers,
            )
            session.connection = conn
            conn.on_notification = self._make_notification_handler(session)
            conn.on_request = self._make_request_handler(session)
            conn.on_relay_request = self._make_relay_handler(session)
            await conn.start()

            init = await conn.initialize()
            session.agent_capabilities = init.get("agentCapabilities") or {}
            await self._open_acp_session(session, user_ctx)

        # Register in the sandboxes table so the agent's sandbox shows up
        # in Manage Sandboxes and the existing terminal/file tooling works
        # against it (attached harness sandboxes are already registered).
        # Best-effort: a cap or Convex hiccup must not block the session.
        if not adopted and session.runtime.owns_sandbox:
            # Fire-and-forget: registration is bookkeeping, not part of
            # the user's cold-start wait. Adopted runtimes are already
            # registered from their first provisioning.
            asyncio.create_task(
                self._register_sandbox_record(
                    session.user_id, session.runtime.sandbox_id, agent.name,
                )
            )

        session.status = "ready"
        logger.info(
            "ACP session '%s' ready (agent=%s, acp_session=%s)",
            session.id, session.agent_id, session.acp_session_id,
        )


    async def _take_over_attached(
        self, session: AgentSession, attach_sandbox_id: str,
    ):
        """Claim an attached sandbox held by another live session.

        One shim per (agent, attached sandbox): provisioning over a live
        session would kill its shim underneath it and rotate the token
        (silent connection-resets, then 401s, mid-turn). Instead the newer
        conversation wins deterministically — the holder's turn is
        cancelled, its stream gets an explanatory error, and its runtime is
        parked for adoption. Returns a ParkedRuntime or None.
        """
        key = self._runtime_key(session.user_id, session.agent_id, attach_sandbox_id)
        holder = next(
            (
                s
                for s in self._sessions.values()
                if s.id != session.id
                and self._runtime_key(s.user_id, s.agent_id, self._session_attach_id(s))
                == key
            ),
            None,
        )
        if holder is None:
            return None
        logger.info(
            "Taking over attached sandbox '%s' from session '%s' for "
            "conversation '%s'",
            attach_sandbox_id, holder.id, session.conversation_id,
        )
        with contextlib.suppress(Exception):
            if holder.connection is not None and holder.acp_session_id:
                await holder.connection.cancel(holder.acp_session_id)
        await holder.event_queue.put(
            {
                "event": "error",
                "data": {
                    "message": "This agent was taken over by a newer "
                    "conversation on the same sandbox.",
                },
            }
        )
        await self._teardown(holder, park=True)
        parked = self._parked.pop(key, None)
        if parked is not None and (
            parked.credential_id != session.harness.agent_credential_id
            or parked.workspace_env_version != session.workspace_env_version
        ):
            # Launched with different agent credentials OR different workspace
            # env (both baked in at spawn) — provision fresh into the sandbox
            # instead (the launcher replaces the shim anyway), so a rotated or
            # revoked credential takes effect immediately. Mirrors _claim_parked.
            await self._destroy_runtime(parked.runtime, parked.agent_id)
            return None
        return parked

    async def _check_sandbox_cap(self, user_id: str) -> None:
        """Refuse to create an owned agent sandbox past the per-user cap."""
        from app.services.convex import count_user_sandboxes

        count = await count_user_sandboxes(self._http_client(), user_id)
        if count is not None and count >= MAX_SANDBOXES_PER_USER:
            raise SessionProvisioningError(
                f"Sandbox limit reached ({count}/{MAX_SANDBOXES_PER_USER}) — "
                "delete a sandbox in Manage Sandboxes before starting "
                "another agent session."
            )

    async def _register_sandbox_record(
        self, user_id: str, sandbox_id: str, agent_name: str,
    ) -> None:
        """Best-effort Manage Sandboxes registration for agent sandboxes."""
        try:
            from app.services.convex import create_sandbox_record

            await create_sandbox_record(
                self._http_client(),
                user_id,
                None,  # never hijack the harness's own sandbox slot
                sandbox_id,
                f"{agent_name} \u00b7 agent session",
                "python",
                False,
                {"cpu": 2, "memoryGB": 4, "diskGB": 10},
            )
        except Exception as e:
            logger.warning(
                "Could not register agent sandbox '%s' in Convex: %s",
                sandbox_id, e,
            )

    async def _reregister_after_loss(
        self, user_id: str, old_sandbox_id: str, new_sandbox_id: str,
        agent_name: str,
    ) -> None:
        """Swap the Manage Sandboxes record when a gone sandbox is replaced
        by a fresh one during revive — drop the dead id (frees the cap) then
        register the new one."""
        from app.services.convex import ConvexMutationError, run_convex_mutation

        with contextlib.suppress(ConvexMutationError):
            await run_convex_mutation(
                self._http_client(),
                "sandboxes:removeByDaytonaId",
                {"daytonaSandboxId": old_sandbox_id},
            )
        await self._register_sandbox_record(user_id, new_sandbox_id, agent_name)

    async def _revive(self, session: AgentSession) -> None:
        """Re-provision a session whose runtime went stale.

        Session sandboxes auto-stop after 30 idle minutes while in-memory
        sessions live longer; a stopped/restarted sandbox loses the shim
        process and rotates the Daytona preview token, so the old runtime
        is unusable (proxy 401/502). Relaunch the shim into the SAME
        sandbox with fresh tokens, rebuild the connection, and open a new
        ACP session — the transcript replays on the next prompt.
        """
        assert session.runtime is not None
        session.status = "reviving"
        logger.info(
            "Reviving stale runtime for session '%s' (agent=%s, sandbox=%s)",
            session.id, session.agent_id, session.runtime.sandbox_id,
        )
        if session.connection is not None:
            await session.connection.close()
            session.connection = None

        agent = get_agent(session.agent_id)
        creds = await resolve_agent_credentials(
            self._http_client(), session.agent_id, session.user_id,
            credential_id=session.harness.agent_credential_id,
        )
        # Re-provisioning relaunches the agent process, so pick up the LATEST
        # workspace credentials here (this is the point at which a revocation
        # or rotation takes effect for a previously-live session).
        session.workspace_env_version = await self._inject_workspace_env(
            creds, session.harness, session.user_id,
        )
        owns = session.runtime.owns_sandbox
        old_sandbox_id = session.runtime.sandbox_id
        try:
            session.runtime = await asyncio.to_thread(
                provision_agent_sandbox,
                session.user_id,
                agent,
                creds,
                None,
                session.runtime,
            )
        except DaytonaNotFoundError:
            # The sandbox was garbage-collected/deleted out from under us.
            # For an owned session sandbox the workspace was scratch anyway,
            # so provision a brand-new one and replay the transcript rather
            # than dead-ending. An attached harness sandbox can't be
            # fabricated — surface the loss.
            if not owns:
                raise
            logger.warning(
                "Sandbox for session '%s' is gone — provisioning a fresh one",
                session.id,
            )
            # If the old sandbox still EXISTS on Daytona but is wedged in an
            # error state (vs. truly deleted), tear down the tombstone so it
            # doesn't linger against the user's quota. Best-effort: a 404 here
            # (truly gone) is fine.
            with contextlib.suppress(Exception):
                await asyncio.to_thread(teardown_sandbox, old_sandbox_id)
            session.runtime = await asyncio.to_thread(
                provision_agent_sandbox,
                session.user_id,
                agent,
                creds,
                None,
                None,
            )
            # The Manage Sandboxes record still points at the dead sandbox and
            # counts against the per-user cap — drop it and register the fresh
            # one. Best-effort: bookkeeping must not fail the revive.
            if session.runtime.owns_sandbox:
                reregister = asyncio.create_task(
                    self._reregister_after_loss(
                        session.user_id, old_sandbox_id,
                        session.runtime.sandbox_id, agent.name,
                    )
                )
                reregister.add_done_callback(_log_background_error)
        await self._rebuild_connection(session)
        session.pending_replay = bool(session.transcript)
        session.status = "ready"
        session.error = None
        logger.info(
            "Session '%s' revived (acp_session=%s)",
            session.id, session.acp_session_id,
        )

    async def _rebuild_connection(self, session: AgentSession) -> None:
        """Open a fresh ACP connection over session.runtime and re-init."""
        assert session.runtime is not None
        conn = AcpConnection(session.runtime.base_url, session.runtime.headers)
        session.connection = conn
        conn.on_notification = self._make_notification_handler(session)
        conn.on_request = self._make_request_handler(session)
        conn.on_relay_request = self._make_relay_handler(session)
        await conn.start()
        init = await conn.initialize()
        session.agent_capabilities = init.get("agentCapabilities") or {}
        # Revive opens a fresh ACP session — keep the user's live config picks.
        await self._open_acp_session(session, session.user_ctx, preserve_config=True)

    async def _ensure_alive(self, session: AgentSession) -> bool:
        """Health-check the runtime; revive if stale. False on hard failure."""
        conn = session.connection
        if conn is not None and conn.agent_exited is None and await conn.healthz():
            return True
        try:
            await self._revive(session)
            return True
        except Exception as e:
            logger.exception("Revive failed for session '%s'", session.id)
            session.status = "error"
            session.error = classify_agent_error(e)
            return False

    @staticmethod
    def _build_session_meta(session: AgentSession) -> dict | None:
        """session/new `_meta`. Scoped to claude-code (other agents ignore it).

        - emitRawSDKMessages: re-emit SDK task-lifecycle messages (otherwise
          dropped) so Workflow/subagent activity is visible.
        - options.systemPrompt: forward the harness system prompt (silently
          dropped on the ACP path before). APPEND to Claude Code's preset so
          its tool-use scaffolding survives — a bare string would replace it.

        Relies on the adapter spreading `_meta.claudeCode.options` into the SDK
        query() options (verified against acp-agent.ts), NOT a stable ACP
        contract — re-verify on any claude-agent-acp version bump.
        """
        if session.agent_id != "claude-code":
            return None
        claude_meta: dict = {"emitRawSDKMessages": SDK_TASK_MESSAGE_FILTERS}
        if session.harness.system_prompt:
            claude_meta["options"] = {
                "systemPrompt": {
                    "type": "preset",
                    "preset": "claude_code",
                    "append": session.harness.system_prompt,
                }
            }
        return {"claudeCode": claude_meta}

    async def _open_acp_session(
        self, session: AgentSession, user_ctx, preserve_config: bool = False,
    ) -> None:
        assert session.connection is not None
        # session/new resets config to the agent's defaults. On a harness
        # switch or a revive we restore the user's live picks (model, effort,
        # mode) instead of resetting them — snapshot before opening.
        prior_config: dict[str, str] = {}
        if preserve_config:
            prior_config = {
                o["id"]: o["currentValue"]
                for o in session.config_options
                if isinstance(o, dict)
                and o.get("id")
                and isinstance(o.get("currentValue"), str)
            }
        mcp_caps = session.agent_capabilities.get("mcpCapabilities") or {}
        servers = session.harness.mcp_servers
        if servers and not mcp_caps.get("http", False):
            logger.warning(
                "Agent '%s' does not advertise http MCP support; "
                "passing %d servers anyway", session.agent_id, len(servers),
            )
        # Point the agent at local relay endpoints; the real URLs and auth
        # live only on this side of the tunnel.
        session.user_ctx = user_ctx
        session.relay_targets = list(servers)
        session.relay_generation = uuid.uuid4().hex[:8]
        acp_servers = [
            {
                "type": "http",
                "name": server.name,
                "url": (
                    f"http://127.0.0.1:{shim_port(get_agent(session.agent_id))}"
                    f"/mcp/{session.relay_generation}/{index}"
                ),
                "headers": [],
            }
            for index, server in enumerate(servers)
        ]
        # Cursor ignores session/new mcpServers — it loads MCP from its
        # config file. Write that file (relay URLs + allowlist) before
        # opening the session so the servers are present from the start.
        if session.agent_id == "cursor" and session.runtime is not None:
            await asyncio.to_thread(
                write_cursor_mcp_config,
                session.runtime.sandbox_id,
                shim_port(get_agent(session.agent_id)),
                servers,
                session.relay_generation,
            )
        session_meta = self._build_session_meta(session)
        result = await session.connection.new_session(
            cwd=(session.runtime.cwd if session.runtime else SANDBOX_WORKSPACE),
            mcp_servers=acp_servers,
            meta=session_meta,
        )
        session.acp_session_id = result["sessionId"]
        # Fresh ACP session → the thin usage_update's cumulative cost restarts at
        # ~0, so reset its running baseline. (Result-message usage is per-turn,
        # so it keeps no cross-turn baseline.)
        session.last_cost_usd = 0.0
        session.config_options = result.get("configOptions") or []
        # Replay notifications that raced the session/new response: Claude
        # Code sends available_commands_update on a setTimeout(0) right after
        # responding, which lands before acp_session_id is assigned above and
        # would otherwise be dropped by the id filter.
        early, session.early_notifications = session.early_notifications, []
        for params in early:
            if params.get("sessionId") == session.acp_session_id:
                await self._process_session_update(session, params)
        if preserve_config and prior_config:
            await self._reapply_config(session, prior_config)
        else:
            await self._apply_harness_model(session)
            await self._apply_harness_config(session)

    @staticmethod
    def _config_value_offered(option: dict, value: str) -> bool:
        """True if `value` is among the option's (possibly grouped) choices."""
        values: list = []
        for entry in option.get("options") or []:
            if isinstance(entry, dict) and isinstance(entry.get("options"), list):
                values.extend(
                    c.get("value") for c in entry["options"] if isinstance(c, dict)
                )
            elif isinstance(entry, dict):
                values.append(entry.get("value"))
        return value in values

    async def _reapply_config(
        self, session: AgentSession, prior: dict[str, str],
    ) -> None:
        """Restore previously-set config values to a freshly-opened ACP
        session (harness switch / revive) so the user's picks survive. Only
        re-applies values the new option list still offers."""
        if session.connection is None or session.acp_session_id is None:
            return
        for option_id, value in prior.items():
            option = next(
                (o for o in session.config_options if o.get("id") == option_id),
                None,
            )
            if not option or option.get("currentValue") == value:
                continue
            if not self._config_value_offered(option, value):
                continue
            try:
                result = await session.connection.set_config_option(
                    session.acp_session_id, option_id, value,
                )
                if result.get("configOptions") is not None:
                    session.config_options = result["configOptions"]
                logger.info(
                    "Re-applied %s=%r to session '%s' after re-open",
                    option_id, value, session.id,
                )
            except Exception as e:
                logger.warning(
                    "Could not re-apply %s=%r on session '%s': %s",
                    option_id, value, session.id, e,
                )

    async def _apply_harness_config(self, session: AgentSession) -> None:
        """Best-effort: seed the harness's persisted ACP mode/effort defaults on
        a fresh session (like _apply_harness_model). Forwarded VERBATIM (not
        gated on the advertised choices) so a valid-but-unadvertised value such
        as bypassPermissions still applies — the wrapper validates and any
        rejection is caught/logged."""
        if session.connection is None or session.acp_session_id is None:
            return
        desired: dict[str, str] = {}
        mode = (session.harness.agent_mode or "").strip()
        if mode:
            desired["mode"] = mode
        effort = (session.harness.reasoning_effort or "").strip()
        if effort:
            # The wrapper names the option either "effort" or "reasoning_effort".
            for oid in ("effort", "reasoning_effort"):
                if any(o.get("id") == oid for o in session.config_options):
                    desired[oid] = effort
                    break
        for option_id, value in desired.items():
            option = next(
                (o for o in session.config_options if o.get("id") == option_id),
                None,
            )
            if option and option.get("currentValue") == value:
                continue
            try:
                result = await session.connection.set_config_option(
                    session.acp_session_id, option_id, value,
                )
                if result.get("configOptions") is not None:
                    session.config_options = result["configOptions"]
                logger.info(
                    "Applied harness %s=%r to session '%s'",
                    option_id, value, session.id,
                )
            except Exception as e:
                logger.warning(
                    "Could not apply harness %s=%r: %s", option_id, value, e,
                )

    async def _apply_harness_model(self, session: AgentSession) -> None:
        """Best-effort: select the harness's configured model on a fresh ACP
        session via the generic "model" config option. Harness model choice
        and agent loop are linked — the agent's own option list stays
        authoritative, so unknown values are skipped, not errors."""
        model = (session.harness.model or "").strip()
        if (
            not model
            or model == "acp"
            or session.connection is None
            or session.acp_session_id is None
        ):
            return
        option = next(
            (o for o in session.config_options if o.get("id") == "model"), None,
        )
        if not option or option.get("currentValue") == model:
            return
        values: list[str] = []
        for entry in option.get("options") or []:
            if isinstance(entry, dict) and isinstance(entry.get("options"), list):
                values.extend(
                    c.get("value") for c in entry["options"] if isinstance(c, dict)
                )
            elif isinstance(entry, dict):
                values.append(entry.get("value"))
        if model not in values:
            logger.info(
                "Harness model %r not offered by agent '%s' (choices: %d)",
                model, session.agent_id, len(values),
            )
            return
        try:
            result = await session.connection.set_config_option(
                session.acp_session_id, "model", model,
            )
            if result.get("configOptions") is not None:
                session.config_options = result["configOptions"]
            logger.info(
                "Applied harness model %r to session '%s'", model, session.id,
            )
        except Exception as e:
            logger.warning("Could not apply harness model %r: %s", model, e)

    def _make_relay_handler(self, session: AgentSession):
        async def handle(payload: dict) -> None:
            conn = session.connection
            if conn is None:
                return
            req_id = payload.get("reqId")
            status, resp_headers, body = 502, {}, b""
            try:
                rest = payload.get("path", "").split("/mcp/", 1)[1]
                generation, _, index_part = rest.partition("/")
                index = int(index_part.split("/", 1)[0])
                # A request from a previous ACP session's MCP clients (the
                # agent process outlives harness switches) must be rejected,
                # not misrouted to whatever server now sits at that index.
                if generation != session.relay_generation:
                    raise LookupError("stale relay generation")
                target = session.relay_targets[index]
            except (IndexError, ValueError, LookupError):
                await conn.post_relay_response(
                    req_id, 404, {}, b"unknown or stale relay target",
                )
                return
            try:
                import base64

                req_headers = {
                    k: v
                    for k, v in (payload.get("headers") or {}).items()
                    if v is not None
                }
                req_headers.update(
                    await resolve_mcp_auth_headers(
                        self._http_client(), target, session.user_ctx,
                    )
                )
                resp = await self._http_client().request(
                    payload.get("method", "POST"),
                    target.url,
                    content=base64.b64decode(payload.get("bodyB64") or ""),
                    headers=req_headers,
                    timeout=httpx.Timeout(110.0, connect=15.0),
                )
                body = resp.content
                status = resp.status_code
                resp_headers = {
                    k: v
                    for k, v in resp.headers.items()
                    if k.lower() in ("content-type", "mcp-session-id", "mcp-protocol-version")
                }
            except httpx.HTTPError as e:
                logger.warning(
                    "MCP relay to '%s' failed: %s", target.name, e,
                )
                body = str(e).encode()
            except Exception:
                # Auth-refresh and decode failures must never strand the
                # shim's held request until its 120s relay timeout — always
                # answer, even if only with a 502.
                logger.exception("MCP relay to '%s' crashed", target.name)
                body = b"relay failed"
            await conn.post_relay_response(req_id, status, resp_headers, body)

        return handle

    # ── Incoming agent traffic ─────────────────────────────

    async def _process_session_update(self, session: AgentSession, params: dict) -> None:
        update = params.get("update") or {}
        # Keep session-level state fresh even between turns (the event
        # queue is only drained while a prompt streams — the initial
        # available_commands_update would otherwise be lost as stale).
        if update.get("sessionUpdate") == "config_option_update":
            session.config_options = update.get("configOptions") or []
        elif update.get("sessionUpdate") == "available_commands_update":
            session.available_commands = update.get("availableCommands") or []
        event = normalize_session_update(update)
        if event is not None:
            # Capture the latest Anthropic rate-limit snapshot off ANY usage
            # update (even one without cost), so the authoritative result-message
            # row can carry the freshest quota state.
            if event["event"] == "agent_usage":
                rl = (update.get("_meta") or {}).get("_claude/rateLimit")
                if rl is not None:
                    session.last_rate_limit = rl
            # Persist per-credential agent usage on the terminal usage_update
            # (the only one carrying cost). Thin: no cache tokens, cache-excluded
            # cost — for claude-code the SDK result message upgrades this row in
            # place (see _record_result_usage). Informational only — never gates
            # a turn — and fail-soft, so it can't disturb streaming.
            if (
                event["event"] == "agent_usage"
                and event["data"].get("cost") is not None
                and session.harness.agent_credential_id
            ):
                # Cost is cumulative-per-session; convert to a per-turn delta
                # HERE (this handler runs sequentially per session) so the
                # fire-and-forget recorder below can't race on last_cost_usd.
                cost_delta = self._per_turn_cost_delta(
                    session, float(event["data"].get("cost") or 0.0)
                )
                task = asyncio.create_task(
                    self._record_agent_usage(session, event["data"], update, cost_delta)
                )
                self._usage_tasks.add(task)
                task.add_done_callback(self._usage_tasks.discard)
            await session.event_queue.put(event)

    @staticmethod
    def _per_turn_cost_delta(session: AgentSession, cumulative: float) -> float:
        """The SDK's total_cost_usd is cumulative across the ACP session; return
        this turn's delta and advance the session's running total. Clamped at 0
        so a reset/reconnect can't record a negative cost."""
        delta = max(0.0, cumulative - session.last_cost_usd)
        session.last_cost_usd = cumulative
        return delta

    async def _record_agent_usage(
        self, session: AgentSession, data: dict, update: dict, cost: float
    ) -> None:
        """Record one turn's agent usage to Convex (per-credential, fail-soft).

        `cost` is the per-turn delta already computed by the caller.
        """
        cred_id = session.harness.agent_credential_id
        if not cred_id:
            return
        model = _session_model(session)
        # Authoritative-ish Anthropic per-account quota snapshot, if present.
        rate_limit = (update.get("_meta") or {}).get("_claude/rateLimit")
        from app.services.usage import record_agent_usage

        await record_agent_usage(
            self._http_client(),
            user_id=session.user_id,
            agent_credential_id=cred_id,
            agent=session.agent_id,
            conversation_id=session.conversation_id,
            acp_session_id=session.acp_session_id,
            model=model,
            used_tokens=int(data.get("used") or 0),
            context_size=data.get("size"),
            cost=cost,
            currency=data.get("currency") or "USD",
            turn_key=f"{session.acp_session_id}:{session.turn_index}",
            rate_limit=rate_limit,
        )

    @staticmethod
    def _result_usage_payload(
        session: AgentSession, message: dict
    ) -> dict | None:
        """Extract THIS turn's authoritative usage from an SDK `result` message.

        The result message fires once per ACP prompt turn — each turn is its own
        SDK `query()` call — so its `total_cost_usd` and token usage are PER-TURN
        totals (cumulative across the steps WITHIN the turn, not across turns).
        We therefore record them directly; no cross-turn deltas. Returns None
        when the message carries no real signal (cost ~0 AND zero tokens, e.g. an
        error/aborted turn), so a hollow result can't clobber the thin
        usage_update row already written for this turnKey.
        """
        usage = message.get("usage")
        model_usage = message.get("modelUsage")
        tokens = _result_token_categories(usage, model_usage)
        raw_cost = message.get("total_cost_usd")
        cost = max(0.0, float(raw_cost)) if isinstance(raw_cost, (int, float)) else 0.0
        if cost <= 0.0 and sum(tokens.values()) == 0:
            return None
        return {
            "model": _result_primary_model(model_usage) or _session_model(session),
            "cost": cost,
            "tokens": tokens,
            "rate_limit": session.last_rate_limit,
            "turn_key": f"{session.acp_session_id}:{session.turn_index}",
        }

    async def _record_result_usage(
        self, session: AgentSession, payload: dict
    ) -> None:
        """Persist the precomputed authoritative result-message usage to Convex
        (per-credential, fail-soft). Tagged `authoritative`, it upgrades the thin
        usage_update row written for the same turnKey. Only claude-code emits
        result messages.
        """
        cred_id = session.harness.agent_credential_id
        if not cred_id:
            return
        tokens = payload["tokens"]
        from app.services.usage import record_agent_usage

        await record_agent_usage(
            self._http_client(),
            user_id=session.user_id,
            agent_credential_id=cred_id,
            agent=session.agent_id,
            conversation_id=session.conversation_id,
            acp_session_id=session.acp_session_id,
            model=payload["model"],
            used_tokens=sum(tokens.values()),
            context_size=None,
            cost=payload["cost"],
            currency="USD",
            turn_key=payload["turn_key"],
            rate_limit=payload["rate_limit"],
            input_tokens=tokens["input"],
            output_tokens=tokens["output"],
            cache_read_tokens=tokens["cache_read"],
            cache_creation_tokens=tokens["cache_creation"],
            authoritative=True,
        )

    async def _handle_sdk_compaction(self, session: AgentSession, message: dict) -> None:
        """Merge the two compaction SDK frames into one `compaction` SSE event.

        The `compact_boundary` (metadata: trigger, token deltas) arrives first;
        the summary prose follows as a synthetic user-message. Stash the
        metadata on the boundary, then emit the merged event when the summary
        lands — gated on a preceding boundary so a user message that merely
        starts with the same preamble can't be mistaken for a compaction.
        Best-effort; exceptions here are swallowed by the notification caller.
        """
        parsed = parse_sdk_compaction(message)
        if parsed is None:
            return
        if parsed["kind"] == "boundary":
            session.pending_compaction = {
                "trigger": parsed.get("trigger"),
                "pre_tokens": parsed.get("pre_tokens"),
                "post_tokens": parsed.get("post_tokens"),
            }
            return
        # kind == "summary": only real if a boundary was just seen this turn.
        meta = session.pending_compaction
        if meta is None:
            return
        session.pending_compaction = None
        await session.event_queue.put(
            {
                "event": "compaction",
                "data": {
                    "summary": parsed["summary"],
                    "trigger": meta.get("trigger") or "manual",
                    "pre_tokens": meta.get("pre_tokens"),
                    "post_tokens": meta.get("post_tokens"),
                },
            }
        )

    async def _handle_cursor_notification(
        self, session: AgentSession, method: str, params: dict
    ) -> bool:
        """Best-effort mapping of Cursor's extension notifications onto our
        existing event vocabulary. Schemas are inferred (Cursor is
        closed-source and not live-verified here), so each path degrades to a
        no-op on an unexpected shape rather than erroring."""
        if method in ("cursor/update_todos", "cursor/updateTodos"):
            todos = params.get("todos") or params.get("items") or []
            entries = [
                {
                    "content": t.get("content") or t.get("title") or t.get("text") or "",
                    "status": t.get("status") or "pending",
                }
                for t in todos
                if isinstance(t, dict)
            ]
            await session.event_queue.put({"event": "plan", "data": {"entries": entries}})
            return True
        if method in ("cursor/task", "cursor/subagent"):
            task = params.get("task") or params
            call_id = str(task.get("id") or task.get("taskId") or uuid.uuid4().hex)
            desc = task.get("description") or task.get("prompt") or "Subagent"
            await session.event_queue.put(
                {
                    "event": "tool_call",
                    "data": {
                        "call_id": call_id,
                        "tool": desc,
                        "arguments": {"description": desc, "prompt": task.get("prompt")},
                        "kind": "subagent",
                        "status": task.get("status"),
                        "locations": [],
                    },
                }
            )
            if task.get("status") in ("completed", "failed"):
                await session.event_queue.put(
                    {
                        "event": "tool_result",
                        "data": {
                            "call_id": call_id,
                            "status": task.get("status"),
                            "result": task.get("result") or task.get("summary") or "",
                        },
                    }
                )
            return True
        return False

    def _make_notification_handler(self, session: AgentSession):
        async def handle(method: str, params: dict) -> None:
            if session.agent_id == "cursor" and method.startswith("cursor/"):
                if await self._handle_cursor_notification(session, method, params):
                    return
            if method == "_claude/sdkMessage":
                # Raw Claude Agent SDK messages (emitRawSDKMessages). Surface
                # Workflow/subagent task lifecycle that the adapter otherwise
                # drops. These arrive mid-turn, so the session id is assigned.
                if params.get("sessionId") == session.acp_session_id:
                    raw = params.get("message") or {}
                    for event in normalize_sdk_task_message(raw):
                        await session.event_queue.put(event)
                    await self._handle_sdk_compaction(session, raw)
                    # Authoritative usage (real cost + cache tokens) rides the
                    # result message; record it (fail-soft) when a credential is
                    # linked. Upgrades the thin usage_update row for this turn.
                    if (
                        _is_sdk_result_message(raw)
                        and session.harness.agent_credential_id
                    ):
                        payload = self._result_usage_payload(session, raw)
                        if payload is not None:
                            task = asyncio.create_task(
                                self._record_result_usage(session, payload)
                            )
                            self._usage_tasks.add(task)
                            task.add_done_callback(self._usage_tasks.discard)
                return
            if method != "session/update":
                return
            if params.get("sessionId") != session.acp_session_id:
                # Likely a notification racing the session/new (or
                # switch-harness) response — the agent already knows the new
                # session id while ours is still unassigned. Hold it for
                # replay in _open_acp_session instead of dropping it.
                if len(session.early_notifications) < 50:
                    session.early_notifications.append(params)
                return
            await self._process_session_update(session, params)

        return handle

    def _make_request_handler(self, session: AgentSession):
        async def handle(method: str, params: dict) -> dict:
            if method == "session/request_permission":
                return await self._handle_permission(session, params)
            if method == "elicitation/create":
                return await self._handle_elicitation(session, params)
            # fs/* and terminal/* are not advertised in clientCapabilities;
            # reject anything unexpected.
            raise AcpError(-32601, f"Client does not support {method}")

        return handle

    async def _handle_permission(self, session: AgentSession, params: dict) -> dict:
        request_id = uuid.uuid4().hex
        options = params.get("options") or []
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        session.pending_permissions[request_id] = future
        await session.event_queue.put(
            {
                "event": "permission_request",
                "data": {
                    "request_id": request_id,
                    "tool_call": params.get("toolCall") or {},
                    "options": options,
                },
            }
        )
        try:
            outcome = await asyncio.wait_for(future, timeout=PERMISSION_TIMEOUT_SECONDS)
            return {"outcome": outcome}
        except asyncio.TimeoutError:
            await session.event_queue.put(
                {
                    "event": "permission_resolved",
                    "data": {"request_id": request_id, "outcome": "cancelled"},
                }
            )
            return {"outcome": {"outcome": "cancelled"}}
        finally:
            session.pending_permissions.pop(request_id, None)

    async def answer_permission(
        self, session_id: str, user_id: str, request_id: str,
        option_id: str | None, cancelled: bool,
    ) -> None:
        session = self.get(session_id, user_id)
        future = session.pending_permissions.get(request_id)
        if future is None or future.done():
            raise KeyError(request_id)
        if cancelled or option_id is None:
            future.set_result({"outcome": "cancelled"})
        else:
            future.set_result({"outcome": "selected", "optionId": option_id})
        await session.event_queue.put(
            {
                "event": "permission_resolved",
                "data": {
                    "request_id": request_id,
                    "outcome": "cancelled" if cancelled else option_id,
                },
            }
        )

    # ── Questions (ACP form elicitation / AskUserQuestion) ─

    QUESTION_TIMEOUT_SECONDS = 600.0

    async def _handle_elicitation(self, session: AgentSession, params: dict) -> dict:
        """elicitation/create: the agent is asking the user a question.

        Claude Code's AskUserQuestion arrives here as a form elicitation;
        MCP servers can also elicit input. Surfaced to the UI as a
        question_request event; the answer resolves this request.
        """
        if params.get("mode") != "form":
            raise AcpError(-32602, "Only form elicitations are supported")
        request_id = uuid.uuid4().hex
        message = params.get("message") or ""
        fields = parse_elicitation_fields(params.get("requestedSchema") or {})
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        session.pending_questions[request_id] = future
        # Kept so the answer can be rendered as a first-class Q→A exchange.
        session.question_meta[request_id] = {"message": message, "fields": fields}
        await session.event_queue.put(
            {
                "event": "question_request",
                "data": {
                    "request_id": request_id,
                    "message": message,
                    "tool_call_id": params.get("toolCallId"),
                    "fields": fields,
                },
            }
        )
        try:
            return await asyncio.wait_for(
                future, timeout=self.QUESTION_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            await self._emit_question_outcome(session, request_id, "decline", {})
            # Decline = "user skipped" (the turn continues); cancel would
            # abort the whole tool call.
            return {"action": "decline"}
        finally:
            session.pending_questions.pop(request_id, None)
            session.question_meta.pop(request_id, None)

    async def answer_question(
        self, session_id: str, user_id: str, request_id: str,
        action: str, content: dict | None,
    ) -> None:
        session = self.get(session_id, user_id)
        future = session.pending_questions.get(request_id)
        if future is None or future.done():
            raise KeyError(request_id)
        result: dict = {"action": action}
        clean: dict = {}
        if action == "accept":
            for key, value in (content or {}).items():
                if isinstance(value, str | int | float | bool):
                    clean[key] = value
                elif isinstance(value, list):
                    clean[key] = [str(v) for v in value]
            result["content"] = clean
        await self._emit_question_outcome(session, request_id, action, clean)
        future.set_result(result)

    async def _emit_question_outcome(
        self, session: AgentSession, request_id: str, action: str, content: dict,
    ) -> None:
        """question_resolved (clears the card) + question_answered (a Q→A
        exchange the UI renders and persists into the transcript)."""
        await session.event_queue.put(
            {
                "event": "question_resolved",
                "data": {"request_id": request_id, "action": action},
            }
        )
        meta = session.question_meta.get(request_id) or {}
        qa: list[dict] = []
        for field_def in meta.get("fields") or []:
            value = content.get(field_def["key"])
            if value is None or value == "" or value == []:
                continue
            label_map = {
                o["value"]: o["label"] for o in (field_def.get("options") or [])
            }
            if isinstance(value, list):
                answer = ", ".join(label_map.get(v, str(v)) for v in value)
            elif isinstance(value, bool):
                answer = "Yes" if value else "No"
            else:
                answer = label_map.get(value, str(value))
            qa.append(
                {
                    "q": field_def.get("title")
                    or field_def.get("description")
                    or field_def["key"],
                    "a": answer,
                }
            )
        await session.event_queue.put(
            {
                "event": "question_answered",
                "data": {
                    "call_id": f"question-{request_id}",
                    "message": meta.get("message") or "Question",
                    "action": action,
                    "qa": qa,
                },
            }
        )

    # ── Prompt turns ───────────────────────────────────────

    async def prompt(
        self, session_id: str, user_id: str, message: str, user_ctx,
        history: list[dict] | None = None,
        blocks: list[dict] | None = None,
    ):
        """Run one prompt turn; yields normalized SSE events.

        If the session has no transcript yet and `history` is provided
        (conversation predates the session), it seeds the transcript and is
        replayed as context — same mechanism as a harness switch.

        `blocks` are extra ACP content blocks (images) attached to the user
        message; dropped (with a log) when the agent doesn't advertise
        promptCapabilities.image.
        """
        session = self.get(session_id, user_id)
        # Guard the WHOLE turn, including the pre-lock awaits (ready_event,
        # healthz, revive): status/lock only flip later, and _claim_parked
        # stealing a session in that window tears down its connection
        # mid-request and hands its sandbox to another session.
        session.turn_guard += 1
        session.turn_index += 1
        try:
            async for event in self._prompt_turn(session, message, history, blocks):
                yield event
        finally:
            session.turn_guard -= 1

    async def _prompt_turn(
        self, session: AgentSession, message: str,
        history: list[dict] | None, blocks: list[dict] | None,
    ):
        session.last_activity = time.monotonic()
        if history and not session.transcript:
            session.transcript = [
                {"role": m["role"], "content": m["content"]}
                for m in history
                if isinstance(m.get("content"), str) and m.get("role") in ("user", "assistant")
            ]
            session.pending_replay = bool(session.transcript)

        if session.status == "provisioning":
            yield {
                "event": "status",
                "data": {"state": "provisioning", "agent": session.agent_id},
            }
            await session.ready_event.wait()
            if session.status != "error":
                yield {
                    "event": "status",
                    "data": {"state": "ready", "agent": session.agent_id},
                }
        if session.status == "error":
            # Provisioning failed (or a prior turn errored the session): the
            # message is already user-friendly and the next send recreates.
            yield {
                "event": "error",
                "data": {"message": session.error or "session failed"},
            }
            return
        if session.status == "prompting":
            yield {"event": "error", "data": {"message": "A turn is already in progress"}}
            return

        # Stale-runtime guard: the sandbox may have auto-stopped since the
        # last turn (shim gone, preview token rotated). Revive in place.
        conn = session.connection
        if conn is None or conn.agent_exited is not None or not await conn.healthz():
            yield {
                "event": "status",
                "data": {"state": "reviving", "agent": session.agent_id},
            }
            if not await self._ensure_alive(session):
                yield {
                    "event": "error",
                    "data": {"message": session.error or "could not reconnect"},
                }
                return
            yield {
                "event": "status",
                "data": {"state": "ready", "agent": session.agent_id},
            }

        assert session.connection is not None and session.acp_session_id is not None
        async with session.lock:
            session.status = "prompting"
            # Drain any stale events from a previous turn.
            while not session.event_queue.empty():
                session.event_queue.get_nowait()
            # A compaction's boundary→summary pair always lands within a single
            # turn; clear any stale boundary metadata so it can't be paired with
            # a later turn's user message that merely echoes the summary preamble.
            session.pending_compaction = None

            outgoing = message
            if session.pending_replay and session.transcript:
                outgoing = _build_replay_preamble(session.transcript) + "\n\n" + message
                session.pending_replay = False

            session.transcript.append({"role": "user", "content": message})
            session.extra_turns = []
            text_parts: list[str] = []

            extra_blocks = blocks or []
            if extra_blocks:
                prompt_caps = session.agent_capabilities.get("promptCapabilities") or {}
                if not prompt_caps.get("image", False):
                    logger.info(
                        "Agent '%s' does not accept images — dropping %d block(s)",
                        session.agent_id, len(extra_blocks),
                    )
                    extra_blocks = []

            turn = asyncio.create_task(
                session.connection.prompt(
                    session.acp_session_id, outgoing, blocks=extra_blocks,
                )
            )
            queue_get: asyncio.Task | None = None
            try:
                while True:
                    queue_get = asyncio.create_task(session.event_queue.get())
                    # Queued prompts (promptQueueing agents) add turns whose
                    # events flow through the same stream.
                    turns = {turn, *session.extra_turns}
                    done, _ = await asyncio.wait(
                        {queue_get, *turns}, return_when=asyncio.FIRST_COMPLETED,
                    )
                    if queue_get in done:
                        event = queue_get.result()
                        if event["event"] == "token":
                            text_parts.append(event["data"]["content"])
                        yield event
                        session.last_activity = time.monotonic()
                        continue
                    # A turn finished — recover the event a cancelled get()
                    # may have consumed, flush the queue, then either keep
                    # waiting (turns still in flight) or conclude.
                    queue_get.cancel()
                    leftover = None
                    with contextlib.suppress(asyncio.CancelledError):
                        leftover = await queue_get
                    pending_events = [leftover] if leftover is not None else []
                    while not session.event_queue.empty():
                        pending_events.append(session.event_queue.get_nowait())
                    for event in pending_events:
                        if event["event"] == "token":
                            text_parts.append(event["data"]["content"])
                        yield event
                    turns = {turn, *session.extra_turns}
                    if any(not t.done() for t in turns):
                        continue
                    result = turn.result()  # raises on AcpError/transport error
                    for extra in session.extra_turns:
                        if extra.exception() is not None:
                            logger.warning(
                                "Queued turn failed on session '%s': %s",
                                session.id, extra.exception(),
                            )
                    content = "".join(text_parts)
                    session.transcript.append({"role": "assistant", "content": content})
                    yield {
                        "event": "done",
                        "data": {
                            "content": content,
                            "stop_reason": result.get("stopReason"),
                            "model": f"acp:{session.agent_id}",
                        },
                    }
                    return
            except (AcpError, AcpTransportError) as e:
                logger.warning("Prompt turn failed on session '%s': %s", session.id, e)
                yield {
                    "event": "error",
                    "data": {"message": classify_agent_error(e)},
                }
            except GeneratorExit:
                # SSE client disconnected mid-turn (tab closed, dev-server
                # reload, proxy drop). Stop the now-headless turn agent-side
                # too: cancelling the local task only pops a future — without
                # session/cancel the agent keeps producing output that the
                # next turn would silently drain as stale.
                logger.warning(
                    "SSE consumer disconnected mid-turn on session '%s' "
                    "(turn still running: %s)", session.id, not turn.done(),
                )
                if (
                    not turn.done()
                    and session.connection is not None
                    and session.acp_session_id is not None
                ):
                    cancel_task = asyncio.create_task(
                        session.connection.cancel(session.acp_session_id)
                    )
                    cancel_task.add_done_callback(_log_background_error)
                raise
            except Exception as e:
                # A bug here must surface as an error event, never as a
                # silently truncated stream.
                logger.exception("Unexpected error in prompt turn on session '%s'", session.id)
                yield {"event": "error", "data": {"message": f"internal error: {e}"}}
            finally:
                if not turn.done():
                    turn.cancel()
                # asyncio.wait never cancels its awaitables — an abandoned
                # event_queue.get() would survive as a parked getter and
                # silently eat the next turn's first event (e.g. a
                # permission_request, stalling it to the 300s timeout).
                if queue_get is not None and not queue_get.done():
                    queue_get.cancel()
                session.status = "ready" if session.error is None else "error"
                session.last_activity = time.monotonic()

    async def cancel(self, session_id: str, user_id: str) -> None:
        session = self.get(session_id, user_id)
        if session.connection and session.acp_session_id:
            await session.connection.cancel(session.acp_session_id)

    async def set_config_option(
        self, session_id: str, user_id: str, config_id: str, value: str,
    ) -> list[dict]:
        """Change an ACP session config option (model, mode, effort, ...)."""
        session = self.get(session_id, user_id)
        if session.status == "provisioning":
            await session.ready_event.wait()
        if session.connection is None or session.acp_session_id is None:
            raise RuntimeError(session.error or "Session is not ready")
        result = await session.connection.set_config_option(
            session.acp_session_id, config_id, value,
        )
        if result.get("configOptions") is not None:
            session.config_options = result["configOptions"]
        session.last_activity = time.monotonic()
        return session.config_options

    async def queue_prompt(self, session_id: str, user_id: str, message: str) -> None:
        """Send an additional prompt onto an in-flight turn.

        Only valid for agents advertising promptQueueing (Claude Code): the
        agent queues the prompt and runs it after the current turn; all its
        events flow through the already-open stream.
        """
        session = self.get(session_id, user_id)
        if session.status != "prompting":
            raise RuntimeError("No active turn — send a regular prompt instead")
        if not session.supports_prompt_queueing:
            raise PermissionError(
                f"Agent '{session.agent_id}' does not support prompt queueing"
            )
        assert session.connection is not None and session.acp_session_id is not None
        session.transcript.append({"role": "user", "content": message})
        session.extra_turns.append(
            asyncio.create_task(
                session.connection.prompt(session.acp_session_id, message)
            )
        )
        session.last_activity = time.monotonic()

    # ── Harness switching (MCP quick-switch) ───────────────

    async def switch_harness(
        self, session_id: str, user_id: str, harness: HarnessConfig, user_ctx,
    ) -> None:
        """Swap the session's MCP configuration mid-conversation.

        Opens a fresh ACP session on the live agent process with the new
        mcpServers; the transcript is replayed on the next prompt.
        """
        session = self.get(session_id, user_id)
        if session.status == "provisioning":
            await session.ready_event.wait()
        if session.status not in ("ready",):
            raise RuntimeError(f"Cannot switch harness while {session.status}")
        # The runtime may have gone stale since the last turn (sandbox
        # auto-stop) — switching opens a new ACP session on the connection,
        # so make sure it is alive first.
        session.harness = harness  # _revive's open uses the NEW harness
        if not await self._ensure_alive(session):
            raise RuntimeError(session.error or "could not reconnect to the agent")
        async with session.lock:
            session.harness = harness
            # An MCP switch must not reset the user's model/effort/mode picks.
            await self._open_acp_session(session, user_ctx, preserve_config=True)
            session.pending_replay = bool(session.transcript)
            session.last_activity = time.monotonic()
            logger.info(
                "Session '%s' switched to harness '%s' (%d MCP servers, replay=%s)",
                session.id, harness.name, len(harness.mcp_servers), session.pending_replay,
            )

    # ── Teardown ───────────────────────────────────────────

    async def close(self, session_id: str, user_id: str) -> None:
        session = self.get(session_id, user_id)
        await self._teardown(session, park=True)

    async def reset_conversation(self, user_id: str, conversation_id: str) -> int:
        """Tear down any live ACP session for a conversation so the NEXT prompt
        opens a fresh session, re-seeded from the (now-truncated) history.

        Used by rewind: a Convex message delete can't touch the agent's
        in-sandbox context, and reusing the warm session would keep the rewound
        turns (its transcript is non-empty, so seed-from-history is skipped).
        Tearing the session down (parking the runtime so the next prompt stays
        warm) forces a fresh session + fresh ACP session that drops them.
        Keyed by conversation, not agent, so a session-only agent override is
        never missed. Returns how many sessions were reset.
        """
        # Only tear down IDLE sessions: a session that's prompting/provisioning,
        # has a turn starting (turn_guard), or holds its lock must not be ripped
        # out from under a live turn — same guard the reaper/_claim_parked use.
        # (The client already blocks rewind while streaming; this is the
        # server-side backstop.)
        targets = [
            s
            for s in self._sessions.values()
            if s.user_id == user_id
            and s.conversation_id == conversation_id
            and s.status == "ready"
            and s.turn_guard == 0
            and not s.lock.locked()
        ]
        for session in targets:
            await self._teardown(session, park=True)
        return len(targets)

    async def _teardown(self, session: AgentSession, park: bool = False) -> None:
        """End a session. With park=True a healthy runtime is kept warm for
        the user's next conversation instead of being destroyed."""
        session.status = "closed"
        self._sessions.pop(session.id, None)
        if session.connection:
            await session.connection.close()
            session.connection = None
        if session.runtime is None:
            return
        if park and session.error is None:
            await self._park_runtime(session)
            return
        await self._destroy_runtime(session.runtime, session.agent_id)

    async def _park_runtime(self, session: AgentSession) -> None:
        key = self._runtime_key(
            session.user_id, session.agent_id, self._session_attach_id(session),
        )
        replaced = self._parked.pop(key, None)
        if replaced is not None and (
            replaced.runtime.sandbox_id != session.runtime.sandbox_id
        ):
            await self._destroy_runtime(replaced.runtime, replaced.agent_id)
        self._parked[key] = ParkedRuntime(
            runtime=session.runtime,
            agent_id=session.agent_id,
            user_id=session.user_id,
            agent_capabilities=session.agent_capabilities,
            msg_id_floor=session.msg_id_floor + 1_000_000,
            credential_id=session.harness.agent_credential_id,
            workspace_env_version=session.workspace_env_version,
        )
        logger.info(
            "Parked %s runtime (sandbox=%s) for user '%s'",
            session.agent_id, session.runtime.sandbox_id, session.user_id,
        )

    async def _destroy_runtime(
        self, runtime: ProvisionedRuntime, agent_id: str,
    ) -> None:
        if runtime.owns_sandbox:
            await asyncio.to_thread(teardown_sandbox, runtime.sandbox_id)
            # Drop the Manage Sandboxes record for the deleted sandbox.
            from app.services.convex import ConvexMutationError, run_convex_mutation

            with contextlib.suppress(ConvexMutationError):
                await run_convex_mutation(
                    self._http_client(),
                    "sandboxes:removeByDaytonaId",
                    {"daytonaSandboxId": runtime.sandbox_id},
                )
        else:
            # Attached to the harness's sandbox: stop only our shim.
            await asyncio.to_thread(
                stop_agent_shim, runtime.sandbox_id, get_agent(agent_id),
            )

    def _ensure_reaper(self) -> None:
        if self._reaper_task is None or self._reaper_task.done():
            self._reaper_task = asyncio.create_task(self._reap_idle())

    async def _reap_idle(self) -> None:
        while True:
            await asyncio.sleep(60)
            ttl = settings.acp_session_idle_minutes * 60
            parked_ttl = settings.acp_parked_ttl_minutes * 60
            now = time.monotonic()
            for session in list(self._sessions.values()):
                if _session_is_reapable(
                    session.status, session.turn_guard,
                    session.last_activity, now, ttl,
                    session.lock.locked(),
                ):
                    logger.info("Parking idle ACP session '%s'", session.id)
                    with contextlib.suppress(Exception):
                        await self._teardown(session, park=True)
            for key, parked in list(self._parked.items()):
                if now - parked.parked_at > parked_ttl:
                    logger.info(
                        "Expiring parked %s runtime (sandbox=%s)",
                        parked.agent_id, parked.runtime.sandbox_id,
                    )
                    self._parked.pop(key, None)
                    with contextlib.suppress(Exception):
                        await self._destroy_runtime(parked.runtime, parked.agent_id)


_manager: AgentSessionManager | None = None


def get_session_manager() -> AgentSessionManager:
    global _manager
    if _manager is None:
        _manager = AgentSessionManager()
    return _manager
