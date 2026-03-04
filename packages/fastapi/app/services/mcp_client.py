import asyncio
import itertools
import json
import logging
import re
import time
from dataclasses import dataclass

import httpx

from app.models import McpServer

logger = logging.getLogger(__name__)

JSONRPC_HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
}

# Monotonically increasing JSON-RPC request ID so each request is unique.
_request_id_counter = itertools.count(1)

# Cache of session IDs per MCP server URL to avoid re-initializing on every request.
_session_cache: dict[str, str] = {}

# Per-server lock to prevent concurrent session initialization races.
_session_init_locks: dict[str, asyncio.Lock] = {}

# TTL cache for tools/list results: url → (tools, timestamp).
_tools_cache: dict[str, tuple[list[dict], float]] = {}
_TOOLS_CACHE_TTL = 60.0  # seconds

# Reverse map: sanitized tool name → original MCP tool name.
_tool_name_map: dict[str, str] = {}

_TOOL_NAME_RE = re.compile(r"[^a-zA-Z0-9_-]")


def _sanitize_tool_name(name: str) -> str:
    """Replace characters not matching [a-zA-Z0-9_-] with underscores."""
    return _TOOL_NAME_RE.sub("_", name)


def _next_request_id() -> int:
    """Return a unique JSON-RPC request ID."""
    return next(_request_id_counter)


def _get_init_lock(server_url: str) -> asyncio.Lock:
    """Get or create an initialization lock for a given server URL."""
    if server_url not in _session_init_locks:
        _session_init_locks[server_url] = asyncio.Lock()
    return _session_init_locks[server_url]


async def _build_headers(
    client: httpx.AsyncClient,
    server: McpServer,
    session_id: str | None = None,
    user_id: str | None = None,
) -> dict[str, str]:
    """Build request headers, including auth and session ID if available.

    For OAuth servers, resolves the user's access token from Convex (with auto-refresh).
    """
    headers = dict(JSONRPC_HEADERS)

    if server.auth_type == "bearer" and server.auth_token:
        headers["Authorization"] = f"Bearer {server.auth_token}"
    elif server.auth_type == "oauth" and user_id:
        from app.services.mcp_oauth import get_valid_token

        token = await get_valid_token(client, user_id, server.url)
        if token:
            headers["Authorization"] = f"Bearer {token}"
        else:
            logger.warning(
                "No valid OAuth token for user '%s' on MCP '%s'",
                user_id,
                server.name,
            )

    if session_id:
        headers["mcp-session-id"] = session_id
    return headers


async def _post_streaming(
    client: httpx.AsyncClient,
    url: str,
    payload: dict,
    headers: dict[str, str],
    timeout: float,
) -> tuple[dict, httpx.Headers, int]:
    """Send a POST and handle both JSON and SSE responses using streaming.

    SSE connections are long-lived, so we stream line-by-line and close
    as soon as we get a JSON-RPC result, rather than waiting for the
    server to close the connection (which may never happen).

    Returns (result_body, response_headers, status_code).
    """
    req = client.build_request("POST", url, json=payload, headers=headers, timeout=timeout)
    resp = await client.send(req, stream=True)

    resp_headers = resp.headers
    status_code = resp.status_code

    content_type = resp_headers.get("content-type", "")

    if "text/event-stream" in content_type and status_code < 400:
        # Stream SSE line-by-line, extract the first JSON-RPC result, then close.
        result: dict = {}
        try:
            async for raw_line in resp.aiter_lines():
                line = raw_line.strip()
                if not line or line.startswith("event:"):
                    continue
                if line.startswith("data:"):
                    data = line[5:].strip()
                    try:
                        parsed = json.loads(data)
                        if "result" in parsed:
                            result = parsed["result"]
                            break
                        if "error" in parsed:
                            result = parsed
                            break
                    except json.JSONDecodeError:
                        continue
        finally:
            await resp.aclose()
        return result, resp_headers, status_code
    else:
        # Regular JSON response — read full body then close.
        try:
            body_bytes = await resp.aread()
        finally:
            await resp.aclose()

        if status_code >= 400:
            return {"_raw_text": body_bytes.decode("utf-8", errors="replace")}, resp_headers, status_code

        try:
            body = json.loads(body_bytes)
            return body.get("result", {}), resp_headers, status_code
        except json.JSONDecodeError:
            return {}, resp_headers, status_code


