"""Dependency injection helpers — http client passthrough and user re-exposure."""
import httpx

from app.dependencies import get_current_user, get_http_client


class _App:
    class state:
        pass


def _fake_request_with_client(client):
    from fastapi import Request
    _App.state.http_client = client
    return Request({"type": "http", "headers": [], "app": _App})


async def test_get_http_client_returns_app_state_client():
    async with httpx.AsyncClient() as client:
        req = _fake_request_with_client(client)
        assert await get_http_client(req) is client


async def test_get_current_user_returns_token_payload_verbatim():
    # Since get_current_user just returns the Depends(verify_token) result, we can
    # call it directly by passing the resolved user dict.
    user = {"sub": "user_abc", "iss": "test"}
    assert await get_current_user(user=user) is user
