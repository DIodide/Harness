"""OAuth routes for MCP server authentication.

Implements:
- GET /start      — Initiate OAuth flow, returns authorization URL
- GET /callback   — OAuth redirect callback, exchanges code for tokens
- GET /status     — Check if user has a valid token for an MCP server
- POST /revoke    — Delete stored tokens for an MCP server
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse

from app.auth import verify_token
from app.services.mcp_oauth import (
    GITHUB_STANDALONE_URL,
    OAuthDiscoveryError,
    OAuthError,
    exchange_code,
    get_valid_token,
    start_github_oauth_flow,
    start_oauth_flow,
    _convex_delete_tokens,
    _convex_store_tokens,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/start")
async def oauth_start(
    request: Request,
    server_url: str = Query(..., description="MCP server URL to authenticate with"),
    token: dict = Depends(verify_token),
):
    """Initiate the OAuth flow for an MCP server.

    Returns the authorization URL that the frontend should open in a popup.
    """
    user_id = token.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing user ID in token")

    http_client = request.app.state.http_client

    # Derive redirect URI from the incoming request so it works behind proxies/ngrok.
    # X-Forwarded-* headers are set by Vite's proxy and ngrok.
    forwarded_proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host", "localhost:8000")
    base_url = f"{forwarded_proto}://{forwarded_host}"
    redirect_uri = f"{base_url}/api/mcp/oauth/callback"

    try:
        authorization_url, state = await start_oauth_flow(
            http_client,
            user_id=user_id,
            mcp_server_url=server_url,
            redirect_uri=redirect_uri,
        )
    except OAuthDiscoveryError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.exception("Failed to start OAuth flow for %s", server_url)
        raise HTTPException(status_code=500, detail="Failed to start OAuth flow")

    return JSONResponse(
        {"authorization_url": authorization_url, "state": state}
    )


@router.get("/callback")
async def oauth_callback(
    request: Request,
    code: str = Query(...),
    state: str = Query(...),
):
    """OAuth redirect callback. Exchanges the authorization code for tokens.

    This endpoint is called by the authorization server after the user authorizes.
    It stores the tokens in Convex and returns an HTML page that closes the popup.
    """
    http_client = request.app.state.http_client

    try:
        token_info = await exchange_code(http_client, state=state, code=code)
    except OAuthError as e:
        return HTMLResponse(
            content=_close_popup_html(success=False, error=str(e)),
            status_code=200,
        )
    except Exception as e:
        logger.exception("OAuth callback error")
        return HTMLResponse(
            content=_close_popup_html(success=False, error="Token exchange failed"),
            status_code=200,
        )

    # Store tokens in Convex
    try:
        await _convex_store_tokens(
            http_client,
            user_id=token_info["user_id"],
            mcp_server_url=token_info["mcp_server_url"],
            access_token=token_info["access_token"],
            refresh_token=token_info.get("refresh_token"),
            expires_in=token_info.get("expires_in", 3600),
            scopes=token_info.get("scope", ""),
            auth_server_url=token_info.get("auth_server_url", ""),
        )
    except Exception as e:
        logger.exception("Failed to store OAuth tokens")
        return HTMLResponse(
            content=_close_popup_html(success=False, error="Failed to save tokens"),
            status_code=200,
        )

    return HTMLResponse(
        content=_close_popup_html(success=True, server_url=token_info["mcp_server_url"]),
        status_code=200,
    )


@router.get("/status")
async def oauth_status(
    request: Request,
    server_url: str = Query(..., description="MCP server URL to check"),
    token: dict = Depends(verify_token),
):
    """Check if the current user has a valid OAuth token for an MCP server."""
    user_id = token.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing user ID")

    http_client = request.app.state.http_client
    access_token = await get_valid_token(http_client, user_id, server_url)

    return JSONResponse({"connected": access_token is not None})


@router.post("/revoke")
async def oauth_revoke(
    request: Request,
    server_url: str = Query(..., description="MCP server URL to revoke tokens for"),
    token: dict = Depends(verify_token),
):
    """Revoke and delete stored OAuth tokens for an MCP server."""
    user_id = token.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing user ID")

    http_client = request.app.state.http_client
    await _convex_delete_tokens(http_client, user_id, server_url)

    return JSONResponse({"revoked": True})


# ── Dedicated GitHub OAuth (independent of MCP) ──────────────

@router.get("/github/start")
async def github_oauth_start(
    request: Request,
    token: dict = Depends(verify_token),
):
    """Initiate the GitHub OAuth flow for sandbox git operations."""
    user_id = token.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing user ID in token")

    forwarded_proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host", "localhost:8000")
    base_url = f"{forwarded_proto}://{forwarded_host}"
    redirect_uri = f"{base_url}/api/mcp/oauth/callback"

    try:
        authorization_url, state = start_github_oauth_flow(
            user_id=user_id,
            redirect_uri=redirect_uri,
        )
    except OAuthError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.exception("Failed to start GitHub OAuth flow")
        raise HTTPException(status_code=500, detail="Failed to start GitHub OAuth flow")

    return JSONResponse(
        {"authorization_url": authorization_url, "state": state}
    )


@router.get("/github/status")
async def github_oauth_status(
    request: Request,
    token: dict = Depends(verify_token),
):
    """Check if user has a valid standalone GitHub token for sandbox git."""
    user_id = token.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing user ID")

    http_client = request.app.state.http_client
    access_token = await get_valid_token(
        http_client, user_id, GITHUB_STANDALONE_URL,
    )

    return JSONResponse({"connected": access_token is not None})


@router.post("/github/revoke")
async def github_oauth_revoke(
    request: Request,
    token: dict = Depends(verify_token),
):
    """Revoke the standalone GitHub OAuth token."""
    user_id = token.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing user ID")

    http_client = request.app.state.http_client
    await _convex_delete_tokens(http_client, user_id, GITHUB_STANDALONE_URL)

    return JSONResponse({"revoked": True})


def _close_popup_html(
    success: bool,
    server_url: str = "",
    error: str = "",
) -> str:
    """Generate HTML that communicates the OAuth result to the parent window and closes."""
    message_data = {
        "type": "mcp-oauth-callback",
        "success": success,
        "serverUrl": server_url,
        "error": error,
    }

    return f"""<!DOCTYPE html>
<html>
<head><title>MCP OAuth</title></head>
<body>
<p>{"Connected successfully!" if success else f"Error: {error}"}</p>
<p>You can close this window.</p>
<script>
    if (window.opener) {{
        window.opener.postMessage({json.dumps(message_data)}, "*");
    }}
    setTimeout(function() {{ window.close(); }}, 1500);
</script>
</body>
</html>"""
