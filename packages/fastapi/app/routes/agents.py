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
    AgentConfigOptionRequest,
    AgentCredentialStoreRequest,
    AgentPermissionAnswer,
    AgentPromptRequest,
    AgentQuestionAnswer,
    AgentQueuePromptRequest,
    AgentSessionCreateRequest,
    AgentSwitchHarnessRequest,
)
from app.services.agents.credentials import (
    CredentialCryptoError,
    credential_sources,
    store_user_credential,
    validate_secret,
)
from app.services.agents.registry import AGENT_REGISTRY, AgentCredentialsError
from app.services.agents.session_manager import (
    SandboxAccessError,
    get_session_manager,
)
from app.services.convex import save_assistant_message
from app.services.mcp_client import UserContext, resolve_princeton_netid

router = APIRouter()
logger = logging.getLogger(__name__)

USER_MESSAGE_MAX_LENGTH = 16000  # mirror /api/chat/stream

# History is replay context only (the manager replays the last 40 entries,
# truncated, after a harness switch) — cap what we parse and retain so an
# oversized payload can't bypass the message-length guard.
MAX_HISTORY_MESSAGES = 100


async def _user_context(http_client: httpx.AsyncClient, user: dict) -> UserContext:
    netid = await resolve_princeton_netid(http_client, user)
    return UserContext(user_id=user.get("sub"), princeton_netid=netid)


# Cap on a single tool call's accumulated result (terminal output) kept in
# the persisted message — Convex documents have a ~1MB ceiling, and the
# whole message write fails if a pathologically verbose command blows it.
_MAX_TOOL_RESULT_CHARS = 256_000

# Combined base64 payload cap for image blocks (~15 MB of raw image data).
MAX_IMAGE_BLOCK_BYTES = 20_000_000

# codex_core rejects degenerate images as a poisoning risk — and worse, the
# rejected image stays in the thread history, failing every later turn.
# Guard dimensions here so a bad attachment can never brick a session.
MIN_IMAGE_DIMENSION = 4


