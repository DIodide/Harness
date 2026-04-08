import json
import logging

import httpx
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from app.config import MODEL_MAP
from app.dependencies import get_current_user, get_http_client
from app.services.openrouter import stream_chat

router = APIRouter()
logger = logging.getLogger(__name__)

# Mirrors frontend PRESET_MCPS — kept in sync manually.
_PRESET_MCP_CATALOG = [
    {"id": "princetoncourses", "name": "Princeton Courses", "description": "Search Princeton courses, read evaluations, and explore instructors.", "auth": "tiger_junction"},
    {"id": "tigerjunction", "name": "TigerJunction", "description": "Manage course schedules — create, edit, verify conflicts.", "auth": "tiger_junction"},
    {"id": "tigersnatch", "name": "TigerSnatch", "description": "Track course demand and subscribe to enrollment notifications.", "auth": "tiger_junction"},
    {"id": "github", "name": "GitHub", "description": "Browse repos, manage issues and pull requests, and search code.", "auth": "oauth"},
    {"id": "notion", "name": "Notion", "description": "Read and write pages, databases, and blocks in your workspace.", "auth": "oauth"},
    {"id": "linear", "name": "Linear", "description": "Create and track issues, manage projects, and streamline engineering workflows.", "auth": "oauth"},
    {"id": "slack", "name": "Slack", "description": "Send messages, read channel history, and search conversations.", "auth": "oauth"},
    {"id": "jira", "name": "Jira", "description": "Create tickets, track sprints, and manage Agile releases.", "auth": "oauth"},
    {"id": "awsknowledge", "name": "AWS Knowledge", "description": "Search AWS documentation and knowledge bases for services and best practices.", "auth": "none"},
    {"id": "exa", "name": "Exa", "description": "AI-powered semantic web search and content retrieval.", "auth": "none"},
    {"id": "context7", "name": "Context7", "description": "Fetch up-to-date library docs and code examples for any framework.", "auth": "none"},
]

_AVAILABLE_MODELS = list(MODEL_MAP.keys())

_CREATION_SYSTEM_PROMPT = None


def _get_system_prompt() -> str:
    global _CREATION_SYSTEM_PROMPT
    if _CREATION_SYSTEM_PROMPT is not None:
        return _CREATION_SYSTEM_PROMPT

    models_text = "\n".join(f"  - {m}" for m in _AVAILABLE_MODELS)

    mcps_lines = []
    for mcp in _PRESET_MCP_CATALOG:
        auth_note = f" [requires {mcp['auth']} sign-in after creation]" if mcp["auth"] != "none" else ""
        mcps_lines.append(f"  - id={mcp['id']!r}, name={mcp['name']!r}: {mcp['description']}{auth_note}")
    mcps_text = "\n".join(mcps_lines)

    _CREATION_SYSTEM_PROMPT = f"""You are a friendly assistant that helps users set up an AI "Harness" — a named AI agent configuration with a chosen model and optional tool integrations.

Your goal: ask a few focused questions to understand the user's use case, then recommend a harness configuration.

Keep responses short and conversational. After 1–3 exchanges you should have enough information to produce a config. Do not ask about sandboxes or skills.

## Available models
{models_text}

Defaults: recommend "claude-sonnet-4" for general use, "gpt-4.1-mini" for quick/lightweight tasks, "gemini-2.5-pro" for long-context or multimodal tasks.

## Available MCP integrations (tools the agent can use)
{mcps_text}

Only suggest MCPs that are clearly relevant to the user's stated use case. Leave mcpIds as [] if no tools are needed.

## When you have gathered enough information

Output a brief summary sentence, then immediately output the harness config block — no other text after the block:

<harness-config>
{{
  "name": "Short Harness Name",
  "model": "exact-model-id",
  "mcpIds": ["id1", "id2"]
}}
</harness-config>

Rules:
- Use only exact model IDs from the list above.
- Use only exact MCP ids from the list above.
- Keep the name to 2–4 words.
- Do not include trailing text after the closing </harness-config> tag."""

    return _CREATION_SYSTEM_PROMPT


class _Message(BaseModel):
    role: str
    content: str


class SuggestRequest(BaseModel):
    messages: list[_Message]


@router.post("/stream")
async def suggest_harness_stream(
    request: Request,
    body: SuggestRequest,
    http_client: httpx.AsyncClient = Depends(get_http_client),
    user: dict = Depends(get_current_user),
):
    async def event_generator():
        messages = [{"role": "system", "content": _get_system_prompt()}]
        messages.extend({"role": m.role, "content": m.content} for m in body.messages)

        collected_content = ""

        try:
            async for chunk in stream_chat(http_client, messages, "claude-sonnet-4"):
                if await request.is_disconnected():
                    return

                if chunk.get("type") == "done":
                    break

                choices = chunk.get("choices", [])
                if not choices:
                    continue

                delta = choices[0].get("delta", {})
                if delta.get("content"):
                    collected_content += delta["content"]
                    yield {
                        "event": "token",
                        "data": json.dumps({"content": delta["content"]}),
                    }

        except Exception:
            logger.exception("Error in harness suggestion stream")
            yield {"event": "error", "data": json.dumps({"message": "Internal server error"})}
            return

        yield {"event": "done", "data": json.dumps({"content": collected_content})}

    return EventSourceResponse(event_generator())
