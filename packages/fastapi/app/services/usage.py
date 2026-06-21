"""Usage budget checking and recording via Convex HTTP API."""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


@dataclass
class BudgetCheckResult:
    allowed: bool
    daily_pct: float
    weekly_pct: float
    daily_reset: str  # ISO date of next day
    weekly_reset: str  # ISO date of next Monday


def _current_day() -> str:
    """Return current UTC date as 'YYYY-MM-DD'."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _current_week() -> str:
    """Return current ISO week as 'YYYY-WNN'."""
    now = datetime.now(timezone.utc)
    iso_year, iso_week, _ = now.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def _next_daily_reset() -> str:
    """Return ISO string for next midnight UTC."""
    now = datetime.now(timezone.utc)
    tomorrow = (now + timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return tomorrow.isoformat()


def _next_weekly_reset() -> str:
    """Return ISO string for next Monday 00:00 UTC."""
    now = datetime.now(timezone.utc)
    days_until_monday = (7 - now.weekday()) % 7
    if days_until_monday == 0:
        days_until_monday = 7
    next_monday = (now + timedelta(days=days_until_monday)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return next_monday.isoformat()


async def check_user_budget(
    http_client: httpx.AsyncClient,
    user_id: str,
) -> BudgetCheckResult:
    """Check whether a user is within their daily and weekly cost budgets.

    Calls the Convex `usage:checkBudget` internal query.
    Fails open on errors (allows the request, logs a warning).
    """
    if not settings.convex_url or not settings.convex_deploy_key:
        logger.warning("Convex not configured — skipping budget check")
        return BudgetCheckResult(
            allowed=True,
            daily_pct=0,
            weekly_pct=0,
            daily_reset=_next_daily_reset(),
            weekly_reset=_next_weekly_reset(),
        )

    try:
        resp = await http_client.post(
            f"{settings.convex_url}/api/query",
            headers={"Authorization": f"Convex {settings.convex_deploy_key}"},
            json={
                "path": "usage:checkBudget",
                "args": {
                    "userId": user_id,
                    "day": _current_day(),
                    "week": _current_week(),
                },
                "format": "json",
            },
            timeout=5.0,
        )
        resp.raise_for_status()
        data = resp.json()
        value = data.get("value")
        if value is None:
            logger.warning("checkBudget returned null — allowing request")
            return BudgetCheckResult(
                allowed=True,
                daily_pct=0,
                weekly_pct=0,
                daily_reset=_next_daily_reset(),
                weekly_reset=_next_weekly_reset(),
            )

        return BudgetCheckResult(
            allowed=value["allowed"],
            daily_pct=value["daily"]["pctUsed"],
            weekly_pct=value["weekly"]["pctUsed"],
            daily_reset=_next_daily_reset(),
            weekly_reset=_next_weekly_reset(),
        )
    except Exception:
        logger.exception("Failed to check user budget — allowing request (fail-open)")
        return BudgetCheckResult(
            allowed=True,
            daily_pct=0,
            weekly_pct=0,
            daily_reset=_next_daily_reset(),
            weekly_reset=_next_weekly_reset(),
        )


async def record_usage(
    http_client: httpx.AsyncClient,
    user_id: str,
    conversation_id: str,
    harness_id: str | None,
    harness_name: str | None,
    model: str,
    usage_data: dict,
) -> None:
    """Record usage after a chat stream completes.

    Calls the Convex `usage:recordUsage` internal mutation.
    Fire-and-forget: logs errors but does not block.
    Only records if cost is present in usage_data.
    """
    cost = usage_data.get("cost")
    if cost is None:
        logger.debug("No cost in usage data — skipping usage recording")
        return

    if not settings.convex_url or not settings.convex_deploy_key:
        logger.warning("Convex not configured — skipping usage recording")
        return

    args: dict = {
        "userId": user_id,
        "conversationId": conversation_id,
        "model": model,
        "promptTokens": usage_data.get("prompt_tokens", 0),
        "completionTokens": usage_data.get("completion_tokens", 0),
        "totalTokens": usage_data.get("total_tokens", 0),
        "cost": cost,
        "day": _current_day(),
        "week": _current_week(),
    }
    if harness_id:
        args["harnessId"] = harness_id
    if harness_name:
        args["harnessName"] = harness_name

    try:
        resp = await http_client.post(
            f"{settings.convex_url}/api/mutation",
            headers={"Authorization": f"Convex {settings.convex_deploy_key}"},
            json={
                "path": "usage:recordUsage",
                "args": args,
                "format": "json",
            },
            timeout=10.0,
        )
        resp.raise_for_status()
        logger.info(
            "Recorded usage for user '%s': cost=$%.6f, model=%s",
            user_id,
            cost,
            model,
        )
    except Exception:
        logger.exception(
            "Failed to record usage for user '%s' conversation '%s'",
            user_id,
            conversation_id,
        )


async def record_agent_usage(
    http_client: httpx.AsyncClient,
    *,
    user_id: str,
    agent_credential_id: str,
    agent: str,
    conversation_id: str,
    acp_session_id: str | None,
    model: str | None,
    used_tokens: int,
    context_size: int | None,
    cost: float,
    currency: str,
    turn_key: str,
    rate_limit: object | None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    cache_read_tokens: int | None = None,
    cache_creation_tokens: int | None = None,
    authoritative: bool = False,
) -> None:
    """Record one ACP agent turn's usage, per credential.

    Unlike `record_usage` (OpenRouter spend Harness pays for + caps), agent
    cost bills to the user's OWN agent account — this is informational only and
    never gates a turn. Idempotent on `turn_key` server-side, except an
    `authoritative` row (SDK result message: real total_cost_usd + cache tokens)
    upgrades an earlier thin one. Fire-and-forget: logs errors, never raises.
    """
    if not settings.convex_url or not settings.convex_deploy_key:
        return
    args: dict = {
        "userId": user_id,
        "agentCredentialId": agent_credential_id,
        "agent": agent,
        "conversationId": conversation_id,
        "usedTokens": used_tokens,
        "costUsd": cost,
        "currency": currency,
        "turnKey": turn_key,
        "day": _current_day(),
        "week": _current_week(),
    }
    if acp_session_id:
        args["acpSessionId"] = acp_session_id
    if model:
        args["model"] = model
    if context_size is not None:
        args["contextSize"] = context_size
    if rate_limit is not None:
        args["rateLimit"] = rate_limit
    if input_tokens is not None:
        args["inputTokens"] = input_tokens
    if output_tokens is not None:
        args["outputTokens"] = output_tokens
    if cache_read_tokens is not None:
        args["cacheReadTokens"] = cache_read_tokens
    if cache_creation_tokens is not None:
        args["cacheCreationTokens"] = cache_creation_tokens
    if authoritative:
        args["authoritative"] = True

    # Imported here to avoid a module-load cycle (convex imports settings too).
    from app.services.convex import run_convex_mutation

    try:
        await run_convex_mutation(http_client, "agentUsage:record", args)
    except Exception:
        logger.exception(
            "Failed to record agent usage for credential '%s'", agent_credential_id
        )


async def record_agent_rate_limit(
    http_client: httpx.AsyncClient,
    *,
    user_id: str,
    agent_credential_id: str,
    rate_limit: object,
) -> None:
    """Persist the latest Anthropic rate-limit snapshot onto the credential.

    Decoupled from `record_agent_usage` so it lands even when the rate_limit
    event carries no cost/tokens — including a silent hard-limit turn, which is
    exactly when the user needs to see the reset time. Fire-and-forget.
    """
    if not settings.convex_url or not settings.convex_deploy_key:
        return
    from app.services.convex import run_convex_mutation

    try:
        await run_convex_mutation(
            http_client,
            "agentCredentials:recordRateLimit",
            {
                "credentialId": agent_credential_id,
                "userId": user_id,
                "rateLimit": rate_limit,
            },
        )
    except Exception:
        logger.exception(
            "Failed to record rate limit for credential '%s'", agent_credential_id
        )