async def _initialize_session(
    client: httpx.AsyncClient,
    server: McpServer,
    user_id: str | None = None,
) -> str | None:
    """Send the MCP initialize handshake and return the session ID.

    Uses a per-server lock to prevent concurrent initialization races.
    """
    cached = _session_cache.get(server.url)
    if cached:
        return cached

    lock = _get_init_lock(server.url)
    async with lock:
        # Double-check after acquiring the lock (another task may have initialized).
        cached = _session_cache.get(server.url)
        if cached:
            return cached

        headers = await _build_headers(client, server, user_id=user_id)
        payload = {
            "jsonrpc": "2.0",
            "id": _next_request_id(),
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "harness", "version": "1.0.0"},
            },
        }

        try:
            result, resp_headers, status = await _post_streaming(client, server.url, payload, headers, timeout=10.0)
            if status >= 400:
                logger.error("MCP initialize returned %d for '%s'", status, server.name)
                return None
            session_id = resp_headers.get("mcp-session-id")
            if session_id:
                _session_cache[server.url] = session_id
                logger.debug("Initialized MCP session '%s' for '%s'", session_id, server.name)
            return session_id
        except httpx.HTTPError as e:
            logger.error("Failed to initialize MCP session for '%s' at %s: %s", server.name, server.url, e)
            return None


async def _post_jsonrpc(
    client: httpx.AsyncClient,
    server: McpServer,
    method: str,
    params: dict | None = None,
    timeout: float = 10.0,
    session_id: str | None = None,
    user_id: str | None = None,
) -> dict:
    """Send a JSON-RPC 2.0 request to an MCP server and return the result.

    Uses streaming to handle text/event-stream responses without hanging.
    """
    headers = await _build_headers(client, server, session_id, user_id=user_id)
    payload = {
        "jsonrpc": "2.0",
        "id": _next_request_id(),
        "method": method,
        "params": params or {},
    }

    result, resp_headers, status = await _post_streaming(client, server.url, payload, headers, timeout)

    # If we get a 400 "not initialized", try initializing and retry once
    if status == 400:
        raw = result.get("_raw_text", "")
        if "not initialized" in raw.lower():
            logger.info("MCP server '%s' requires initialization, retrying...", server.name)
            _session_cache.pop(server.url, None)
            new_session = await _initialize_session(client, server, user_id=user_id)
            if new_session:
                headers = await _build_headers(client, server, new_session, user_id=user_id)
                result, resp_headers, status = await _post_streaming(
                    client, server.url, payload, headers, timeout
                )

    # Handle OAuth 401 — signal that re-auth is needed
    if status == 401 and server.auth_type == "oauth":
        raise McpAuthRequiredError(server.name, server.url)

    if status >= 400:
        raise httpx.HTTPStatusError(
            f"MCP server returned {status}",
            request=httpx.Request("POST", server.url),
            response=httpx.Response(status),
        )

    # Update cached session if server returns one
    new_session = resp_headers.get("mcp-session-id")
    if new_session:
        _session_cache[server.url] = new_session

    return result


async def _ensure_session(
    client: httpx.AsyncClient,
    server: McpServer,
    user_id: str | None = None,
) -> str | None:
    """Ensure we have a valid session for this server, initializing if needed."""
    return await _initialize_session(client, server, user_id=user_id)


async def _list_tools_for_server(
    client: httpx.AsyncClient,
    server: McpServer,
    user_id: str | None = None,
) -> list[dict]:
    """Fetch tools from a single MCP server, returned in OpenAI function format.

    Results are cached per server URL for up to _TOOLS_CACHE_TTL seconds.
    """
    cached = _tools_cache.get(server.url)
    if cached:
        tools, ts = cached
        if time.monotonic() - ts < _TOOLS_CACHE_TTL:
            logger.debug("Using cached tools for MCP '%s' (%d tools)", server.name, len(tools))
            return tools

    session_id = await _ensure_session(client, server, user_id=user_id)
    result = await _post_jsonrpc(client, server, "tools/list", session_id=session_id, user_id=user_id)
    server_tools = result.get("tools", [])
    tools = []
    for tool in server_tools:
        raw_name = tool["name"]
        sanitized = _sanitize_tool_name(f"{server.name}__{raw_name}")
        # Store mapping so we can recover the original MCP tool name on call_tool
        _tool_name_map[sanitized] = raw_name
        tools.append({
            "type": "function",
            "function": {
                "name": sanitized,
                "description": tool.get("description", ""),
                "parameters": tool.get("inputSchema", {}),
            },
        })
    _tools_cache[server.url] = (tools, time.monotonic())
    logger.info("Loaded %d tools from MCP '%s' at %s", len(server_tools), server.name, server.url)
    return tools


@dataclass
class McpServerFailure:
    """Describes an MCP server that failed to load tools."""
    server_name: str
    server_url: str
    reason: str  # "auth_required" | "error"


