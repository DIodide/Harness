"""MCP OAuth 2.1 service implementing the Model Context Protocol authorization spec.

Handles:
- Protected Resource Metadata discovery (RFC 9728)
- Authorization Server Metadata discovery (RFC 8414 / OIDC)
- Dynamic Client Registration (RFC 7591) as fallback
- PKCE generation
- Authorization URL construction with resource indicators (RFC 8707)
- Authorization code exchange
- Token refresh
- Token retrieval from Convex
"""

import base64
import hashlib
import logging
import secrets
import time
from dataclasses import dataclass, field
from urllib.parse import urlencode, urlparse

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# Sentinel URL used as the mcpServerUrl key for standalone GitHub tokens
# (i.e. GitHub auth for sandbox git operations without a GitHub MCP server).
GITHUB_STANDALONE_URL = "https://github.com/__harness_sandbox_auth__"

# Cache for discovered metadata to avoid repeated HTTP calls.
_auth_server_cache: dict[str, "AuthServerMeta"] = {}
_AUTH_SERVER_CACHE_TTL = 300.0  # 5 minutes

# Cache for dynamically registered client credentials per auth server issuer.
_client_registration_cache: dict[str, "RegisteredClient"] = {}

# Temporary store for PKCE code verifiers during OAuth flow.
_pending_oauth: dict[str, "PendingOAuth"] = {}


@dataclass
class RegisteredClient:
    """Credentials obtained via Dynamic Client Registration."""

    client_id: str
    client_secret: str | None = None
    client_id_issued_at: float = 0
    client_secret_expires_at: float = 0


@dataclass
class AuthServerMeta:
    """Cached authorization server metadata."""

    authorization_endpoint: str
    token_endpoint: str
    registration_endpoint: str | None
    scopes_supported: list[str]
    code_challenge_methods_supported: list[str]
    resource_metadata_url: str
    supports_cimd: bool  # client_id_metadata_document_supported
    raw_metadata: dict = field(default_factory=dict)
    fetched_at: float = 0


@dataclass
class PendingOAuth:
    """Tracks an in-progress OAuth flow."""

    user_id: str
    mcp_server_url: str
    code_verifier: str
    scopes: str
    auth_server_meta: AuthServerMeta
    registered_client: RegisteredClient
    redirect_uri: str
    created_at: float


def _generate_pkce_pair() -> tuple[str, str]:
    """Generate PKCE code_verifier and S256 code_challenge."""
    code_verifier = secrets.token_urlsafe(96)[:128]
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = (
        base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    )
    return code_verifier, code_challenge


def _canonical_server_url(url: str) -> str:
    """Normalize an MCP server URL to its canonical form for resource param."""
    parsed = urlparse(url)
    canonical = f"{parsed.scheme}://{parsed.netloc}{parsed.path}".rstrip("/")
    return canonical