def _png_dimensions(raw: bytes) -> tuple[int, int] | None:
    if len(raw) < 24 or raw[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    import struct

    width, height = struct.unpack(">II", raw[16:24])
    return width, height


def _gif_dimensions(raw: bytes) -> tuple[int, int] | None:
    if len(raw) < 10 or raw[:4] != b"GIF8":
        return None
    import struct

    width, height = struct.unpack("<HH", raw[6:10])
    return width, height


def _jpeg_dimensions(raw: bytes) -> tuple[int, int] | None:
    if len(raw) < 4 or raw[:2] != b"\xff\xd8":
        return None
    import struct

    pos = 2
    while pos + 9 < len(raw):
        if raw[pos] != 0xFF:
            pos += 1
            continue
        marker = raw[pos + 1]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            height, width = struct.unpack(">HH", raw[pos + 5 : pos + 9])
            return width, height
        length = struct.unpack(">H", raw[pos + 2 : pos + 4])[0]
        pos += 2 + length
    return None


def _image_dimensions(raw: bytes) -> tuple[int, int] | None:
    for probe in (_png_dimensions, _gif_dimensions, _jpeg_dimensions):
        dims = probe(raw)
        if dims is not None:
            return dims
    return None  # unknown container (e.g. webp) — let the agent decide


def _validated_image_blocks(blocks: list[dict] | None) -> list[dict]:
    """Keep only well-formed ACP image blocks, within a total size budget."""
    import base64

    out: list[dict] = []
    total = 0
    for block in blocks or []:
        if not isinstance(block, dict) or block.get("type") != "image":
            continue
        data = block.get("data")
        mime = block.get("mimeType")
        if not isinstance(data, str) or not isinstance(mime, str):
            continue
        if not mime.startswith("image/"):
            continue
        total += len(data)
        if total > MAX_IMAGE_BLOCK_BYTES:
            logger.warning("Dropping image blocks over the %dB cap", MAX_IMAGE_BLOCK_BYTES)
            break
        try:
            raw = base64.b64decode(data, validate=True)
        except Exception:
            logger.warning("Dropping image block with invalid base64")
            continue
        dims = _image_dimensions(raw)
        if dims is not None and (
            dims[0] < MIN_IMAGE_DIMENSION or dims[1] < MIN_IMAGE_DIMENSION
        ):
            logger.warning(
                "Dropping %dx%d image — below the %dpx floor that agents accept",
                dims[0], dims[1], MIN_IMAGE_DIMENSION,
            )
            continue
        out.append({"type": "image", "data": data, "mimeType": mime})
    return out


# ACP stopReasons that should surface like an interrupted response. Plain
# "end_turn" (and queue-related reasons) are normal completions.
_STOP_REASON_NOTES = {
    "cancelled": "Stopped by user",
    "refusal": "The agent declined to continue",
    "max_tokens": "Stopped at the agent's token limit",
    "max_turn_requests": "Stopped at the agent's turn-request limit",
}


def _interruption_for_stop_reason(stop_reason: str | None) -> str | None:
    if not stop_reason:
        return None
    return _STOP_REASON_NOTES.get(stop_reason)


def _diff_to_text(diff: dict) -> str:
    """Render an ACP diff content block as plain unified-style text."""
    lines = [f"--- {diff.get('path') or 'file'}"]
    old_text = diff.get("oldText") or ""
    new_text = diff.get("newText") or ""
    lines += [f"-{line}" for line in old_text.splitlines()]
    lines += [f"+{line}" for line in new_text.splitlines()]
    return "\n".join(lines[:400])


def _session_payload(session) -> dict:
    caps = session.agent_capabilities or {}
    prompt_caps = caps.get("promptCapabilities") or {}
    mcp_caps = caps.get("mcpCapabilities") or {}
    return {
        "session_id": session.id,
        "agent": session.agent_id,
        "status": session.status,
        "error": session.error,
        "conversation_id": session.conversation_id,
        "harness_name": session.harness.name,
        "prompt_queueing": session.supports_prompt_queueing,
        # ACP session config options (model, mode, ...) for selector UIs.
        "config_options": session.config_options,
        # Agent-advertised slash commands for the composer's slash menu.
        "available_commands": session.available_commands,
        # The harness's MCP servers (names) — shown as an at-a-glance context
        # chip; the ACP startup notifications are too unreliable across agents
        # to drive a live per-server panel.
        "mcp_servers": [s.name for s in session.harness.mcp_servers],
        # Live feature surface, so the UI can explain why images/queueing/MCP
        # behave as they do (shown in developer display mode).
        "capabilities": {
            "image": bool(prompt_caps.get("image")),
            "mcp_http": bool(mcp_caps.get("http")),
            "prompt_queueing": session.supports_prompt_queueing,
            "terminal_output": True,
        },
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
            {
                "id": agent.id,
                "name": agent.name,
                "models": list(agent.models),
                **sources[agent.id],
            }
            for agent in AGENT_REGISTRY.values()
        ]
    }


