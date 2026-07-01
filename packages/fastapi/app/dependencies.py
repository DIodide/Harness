import httpx
from fastapi import Depends, Request

from app.auth import verify_token, verify_token_optional


async def get_http_client(request: Request) -> httpx.AsyncClient:
    """Provide the shared httpx client from app state."""
    return request.app.state.http_client


async def get_current_user(user: dict = Depends(verify_token)) -> dict:
    """Provide the authenticated user's token payload."""
    return user


async def get_current_user_optional(
    user: dict | None = Depends(verify_token_optional),
) -> dict | None:
    """Authenticated user payload, or None for an anonymous caller."""
    return user
