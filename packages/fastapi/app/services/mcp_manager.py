"""MCP Client Manager.

Connects to remote MCP servers via Streamable HTTP transport,
discovers their tools, and converts them to OpenAI function-calling format.
"""

import json
import logging
from contextlib import AsyncExitStack

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from app.config import MCP_SERVERS
from app.services import convex as convex_client

logger = logging.getLogger(__name__)


def mcp_tool_to_openai(tool) -> dict:
    """Convert an MCP tool definition to OpenAI function-calling format."""
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description or "",
            "parameters": tool.inputSchema if tool.inputSchema else {"type": "object", "properties": {}},
        },
    }


class MCPManager:
    """Manages MCP client sessions for a user's harness."""

    def __init__(self):
        self._sessions: dict[str, ClientSession] = {}
        self._tool_to_server: dict[str, str] = {}
        self._exit_stack = AsyncExitStack()

    @property
    def connected_server_names(self) -> set[str]:
        return set(self._sessions.keys())

    async def connect_servers(
        self, server_names: list[str], user_id: str
    ) -> list[dict]:
        """Connect to MCP servers and return all tools in OpenAI format."""
        all_tools: list[dict] = []

        for name in server_names:
            server_config = MCP_SERVERS.get(name)
            if not server_config:
                logger.warning(f"Unknown MCP server: {name}")
                continue

            url = server_config["url"]
            auth_type = server_config["auth"]

            headers: dict[str, str] = {}
            if auth_type == "oauth":
                token_data = await convex_client.run_query(
                    "mcpConnections:getToken",
                    {"userId": user_id, "serverName": name},
                )
                if not token_data:
                    logger.warning(f"No OAuth token for {name}, skipping")
                    continue
                headers["Authorization"] = f"Bearer {token_data['accessToken']}"

            try:
                read_stream, write_stream, _ = await self._exit_stack.enter_async_context(
                    streamablehttp_client(
                        url=url,
                        headers=headers if headers else None,
                        terminate_on_close=False,
                    )
                )

                session: ClientSession = await self._exit_stack.enter_async_context(
                    ClientSession(read_stream, write_stream)
                )
                await session.initialize()

                tools_result = await session.list_tools()
                tools = tools_result.tools

                self._sessions[name] = session

                for tool in tools:
                    openai_tool = mcp_tool_to_openai(tool)
                    all_tools.append(openai_tool)
                    self._tool_to_server[tool.name] = name

                logger.info(f"Connected to {name}: {len(tools)} tools available")
            except BaseException as e:
                logger.error(f"Failed to connect to MCP server {name} at {url}: {type(e).__name__}: {e}")

        return all_tools

    async def call_tool(self, tool_name: str, arguments: dict) -> str:
        """Execute a tool call on the appropriate MCP server."""
        server_name = self._tool_to_server.get(tool_name)
        if not server_name:
            return json.dumps({"error": f"Unknown tool: {tool_name}"})

        session = self._sessions.get(server_name)
        if not session:
            return json.dumps({"error": f"No active session for server: {server_name}"})

        try:
            result = await session.call_tool(tool_name, arguments)
            content_parts = []
            for item in result.content:
                if hasattr(item, "text"):
                    content_parts.append(item.text)
                else:
                    content_parts.append(str(item))
            return "\n".join(content_parts)
        except BaseException as e:
            logger.error(f"Tool call failed: {tool_name}: {type(e).__name__}: {e}")
            return json.dumps({"error": str(e)})

    async def close(self) -> None:
        """Close all MCP sessions and transports."""
        try:
            await self._exit_stack.aclose()
        except BaseException:
            logger.debug("Error closing MCP sessions", exc_info=True)
        self._sessions.clear()
        self._tool_to_server.clear()