@router.post("/credentials")
async def store_credential(
    body: AgentCredentialStoreRequest,
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    """Store a per-user agent credential (write-only; value never echoed).

    Without credential_id a NEW credential is created (users may keep
    several per agent — work/personal accounts); with one, that
    credential's secret is replaced in place. Returns the credential id so
    the harness flow can link it. Deletion goes through the Convex
    `agentCredentials.remove` mutation directly (user-authenticated).
    """
    if body.agent not in AGENT_REGISTRY:
        raise HTTPException(status_code=404, detail=f"Unknown agent '{body.agent}'")
    error = validate_secret(body.agent, body.kind, body.value)
    if error:
        raise HTTPException(status_code=422, detail=error)
    try:
        credential_id = await store_user_credential(
            http_client,
            user["sub"],
            body.agent,
            body.kind,
            body.value,
            body.label,
            credential_id=body.credential_id,
        )
    except CredentialCryptoError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except AgentCredentialsError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {
        "ok": True,
        "agent": body.agent,
        "kind": body.kind,
        "credential_id": credential_id,
    }


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
    except SandboxAccessError as e:
        raise HTTPException(status_code=403, detail=str(e))
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
        terminal_event = None  # "done" | "error" once the turn concluded
        # Distinct ACP messageIds (e.g. before/after a background task
        # completes) must become distinct parts, not one merged blob.
        last_text_mid = last_reasoning_mid = object()
        stop_reason = None
        try:
            async for event in manager.prompt(
                session_id,
                user["sub"],
                body.message,
                user_ctx,
                history=[
                    {
                        **m.model_dump(),
                        "content": (
                            m.content[:USER_MESSAGE_MAX_LENGTH]
                            if isinstance(m.content, str)
                            else m.content
                        ),
                    }
                    for m in (body.history or [])[-MAX_HISTORY_MESSAGES:]
                ],
                blocks=_validated_image_blocks(body.blocks),
            ):
                if event["event"] in ("done", "error"):
                    terminal_event = event["event"]
                if event["event"] == "done":
                    content = event["data"]["content"]
                    stop_reason = event["data"].get("stop_reason")
                elif event["event"] == "token":
                    mid = event["data"].get("message_id")
                    parent = event["data"].get("parent_id")
                    if parts and parts[-1]["type"] == "text" and mid == last_text_mid:
                        parts[-1]["content"] += event["data"]["content"]
                    else:
                        parts.append(
                            {
                                "type": "text",
                                "content": event["data"]["content"],
                                **({"parent_id": parent} if parent else {}),
                            }
                        )
                    last_text_mid = mid
                elif event["event"] == "thinking":
                    mid = event["data"].get("message_id")
                    parent = event["data"].get("parent_id")
                    if parts and parts[-1]["type"] == "reasoning" and mid == last_reasoning_mid:
                        parts[-1]["content"] += event["data"]["content"]
                    else:
                        # parent_id persists sub-agent thinking nested under
                        # its Task tool call — same as token/tool_call parts.
                        parts.append(
                            {
                                "type": "reasoning",
                                "content": event["data"]["content"],
                                **({"parent_id": parent} if parent else {}),
                            }
                        )
                    last_reasoning_mid = mid
                elif event["event"] == "tool_call":
                    d = event["data"]
                    parts.append(
                        {
                            "type": "tool_call",
                            "tool": d["tool"],
                            "arguments": d["arguments"],
                            "call_id": d["call_id"],
                            "result": "",
                            "kind": d.get("kind") or "other",
                            **({"status": d["status"]} if d.get("status") else {}),
                            **(
                                {"server_name": d["server_name"]}
                                if d.get("server_name")
                                else {}
                            ),
                            **(
                                {"parent_id": d["parent_id"]}
                                if d.get("parent_id")
                                else {}
                            ),
                        }
                    )
                elif event["event"] == "question_answered":
                    # Persist the Q→A exchange so the conversation keeps a
                    # first-class record of what the user was asked and chose.
                    qa = event["data"].get("qa") or []
                    action = event["data"].get("action")
                    result_text = (
                        "\n".join(f"{e['q']} → {e['a']}" for e in qa)
                        if qa
                        else ("Skipped" if action != "cancel" else "Dismissed")
                    )
                    parts.append(
                        {
                            "type": "tool_call",
                            "tool": event["data"].get("message") or "Question",
                            "arguments": {"qa": qa, "action": action},
                            "call_id": event["data"]["call_id"],
                            "result": result_text,
                            "kind": "ask_user",
                        }
                    )
                elif event["event"] == "tool_result":
                    d = event["data"]
                    call_id = d["call_id"]
                    status = d.get("status")
                    if d.get("append"):
                        # Live terminal stream: append the delta, record exit.
                        for part in reversed(parts):
                            if (
                                part["type"] == "tool_call"
                                and part["call_id"] == call_id
                            ):
                                if d.get("output_delta"):
                                    combined = (part.get("result") or "") + d[
                                        "output_delta"
                                    ]
                                    # Cap accumulated output so a pathologically
                                    # verbose command can't push the persisted
                                    # message past Convex's document size limit
                                    # (which would fail the whole write).
                                    if len(combined) > _MAX_TOOL_RESULT_CHARS:
                                        combined = (
                                            "…[earlier output truncated]\n"
                                            + combined[-_MAX_TOOL_RESULT_CHARS:]
                                        )
                                    part["result"] = combined
                                if status:
                                    part["status"] = status
                                if d.get("exit_code") is not None:
                                    part["exit_code"] = d["exit_code"]
                                break
                    else:
                        result_text = d.get("result") or ""
                        diff = d.get("diff")
                        refined_args = d.get("arguments")
                        if diff and not result_text:
                            # Persist file edits readably even without content.
                            result_text = _diff_to_text(diff)
                        # Status-only progress updates carry no result — don't
                        # blank content an earlier update already delivered.
                        for part in reversed(parts):
                            if (
                                part["type"] == "tool_call"
                                and part["call_id"] == call_id
                            ):
                                if result_text or status in ("completed", "failed"):
                                    part["result"] = result_text
                                if status:
                                    part["status"] = status
                                # Late-arriving full input (e.g. Workflow script).
                                if isinstance(refined_args, dict) and refined_args:
                                    part["arguments"] = {
                                        **(part.get("arguments") or {}),
                                        **refined_args,
                                    }
                                break
                yield {"event": event["event"], "data": json.dumps(event["data"])}
        finally:
            if terminal_event is None:
                # Stream ended without done/error: the SSE consumer
                # disconnected (tab close, reload, proxy drop). The frontend
                # persists the interrupted partial in its onAbort handler —
                # saving here too would double it (same invariant as
                # /api/chat/stream).
                logger.warning(
                    "Agent prompt stream for session '%s' (convo '%s') ended "
                    "without a terminal event — SSE consumer disconnected; "
                    "skipping server-side save",
                    session_id, session.conversation_id,
                )
            elif content or parts:
                interruption = _interruption_for_stop_reason(stop_reason)
                await save_assistant_message(
                    http_client,
                    session.conversation_id,
                    content,
                    parts=parts or None,
                    model=f"acp:{session.agent_id}",
                    interrupted=interruption is not None,
                    interruption_reason=interruption,
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


@router.post("/sessions/{session_id}/question")
async def answer_question(
    session_id: str,
    body: AgentQuestionAnswer,
    user: dict = Depends(get_current_user),
):
    """Answer an agent question (AskUserQuestion / MCP form elicitation)."""
    try:
        await get_session_manager().answer_question(
            session_id, user["sub"], body.request_id, body.action, body.content,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="No such pending question")
    return {"ok": True}


@router.post("/sessions/{session_id}/config")
async def set_config_option(
    session_id: str,
    body: AgentConfigOptionRequest,
    user: dict = Depends(get_current_user),
):
    """Set an ACP session config option (session/set_config_option)."""
    manager = get_session_manager()
    try:
        options = await manager.set_config_option(
            session_id, user["sub"], body.config_id, body.value,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        # AcpError from the agent (invalid model id, unsupported option).
        raise HTTPException(status_code=422, detail=str(e))
    return {"config_options": options}


@router.post("/sessions/{session_id}/queue")
async def queue_prompt(
    session_id: str,
    body: AgentQueuePromptRequest,
    user: dict = Depends(get_current_user),
):
    """Queue an extra prompt onto an in-flight turn (promptQueueing agents).

    409 means the caller should fall back to client-side queueing.
    """
    if len(body.message) > USER_MESSAGE_MAX_LENGTH:
        raise HTTPException(status_code=422, detail="Message too long")
    try:
        await get_session_manager().queue_prompt(session_id, user["sub"], body.message)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    except (RuntimeError, PermissionError) as e:
        raise HTTPException(status_code=409, detail=str(e))
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
