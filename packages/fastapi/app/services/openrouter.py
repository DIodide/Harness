import json
import logging
from collections.abc import AsyncGenerator

import httpx

from app.config import MODEL_MAP, settings

logger = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


async def stream_chat(
    client: httpx.AsyncClient,
    messages: list[dict],
    model: str,
    tools: list[dict] | None = None,
) -> AsyncGenerator[dict, None]:
    """Stream chat completion from OpenRouter. Yields parsed SSE chunks.

    Args:
        client: Shared httpx.AsyncClient (from app.state).
        messages: OpenAI-format message list.
        model: Short model name (e.g. "claude-sonnet-4") or full OpenRouter ID.
        tools: Optional OpenAI-format tool definitions.
    """
    resolved_model = MODEL_MAP.get(model, model)
    logger.debug("Streaming chat with model '%s' (resolved: '%s')", model, resolved_model)

    payload: dict = {
        "model": resolved_model,
        "messages": messages,
        "stream": True,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": settings.frontend_url,
        "X-Title": "Harness",
    }

    async with client.stream(
        "POST", OPENROUTER_URL, json=payload, headers=headers
    ) as response:
        response.raise_for_status()
        async for line in response.aiter_lines():
            if not line.startswith("data: "):
                continue
            data = line[6:]
            if data == "[DONE]":
                yield {"type": "done"}
                return
            try:
                yield json.loads(data)
            except json.JSONDecodeError:
                logger.warning("Failed to parse SSE chunk: %s", data[:200])
                continue
