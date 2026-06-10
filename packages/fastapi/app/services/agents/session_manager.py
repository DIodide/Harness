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
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.config import settings
from app.models import HarnessConfig, McpServer
from app.services.agents.acp_client import AcpConnection, AcpError, AcpTransportError
from app.services.agents.daytona_runtime import (
    ProvisionedRuntime,
    provision_agent_sandbox,
    shim_port,
    stop_agent_shim,
    teardown_sandbox,
    write_cursor_mcp_config,
)


class _AlreadyRegistered(Exception):
    """Control-flow marker: attached sandboxes skip Convex registration."""
from app.services.agents.credentials import resolve_agent_credentials
from app.services.agents.registry import SANDBOX_WORKSPACE, get_agent
from app.services.mcp_client import UserContext

logger = logging.getLogger(__name__)

PERMISSION_TIMEOUT_SECONDS = 300.0

_DONE = object()  # sentinel pushed to event queues when a turn finishes


@dataclass
class AgentSession:
    id: str
    user_id: str
    agent_id: str
    harness: HarnessConfig
    conversation_id: str
    status: str = "provisioning"  # provisioning|ready|prompting|error|closed
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
    # MCP relay: index → real server config. The agent only ever sees
    # http://127.0.0.1:<shim>/mcp/<index>; Daytona egress restrictions and
    # MCP credentials are both handled backend-side.
    relay_targets: list[McpServer] = field(default_factory=list)
    user_ctx: UserContext | None = None
    # Queue of normalized events for the currently streaming prompt turn.
    event_queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    # Prompts queued onto an in-flight turn (agents advertising
    # promptQueueing, e.g. Claude Code). Their events flow into the same
    # event_queue; the active stream ends only when all turns complete.
    extra_turns: list[asyncio.Task] = field(default_factory=list)
    pending_permissions: dict[str, asyncio.Future] = field(default_factory=dict)
    ready_event: asyncio.Event = field(default_factory=asyncio.Event)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    last_activity: float = field(default_factory=time.monotonic)

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
        return {
            "event": "tool_call",
            "data": {
                "call_id": update.get("toolCallId", ""),
                "tool": update.get("title") or update.get("kind") or "tool",
                "arguments": update.get("rawInput") or {},
                # ACP tool kind (execute|read|edit|delete|move|search|fetch|
                # think|switch_mode|other) — drives first-class rendering.
                "kind": update.get("kind") or "other",
                "status": update.get("status"),
                "locations": update.get("locations") or [],
                # Set for tool calls made by a background/sub agent — the UI
                # nests these under the spawning Task tool call.
                **({"parent_id": parent_id} if parent_id else {}),
            },
        }
    if kind == "tool_call_update":
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
        return {
            "event": "tool_result",
            "data": {
                "call_id": update.get("toolCallId", ""),
                "status": update.get("status"),
                "result": result_text or json.dumps(update.get("rawOutput") or {})[:4000],
                **({"diff": diff} if diff else {}),
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
    """Context block replayed into a fresh ACP session after a harness switch."""
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


class AgentSessionManager:
    def __init__(self):
        self._sessions: dict[str, AgentSession] = {}
        self._reaper_task: asyncio.Task | None = None
        self._http: httpx.AsyncClient | None = None

    def _http_client(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(timeout=30.0)
        return self._http

    def get(self, session_id: str, user_id: str) -> AgentSession:
        session = self._sessions.get(session_id)
        if session is None or session.user_id != user_id:
            raise KeyError(session_id)
        return session

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
        self._sessions[session.id] = session
        self._ensure_reaper()
        asyncio.create_task(self._provision(session, creds, user_ctx))
        return session

    async def _provision(self, session: AgentSession, creds, user_ctx) -> None:
        try:
            agent = get_agent(session.agent_id)
            # Deeper unification: harnesses with a sandbox run the agent
            # INSIDE that sandbox (user's real files, persistent), instead
            # of a session-owned scratch sandbox.
            attach_sandbox_id = (
                session.harness.sandbox_id
                if session.harness.sandbox_enabled and session.harness.sandbox_id
                else None
            )
            session.runtime = await asyncio.to_thread(
                provision_agent_sandbox,
                session.user_id,
                agent,
                creds,
                attach_sandbox_id,
            )
            conn = AcpConnection(session.runtime.base_url, session.runtime.headers)
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
            try:
                if not session.runtime.owns_sandbox:
                    raise _AlreadyRegistered
                from app.services.convex import create_sandbox_record

                await create_sandbox_record(
                    self._http_client(),
                    session.user_id,
                    None,  # never hijack the harness's own sandbox slot
                    session.runtime.sandbox_id,
                    f"{agent.name} · agent session",
                    "python",
                    False,
                    {"cpu": 2, "memoryGB": 4, "diskGB": 10},
                )
            except _AlreadyRegistered:
                pass
            except Exception as e:
                logger.warning(
                    "Could not register agent sandbox '%s' in Convex: %s",
                    session.runtime.sandbox_id, e,
                )

            session.status = "ready"
            logger.info(
                "ACP session '%s' ready (agent=%s, acp_session=%s)",
                session.id, session.agent_id, session.acp_session_id,
            )
        except Exception as e:
            logger.exception("Provisioning failed for session '%s'", session.id)
            session.status = "error"
            session.error = str(e)
        finally:
            session.ready_event.set()

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
        session.runtime = await asyncio.to_thread(
            provision_agent_sandbox,
            session.user_id,
            agent,
            creds,
            None,
            session.runtime,
        )
        conn = AcpConnection(session.runtime.base_url, session.runtime.headers)
        session.connection = conn
        conn.on_notification = self._make_notification_handler(session)
        conn.on_request = self._make_request_handler(session)
        conn.on_relay_request = self._make_relay_handler(session)
        await conn.start()
        init = await conn.initialize()
        session.agent_capabilities = init.get("agentCapabilities") or {}
        await self._open_acp_session(session, session.user_ctx)
        session.pending_replay = bool(session.transcript)
        session.status = "ready"
        session.error = None
        logger.info(
            "Session '%s' revived (acp_session=%s)",
            session.id, session.acp_session_id,
        )

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
            session.error = f"Could not reconnect to the agent sandbox: {e}"
            return False

    async def _open_acp_session(self, session: AgentSession, user_ctx) -> None:
        assert session.connection is not None
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
        acp_servers = [
            {
                "type": "http",
                "name": server.name,
                "url": f"http://127.0.0.1:{shim_port(get_agent(session.agent_id))}/mcp/{index}",
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
            )
        result = await session.connection.new_session(
            cwd=(session.runtime.cwd if session.runtime else SANDBOX_WORKSPACE),
            mcp_servers=acp_servers,
        )
        session.acp_session_id = result["sessionId"]
        session.config_options = result.get("configOptions") or []
        # Replay notifications that raced the session/new response: Claude
        # Code sends available_commands_update on a setTimeout(0) right after
        # responding, which lands before acp_session_id is assigned above and
        # would otherwise be dropped by the id filter.
        early, session.early_notifications = session.early_notifications, []
        for params in early:
            if params.get("sessionId") == session.acp_session_id:
                await self._process_session_update(session, params)
        await self._apply_harness_model(session)

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
                index = int(payload.get("path", "").split("/mcp/", 1)[1].split("/", 1)[0])
                target = session.relay_targets[index]
            except (IndexError, ValueError):
                await conn.post_relay_response(req_id, 404, {}, b"unknown relay target")
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
            await session.event_queue.put(event)

    def _make_notification_handler(self, session: AgentSession):
        async def handle(method: str, params: dict) -> None:
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
            yield {"event": "error", "data": {"message": session.error or "session failed"}}
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
                yield {"event": "error", "data": {"message": str(e)}}
            except GeneratorExit:
                # SSE client disconnected mid-turn (tab closed, dev-server
                # reload, proxy drop). The agent keeps running server-side.
                logger.warning(
                    "SSE consumer disconnected mid-turn on session '%s' "
                    "(turn still running: %s)", session.id, not turn.done(),
                )
                raise
            except Exception as e:
                # A bug here must surface as an error event, never as a
                # silently truncated stream.
                logger.exception("Unexpected error in prompt turn on session '%s'", session.id)
                yield {"event": "error", "data": {"message": f"internal error: {e}"}}
            finally:
                if not turn.done():
                    turn.cancel()
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
            await self._open_acp_session(session, user_ctx)
            session.pending_replay = bool(session.transcript)
            session.last_activity = time.monotonic()
            logger.info(
                "Session '%s' switched to harness '%s' (%d MCP servers, replay=%s)",
                session.id, harness.name, len(harness.mcp_servers), session.pending_replay,
            )

    # ── Teardown ───────────────────────────────────────────

    async def close(self, session_id: str, user_id: str) -> None:
        session = self.get(session_id, user_id)
        await self._teardown(session)

    async def _teardown(self, session: AgentSession) -> None:
        session.status = "closed"
        self._sessions.pop(session.id, None)
        if session.connection:
            await session.connection.close()
        if session.runtime:
            if session.runtime.owns_sandbox:
                await asyncio.to_thread(teardown_sandbox, session.runtime.sandbox_id)
                # Drop the Manage Sandboxes record for the deleted sandbox.
                from app.services.convex import ConvexMutationError, run_convex_mutation

                with contextlib.suppress(ConvexMutationError):
                    await run_convex_mutation(
                        self._http_client(),
                        "sandboxes:removeByDaytonaId",
                        {"daytonaSandboxId": session.runtime.sandbox_id},
                    )
            else:
                # Attached to the harness's sandbox: stop only our shim.
                await asyncio.to_thread(
                    stop_agent_shim,
                    session.runtime.sandbox_id,
                    get_agent(session.agent_id),
                )

    def _ensure_reaper(self) -> None:
        if self._reaper_task is None or self._reaper_task.done():
            self._reaper_task = asyncio.create_task(self._reap_idle())

    async def _reap_idle(self) -> None:
        while True:
            await asyncio.sleep(60)
            ttl = settings.acp_session_idle_minutes * 60
            now = time.monotonic()
            for session in list(self._sessions.values()):
                if session.status == "prompting":
                    continue
                if now - session.last_activity > ttl:
                    logger.info("Reaping idle ACP session '%s'", session.id)
                    with contextlib.suppress(Exception):
                        await self._teardown(session)


_manager: AgentSessionManager | None = None


def get_session_manager() -> AgentSessionManager:
    global _manager
    if _manager is None:
        _manager = AgentSessionManager()
    return _manager
