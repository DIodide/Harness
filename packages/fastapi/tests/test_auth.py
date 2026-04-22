"""JWT verification — Clerk token parsing against a mocked JWKS endpoint."""
import time
from typing import Any

import httpx
import jwt
import pytest
import respx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException, Request

from app import auth as auth_module


@pytest.fixture(autouse=True)
def clear_jwks_cache():
    auth_module._jwks_cache = None
    yield
    auth_module._jwks_cache = None


@pytest.fixture
def rsa_keypair():
    """Generate a fresh RSA keypair and matching JWK for each test."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_key = key.public_key()
    jwk = jwt.algorithms.RSAAlgorithm.to_jwk(public_key, as_dict=True)
    jwk["kid"] = "test-kid-1"
    jwk["alg"] = "RS256"
    jwk["use"] = "sig"
    return private_pem, jwk


def _make_token(private_pem: bytes, kid: str, issuer: str, **claims: Any) -> str:
    payload = {
        "iss": issuer,
        "sub": "user_abc",
        "iat": int(time.time()),
        "exp": int(time.time()) + 3600,
        **claims,
    }
    return jwt.encode(payload, private_pem, algorithm="RS256", headers={"kid": kid})


def _fake_request(token: str | None, http_client: httpx.AsyncClient) -> Request:
    """Build a minimal FastAPI Request with headers and app.state.http_client."""
    headers = []
    if token is not None:
        headers.append((b"authorization", f"Bearer {token}".encode()))

    class _App:
        class state:
            pass

    _App.state.http_client = http_client

    scope = {
        "type": "http",
        "headers": headers,
        "app": _App,
    }
    return Request(scope)


async def test_missing_auth_header_raises_401():
    async with httpx.AsyncClient() as client:
        req = _fake_request(None, client)
        with pytest.raises(HTTPException) as exc:
            await auth_module.verify_token(req)
    assert exc.value.status_code == 401


async def test_bearer_prefix_required():
    async with httpx.AsyncClient() as client:
        # Simulate a non-bearer scheme
        req = _fake_request(None, client)
        # Manually set a non-bearer header
        req.scope["headers"] = [(b"authorization", b"Basic abcdef")]
        with pytest.raises(HTTPException) as exc:
            await auth_module.verify_token(req)
    assert exc.value.status_code == 401


async def test_token_without_kid_rejected():
    # Token has no 'kid' header → rejected before JWKS lookup.
    token = jwt.encode({"sub": "x"}, "secret", algorithm="HS256")
    async with httpx.AsyncClient() as client:
        req = _fake_request(token, client)
        with pytest.raises(HTTPException) as exc:
            await auth_module.verify_token(req)
    assert exc.value.status_code == 401


@respx.mock
async def test_valid_token_passes(rsa_keypair, monkeypatch):
    private_pem, jwk = rsa_keypair
    issuer = "https://test.clerk.accounts.dev"
    monkeypatch.setattr(auth_module.settings, "clerk_issuer", issuer)

    respx.get(f"{issuer}/.well-known/jwks.json").mock(
        return_value=httpx.Response(200, json={"keys": [jwk]})
    )

    token = _make_token(private_pem, "test-kid-1", issuer)
    async with httpx.AsyncClient() as client:
        req = _fake_request(token, client)
        payload = await auth_module.verify_token(req)
    assert payload["sub"] == "user_abc"
    assert payload["iss"] == issuer


@respx.mock
async def test_unknown_kid_triggers_refresh_and_passes(rsa_keypair, monkeypatch):
    """First JWKS fetch returns no matching key → cache cleared → second fetch finds it."""
    private_pem, jwk = rsa_keypair
    issuer = "https://test.clerk.accounts.dev"
    monkeypatch.setattr(auth_module.settings, "clerk_issuer", issuer)

    # Prime the cache with an empty keyset so the first lookup misses.
    auth_module._jwks_cache = {"keys": []}

    respx.get(f"{issuer}/.well-known/jwks.json").mock(
        return_value=httpx.Response(200, json={"keys": [jwk]})
    )

    token = _make_token(private_pem, "test-kid-1", issuer)
    async with httpx.AsyncClient() as client:
        req = _fake_request(token, client)
        payload = await auth_module.verify_token(req)
    assert payload["sub"] == "user_abc"


@respx.mock
async def test_kid_not_in_jwks_raises_401(rsa_keypair, monkeypatch):
    """After the refresh retry, if the kid is still missing, reject."""
    private_pem, _ = rsa_keypair
    issuer = "https://test.clerk.accounts.dev"
    monkeypatch.setattr(auth_module.settings, "clerk_issuer", issuer)

    respx.get(f"{issuer}/.well-known/jwks.json").mock(
        return_value=httpx.Response(200, json={"keys": []})
    )

    token = _make_token(private_pem, "missing-kid", issuer)
    async with httpx.AsyncClient() as client:
        req = _fake_request(token, client)
        with pytest.raises(HTTPException) as exc:
            await auth_module.verify_token(req)
    assert exc.value.status_code == 401


@respx.mock
async def test_expired_token_rejected(rsa_keypair, monkeypatch):
    private_pem, jwk = rsa_keypair
    issuer = "https://test.clerk.accounts.dev"
    monkeypatch.setattr(auth_module.settings, "clerk_issuer", issuer)

    respx.get(f"{issuer}/.well-known/jwks.json").mock(
        return_value=httpx.Response(200, json={"keys": [jwk]})
    )

    token = _make_token(
        private_pem, "test-kid-1", issuer,
        exp=int(time.time()) - 10,
    )
    async with httpx.AsyncClient() as client:
        req = _fake_request(token, client)
        with pytest.raises(HTTPException) as exc:
            await auth_module.verify_token(req)
    assert exc.value.status_code == 401
    assert "expired" in exc.value.detail.lower()


@respx.mock
async def test_wrong_issuer_rejected(rsa_keypair, monkeypatch):
    private_pem, jwk = rsa_keypair
    expected_issuer = "https://test.clerk.accounts.dev"
    monkeypatch.setattr(auth_module.settings, "clerk_issuer", expected_issuer)

    respx.get(f"{expected_issuer}/.well-known/jwks.json").mock(
        return_value=httpx.Response(200, json={"keys": [jwk]})
    )

    # Token signed with *our* key but claims a different issuer — must still be rejected.
    token = _make_token(
        private_pem, "test-kid-1", "https://attacker.example.com",
    )
    async with httpx.AsyncClient() as client:
        req = _fake_request(token, client)
        with pytest.raises(HTTPException) as exc:
            await auth_module.verify_token(req)
    assert exc.value.status_code == 401


@respx.mock
async def test_jwks_is_cached_across_calls(rsa_keypair, monkeypatch):
    private_pem, jwk = rsa_keypair
    issuer = "https://test.clerk.accounts.dev"
    monkeypatch.setattr(auth_module.settings, "clerk_issuer", issuer)

    route = respx.get(f"{issuer}/.well-known/jwks.json").mock(
        return_value=httpx.Response(200, json={"keys": [jwk]})
    )

    token = _make_token(private_pem, "test-kid-1", issuer)
    async with httpx.AsyncClient() as client:
        for _ in range(3):
            req = _fake_request(token, client)
            await auth_module.verify_token(req)
    assert route.call_count == 1
