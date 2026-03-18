import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


async def save_assistant_message(
    http_client: httpx.AsyncClient,
    conversation_id: str,
    content: str,
    reasoning: str | None = None,
    tool_calls: list[dict] | None = None,
    parts: list[dict] | None = None,
    usage: dict | None = None,
    model: str | None = None,
) -> None:
    """Save an assistant message to Convex via the HTTP API.

    Uses the deploy key for admin auth, which allows calling internal mutations.
    """
    if not settings.convex_url or not settings.convex_deploy_key:
        logger.warning("Convex not configured — skipping message save")
        return

    logger.info("Saving assistant message for conversation '%s'", conversation_id)

    args: dict = {
        "conversationId": conversation_id,
        "content": content,
    }
    if reasoning:
        args["reasoning"] = reasoning
    if tool_calls:
        args["toolCalls"] = tool_calls
    if parts:
        args["parts"] = parts
    if usage:
        args["usage"] = usage
    if model:
        args["model"] = model

    try:
        resp = await http_client.post(
            f"{settings.convex_url}/api/mutation",
            headers={
                "Authorization": f"Convex {settings.convex_deploy_key}",
            },
            json={
                "path": "messages:saveAssistantMessage",
                "args": args,
                "format": "json",
            },
            timeout=10.0,
        )
        resp.raise_for_status()
        logger.info(
            "Saved assistant message to conversation '%s'",
            conversation_id,
        )
    except httpx.HTTPStatusError as e:
        logger.error(
            "Failed to save assistant message to Convex: %s %s",
            e.response.status_code,
            e.response.text[:500],
        )
    except httpx.HTTPError as e:
        logger.error("HTTP error saving assistant message to Convex: %s", e)
    except Exception:
        logger.exception(
            "Unexpected error saving assistant message for conversation '%s'",
            conversation_id,
        )


async def patch_message_usage(
    http_client: httpx.AsyncClient,
    conversation_id: str,
    usage: dict,
    model: str | None = None,
) -> None:
    """Backfill usage data on the last assistant message of a conversation."""
    if not settings.convex_url or not settings.convex_deploy_key:
        return

    logger.info("Patching usage for conversation '%s'", conversation_id)

    args: dict = {
        "conversationId": conversation_id,
        "usage": usage,
    }
    if model:
        args["model"] = model

    try:
        resp = await http_client.post(
            f"{settings.convex_url}/api/mutation",
            headers={
                "Authorization": f"Convex {settings.convex_deploy_key}",
            },
            json={
                "path": "messages:patchMessageUsage",
                "args": args,
                "format": "json",
            },
            timeout=10.0,
        )
        resp.raise_for_status()
        logger.info("Patched usage for conversation '%s'", conversation_id)
    except Exception:
        logger.exception(
            "Failed to patch usage for conversation '%s'", conversation_id
        )