async def discover_auth_server(
    client: httpx.AsyncClient,
    mcp_server_url: str,
) -> AuthServerMeta:
    """Discover the authorization server for an MCP server.

    1. Send unauthenticated request -> get 401 with WWW-Authenticate header
    2. Fetch Protected Resource Metadata (RFC 9728)
    3. Fetch Authorization Server Metadata (RFC 8414 / OIDC Discovery)
    """
    cached = _auth_server_cache.get(mcp_server_url)
    if cached and time.monotonic() - cached.fetched_at < _AUTH_SERVER_CACHE_TTL:
        return cached

    # Step 1: Probe the MCP server to get WWW-Authenticate header
    resource_metadata_url = None
    challenge_scopes = None

    try:
        resp = await client.post(
            mcp_server_url,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {},
            },
            headers={"Content-Type": "application/json"},
            timeout=10.0,
        )
        if resp.status_code == 401:
            www_auth = resp.headers.get("www-authenticate", "")
            resource_metadata_url = _parse_www_authenticate(
                www_auth, "resource_metadata"
            )
            challenge_scopes = _parse_www_authenticate(www_auth, "scope")
    except httpx.HTTPError as e:
        logger.warning(
            "Failed to probe MCP server %s: %s", mcp_server_url, e
        )

    # Step 2: Fetch Protected Resource Metadata
    if not resource_metadata_url:
        resource_metadata_url = await _probe_resource_metadata(
            client, mcp_server_url
        )

    scopes_supported: list[str] = []
    as_meta: dict | None = None

    if resource_metadata_url:
        # Standard path: fetch Protected Resource Metadata, then AS metadata
        resource_meta = await _fetch_json(client, resource_metadata_url)
        auth_servers = resource_meta.get("authorization_servers", [])
        if not auth_servers:
            raise OAuthDiscoveryError(
                f"No authorization_servers in resource metadata "
                f"for {mcp_server_url}"
            )

        scopes_supported = resource_meta.get("scopes_supported", [])
        auth_server_issuer = auth_servers[0]
        as_meta = await _discover_as_metadata(client, auth_server_issuer)
    else:
        # Fallback: some servers (e.g. Linear) skip Protected Resource Metadata
        # and serve AS metadata directly on the MCP server's origin.
        parsed = urlparse(mcp_server_url)
        mcp_origin = f"{parsed.scheme}://{parsed.netloc}"
        try:
            as_meta = await _discover_as_metadata(client, mcp_origin)
            scopes_supported = as_meta.get("scopes_supported", [])
            logger.info(
                "Discovered AS metadata directly on MCP origin %s",
                mcp_origin,
            )
        except OAuthDiscoveryError:
            raise OAuthDiscoveryError(
                f"Could not discover resource metadata or AS metadata "
                f"for {mcp_server_url}"
            )

    authorization_endpoint = as_meta.get("authorization_endpoint")
    token_endpoint = as_meta.get("token_endpoint")
    if not authorization_endpoint or not token_endpoint:
        raise OAuthDiscoveryError(
            f"AS metadata missing required endpoints for "
            f"{mcp_server_url}"
        )

    code_challenge_methods = as_meta.get(
        "code_challenge_methods_supported", []
    )
    if not code_challenge_methods:
        raise OAuthDiscoveryError(
            f"AS for {mcp_server_url} does not support PKCE"
        )

    meta = AuthServerMeta(
        authorization_endpoint=authorization_endpoint,
        token_endpoint=token_endpoint,
        registration_endpoint=as_meta.get("registration_endpoint"),
        scopes_supported=scopes_supported,
        code_challenge_methods_supported=code_challenge_methods,
        resource_metadata_url=resource_metadata_url or mcp_server_url,
        supports_cimd=as_meta.get(
            "client_id_metadata_document_supported", False
        ),
        raw_metadata=as_meta,
        fetched_at=time.monotonic(),
    )
    _auth_server_cache[mcp_server_url] = meta
    return meta


