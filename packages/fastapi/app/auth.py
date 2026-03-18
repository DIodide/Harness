import logging

import httpx
import jwt
from fastapi import HTTPException, Request

from app.config import settings

logger = logging.getLogger(__name__)

_jwks_cache: dict | None = None


async def _get_jwks(client: httpx.AsyncClient, jwks_url: str) -> dict:
    """Fetch and cache Clerk's JWKS keys from a pinned URL."""
    global _jwks_cache
    if _jwks_cache is not None:
        return _jwks_cache

    logger.debug("Fetching JWKS from %s", jwks_url)
    resp = await client.get(jwks_url, timeout=10.0)
    resp.raise_for_status()
    _jwks_cache = resp.json()
    return _jwks_cache


async def verify_token(request: Request) -> dict:
    """FastAPI dependency that verifies the Clerk JWT from the Authorization header.

    Returns the decoded token payload (contains 'sub' as user ID).
    """
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization token")

    token = auth_header[7:]
    http_client = request.app.state.http_client

    # Require a pinned issuer to prevent JWKS spoofing attacks
    expected_issuer = settings.clerk_issuer
    if not expected_issuer:
        logger.error("CLERK_ISSUER is not configured")
        raise HTTPException(status_code=500, detail="Server authentication misconfigured")

    jwks_url = f"{expected_issuer.rstrip('/')}/.well-known/jwks.json"

    try:
        # Decode header to get key ID
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        if not kid:
            raise HTTPException(status_code=401, detail="Token missing key ID")

        # Validate `iss` from unverified payload against the pinned issuer
        # before any JWKS lookup, so attacker-controlled issuers are rejected early.
        unverified_claims = jwt.decode(token, options={"verify_signature": False})
        token_issuer = unverified_claims.get("iss", "")
        if token_issuer != expected_issuer:
            logger.warning("Token issuer mismatch: expected %s, got %s", expected_issuer, token_issuer)
            raise HTTPException(status_code=401, detail="Invalid token issuer")

        # Fetch JWKS from the pinned URL (not from the token's iss)
        jwks = await _get_jwks(http_client, jwks_url)
        key = None
        for k in jwks.get("keys", []):
            if k.get("kid") == kid:
                key = jwt.algorithms.RSAAlgorithm.from_jwk(k)
                break

        if key is None:
            # Key not found — maybe rotated. Clear cache and retry once.
            global _jwks_cache
            _jwks_cache = None
            logger.info("JWKS key %s not found in cache, refetching", kid)
            jwks = await _get_jwks(http_client, jwks_url)
            for k in jwks.get("keys", []):
                if k.get("kid") == kid:
                    key = jwt.algorithms.RSAAlgorithm.from_jwk(k)
                    break

        if key is None:
            raise HTTPException(status_code=401, detail="Signing key not found")

        payload = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            issuer=expected_issuer,
            options={"verify_aud": False},
        )
        return payload

    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as e:
        logger.warning("Invalid token received: %s", e)
        raise HTTPException(status_code=401, detail="Invalid token")
