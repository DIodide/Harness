import asyncio
import logging
from typing import Literal

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.dependencies import get_current_user, get_http_client
from app.models import McpServer
from app.services.mcp_client import (
    McpAuthRequiredError,
    check_server_health,
    evict_session_cache,
)

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
    user_id: str | None,
    force: bool,
) -> ServerHealth:
    if force:
        evict_session_cache(server.url)
    try:
        reachable = await check_server_health(client, server, user_id=user_id)
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
    user_id = user.get("sub")

    results = await asyncio.gather(
        *[_check_one(http_client, s, user_id, body.force) for s in body.mcp_servers],
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