async def _ensure_client_registration(
    client: httpx.AsyncClient,
    meta: AuthServerMeta,
    redirect_uri: str,
) -> RegisteredClient:
    """Ensure we have a registered client for this authorization server.

    Priority per MCP spec:
    1. Pre-registered client (env vars for known providers like GitHub)
    2. Dynamic Client Registration (if registration_endpoint exists)
    3. Fallback to static client_id (CIMD-style)
    """
    issuer = meta.raw_metadata.get(
        "issuer", meta.authorization_endpoint
    )

    # Check cache
    cached = _client_registration_cache.get(issuer)
    if cached:
        if (
            not cached.client_secret_expires_at
            or cached.client_secret_expires_at > time.time() + 60
        ):
            return cached

    # 1. Check for pre-registered credentials (known providers)
    pre_registered = _get_preregistered_client(issuer)
    if pre_registered:
        _client_registration_cache[issuer] = pre_registered
        logger.info(
            "Using pre-registered client for %s", issuer
        )
        return pre_registered

    # 2. Try Dynamic Client Registration if available
    if meta.registration_endpoint:
        logger.info(
            "Registering client via DCR at %s",
            meta.registration_endpoint,
        )
        reg_request = {
            "client_name": "Harness",
            "redirect_uris": [redirect_uri],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "client_secret_basic",
        }

        try:
            resp = await client.post(
                meta.registration_endpoint,
                json=reg_request,
                headers={"Content-Type": "application/json"},
                timeout=15.0,
            )
            if resp.status_code in (200, 201):
                reg_resp = resp.json()
                registered = RegisteredClient(
                    client_id=reg_resp["client_id"],
                    client_secret=reg_resp.get("client_secret"),
                    client_id_issued_at=reg_resp.get(
                        "client_id_issued_at", time.time()
                    ),
                    client_secret_expires_at=reg_resp.get(
                        "client_secret_expires_at", 0
                    ),
                )
                _client_registration_cache[issuer] = registered
                logger.info(
                    "DCR successful, client_id=%s", registered.client_id
                )
                return registered
            else:
                logger.warning(
                    "DCR failed (%d): %s",
                    resp.status_code,
                    resp.text[:300],
                )
        except httpx.HTTPError as e:
            logger.warning("DCR request failed: %s", e)

    # Fallback: use a static client_id (CIMD-style URL)
    static_id = _get_static_client_id()
    logger.info("Using static client_id: %s", static_id)
    return RegisteredClient(client_id=static_id)


async def start_oauth_flow(
    client: httpx.AsyncClient,
    user_id: str,
    mcp_server_url: str,
    redirect_uri: str,
) -> tuple[str, str]:
    """Start the OAuth flow for a user connecting to an MCP server.

    Returns (authorization_url, state).
    """
    meta = await discover_auth_server(client, mcp_server_url)

    # Ensure we have client credentials (via DCR or static)
    registered = await _ensure_client_registration(
        client, meta, redirect_uri
    )

    state = secrets.token_urlsafe(32)
    code_verifier, code_challenge = _generate_pkce_pair()
    canonical_resource = _canonical_server_url(mcp_server_url)

    scopes = (
        " ".join(meta.scopes_supported) if meta.scopes_supported else ""
    )

    params: dict[str, str] = {
        "response_type": "code",
        "client_id": registered.client_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "resource": canonical_resource,
    }
    if scopes:
        params["scope"] = scopes

    authorization_url = (
        f"{meta.authorization_endpoint}?{urlencode(params)}"
    )

    _pending_oauth[state] = PendingOAuth(
        user_id=user_id,
        mcp_server_url=mcp_server_url,
        code_verifier=code_verifier,
        scopes=scopes,
        auth_server_meta=meta,
        registered_client=registered,
        redirect_uri=redirect_uri,
        created_at=time.time(),
    )

    _cleanup_pending()
    return authorization_url, state


async def exchange_code(
    client: httpx.AsyncClient,
    state: str,
    code: str,
) -> dict:
    """Exchange an authorization code for tokens.

    Returns dict with token info.
    """
    pending = _pending_oauth.pop(state, None)
    if not pending:
        raise OAuthError("Invalid or expired OAuth state")

    canonical_resource = _canonical_server_url(pending.mcp_server_url)
    reg = pending.registered_client

    token_data: dict[str, str] = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": pending.redirect_uri,
        "client_id": reg.client_id,
        "resource": canonical_resource,
    }
    if pending.code_verifier:
        token_data["code_verifier"] = pending.code_verifier

    # Build headers — use client_secret_basic if we have a secret
    headers: dict[str, str] = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
    }
    if reg.client_secret:
        credentials = base64.b64encode(
            f"{reg.client_id}:{reg.client_secret}".encode()
        ).decode()
        headers["Authorization"] = f"Basic {credentials}"
    else:
        # Some providers (e.g. GitHub) want client_secret in body
        # even if empty, when using client_secret_post
        pass

    resp = await client.post(
        pending.auth_server_meta.token_endpoint,
        data=token_data,
        headers=headers,
        timeout=15.0,
    )

    if resp.status_code != 200:
        logger.error(
            "Token exchange failed for %s: %d %s",
            pending.mcp_server_url,
            resp.status_code,
            resp.text[:500],
        )
        raise OAuthError(
            f"Token exchange failed: {resp.status_code}"
        )

    token_resp = resp.json()

    return {
        "user_id": pending.user_id,
        "mcp_server_url": pending.mcp_server_url,
        "access_token": token_resp["access_token"],
        "refresh_token": token_resp.get("refresh_token"),
        "expires_in": token_resp.get("expires_in", 3600),
        "scope": token_resp.get("scope", pending.scopes),
        "auth_server_url": pending.auth_server_meta.token_endpoint,
    }


