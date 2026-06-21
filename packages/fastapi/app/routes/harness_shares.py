"""Harness-share email-binding (claim) endpoint.

When an owner invites a not-yet-registered email to a harness, the grant stores
only `granteeEmail`. On the recipient's first authenticated visit the client
calls this endpoint; we resolve the caller's SERVER-VERIFIED emails from the
Clerk Backend API (the client never supplies a bindable email) and bind any
matching invites to their Clerk subject via the deploy-key Convex mutation.
"""

import logging

import httpx
from fastapi import APIRouter, Depends

from app.config import settings
from app.dependencies import get_current_user, get_http_client
from app.services.convex import ConvexMutationError, run_convex_mutation

logger = logging.getLogger(__name__)

router = APIRouter()


async def _verified_emails(http_client: httpx.AsyncClient, user_id: str) -> list[str]:
    """The caller's verified email addresses, per the Clerk Backend API.

    Mirrors the verified-email enumeration in mcp_client.resolve_princeton_netid:
    only addresses whose verification.status == "verified" are returned, from
    both primary email_addresses and external_accounts. Empty on any error.
    """
    if not settings.clerk_secret_key:
        return []
    out: set[str] = set()
    try:
        resp = await http_client.get(
            f"https://api.clerk.com/v1/users/{user_id}",
            headers={"Authorization": f"Bearer {settings.clerk_secret_key}"},
            timeout=5.0,
        )
        if resp.status_code != 200:
            logger.warning(
                "Clerk API returned %d for user '%s' (claim)", resp.status_code, user_id
            )
            return []
        data = resp.json()
        for email_obj in data.get("email_addresses", []):
            addr = (email_obj.get("email_address") or "").strip().lower()
            if addr and (email_obj.get("verification") or {}).get("status") == "verified":
                out.add(addr)
        for ext in data.get("external_accounts", []):
            addr = (ext.get("email_address") or "").strip().lower()
            if addr and (ext.get("verification") or {}).get("status") == "verified":
                out.add(addr)
    except Exception as e:
        logger.warning("Failed to fetch Clerk user '%s' for claim: %s", user_id, e)
        return []
    return list(out)


@router.post("/claim")
async def claim_harness_shares(
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    """Bind any pending email invites to this user's verified emails.

    Idempotent and best-effort. Returns the number of grants bound.
    """
    user_id = user["sub"]
    emails = await _verified_emails(http_client, user_id)
    if not emails:
        return {"ok": True, "bound": 0}
    try:
        result = await run_convex_mutation(
            http_client,
            "harnessShares:bindHarnessGrantsInternal",
            {"userId": user_id, "verifiedEmails": emails},
        )
    except ConvexMutationError as e:
        logger.warning("bindHarnessGrantsInternal failed for '%s': %s", user_id, e)
        return {"ok": False, "bound": 0}
    bound = (result or {}).get("bound", 0) if isinstance(result, dict) else 0
    return {"ok": True, "bound": bound}
