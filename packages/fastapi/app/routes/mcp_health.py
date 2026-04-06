import asyncio
import json
import logging
from typing import Literal

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.dependencies import get_current_user, get_http_client
from app.models import McpServer
from app.services.mcp_client import (
    McpAuthRequiredError,
    UserContext,
    check_server_health,
    evict_session_cache,
    list_tools,
)
from app.services.openrouter import complete_chat

router = APIRouter()
logger = logging.getLogger(__name__)


class HealthCheckRequest(BaseModel):
    mcp_servers: list[McpServer]
    force: bool = False


class ServerHealth(BaseModel):
    name: str
    url: str
    reachable: bool
    status: Literal["ok", "auth_required", "error"]


class HealthCheckResponse(BaseModel):
    servers: list[ServerHealth]


async def _check_one(
    client: httpx.AsyncClient,
    server: McpServer,
    user_ctx: UserContext | None,
    force: bool,
) -> ServerHealth:
    if force:
        evict_session_cache(server.url)
    try:
        reachable = await check_server_health(client, server, user_ctx=user_ctx)
        if reachable:
            return ServerHealth(name=server.name, url=server.url, reachable=True, status="ok")
        return ServerHealth(name=server.name, url=server.url, reachable=False, status="error")
    except McpAuthRequiredError:
        return ServerHealth(name=server.name, url=server.url, reachable=False, status="auth_required")
    except Exception as e:
        logger.warning("Health check failed for '%s' at %s: %s", server.name, server.url, e)
        return ServerHealth(name=server.name, url=server.url, reachable=False, status="error")


@router.post("/check", response_model=HealthCheckResponse)
async def check_health(
    body: HealthCheckRequest,
    http_client: httpx.AsyncClient = Depends(get_http_client),
    user: dict = Depends(get_current_user),
):
    user_ctx = UserContext(user_id=user.get("sub"))

    results = await asyncio.gather(
        *[_check_one(http_client, s, user_ctx, body.force) for s in body.mcp_servers],
        return_exceptions=True,
    )

    servers = []
    for server, result in zip(body.mcp_servers, results):
        if isinstance(result, BaseException):
            logger.error("Health check exception for '%s': %s", server.name, result)
            servers.append(ServerHealth(name=server.name, url=server.url, reachable=False, status="error"))
        else:
            servers.append(result)

    return HealthCheckResponse(servers=servers)


class GeneratePromptsRequest(BaseModel):
    mcp_servers: list[McpServer]


class GeneratePromptsResponse(BaseModel):
    prompts: list[str]


@router.post("/generate-prompts", response_model=GeneratePromptsResponse)
async def generate_prompts(
    body: GeneratePromptsRequest,
    http_client: httpx.AsyncClient = Depends(get_http_client),
    user: dict = Depends(get_current_user),
):
    user_ctx = UserContext(user_id=user.get("sub"))

    if not body.mcp_servers:
        return GeneratePromptsResponse(prompts=[])

    # Fetch available tools from all MCP servers
    try:
        tools, _ = await list_tools(http_client, body.mcp_servers, user_ctx=user_ctx)
    except Exception:
        logger.exception("Failed to fetch tools for prompt generation")
        return GeneratePromptsResponse(prompts=[])

    if not tools:
        return GeneratePromptsResponse(prompts=[])

    # Build a summary of available tools
    tool_descriptions = []
    for t in tools:
        fn = t.get("function", {})
        name = fn.get("name", "unknown")
        desc = fn.get("description", "")
        tool_descriptions.append(f"- {name}: {desc}" if desc else f"- {name}")

    tools_text = "\n".join(tool_descriptions[:50])  # Cap at 50 tools

    messages = [
        {
            "role": "system",
            "content": (
                "You generate suggested prompts for an AI chat assistant. "
                "The assistant has access to tools via MCP servers. "
                "Given the available tools below, suggest exactly 4 short, "
                "practical prompts (1 sentence each, under 60 characters) that "
                "a user might want to try. Return ONLY a JSON array of 4 strings, "
                "no markdown, no explanation.\n\n"
                f"Available tools:\n{tools_text}"
            ),
        },
        {
            "role": "user",
            "content": "Generate 4 suggested prompts as a JSON array.",
        },
    ]

    try:
        content = await complete_chat(http_client, messages)
        # Strip markdown fences if present
        content = content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        prompts = json.loads(content)
        if isinstance(prompts, list) and all(isinstance(p, str) for p in prompts):
            return GeneratePromptsResponse(prompts=prompts[:4])
    except Exception:
        logger.exception("Failed to generate suggested prompts")

    return GeneratePromptsResponse(prompts=[])
