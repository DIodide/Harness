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
    teardown_sandbox,
)
from app.services.agents.registry import (
    SANDBOX_WORKSPACE,
    get_agent,
    resolve_credentials,
)
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
    pending_permissions: dict[str, asyncio.Future] = field(default_factory=dict)
    ready_event: asyncio.Event = field(default_factory=asyncio.Event)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    last_activity: float = field(default_factory=time.monotonic)


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


def normalize_session_update(update: dict) -> dict | None:
    """Map an ACP session/update payload to a Harness SSE event."""
    kind = update.get("sessionUpdate")
    if kind == "agent_message_chunk":
        return {"event": "token", "data": {"content": _content_block_text(update.get("content") or {})}}
    if kind == "agent_thought_chunk":
        return {"event": "thinking", "data": {"content": _content_block_text(update.get("content") or {})}}
    if kind == "tool_call":
        return {
            "event": "tool_call",
            "data": {
                "call_id": update.get("toolCallId", ""),
                "tool": update.get("title") or update.get("kind") or "tool",
                "arguments": update.get("rawInput") or {},
                "kind": update.get("kind"),
                "status": update.get("status"),
            },
        }
    if kind == "tool_call_update":
        content = update.get("content") or []
        result_text = "\n".join(
            _content_block_text(c.get("content") or {})
            for c in content
            if isinstance(c, dict) and c.get("type") == "content"
        )
        return {
            "event": "tool_result",
            "data": {
                "call_id": update.get("toolCallId", ""),
                "status": update.get("status"),
                "result": result_text or json.dumps(update.get("rawOutput") or {})[:4000],
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
        creds = resolve_credentials(agent_id, user_id)

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
            session.runtime = await asyncio.to_thread(
                provision_agent_sandbox, session.user_id, agent, creds,
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
                "url": f"http://127.0.0.1:{settings.acp_shim_port}/mcp/{index}",
                "headers": [],
            }
            for index, server in enumerate(servers)
        ]
        session.acp_session_id = await session.connection.new_session(
            cwd=SANDBOX_WORKSPACE, mcp_servers=acp_servers,
        )

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

    def _make_notification_handler(self, session: AgentSession):
        async def handle(method: str, params: dict) -> None:
            if method != "session/update":
                return
            if params.get("sessionId") != session.acp_session_id:
                return
            event = normalize_session_update(params.get("update") or {})
            if event is not None:
                await session.event_queue.put(event)

        return handle

    def _make_request_handler(self, session: AgentSession):
        async def handle(method: str, params: dict) -> dict:
            if method == "session/request_permission":
                return await self._handle_permission(session, params)
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

    # ── Prompt turns ───────────────────────────────────────

    async def prompt(
        self, session_id: str, user_id: str, message: str, user_ctx,
        history: list[dict] | None = None,
    ):
        """Run one prompt turn; yields normalized SSE events.

        If the session has no transcript yet and `history` is provided
        (conversation predates the session), it seeds the transcript and is
        replayed as context — same mechanism as a harness switch.
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
            yield {"event": "status", "data": {"state": "provisioning"}}
            await session.ready_event.wait()
        if session.status == "error":
            yield {"event": "error", "data": {"message": session.error or "session failed"}}
            return
        if session.status == "prompting":
            yield {"event": "error", "data": {"message": "A turn is already in progress"}}
            return

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
            text_parts: list[str] = []

            turn = asyncio.create_task(
                session.connection.prompt(session.acp_session_id, outgoing)
            )
            try:
                while True:
                    queue_get = asyncio.create_task(session.event_queue.get())
                    done, _ = await asyncio.wait(
                        {queue_get, turn}, return_when=asyncio.FIRST_COMPLETED,
                    )
                    if queue_get in done:
                        event = queue_get.result()
                        if event["event"] == "token":
                            text_parts.append(event["data"]["content"])
                        yield event
                        session.last_activity = time.monotonic()
                        continue
                    # Turn finished — flush anything already queued.
                    queue_get.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await queue_get
                    while not session.event_queue.empty():
                        event = session.event_queue.get_nowait()
                        if event["event"] == "token":
                            text_parts.append(event["data"]["content"])
                        yield event
                    result = turn.result()  # raises on AcpError/transport error
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
            finally:
                if not turn.done():
                    turn.cancel()
                session.status = "ready" if session.error is None else "error"
                session.last_activity = time.monotonic()

    async def cancel(self, session_id: str, user_id: str) -> None:
        session = self.get(session_id, user_id)
        if session.connection and session.acp_session_id:
            await session.connection.cancel(session.acp_session_id)

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
            await asyncio.to_thread(teardown_sandbox, session.runtime.sandbox_id)

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
