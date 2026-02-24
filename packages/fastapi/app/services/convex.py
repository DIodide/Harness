import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=30.0)
    return _client


def _public_headers() -> dict[str, str]:
    return {"Content-Type": "application/json"}


def _admin_headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if settings.convex_deploy_key:
        headers["Authorization"] = f"Convex {settings.convex_deploy_key}"
    return headers


async def run_query(function_path: str, args: dict) -> dict | list | None:
    """Run a public Convex query via HTTP API."""
    client = _get_client()
    resp = await client.post(
        f"{settings.convex_url}/api/query",
        json={"path": function_path, "args": args, "format": "json"},
        headers=_public_headers(),
    )
    if not resp.is_success:
        logger.error(f"Convex query {function_path} failed: {resp.status_code} {resp.text}")
    resp.raise_for_status()
    data = resp.json()
    return data.get("value")


async def run_mutation(function_path: str, args: dict) -> dict | str | None:
    """Run a public Convex mutation via HTTP API."""
    client = _get_client()
    resp = await client.post(
        f"{settings.convex_url}/api/mutation",
        json={"path": function_path, "args": args, "format": "json"},
        headers=_public_headers(),
    )
    if not resp.is_success:
        logger.error(f"Convex mutation {function_path} failed: {resp.status_code} {resp.text}")
    resp.raise_for_status()
    data = resp.json()
    return data.get("value")


async def run_internal_mutation(function_path: str, args: dict) -> dict | str | None:
    """Run an internal Convex mutation via HTTP API (requires deploy key)."""
    client = _get_client()
    resp = await client.post(
        f"{settings.convex_url}/api/mutation",
        json={"path": function_path, "args": args, "format": "json"},
        headers=_admin_headers(),
    )
    if not resp.is_success:
        logger.error(f"Convex internal mutation {function_path} failed: {resp.status_code} {resp.text}")
    resp.raise_for_status()
    data = resp.json()
    return data.get("value")


async def run_internal_query(function_path: str, args: dict) -> dict | list | None:
    """Run an internal Convex query via HTTP API (requires deploy key)."""
    client = _get_client()
    resp = await client.post(
        f"{settings.convex_url}/api/query",
        json={"path": function_path, "args": args, "format": "json"},
        headers=_admin_headers(),
    )
    if not resp.is_success:
        logger.error(f"Convex internal query {function_path} failed: {resp.status_code} {resp.text}")
    resp.raise_for_status()
    data = resp.json()
    return data.get("value")