async def refresh_access_token(
    client: httpx.AsyncClient,
    refresh_token: str,
    token_endpoint: str,
    mcp_server_url: str,
) -> dict | None:
    """Use a refresh token to get a new access token."""
    canonical_resource = _canonical_server_url(mcp_server_url)

    token_data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "resource": canonical_resource,
    }

    # Try to find cached client credentials for this token endpoint
    issuer = _issuer_from_token_endpoint(token_endpoint)
    reg = _client_registration_cache.get(issuer)

    if reg:
        token_data["client_id"] = reg.client_id
        headers: dict[str, str] = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        }
        if reg.client_secret:
            credentials = base64.b64encode(
                f"{reg.client_id}:{reg.client_secret}".encode()
            ).decode()
            headers["Authorization"] = f"Basic {credentials}"
    else:
        token_data["client_id"] = _get_static_client_id()
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        }

    try:
        resp = await client.post(
            token_endpoint,
            data=token_data,
            headers=headers,
            timeout=15.0,
        )
        if resp.status_code != 200:
            logger.warning(
                "Token refresh failed for %s: %d",
                mcp_server_url,
                resp.status_code,
            )
            return None

        token_resp = resp.json()
        return {
            "access_token": token_resp["access_token"],
            "refresh_token": token_resp.get(
                "refresh_token", refresh_token
            ),
            "expires_in": token_resp.get("expires_in", 3600),
            "scope": token_resp.get("scope", ""),
        }
    except httpx.HTTPError as e:
        logger.error(
            "HTTP error refreshing token for %s: %s",
            mcp_server_url,
            e,
        )
        return None


async def get_valid_token(
    http_client: httpx.AsyncClient,
    user_id: str,
    mcp_server_url: str,
) -> str | None:
    """Get a valid access token for a user+server pair from Convex.

    Automatically refreshes if expired.
    """
    if not settings.convex_url or not settings.convex_deploy_key:
        return None

    token_data = await _convex_get_tokens(
        http_client, user_id, mcp_server_url
    )
    if not token_data:
        return None

    access_token = token_data.get("accessToken")
    expires_at = token_data.get("expiresAt", 0)
    refresh_token = token_data.get("refreshToken")
    auth_server_url = token_data.get("authServerUrl", "")

    # Valid with 60s buffer
    if expires_at > time.time() + 60:
        return access_token

    if not refresh_token or not auth_server_url:
        logger.info(
            "Token expired and no refresh token for %s",
            mcp_server_url,
        )
        return None

    new_tokens = await refresh_access_token(
        http_client, refresh_token, auth_server_url, mcp_server_url
    )
    if not new_tokens:
        await _convex_delete_tokens(
            http_client, user_id, mcp_server_url
        )
        return None

    await _convex_store_tokens(
        http_client,
        user_id=user_id,
        mcp_server_url=mcp_server_url,
        access_token=new_tokens["access_token"],
        refresh_token=new_tokens.get("refresh_token"),
        expires_in=new_tokens.get("expires_in", 3600),
        scopes=new_tokens.get("scope", ""),
        auth_server_url=auth_server_url,
    )

    return new_tokens["access_token"]


# --- Convex helpers ---


