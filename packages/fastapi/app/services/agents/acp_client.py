"""ACP (Agent Client Protocol) client over the Daytona shim transport.

Speaks JSON-RPC 2.0 with an ACP agent whose stdio is bridged by
acp_shim.mjs: outgoing messages are POSTed to /stdin, incoming messages
arrive as SSE `line` events on /events (with monotonically increasing ids,
so reconnects resume without message loss).

Protocol reference: https://agentclientprotocol.com/protocol/overview
"""

import asyncio
import contextlib
import itertools
import json
import logging
from collections.abc import Awaitable, Callable

import httpx

logger = logging.getLogger(__name__)

ACP_PROTOCOL_VERSION = 1

# A server→client request handler returns the JSON-RPC result payload.
RequestHandler = Callable[[str, dict], Awaitable[dict]]
NotificationHandler = Callable[[str, dict], Awaitable[None]]


class AcpError(Exception):
    """JSON-RPC error returned by the agent."""

    def __init__(self, code: int, message: str, data=None):
        super().__init__(f"ACP error {code}: {message}")
        self.code = code
        self.message = message
        self.data = data


class AcpTransportError(Exception):
    """Shim/agent transport failure (agent exited, sandbox gone, ...)."""


class AcpConnection:
    """One JSON-RPC connection to one ACP agent process."""

    def __init__(self, base_url: str, headers: dict[str, str]):
        self._base_url = base_url
        self._headers = headers
        self._http = httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=None))
        self._ids = itertools.count(1)
        self._pending: dict[int, asyncio.Future] = {}
        self._last_seq = 0
        self._closed = False
        self._agent_exited: str | None = None
        self._reader_task: asyncio.Task | None = None
        self.on_request: RequestHandler | None = None
        self.on_notification: NotificationHandler | None = None
        # MCP relay: shim-level `relay_request` events (not JSON-RPC traffic).
        self.on_relay_request: Callable[[dict], Awaitable[None]] | None = None

    async def start(self) -> None:
        self._reader_task = asyncio.create_task(self._read_loop())

    async def close(self) -> None:
        self._closed = True
        if self._reader_task:
            self._reader_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._reader_task
        for future in self._pending.values():
            if not future.done():
                future.set_exception(AcpTransportError("connection closed"))
        self._pending.clear()
        await self._http.aclose()

    @property
    def agent_exited(self) -> str | None:
        return self._agent_exited

    # ── Outgoing ───────────────────────────────────────────

    async def request(self, method: str, params: dict, timeout: float = 600.0) -> dict:
        if self._agent_exited is not None:
            raise AcpTransportError(f"agent exited: {self._agent_exited}")
        msg_id = next(self._ids)
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[msg_id] = future
        try:
            await self._send(
                {"jsonrpc": "2.0", "id": msg_id, "method": method, "params": params}
            )
            return await asyncio.wait_for(future, timeout=timeout)
        finally:
            self._pending.pop(msg_id, None)

    async def notify(self, method: str, params: dict) -> None:
        await self._send({"jsonrpc": "2.0", "method": method, "params": params})

    async def respond(self, msg_id, result: dict | None = None, error: dict | None = None) -> None:
        msg: dict = {"jsonrpc": "2.0", "id": msg_id}
        if error is not None:
            msg["error"] = error
        else:
            msg["result"] = result if result is not None else {}
        await self._send(msg)

    async def post_relay_response(
        self, req_id: int, status: int, headers: dict[str, str], body: bytes,
    ) -> None:
        """Deliver the answer for a tunneled /mcp request back to the shim."""
        import base64

        try:
            await self._http.post(
                f"{self._base_url}/relay-response",
                content=json.dumps(
                    {
                        "reqId": req_id,
                        "status": status,
                        "headers": headers,
                        "bodyB64": base64.b64encode(body).decode("ascii"),
                    }
                ),
                headers=self._headers,
            )
        except httpx.HTTPError as e:
            logger.warning("Failed to post relay response %s: %s", req_id, e)

    async def _send(self, msg: dict) -> None:
        try:
            resp = await self._http.post(
                f"{self._base_url}/stdin",
                content=json.dumps(msg),
                headers=self._headers,
            )
        except httpx.HTTPError as e:
            raise AcpTransportError(f"shim unreachable: {e}") from e
        if resp.status_code == 409:
            self._agent_exited = self._agent_exited or "agent exited"
            raise AcpTransportError("agent process has exited")
        if resp.status_code >= 400:
            raise AcpTransportError(f"shim /stdin HTTP {resp.status_code}")

    # ── Incoming ───────────────────────────────────────────

    async def _read_loop(self) -> None:
        backoff = 1.0
        while not self._closed:
            try:
                async with self._http.stream(
                    "GET",
                    f"{self._base_url}/events",
                    params={"since": self._last_seq},
                    headers=self._headers,
                    timeout=httpx.Timeout(30.0, read=None),
                ) as resp:
                    if resp.status_code != 200:
                        raise AcpTransportError(f"/events HTTP {resp.status_code}")
                    backoff = 1.0
                    await self._consume_sse(resp)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                if self._closed:
                    return
                logger.warning("ACP event stream dropped (%s), reconnecting", e)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 15.0)

    async def _consume_sse(self, resp: httpx.Response) -> None:
        event_type = "message"
        event_id: int | None = None
        data_lines: list[str] = []
        async for raw_line in resp.aiter_lines():
            line = raw_line.rstrip("\r")
            if line.startswith(":"):
                continue
            if line == "":
                if data_lines:
                    if event_id is not None:
                        self._last_seq = event_id
                    await self._handle_event(event_type, "\n".join(data_lines))
                event_type, event_id, data_lines = "message", None, []
                continue
            if line.startswith("id: "):
                with contextlib.suppress(ValueError):
                    event_id = int(line[4:])
            elif line.startswith("event: "):
                event_type = line[7:]
            elif line.startswith("data: "):
                data_lines.append(line[6:])
            elif line.startswith("data:"):
                data_lines.append(line[5:])

    async def _handle_event(self, event_type: str, data: str) -> None:
        if event_type == "stderr":
            logger.info("[agent stderr] %s", data[:500])
            return
        if event_type == "relay_request":
            if self.on_relay_request is not None:
                try:
                    asyncio.create_task(self.on_relay_request(json.loads(data)))
                except json.JSONDecodeError:
                    logger.warning("Malformed relay_request from shim")
            return
        if event_type in ("exit", "spawn_error"):
            self._agent_exited = data
            for future in self._pending.values():
                if not future.done():
                    future.set_exception(
                        AcpTransportError(f"agent exited: {data}")
                    )
            return
        if event_type != "line":
            return
        try:
            msg = json.loads(data)
        except json.JSONDecodeError:
            logger.warning("Non-JSON line from agent: %s", data[:300])
            return
        await self._dispatch(msg)

    async def _dispatch(self, msg: dict) -> None:
        # Response to one of our requests.
        if "id" in msg and "method" not in msg:
            future = self._pending.get(msg["id"])
            if future is None or future.done():
                return
            if "error" in msg:
                err = msg["error"] or {}
                future.set_exception(
                    AcpError(err.get("code", -1), err.get("message", "unknown"), err.get("data"))
                )
            else:
                future.set_result(msg.get("result") or {})
            return

        method = msg.get("method", "")
        params = msg.get("params") or {}

        # Server→client request (e.g. session/request_permission, fs/*).
        if "id" in msg:
            asyncio.create_task(self._handle_request(msg["id"], method, params))
            return

        # Notification (session/update, ...).
        if self.on_notification is not None:
            try:
                await self.on_notification(method, params)
            except Exception:
                logger.exception("Notification handler failed for %s", method)

    async def _handle_request(self, msg_id, method: str, params: dict) -> None:
        try:
            if self.on_request is None:
                raise AcpError(-32601, f"Method not supported: {method}")
            result = await self.on_request(method, params)
            await self.respond(msg_id, result=result)
        except AcpError as e:
            await self.respond(
                msg_id, error={"code": e.code, "message": e.message}
            )
        except Exception as e:
            logger.exception("Request handler failed for %s", method)
            with contextlib.suppress(Exception):
                await self.respond(
                    msg_id, error={"code": -32603, "message": str(e)}
                )

    # ── ACP convenience wrappers ───────────────────────────

    async def initialize(self, client_name: str = "harness") -> dict:
        return await self.request(
            "initialize",
            {
                "protocolVersion": ACP_PROTOCOL_VERSION,
                "clientCapabilities": {
                    # The agent owns its sandbox filesystem and terminal —
                    # Harness does not proxy fs/terminal back through itself.
                    "fs": {"readTextFile": False, "writeTextFile": False},
                    "terminal": False,
                },
                "clientInfo": {"name": client_name, "version": "0.1.0"},
            },
            timeout=60.0,
        )

    async def new_session(self, cwd: str, mcp_servers: list[dict]) -> dict:
        """Returns the full session/new result (sessionId, configOptions, modes)."""
        return await self.request(
            "session/new",
            {"cwd": cwd, "mcpServers": mcp_servers},
            timeout=120.0,
        )

    async def set_config_option(
        self, session_id: str, config_id: str, value: str,
    ) -> dict:
        """session/set_config_option — model/mode/effort selection (ACP)."""
        return await self.request(
            "session/set_config_option",
            {"sessionId": session_id, "configId": config_id, "value": value},
            timeout=60.0,
        )

    async def prompt(self, session_id: str, text: str, timeout: float = 1200.0) -> dict:
        return await self.request(
            "session/prompt",
            {
                "sessionId": session_id,
                "prompt": [{"type": "text", "text": text}],
            },
            timeout=timeout,
        )

    async def cancel(self, session_id: str) -> None:
        await self.notify("session/cancel", {"sessionId": session_id})
