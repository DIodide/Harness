import json
import logging
from collections.abc import AsyncGenerator

import httpx

from app.config import MODEL_MAP, THINKING_MODELS, settings

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
    logger.debug(
        "Streaming chat with model '%s' (resolved: '%s')", model, resolved_model
    )

    is_thinking = model in THINKING_MODELS
    payload: dict = {
        "model": resolved_model,
        "messages": messages,
        "stream": True,
        "stream_options": {"include_usage": True},
        "max_tokens": 16000
        if is_thinking
        else 4096,  # This used to be 64k and 16k, this lobotomizes the model and significantly changes how the response vibes are.
    }
    if is_thinking:
        payload["reasoning"] = {"effort": "high"}
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": settings.frontend_url,
        "X-Title": "Harness",
    }

    logger.info(
        "OpenRouter request: model=%s, messages=%d, tools=%d",
        resolved_model,
        len(messages),
        len(tools) if tools else 0,
    )

    async with client.stream(
        "POST", OPENROUTER_URL, json=payload, headers=headers
    ) as response:
        if response.status_code != 200:
            error_body = await response.aread()
            logger.error(
                "OpenRouter error %d: %s",
                response.status_code,
                error_body.decode("utf-8", errors="replace")[:500],
            )
            response.raise_for_status()
        async for line in response.aiter_lines():
            if not line.startswith("data: "):
                continue
            data = line[6:]
            if data == "[DONE]":
                logger.debug("OpenRouter stream ended with [DONE]")
                yield {"type": "done"}
                return
            try:
                parsed = json.loads(data)
                # Log tool_calls and finish_reason for debugging
                choices = parsed.get("choices", [])
                if choices:
                    fr = choices[0].get("finish_reason")
                    delta = choices[0].get("delta", {})
                    if fr:
                        logger.debug("OpenRouter finish_reason: %s", fr)
                    if delta.get("tool_calls"):
                        logger.debug(
                            "OpenRouter tool_call delta: %s", delta["tool_calls"]
                        )
                yield parsed
            except json.JSONDecodeError:
                logger.warning("Failed to parse SSE chunk: %s", data[:200])
                continue
        # If we exit the loop without [DONE], the stream ended unexpectedly
        logger.warning("OpenRouter stream ended without [DONE] marker")
        yield {"type": "done"}