async def list_tools(
    client: httpx.AsyncClient,
    mcp_servers: list[McpServer],
    user_id: str | None = None,
) -> tuple[list[dict], list[McpServerFailure]]:
    """Fetch available tools from all MCP servers in parallel.

    Tool names are namespaced as 'servername__toolname' to avoid collisions.
    Returns (tools, failures) where failures lists servers that could not be reached.
    """
    results = await asyncio.gather(
        *[_list_tools_for_server(client, server, user_id=user_id) for server in mcp_servers],
        return_exceptions=True,
    )

    tools: list[dict] = []
    failures: list[McpServerFailure] = []
    for server, result in zip(mcp_servers, results):
        if isinstance(result, McpAuthRequiredError):
            logger.warning("OAuth re-auth required for MCP '%s'", server.name)
            failures.append(McpServerFailure(server.name, server.url, "auth_required"))
            continue
        if isinstance(result, BaseException):
            logger.error(
                "Error fetching tools from MCP '%s' at %s: %s",
                server.name,
                server.url,
                result,
            )
            failures.append(McpServerFailure(server.name, server.url, "error"))
            continue
        tools.extend(result)

    return tools, failures


async def call_tool(
    client: httpx.AsyncClient,
    tool_name: str,
    arguments: dict,
    mcp_servers: list[McpServer],
    user_id: str | None = None,
) -> str:
    """Execute a tool call on the appropriate MCP server.

    Args:
        tool_name: Namespaced name in format 'servername__toolname'.
        arguments: Tool arguments dict.
        mcp_servers: List of configured MCP servers to resolve against.
        user_id: Current user ID for OAuth token resolution.

    Returns:
        Tool result as a string.
    """
    parts = tool_name.split("__", 1)
    if len(parts) != 2:
        logger.error("Invalid tool name format: %s", tool_name)
        return json.dumps({"error": f"Invalid tool name format: {tool_name}"})

    server_name, sanitized_tool = parts
    # Resolve the original MCP tool name from the reverse map, or fall back to the
    # sanitized name (works when the original had no special chars).
    actual_tool = _tool_name_map.get(tool_name, sanitized_tool)
    server = next((s for s in mcp_servers if _sanitize_tool_name(s.name) == server_name), None)
    if not server:
        logger.error("No MCP server found with name: %s", server_name)
        return json.dumps({"error": f"Unknown MCP server: {server_name}"})

    try:
        session_id = _session_cache.get(server.url)
        logger.debug("Calling tool '%s' on MCP '%s' at %s", actual_tool, server_name, server.url)
        result = await _post_jsonrpc(
            client,
            server,
            "tools/call",
            {"name": actual_tool, "arguments": arguments},
            timeout=30.0,
            session_id=session_id,
            user_id=user_id,
        )
        content = result.get("content", [])
        parts: list[str] = []
        for c in content:
            ctype = c.get("type")
            if ctype == "text":
                parts.append(c.get("text", ""))
            elif ctype == "resource":
                # MCP embedded resource — extract text or decode blob
                resource = c.get("resource", {})
                if "text" in resource:
                    parts.append(resource["text"])
                elif "blob" in resource:
                    import base64
                    try:
                        parts.append(base64.b64decode(resource["blob"]).decode("utf-8", errors="replace"))
                    except Exception:
                        parts.append(f"[binary resource: {resource.get('uri', 'unknown')}]")
            elif ctype == "image":
                parts.append(f"[image: {c.get('mimeType', 'unknown type')}]")
        return "\n".join(parts) if parts else json.dumps(result)
    except McpAuthRequiredError:
        return json.dumps({
            "error": f"OAuth re-authorization required for MCP server: {server_name}",
            "auth_required": True,
            "server_url": server.url,
        })
    except httpx.HTTPError as e:
        logger.error("HTTP error calling tool '%s' on MCP '%s': %s", actual_tool, server_name, e)
        return json.dumps({"error": f"MCP server error: {server_name}"})
    except KeyError as e:
        logger.error("Malformed response from MCP '%s' for tool '%s': missing key %s", server_name, actual_tool, e)
        return json.dumps({"error": f"Malformed response from MCP server: {server_name}"})


class McpAuthRequiredError(Exception):
    """Raised when an OAuth-protected MCP server returns 401."""

    def __init__(self, server_name: str, server_url: str):
        self.server_name = server_name
        self.server_url = server_url
        super().__init__(f"OAuth re-auth required for {server_name} at {server_url}")


def evict_session_cache(server_url: str) -> None:
    """Remove a cached session so the next health check does a real handshake."""
    _session_cache.pop(server_url, None)


async def check_server_health(
    client: httpx.AsyncClient,
    server: McpServer,
    user_id: str | None = None,
) -> bool:
    """Check if an MCP server is reachable by attempting initialization.

    Returns True if reachable, False otherwise.
    Raises McpAuthRequiredError for OAuth 401.
    """
    session_id = await _initialize_session(client, server, user_id=user_id)
    return session_id is not None
