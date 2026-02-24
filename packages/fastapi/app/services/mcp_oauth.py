"""MCP OAuth 2.1 discovery and PKCE flow logic.

Implements:
- RFC 9728: Protected Resource Metadata discovery
- RFC 8414: Authorization Server Metadata
- RFC 7591: Dynamic Client Registration
- PKCE (S256) code challenge generation
"""

import hashlib
import secrets
import base64
import logging
from dataclasses import dataclass, field

import httpx

logger = logging.getLogger(__name__)

# In-memory caches (single-process MVP)
_as_metadata_cache: dict[str, dict] = {}
_client_registration_cache: dict[str, dict] = {}
_pending_flows: dict[str, dict] = {}


@dataclass
class OAuthFlow:
    state: str
    code_verifier: str
    provider: str
    user_id: str
    redirect_uri: str
    token_endpoint: str
    client_id: str
    client_secret: str | None = None


def generate_pkce() -> tuple[str, str]:
    """Generate PKCE code_verifier and code_challenge (S256)."""
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def generate_state() -> str:
    return secrets.token_urlsafe(32)


async def discover_authorization_server(
    mcp_server_url: str,
) -> dict:
    """Discover the authorization server from an MCP server's protected resource metadata."""
    cached = _as_metadata_cache.get(mcp_server_url)
    if cached:
        return cached

    async with httpx.AsyncClient(timeout=15.0) as client:
        # Try RFC 9728 well-known endpoint first
        base = mcp_server_url.rstrip("/")
        prm_url = f"{'/'.join(base.split('/')[:3])}/.well-known/oauth-protected-resource"

        try:
            resp = await client.get(prm_url)
            if resp.status_code == 200:
                prm = resp.json()
                as_url = prm.get("authorization_servers", [None])[0]
                if as_url:
                    return await _fetch_as_metadata(client, as_url, mcp_server_url)
        except Exception:
            logger.debug(f"PRM discovery failed for {mcp_server_url}, trying 401 challenge")

        # Fallback: hit the MCP server directly and parse WWW-Authenticate header
        try:
            resp = await client.get(base)
            if resp.status_code == 401:
                www_auth = resp.headers.get("www-authenticate", "")
                if "resource_metadata" in www_auth:
                    metadata_url = _extract_url_from_www_auth(www_auth, "resource_metadata")
                    if metadata_url:
                        prm_resp = await client.get(metadata_url)
                        if prm_resp.status_code == 200:
                            prm = prm_resp.json()
                            as_url = prm.get("authorization_servers", [None])[0]
                            if as_url:
                                return await _fetch_as_metadata(client, as_url, mcp_server_url)
        except Exception:
            logger.debug(f"401 challenge discovery failed for {mcp_server_url}")

        raise ValueError(
            f"Could not discover authorization server for {mcp_server_url}"
        )


async def _fetch_as_metadata(
    client: httpx.AsyncClient, as_url: str, cache_key: str
) -> dict:
    """Fetch OAuth Authorization Server Metadata (RFC 8414)."""
    as_base = as_url.rstrip("/")
    metadata_url = f"{as_base}/.well-known/oauth-authorization-server"

    resp = await client.get(metadata_url)
    if resp.status_code != 200:
        # Try OpenID Connect Discovery as fallback
        metadata_url = f"{as_base}/.well-known/openid-configuration"
        resp = await client.get(metadata_url)
        resp.raise_for_status()

    metadata = resp.json()
    _as_metadata_cache[cache_key] = metadata
    return metadata


async def register_client(
    registration_endpoint: str,
    redirect_uri: str,
    provider: str,
) -> dict:
    """Dynamically register this app as an OAuth client (RFC 7591)."""
    cache_key = f"{provider}:{redirect_uri}"
    cached = _client_registration_cache.get(cache_key)
    if cached:
        return cached

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            registration_endpoint,
            json={
                "client_name": "Harness",
                "redirect_uris": [redirect_uri],
                "grant_types": ["authorization_code", "refresh_token"],
                "response_types": ["code"],
                "token_endpoint_auth_method": "client_secret_post",
            },
        )
        resp.raise_for_status()
        reg = resp.json()
        _client_registration_cache[cache_key] = reg
        return reg


async def exchange_code_for_tokens(
    token_endpoint: str,
    code: str,
    code_verifier: str,
    redirect_uri: str,
    client_id: str,
    client_secret: str | None = None,
) -> dict:
    """Exchange an authorization code for tokens."""
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
        "code_verifier": code_verifier,
    }
    if client_secret:
        data["client_secret"] = client_secret

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            token_endpoint,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        return resp.json()


def store_pending_flow(flow: OAuthFlow) -> None:
    _pending_flows[flow.state] = {
        "code_verifier": flow.code_verifier,
        "provider": flow.provider,
        "user_id": flow.user_id,
        "redirect_uri": flow.redirect_uri,
        "token_endpoint": flow.token_endpoint,
        "client_id": flow.client_id,
        "client_secret": flow.client_secret,
    }


def get_pending_flow(state: str) -> dict | None:
    return _pending_flows.pop(state, None)


def _extract_url_from_www_auth(header: str, key: str) -> str | None:
    """Extract a URL from a WWW-Authenticate header parameter."""
    for part in header.split(","):
        part = part.strip()
        if part.startswith(f"{key}="):
            url = part.split("=", 1)[1].strip().strip('"')
            return url
    return None
