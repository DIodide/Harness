import json

import httpx

from app.config import settings


def _get_server_url(mcp_name: str) -> str | None:
    """Map a harness MCP name to its server URL via the junction engine."""
    if not settings.junction_engine_url:
        return None
    return f"{settings.junction_engine_url}/{mcp_name}"


async def list_tools(client: httpx.AsyncClient, mcp_names: list[str]) -> list[dict]:
    """Fetch available tools from MCP servers, returned in OpenAI function format.

    Tool names are namespaced as 'servername__toolname' to avoid collisions.
    """
    tools: list[dict] = []

    for name in mcp_names:
        url = _get_server_url(name)
        if not url:
            continue
        try:
            resp = await client.post(
                url,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/list",
                    "params": {},
                },
                timeout=10.0,
            )
            resp.raise_for_status()
            result = resp.json().get("result", {})
            server_tools = result.get("tools", [])
            for tool in server_tools:
                tools.append(
                    {
                        "type": "function",
                        "function": {
                            "name": f"{name}__{tool['name']}",
                            "description": tool.get("description", ""),
                            "parameters": tool.get("inputSchema", {}),
                        },
                    }
                )
        except (httpx.HTTPError, KeyError):
            # MCP server unavailable or malformed response — skip
            continue

    return tools


async def call_tool(client: httpx.AsyncClient, tool_name: str, arguments: dict) -> str:
    """Execute a tool call on the appropriate MCP server.

    Args:
        tool_name: Namespaced name in format 'servername__toolname'.
        arguments: Tool arguments dict.

    Returns:
        Tool result as a string.
    """
    parts = tool_name.split("__", 1)
    if len(parts) != 2:
        return json.dumps({"error": f"Invalid tool name format: {tool_name}"})

    server_name, actual_tool = parts
    url = _get_server_url(server_name)
    if not url:
        return json.dumps({"error": f"Unknown MCP server: {server_name}"})

    try:
        resp = await client.post(
            url,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": actual_tool, "arguments": arguments},
            },
            timeout=30.0,
        )
        resp.raise_for_status()
        result = resp.json().get("result", {})
        content = result.get("content", [])
        # MCP tool results are an array of content blocks; extract text
        texts = [c.get("text", "") for c in content if c.get("type") == "text"]
        return "\n".join(texts) if texts else json.dumps(result)
    except (httpx.HTTPError, KeyError) as e:
        return json.dumps({"error": str(e)})
