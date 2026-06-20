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
    harness_config_from_resolved,
)
from app.services.agents.credentials import (
    CredentialCryptoError,
    credential_sources,
    store_user_credential,
    validate_secret,
)
from app.services.agents.registry import AGENT_REGISTRY, AgentCredentialsError
from app.services.agents.session_manager import (
    AgentSession,
    SandboxAccessError,
    get_session_manager,
)
from app.services.convex import (
    resolve_collab_harness,
    save_assistant_message,
    save_compaction,
    verify_conversation_access,
)
from app.services import stream_bus
from app.services.mcp_client import UserContext, resolve_princeton_netid

router = APIRouter()
logger = logging.getLogger(__name__)

USER_MESSAGE_MAX_LENGTH = 16000  # mirror /api/chat/stream

# A collaborator's per-turn override may ONLY touch reasoning effort — never
# model/mode/etc., which would let an editor reconfigure (and bill-escalate on)
# the owner's session. The sticky /config route stays owner-only for everything;
# this is the narrow, restored-after-the-turn exception. Mirrors the web
# isEffortOption() allowlist.
_EFFORT_CONFIG_IDS = frozenset({"effort", "reasoning_effort"})

# History is replay context only (the manager replays the last 40 entries,
# truncated, after a harness switch) — cap what we parse and retain so an
# oversized payload can't bypass the message-length guard.
MAX_HISTORY_MESSAGES = 100


async def _user_context(http_client: httpx.AsyncClient, user: dict) -> UserContext:
    netid = await resolve_princeton_netid(http_client, user)
    return UserContext(user_id=user.get("sub"), princeton_netid=netid)


async def _authorize_session(
    http_client: httpx.AsyncClient, session_id: str, requester_sub: str,
) -> AgentSession:
    """Return the session iff `requester_sub` is the owner or a still-valid
    editor-grant collaborator. Sessions always run under the OWNER's id; a
    collaborator's grant is RE-VERIFIED live here (against the token they joined
    with) so a revoked share loses access immediately. Raises KeyError → 404."""
    manager = get_session_manager()
    session = manager.peek(session_id)
    if session is None:
        raise KeyError(session_id)
    if session.user_id == requester_sub:
        return session  # owner fast-path
    token = session.collaborator_tokens.get(requester_sub)
    if not token:
        raise KeyError(session_id)
    role = await verify_conversation_access(
        http_client, session.conversation_id, requester_sub, token
    )
    if role in ("owner", "editor"):
        return session
    # Grant revoked/expired since they joined — forget them and deny.
    session.collaborator_tokens.pop(requester_sub, None)
    raise KeyError(session_id)


async def _session_user_ctx(
    http_client: httpx.AsyncClient, session: AgentSession, user: dict,
) -> UserContext:
    """The UserContext a session action runs under: the owner's own (full,
    with netid) when the owner acts, or the owner's identity with NO netid when
    a collaborator acts — never borrow the collaborator's Princeton netid for
    the owner's run."""
    if session.user_id == user["sub"]:
        return await _user_context(http_client, user)
    return UserContext(user_id=session.user_id, princeton_netid=None)


