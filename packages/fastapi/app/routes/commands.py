import logging

import httpx
from fastapi import APIRouter, Depends

from app.dependencies import get_current_user, get_http_client
from app.models import CommandListRequest
from app.services.mcp_client import UserContext, list_tools, resolve_princeton_netid

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/list")
async def command_list(
    body: CommandListRequest,
    http_client: httpx.AsyncClient = Depends(get_http_client),
    user: dict = Depends(get_current_user),
):
    """Return available MCP tools as slash commands."""
    user_id = user.get("sub")
    netid = await resolve_princeton_netid(http_client, user)
    user_ctx = UserContext(user_id=user_id, princeton_netid=netid)

    tools, failures = await list_tools(http_client, body.mcp_servers, user_ctx=user_ctx)

    commands = []
    for tool in tools:
        fn = tool["function"]
        parts = fn["name"].split("__", 1)
        server = parts[0] if len(parts) == 2 else ""
        tool_name = parts[1] if len(parts) == 2 else fn["name"]
        commands.append({
            "name": fn["name"],
            "server": server,
            "tool": tool_name,
            "description": fn.get("description", ""),
            "parameters": fn.get("parameters", {}),
        })

    return {
        "commands": commands,
        "failures": [
            {"server_name": f.server_name, "server_url": f.server_url, "reason": f.reason}
            for f in failures
        ],
    }
