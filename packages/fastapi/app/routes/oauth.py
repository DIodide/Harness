"""OAuth routes for MCP server authentication.

GET /auth/{provider}/start  -- Initiates OAuth flow
GET /auth/{provider}/callback -- Handles OAuth callback
"""

import logging
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse

from app.config import MCP_SERVERS, settings
from app.services import convex as convex_client
from app.services.mcp_oauth import (
    OAuthFlow,
    discover_authorization_server,
    exchange_code_for_tokens,
    generate_pkce,
    generate_state,
    get_pending_flow,
    register_client,
    store_pending_flow,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["oauth"])


@router.get("/{provider}/start")
async def oauth_start(
    provider: str,
    user_id: str = Query(..., description="Clerk user ID"),
):
    """Start the OAuth flow for an MCP server provider."""
    server = MCP_SERVERS.get(provider)
    if not server:
        raise HTTPException(404, f"Unknown provider: {provider}")
    if server["auth"] != "oauth":
        raise HTTPException(400, f"Provider {provider} does not require OAuth")

    mcp_url = server["url"]

    try:
        as_metadata = await discover_authorization_server(mcp_url)
    except ValueError as e:
        raise HTTPException(502, str(e))

    authorization_endpoint = as_metadata.get("authorization_endpoint")
    token_endpoint = as_metadata.get("token_endpoint")
    registration_endpoint = as_metadata.get("registration_endpoint")

    if not authorization_endpoint or not token_endpoint:
        raise HTTPException(
            502,
            "Authorization server missing required endpoints",
        )

    callback_url = f"http://localhost:8000/auth/{provider}/callback"

    # Dynamic client registration if available
    if registration_endpoint:
        try:
            reg = await register_client(
                registration_endpoint, callback_url, provider
            )
            client_id = reg["client_id"]
            client_secret = reg.get("client_secret")
        except Exception:
            logger.exception("Dynamic client registration failed")
            raise HTTPException(502, "Client registration failed")
    else:
        raise HTTPException(
            502,
            "No registration endpoint and no pre-registered client_id",
        )

    code_verifier, code_challenge = generate_pkce()
    state = generate_state()

    flow = OAuthFlow(
        state=state,
        code_verifier=code_verifier,
        provider=provider,
        user_id=user_id,
        redirect_uri=callback_url,
        token_endpoint=token_endpoint,
        client_id=client_id,
        client_secret=client_secret,
    )
    store_pending_flow(flow)

    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": callback_url,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }

    scopes = as_metadata.get("scopes_supported")
    if scopes:
        params["scope"] = " ".join(scopes[:5])

    auth_url = f"{authorization_endpoint}?{urlencode(params)}"
    return RedirectResponse(auth_url)


@router.get("/{provider}/callback")
async def oauth_callback(
    provider: str,
    code: str = Query(...),
    state: str = Query(...),
):
    """Handle the OAuth callback after user authorization."""
    flow_data = get_pending_flow(state)
    if not flow_data:
        raise HTTPException(400, "Invalid or expired OAuth state")

    if flow_data["provider"] != provider:
        raise HTTPException(400, "Provider mismatch")

    try:
        tokens = await exchange_code_for_tokens(
            token_endpoint=flow_data["token_endpoint"],
            code=code,
            code_verifier=flow_data["code_verifier"],
            redirect_uri=flow_data["redirect_uri"],
            client_id=flow_data["client_id"],
            client_secret=flow_data.get("client_secret"),
        )
    except Exception:
        logger.exception("Token exchange failed")
        raise HTTPException(502, "Failed to exchange authorization code")

    server = MCP_SERVERS.get(provider, {})
    expires_in = tokens.get("expires_in")
    expires_at = None
    if expires_in:
        import time
        expires_at = int(time.time()) + int(expires_in)

    await convex_client.run_mutation(
        "mcpConnections:upsert",
        {
            "userId": flow_data["user_id"],
            "serverName": provider,
            "serverUrl": server.get("url", ""),
            "accessToken": tokens["access_token"],
            "refreshToken": tokens.get("refresh_token"),
            "tokenExpiresAt": expires_at,
            "scopes": tokens.get("scope", "").split() if tokens.get("scope") else None,
        },
    )

    redirect_url = f"{settings.frontend_url}/chat?connected={provider}"
    return RedirectResponse(redirect_url)
