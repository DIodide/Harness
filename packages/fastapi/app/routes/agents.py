"""ACP agent gateway routes.

External agents (Codex CLI, Claude Code, ...) running in Daytona sandboxes,
speaking ACP. The Harness-provided default agent stays on /api/chat/stream.

In ACP mode no OpenRouter usage/budget accounting happens — the cost is
incurred on the user's own agent subscription/API key.
"""

import json
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sse_starlette.sse import EventSourceResponse

from app.dependencies import get_current_user, get_http_client
from app.models import (
    AgentCredentialStoreRequest,
    AgentPermissionAnswer,
    AgentPromptRequest,
    AgentSessionCreateRequest,
    AgentSwitchHarnessRequest,
)
from app.services.agents.credentials import (
    CredentialCryptoError,
    credential_sources,
    delete_user_credential,
    store_user_credential,
    validate_secret,
)
from app.services.agents.registry import AGENT_REGISTRY, AgentCredentialsError
from app.services.agents.session_manager import get_session_manager
from app.services.convex import save_assistant_message
from app.services.mcp_client import UserContext, resolve_princeton_netid

router = APIRouter()
logger = logging.getLogger(__name__)

USER_MESSAGE_MAX_LENGTH = 16000  # mirror /api/chat/stream


async def _user_context(http_client: httpx.AsyncClient, user: dict) -> UserContext:
    netid = await resolve_princeton_netid(http_client, user)
    return UserContext(user_id=user.get("sub"), princeton_netid=netid)


def _session_payload(session) -> dict:
    return {
        "session_id": session.id,
        "agent": session.agent_id,
        "status": session.status,
        "error": session.error,
        "conversation_id": session.conversation_id,
        "harness_name": session.harness.name,
    }


@router.get("")
async def list_agents(
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    """Agent catalog with per-user availability (default agent is implicit).

    `source` tells the UI where credentials come from: "user" (connected in
    settings), "server" (deployment fallback), or null (not connected).
    """
    sources = await credential_sources(http_client, user.get("sub", ""))
    return {
        "agents": [
            {"id": agent.id, "name": agent.name, **sources[agent.id]}
            for agent in AGENT_REGISTRY.values()
        ]
    }


@router.post("/credentials")
async def store_credential(
    body: AgentCredentialStoreRequest,
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    """Store a per-user agent credential (write-only; value never echoed)."""
    if body.agent not in AGENT_REGISTRY:
        raise HTTPException(status_code=404, detail=f"Unknown agent '{body.agent}'")
    error = validate_secret(body.agent, body.kind, body.value)
    if error:
        raise HTTPException(status_code=422, detail=error)
    try:
        await store_user_credential(
            http_client, user["sub"], body.agent, body.kind, body.value, body.label,
        )
    except CredentialCryptoError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except AgentCredentialsError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"ok": True, "agent": body.agent, "kind": body.kind}


@router.delete("/credentials/{agent_id}")
async def delete_credential(
    agent_id: str,
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    if agent_id not in AGENT_REGISTRY:
        raise HTTPException(status_code=404, detail=f"Unknown agent '{agent_id}'")
    await delete_user_credential(http_client, user["sub"], agent_id)
    return {"ok": True}


@router.post("/sessions")
async def create_session(
    body: AgentSessionCreateRequest,
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    user_ctx = await _user_context(http_client, user)
    manager = get_session_manager()
    try:
        session = await manager.create(
            user_id=user["sub"],
            agent_id=body.agent,
            harness=body.harness,
            conversation_id=body.conversation_id,
            user_ctx=user_ctx,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown agent '{body.agent}'")
    except AgentCredentialsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _session_payload(session)


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, user: dict = Depends(get_current_user)):
    try:
        session = get_session_manager().get(session_id, user["sub"])
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    return _session_payload(session)


@router.post("/sessions/{session_id}/prompt")
async def prompt(
    session_id: str,
    body: AgentPromptRequest,
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    if len(body.message) > USER_MESSAGE_MAX_LENGTH:
        raise HTTPException(status_code=422, detail="Message too long")
    manager = get_session_manager()
    try:
        session = manager.get(session_id, user["sub"])
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    user_ctx = await _user_context(http_client, user)

    async def event_stream():
        content = ""
        parts: list[dict] = []
        try:
            async for event in manager.prompt(
                session_id, user["sub"], body.message, user_ctx,
            ):
                if event["event"] == "done":
                    content = event["data"]["content"]
                elif event["event"] == "token":
                    if parts and parts[-1]["type"] == "text":
                        parts[-1]["content"] += event["data"]["content"]
                    else:
                        parts.append({"type": "text", "content": event["data"]["content"]})
                elif event["event"] == "thinking":
                    if parts and parts[-1]["type"] == "reasoning":
                        parts[-1]["content"] += event["data"]["content"]
                    else:
                        parts.append({"type": "reasoning", "content": event["data"]["content"]})
                elif event["event"] == "tool_call":
                    parts.append(
                        {
                            "type": "tool_call",
                            "tool": event["data"]["tool"],
                            "arguments": event["data"]["arguments"],
                            "call_id": event["data"]["call_id"],
                            "result": "",
                        }
                    )
                elif event["event"] == "tool_result":
                    for part in reversed(parts):
                        if (
                            part["type"] == "tool_call"
                            and part["call_id"] == event["data"]["call_id"]
                        ):
                            part["result"] = event["data"].get("result") or ""
                            break
                yield {"event": event["event"], "data": json.dumps(event["data"])}
        finally:
            if content or parts:
                await save_assistant_message(
                    http_client,
                    session.conversation_id,
                    content,
                    parts=parts or None,
                    model=f"acp:{session.agent_id}",
                )

    return EventSourceResponse(event_stream())


@router.post("/sessions/{session_id}/permission")
async def answer_permission(
    session_id: str,
    body: AgentPermissionAnswer,
    user: dict = Depends(get_current_user),
):
    try:
        await get_session_manager().answer_permission(
            session_id, user["sub"], body.request_id, body.option_id, body.cancelled,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="No such pending permission request")
    return {"ok": True}


@router.post("/sessions/{session_id}/cancel")
async def cancel(session_id: str, user: dict = Depends(get_current_user)):
    try:
        await get_session_manager().cancel(session_id, user["sub"])
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"ok": True}


@router.post("/sessions/{session_id}/harness")
async def switch_harness(
    session_id: str,
    body: AgentSwitchHarnessRequest,
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    user_ctx = await _user_context(http_client, user)
    manager = get_session_manager()
    try:
        await manager.switch_harness(session_id, user["sub"], body.harness, user_ctx)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _session_payload(manager.get(session_id, user["sub"]))


@router.delete("/sessions/{session_id}")
async def close_session(session_id: str, user: dict = Depends(get_current_user)):
    try:
        await get_session_manager().close(session_id, user["sub"])
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"ok": True}
