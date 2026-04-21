import logging
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


async def query_convex(
    http_client: httpx.AsyncClient,
    path: str,
    args: dict[str, Any],
) -> Any:
    """Execute a Convex query via the HTTP API using the deploy key."""
    if not settings.convex_url or not settings.convex_deploy_key:
        return None

    try:
        resp = await http_client.post(
            f"{settings.convex_url}/api/query",
            headers={
                "Authorization": f"Convex {settings.convex_deploy_key}",
            },
            json={
                "path": path,
                "args": args,
                "format": "json",
            },
            timeout=10.0,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("value")
    except Exception:
        logger.exception("Failed to query Convex path '%s'", path)
        return None


async def save_assistant_message(
    http_client: httpx.AsyncClient,
    conversation_id: str,
    content: str,
    reasoning: str | None = None,
    tool_calls: list[dict] | None = None,
    parts: list[dict] | None = None,
    usage: dict | None = None,
    model: str | None = None,
    interrupted: bool = False,
    interruption_reason: str | None = None,
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
    if interrupted:
        args["interrupted"] = True
    if interruption_reason:
        args["interruptionReason"] = interruption_reason

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


async def verify_sandbox_owner(
    daytona_sandbox_id: str,
    user_id: str,
) -> bool:
    """Check that the sandbox belongs to the given user via Convex.

    Returns True if the user owns the sandbox, False otherwise.
    """
    if not settings.convex_url or not settings.convex_deploy_key:
        if settings.convex_url or settings.convex_deploy_key:
            # Partially configured — likely a misconfiguration, deny access
            logger.error(
                "Convex partially configured (url=%s, key=%s) — denying ownership check",
                bool(settings.convex_url), bool(settings.convex_deploy_key),
            )
            return False
        logger.warning("Convex not configured — skipping ownership check (dev only)")
        return True

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{settings.convex_url}/api/query",
                headers={
                    "Authorization": f"Convex {settings.convex_deploy_key}",
                },
                json={
                    "path": "sandboxes:getOwnerByDaytonaId",
                    "args": {"daytonaSandboxId": daytona_sandbox_id},
                    "format": "json",
                },
                timeout=5.0,
            )
            resp.raise_for_status()
            result = resp.json()
            owner_id = result.get("value")
            if owner_id is None:
                logger.warning(
                    "Sandbox '%s' not found in Convex", daytona_sandbox_id
                )
                return False
            return owner_id == user_id
    except Exception:
        logger.exception(
            "Failed to verify sandbox ownership for '%s'", daytona_sandbox_id
        )
        return False


async def create_sandbox_record(
    http_client: httpx.AsyncClient,
    user_id: str,
    harness_id: str | None,
    daytona_sandbox_id: str,
    name: str,
    language: str,
    ephemeral: bool,
    resources: dict,
) -> str | None:
    """Create a sandbox record in Convex and link it to the harness.

    Returns the Convex sandbox document ID, or None on failure.
    """
    if not settings.convex_url or not settings.convex_deploy_key:
        logger.warning("Convex not configured — skipping sandbox record creation")
        return None

    args: dict = {
        "userId": user_id,
        "daytonaSandboxId": daytona_sandbox_id,
        "name": name,
        "status": "running",
        "language": language,
        "ephemeral": ephemeral,
        "resources": resources,
    }
    if harness_id:
        args["harnessId"] = harness_id

    try:
        resp = await http_client.post(
            f"{settings.convex_url}/api/mutation",
            headers={
                "Authorization": f"Convex {settings.convex_deploy_key}",
            },
            json={
                "path": "sandboxes:createInternal",
                "args": args,
                "format": "json",
            },
            timeout=15.0,
        )
        resp.raise_for_status()
        result = resp.json()
        sandbox_doc_id = result.get("value")
        logger.info(
            "Created sandbox record '%s' (daytona_id=%s) for harness '%s'",
            sandbox_doc_id, daytona_sandbox_id, harness_id,
        )
        return sandbox_doc_id
    except Exception:
        logger.exception(
            "Failed to create sandbox record for daytona_id '%s'",
            daytona_sandbox_id,
        )
        return None