async def _convex_get_tokens(
    client: httpx.AsyncClient,
    user_id: str,
    mcp_server_url: str,
) -> dict | None:
    """Fetch OAuth tokens from Convex."""
    try:
        resp = await client.post(
            f"{settings.convex_url}/api/query",
            headers={
                "Authorization": f"Convex {settings.convex_deploy_key}",
            },
            json={
                "path": "mcpOAuthTokens:getTokens",
                "args": {
                    "userId": user_id,
                    "mcpServerUrl": mcp_server_url,
                },
                "format": "json",
            },
            timeout=10.0,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("value")
    except Exception as e:
        logger.error(
            "Failed to fetch OAuth tokens from Convex: %s", e
        )
        return None


async def _convex_store_tokens(
    client: httpx.AsyncClient,
    user_id: str,
    mcp_server_url: str,
    access_token: str,
    refresh_token: str | None,
    expires_in: int,
    scopes: str,
    auth_server_url: str,
) -> None:
    """Store OAuth tokens in Convex."""
    args: dict = {
        "userId": user_id,
        "mcpServerUrl": mcp_server_url,
        "accessToken": access_token,
        "expiresAt": time.time() + expires_in,
        "scopes": scopes,
        "authServerUrl": auth_server_url,
    }
    if refresh_token:
        args["refreshToken"] = refresh_token

    try:
        resp = await client.post(
            f"{settings.convex_url}/api/mutation",
            headers={
                "Authorization": f"Convex {settings.convex_deploy_key}",
            },
            json={
                "path": "mcpOAuthTokens:storeTokens",
                "args": args,
                "format": "json",
            },
            timeout=10.0,
        )
        resp.raise_for_status()
    except Exception as e:
        logger.error(
            "Failed to store OAuth tokens in Convex: %s", e
        )


async def _convex_delete_tokens(
    client: httpx.AsyncClient,
    user_id: str,
    mcp_server_url: str,
) -> None:
    """Delete OAuth tokens from Convex."""
    try:
        resp = await client.post(
            f"{settings.convex_url}/api/mutation",
            headers={
                "Authorization": f"Convex {settings.convex_deploy_key}",
            },
            json={
                "path": "mcpOAuthTokens:deleteTokensInternal",
                "args": {
                    "userId": user_id,
                    "mcpServerUrl": mcp_server_url,
                },
                "format": "json",
            },
            timeout=10.0,
        )
        resp.raise_for_status()
    except Exception as e:
        logger.error(
            "Failed to delete OAuth tokens from Convex: %s", e
        )


# --- Discovery helpers ---


def _parse_www_authenticate(
    header: str, param_name: str
) -> str | None:
    """Parse a parameter value from a WWW-Authenticate header."""
    if not header:
        return None
    for part in header.split(","):
        part = part.strip()
        if "=" in part:
            key, _, value = part.partition("=")
            key = key.strip().split()[-1]  # handle "Bearer key"
            value = value.strip().strip('"')
            if key == param_name:
                return value
    return None


async def _probe_resource_metadata(
    client: httpx.AsyncClient, mcp_server_url: str
) -> str | None:
    """Try well-known URI probing for Protected Resource Metadata."""
    parsed = urlparse(mcp_server_url)
    base = f"{parsed.scheme}://{parsed.netloc}"
    path = parsed.path.rstrip("/")

    urls_to_try = []
    if path and path != "/":
        urls_to_try.append(
            f"{base}/.well-known/oauth-protected-resource{path}"
        )
    urls_to_try.append(
        f"{base}/.well-known/oauth-protected-resource"
    )

    for url in urls_to_try:
        try:
            resp = await client.get(url, timeout=5.0)
            if resp.status_code == 200:
                return url
        except httpx.HTTPError:
            continue
    return None


async def _discover_as_metadata(
    client: httpx.AsyncClient, issuer: str
) -> dict:
    """Discover Authorization Server metadata."""
    parsed = urlparse(issuer)
    base = f"{parsed.scheme}://{parsed.netloc}"
    path = parsed.path.rstrip("/")

    urls: list[str] = []
    if path and path != "/":
        urls.append(
            f"{base}/.well-known/oauth-authorization-server{path}"
        )
        urls.append(
            f"{base}/.well-known/openid-configuration{path}"
        )
        urls.append(
            f"{base}{path}/.well-known/openid-configuration"
        )
    else:
        urls.append(
            f"{base}/.well-known/oauth-authorization-server"
        )
        urls.append(f"{base}/.well-known/openid-configuration")

    for url in urls:
        try:
            resp = await client.get(url, timeout=5.0)
            if resp.status_code == 200:
                data = resp.json()
                if "authorization_endpoint" in data:
                    return data
        except (httpx.HTTPError, ValueError):
            continue

    raise OAuthDiscoveryError(
        f"Could not discover AS metadata for {issuer}"
    )


async def _fetch_json(
    client: httpx.AsyncClient, url: str
) -> dict:
    """Fetch JSON from a URL."""
    resp = await client.get(url, timeout=10.0)
    resp.raise_for_status()
    return resp.json()


def _get_preregistered_client(
    issuer: str,
) -> RegisteredClient | None:
    """Check if we have pre-registered OAuth credentials for a known issuer."""
    # GitHub OAuth
    if "github.com" in issuer and settings.github_oauth_client_id:
        return RegisteredClient(
            client_id=settings.github_oauth_client_id,
            client_secret=settings.github_oauth_client_secret or None,
        )
    return None


def _get_static_client_id() -> str:
    """Get a static OAuth client ID (CIMD-style URL)."""
    return (
        f"{settings.fastapi_base_url}/oauth/client-metadata.json"
    )


def _issuer_from_token_endpoint(token_endpoint: str) -> str:
    """Derive an issuer key from a token endpoint URL."""
    parsed = urlparse(token_endpoint)
    return f"{parsed.scheme}://{parsed.netloc}"


def start_github_oauth_flow(
    user_id: str,
    redirect_uri: str,
) -> tuple[str, str]:
    """Start a direct GitHub OAuth flow (no MCP discovery).

    Returns (authorization_url, state).
    """
    client_id = settings.github_oauth_client_id
    if not client_id:
        raise OAuthError("GitHub OAuth client ID not configured")

    state = secrets.token_urlsafe(32)

    # GitHub OAuth Apps don't support PKCE — no code_challenge/code_verifier.
    # Security relies on client_secret + state parameter for CSRF protection.

    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "scope": "repo read:user",
    }

    authorization_url = (
        f"https://github.com/login/oauth/authorize?{urlencode(params)}"
    )

    # Build a minimal AuthServerMeta so the callback can exchange the code
    meta = AuthServerMeta(
        authorization_endpoint="https://github.com/login/oauth/authorize",
        token_endpoint="https://github.com/login/oauth/access_token",
        registration_endpoint=None,
        scopes_supported=["repo", "read:user"],
        code_challenge_methods_supported=["S256"],
        resource_metadata_url="",
        supports_cimd=False,
        fetched_at=time.time(),
    )

    registered = RegisteredClient(
        client_id=client_id,
        client_secret=settings.github_oauth_client_secret or None,
    )

    _pending_oauth[state] = PendingOAuth(
        user_id=user_id,
        mcp_server_url=GITHUB_STANDALONE_URL,
        code_verifier="",
        scopes="repo read:user",
        auth_server_meta=meta,
        registered_client=registered,
        redirect_uri=redirect_uri,
        created_at=time.time(),
    )

    _cleanup_pending()
    return authorization_url, state


def _cleanup_pending() -> None:
    """Remove pending OAuth flows older than 10 minutes."""
    cutoff = time.time() - 600
    expired = [
        k for k, v in _pending_oauth.items()
        if v.created_at < cutoff
    ]
    for k in expired:
        del _pending_oauth[k]


def get_pending_oauth(state: str) -> PendingOAuth | None:
    """Get a pending OAuth flow by state."""
    return _pending_oauth.get(state)


# --- Exceptions ---


class OAuthDiscoveryError(Exception):
    """Failed to discover OAuth authorization server."""


class OAuthError(Exception):
    """General OAuth error."""
