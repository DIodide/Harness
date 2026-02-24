"""OpenRouter LLM service using the OpenAI SDK with custom base_url."""

from collections.abc import AsyncIterator

from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from app.config import settings

_openrouter_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _openrouter_client
    if _openrouter_client is None:
        _openrouter_client = AsyncOpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=settings.openrouter_api_key,
        )
    return _openrouter_client


async def stream_chat_completion(
    messages: list[ChatCompletionMessageParam],
    model: str,
    tools: list[dict] | None = None,
) -> AsyncIterator:
    """Stream a chat completion from OpenRouter.

    Returns the raw openai stream object which yields ChatCompletionChunk deltas.
    """
    client = _get_client()

    kwargs: dict = {
        "model": model,
        "messages": messages,
        "stream": True,
    }
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = "auto"

    return await client.chat.completions.create(**kwargs)


async def non_streaming_completion(
    messages: list[ChatCompletionMessageParam],
    model: str,
    tools: list[dict] | None = None,
) -> dict:
    """Non-streaming completion for tool-call follow-ups."""
    client = _get_client()

    kwargs: dict = {
        "model": model,
        "messages": messages,
    }
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = "auto"

    response = await client.chat.completions.create(**kwargs)
    return response
