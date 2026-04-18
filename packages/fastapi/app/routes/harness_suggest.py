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
    {"id": "princetoncourses", "name": "Princeton Courses", "description": "Search Princeton courses, read evaluations, and explore instructors with live registrar data.", "auth": "tiger_junction"},
    {"id": "tigerjunction", "name": "TigerJunction", "description": "Manage your course schedules — create, edit, verify conflicts, and find courses that fit.", "auth": "tiger_junction"},
    {"id": "tigersnatch", "name": "TigerSnatch", "description": "Track course demand and subscribe to enrollment notifications for closed classes.", "auth": "tiger_junction"},
    {"id": "tigerpath", "name": "TigerPath", "description": "Plan your 4-year course schedule, explore major requirements, and see when students typically take courses.", "auth": "tiger_junction"},
    {"id": "github", "name": "GitHub", "description": "Browse repos, manage issues and pull requests, and search code.", "auth": "oauth"},
    {"id": "notion", "name": "Notion", "description": "Read and write pages, databases, and blocks in your workspace.", "auth": "oauth"},
    {"id": "linear", "name": "Linear", "description": "Create and track issues, manage projects, and streamline engineering workflows.", "auth": "oauth"},
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

Your goal: understand the user's use case well enough to recommend the right model and integrations, then produce a config.

Keep responses short and conversational. Do not ask about sandboxes or skills.

## How many questions to ask

Adapt to how clearly the user has expressed their needs:
- If their first message already tells you the task, speed requirements, and relevant tools → produce a config immediately with a one-line explanation.
- If you have most of what you need but one important thing is unclear → ask exactly one follow-up question.
- If the use case is genuinely vague → ask up to two focused questions, then produce a config. Never ask more than two follow-up questions total.

Batch multiple unknowns into a single message rather than asking one-by-one.

## Choosing a model

Pick the model that best fits the user's needs across three dimensions: speed, depth, and cost.

{models_text}

Guidelines:
- **Fast, lightweight tasks** (quick lookups, short answers, high-volume use): recommend "gpt-4.1-mini" or "grok-3-mini"
- **General-purpose, balanced**: recommend "claude-sonnet-4" or "gpt-4.1"
- **Deep reasoning, complex multi-step tasks**: recommend "claude-sonnet-4-thinking", "claude-opus-4-thinking", or "deepseek-r1"
- **Long documents or large codebases**: recommend "gemini-2.5-pro" or "gemini-2.5-flash"
- **Cost-sensitive**: prefer mini/flash variants; "deepseek-v3" and "kimi-k2" are strong low-cost options
- **Cutting-edge capability, cost not a concern**: "claude-opus-4" or "claude-opus-4-thinking"

If the user mentions needing fast responses or running many queries → lean lighter. If they describe complex analysis, writing, or reasoning → lean heavier. Explain your model choice in one short sentence.

## Available MCP integrations (tools the agent can use)
{mcps_text}

Be proactive: if an MCP is clearly relevant to the user's use case, suggest it and briefly explain what it enables (one phrase). Only suggest MCPs that genuinely fit — don't list everything. Leave mcpIds as [] if no tools are needed.

If you're unsure whether the user wants a particular integration, mention it as an option and let them decide.

## When you have gathered enough information

Output a brief summary (1–2 sentences max, including your model rationale), then immediately output the harness config block — no other text after the block:

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