def _require_session_owner(session: AgentSession, requester_sub: str) -> None:
    """Reject collaborators from owner-only actions (reconfigure/close the
    owner's session). Collaborators may drive turns, not re-wire the session."""
    if session.user_id != requester_sub:
        raise HTTPException(
            status_code=403, detail="Only the conversation owner can do that"
        )


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
    requester = user["sub"]
    # Authorize against the conversation before binding/provisioning anything.
    access = await verify_conversation_access(
        http_client, body.conversation_id, requester, body.token
    )
    if access not in ("owner", "editor"):
        raise HTTPException(status_code=403, detail="Not authorized for this conversation")

    if access == "editor":
        # Collaborator: resolve the OWNER's harness server-side and run the
        # session under the OWNER's identity (credentials, sandbox, billing,
        # warm runtime all key to the owner). Never trust a client harness.
        resolved = await resolve_collab_harness(
            http_client, body.conversation_id, requester, body.token
        )
        agent_id = (resolved or {}).get("agent")
        if not resolved or not agent_id or agent_id == "default":
            raise HTTPException(
                status_code=403, detail="This conversation is not an agent chat"
            )
        harness = harness_config_from_resolved(resolved)
        owner_id = resolved["ownerUserId"]
        user_ctx = UserContext(user_id=owner_id, princeton_netid=None)
    else:
        if body.harness is None:
            raise HTTPException(status_code=422, detail="harness is required")
        harness = body.harness
        agent_id = body.agent
        owner_id = requester
        user_ctx = await _user_context(http_client, user)

    manager = get_session_manager()
    try:
        session = await manager.create(
            user_id=owner_id,
            agent_id=agent_id,
            harness=harness,
            conversation_id=body.conversation_id,
            user_ctx=user_ctx,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown agent '{agent_id}'")
    except SandboxAccessError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except AgentCredentialsError as e:
        raise HTTPException(status_code=409, detail=str(e))

    # Register the collaborator on the (possibly pre-existing, owner-owned)
    # session so their later prompts/cancels re-verify the live grant.
    if access == "editor":
        manager.note_collaborator(session.id, requester, body.token)
    return _session_payload(session)


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: str,
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    try:
        session = await _authorize_session(http_client, session_id, user["sub"])
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
        session = await _authorize_session(http_client, session_id, user["sub"])
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    # Run the turn under the session OWNER's identity (credentials/MCP/billing);
    # a collaborator drives it but never lends their own identity to the run.
    effective_user_id = session.user_id
    user_ctx = await _session_user_ctx(http_client, session, user)
    requester_sub = user["sub"]
    requester_token = session.collaborator_tokens.get(requester_sub)

    # Per-turn effort: a collaborator can't persist the owner's sticky session
    # config, so they pass a per-turn override. Snapshot the current value, apply
    # for this turn only, and restore in the finally — the session config is the
    # owner's and must not be mutated past the collaborator's single turn.
    prev_effort: str | None = None
    applied_effort_cfg: str | None = None

    async def event_stream():
        nonlocal prev_effort, applied_effort_cfg
        content = ""
        parts: list[dict] = []
        terminal_event = None  # "done" | "error" once the turn concluded
        # Distinct ACP messageIds (e.g. before/after a background task
        # completes) must become distinct parts, not one merged blob.
        last_text_mid = last_reasoning_mid = object()
        stop_reason = None
        if body.effort_config_id in _EFFORT_CONFIG_IDS and body.effort_value:
            prev_effort = next(
                (
                    o.get("currentValue")
                    for o in session.config_options
                    if o.get("id") == body.effort_config_id
                ),
                None,
            )
            # Only override when there's a prior value to restore to — otherwise
            # the collaborator's choice could persist on the owner's session past
            # the turn (the restore below is gated on prev_effort is not None).
            if prev_effort is not None and prev_effort != body.effort_value:
                try:
                    await manager.set_config_option(
                        session_id,
                        effective_user_id,
                        body.effort_config_id,
                        body.effort_value,
                    )
                    applied_effort_cfg = body.effort_config_id
                except Exception:
                    logger.warning("Per-turn effort apply failed; using current effort")
        try:
            async for event in manager.prompt(
                session_id,
                effective_user_id,
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
                elif event["event"] == "compaction":
                    # Persist immediately (mid-turn): a compaction is a
                    # standalone fact that must survive an interrupted turn,
                    # unlike the assistant-message save (skipped on the SSE
                    # disconnect path in the `finally` below).
                    cd = event["data"]
                    await save_compaction(
                        http_client,
                        session.conversation_id,
                        summary=cd.get("summary") or "",
                        trigger=cd.get("trigger") or "manual",
                        at_message_count=len(body.history or []),
                        pre_tokens=cd.get("pre_tokens"),
                        post_tokens=cd.get("post_tokens"),
                        model=f"acp:{session.agent_id}",
                        requester_user_id=requester_sub,
                        requester_token=requester_token,
                    )
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
                    requester_user_id=requester_sub,
                    requester_token=requester_token,
                )
            # Restore the owner's effort if this turn overrode it.
            if applied_effort_cfg and prev_effort is not None:
                try:
                    await manager.set_config_option(
                        session_id, effective_user_id, applied_effort_cfg, prev_effort,
                    )
                except Exception:
                    logger.warning("Per-turn effort restore failed")

    # Tee display events into the Redis bus for live fan-out to passive viewers.
    return EventSourceResponse(
        stream_bus.tee(event_stream(), session.conversation_id)
    )


@router.post("/sessions/{session_id}/permission")
async def answer_permission(
    session_id: str,
    body: AgentPermissionAnswer,
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    try:
        session = await _authorize_session(http_client, session_id, user["sub"])
        await get_session_manager().answer_permission(
            session_id, session.user_id, body.request_id, body.option_id, body.cancelled,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="No such pending permission request")
    return {"ok": True}


@router.post("/sessions/{session_id}/question")
async def answer_question(
    session_id: str,
    body: AgentQuestionAnswer,
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    """Answer an agent question (AskUserQuestion / MCP form elicitation)."""
    try:
        session = await _authorize_session(http_client, session_id, user["sub"])
        await get_session_manager().answer_question(
            session_id, session.user_id, body.request_id, body.action, body.content,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="No such pending question")
    return {"ok": True}


@router.post("/sessions/{session_id}/config")
async def set_config_option(
    session_id: str,
    body: AgentConfigOptionRequest,
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    """Set an ACP session config option (session/set_config_option). Owner-only
    — collaborators drive turns but don't reconfigure the owner's session."""
    manager = get_session_manager()
    try:
        session = await _authorize_session(http_client, session_id, user["sub"])
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    _require_session_owner(session, user["sub"])
    try:
        options = await manager.set_config_option(
            session_id, session.user_id, body.config_id, body.value,
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
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    """Queue an extra prompt onto an in-flight turn (promptQueueing agents).

    409 means the caller should fall back to client-side queueing.
    """
    if len(body.message) > USER_MESSAGE_MAX_LENGTH:
        raise HTTPException(status_code=422, detail="Message too long")
    try:
        session = await _authorize_session(http_client, session_id, user["sub"])
        await get_session_manager().queue_prompt(session_id, session.user_id, body.message)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    except (RuntimeError, PermissionError) as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"ok": True}


@router.post("/sessions/{session_id}/cancel")
async def cancel(
    session_id: str,
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    try:
        session = await _authorize_session(http_client, session_id, user["sub"])
        await get_session_manager().cancel(session_id, session.user_id)
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
    manager = get_session_manager()
    try:
        session = await _authorize_session(http_client, session_id, user["sub"])
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    # Owner-only: a collaborator must not re-wire the owner's session (and never
    # has the owner's harness to switch to anyway).
    _require_session_owner(session, user["sub"])
    user_ctx = await _user_context(http_client, user)
    try:
        await manager.switch_harness(session_id, session.user_id, body.harness, user_ctx)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _session_payload(manager.get(session_id, session.user_id))


@router.post("/sessions/by-conversation/{conversation_id}/reset")
async def reset_conversation_sessions(
    conversation_id: str,
    user: dict = Depends(get_current_user),
):
    """Rewind: tear down the caller's live ACP session(s) for a conversation so
    the next prompt reopens fresh (re-seeded from the truncated history). Only
    affects the caller's own sessions. Idempotent — returns 0 if none live."""
    manager = get_session_manager()
    count = await manager.reset_conversation(user["sub"], conversation_id)
    return {"reset": count}


@router.delete("/sessions/{session_id}")
async def close_session(
    session_id: str,
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    manager = get_session_manager()
    try:
        session = await _authorize_session(http_client, session_id, user["sub"])
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    # Owner-only: closing kills the shared runtime; a collaborator leaving must
    # not tear down the owner's (and other collaborators') session.
    _require_session_owner(session, user["sub"])
    try:
        await manager.close(session_id, session.user_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"ok": True}
