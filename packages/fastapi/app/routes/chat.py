import asyncio
import json
import logging
import re

import httpx
from fastapi import APIRouter, Depends, Request
from sse_starlette.sse import EventSourceResponse
from app.config import settings
from app.dependencies import get_current_user, get_http_client
from app.models import ChatRequest
from app.services.convex import query_convex, save_assistant_message, patch_message_usage, create_sandbox_record
from app.services.mcp_client import UserContext, call_tool, resolve_princeton_netid, list_tools
from app.services.mcp_oauth import get_valid_token, GITHUB_STANDALONE_URL
from app.services.openrouter import stream_chat
from app.services.usage import check_user_budget, record_usage
from app.services.sandbox_tools import (
    SANDBOX_TOOL_DEFINITIONS,
    SANDBOX_TOOL_NAMES,
    execute_sandbox_tool,
)
from app.services.daytona_service import (
    get_daytona_service,
    RESOURCE_TIERS,
)

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_TOOL_ITERATIONS = 50

SKILL_TOOL_NAME = "get_skill_content"

SKILL_TOOL_DEFINITION = {
    "type": "function",
    "function": {
        "name": SKILL_TOOL_NAME,
        "description": (
            "Retrieve the full markdown content for a skill from the user's harness. "
            "Use this when you need detailed instructions, best practices, or reference "
            "material from a skill the user has installed."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "The full name of the skill (e.g. '0xbigboss/claude-code/react-best-practices')",
                },
            },
            "required": ["name"],
        },
    },
}


def _extract_summary(detail: str, max_chars: int = 300) -> str:
    """Extract a short summary from SKILL.md content.

    Strips YAML frontmatter and headings, then takes the first meaningful
    paragraph to give the model a sense of what the skill covers.
    """
    import re

    text = detail.strip()
    # Strip YAML frontmatter
    text = re.sub(r"^---\s*\n[\s\S]*?\n---\s*\n?", "", text).strip()
    # Collect non-heading, non-empty lines
    lines = [
        l.strip()
        for l in text.split("\n")
        if l.strip() and not l.strip().startswith("#")
    ]
    summary = " ".join(lines)
    if len(summary) > max_chars:
        summary = summary[:max_chars].rsplit(" ", 1)[0] + "…"
    return summary


def _build_skills_system_block(skills: list[dict]) -> str:
    """Build a system prompt section listing available skills.

    Each skill dict has 'name' and optionally 'summary' (extracted from SKILL.md).
    """
    lines = [
        "You have access to the following skills from the user's harness. "
        "Each skill contains detailed instructions and best practices. "
        "When a user's request relates to a skill topic, use the get_skill_content "
        "tool to retrieve its full content before responding.\n",
        "Available skills:",
    ]
    for s in skills:
        summary = f" — {s['summary']}" if s.get("summary") else ""
        lines.append(f"  • {s['name']}{summary}")
    return "\n".join(lines)


async def _resolve_github_repo(
    http_client: httpx.AsyncClient,
    source: str,
) -> str | None:
    """Resolve canonical owner/repo via GitHub API (handles org renames/redirects)."""
    try:
        resp = await http_client.get(
            f"https://api.github.com/repos/{source}",
            headers={"Accept": "application/vnd.github.v3+json"},
            timeout=10.0,
            follow_redirects=True,
        )
        if resp.status_code == 200:
            return resp.json().get("full_name")
    except Exception:
        pass
    return None


async def _search_skills_sh(
    http_client: httpx.AsyncClient,
    skill_id: str,
) -> str | None:
    """Query skills.sh search API to find the correct source for a skill ID."""
    try:
        from urllib.parse import quote
        resp = await http_client.get(
            f"https://skills.sh/api/search?q={quote(skill_id, safe='')}&limit=20",
            timeout=10.0,
        )
        if resp.status_code != 200:
            return None
        skills = resp.json().get("skills", [])
        normalized = skill_id.replace(":", "-").lower()
        for s in skills:
            if s.get("skillId") == skill_id:
                return s.get("source")
        for s in skills:
            if s.get("skillId", "").replace(":", "-").lower() == normalized:
                return s.get("source")
    except Exception:
        pass
    return None


async def _fetch_skill_md_from_repo(
    http_client: httpx.AsyncClient,
    source: str,
    skill_id: str,
) -> str | None:
    """Try to fetch SKILL.md from a specific repo, trying main & master branches."""
    gh_raw = "https://raw.githubusercontent.com"
    gh_api = "https://api.github.com"
    gh_headers = {"Accept": "application/vnd.github.v3+json"}
    bases = ["skills", ".agents/skills", ".claude/skills"]
    branches = ["main", "master"]
    normalized_id = skill_id.replace(":", "-").lower()
    ids_to_try = [skill_id] + ([normalized_id] if normalized_id != skill_id else [])

    # 1. Direct paths (both branches)
    for branch in branches:
        for sid in ids_to_try:
            for base in bases:
                try:
                    resp = await http_client.get(
                        f"{gh_raw}/{source}/{branch}/{base}/{sid}/SKILL.md",
                        timeout=10.0,
                    )
                    if resp.status_code == 200:
                        return resp.text
                except Exception:
                    continue

        # 2. Repo-root SKILL.md
        try:
            resp = await http_client.get(
                f"{gh_raw}/{source}/{branch}/SKILL.md", timeout=10.0
            )
            if resp.status_code == 200:
                return resp.text
        except Exception:
            pass

    # 3. Full repo tree search
    for branch in branches:
        try:
            resp = await http_client.get(
                f"{gh_api}/repos/{source}/git/trees/{branch}?recursive=1",
                headers=gh_headers,
                timeout=10.0,
                follow_redirects=True,
            )
            if resp.status_code != 200:
                continue

            tree = resp.json().get("tree", [])
            skill_files = [
                e["path"]
                for e in tree
                if e.get("type") == "blob" and e["path"].endswith("/SKILL.md")
            ]
            if not skill_files:
                continue

            def _dir_name(p: str) -> str:
                segs = p.split("/")
                return segs[-2] if len(segs) >= 2 else ""

            match = next(
                (p for p in skill_files if _dir_name(p) in (skill_id, normalized_id)),
                None,
            ) or next(
                (
                    p for p in skill_files
                    if (
                        normalized_id in _dir_name(p).lower()
                        or _dir_name(p).lower() in normalized_id
                    )
                ),
                None,
            )

            if match:
                md_resp = await http_client.get(
                    f"{gh_raw}/{source}/{branch}/{match}", timeout=10.0
                )
                if md_resp.status_code == 200:
                    return md_resp.text

            root_md = next(
                (p for p in skill_files if p.count("/") <= 1), None
            )
            if root_md:
                md_resp = await http_client.get(
                    f"{gh_raw}/{source}/{branch}/{root_md}", timeout=10.0
                )
                if md_resp.status_code == 200:
                    return md_resp.text
        except Exception:
            pass

    return None


async def _handle_get_skill_content(
    http_client: httpx.AsyncClient,
    skill_name: str,
    allowed_skills: set[str],
) -> str:
    """Fetch a skill's markdown detail from Convex, falling back to GitHub.

    Resolution strategy:
    1. Check Convex cache.
    2. Try GitHub with original source (main & master branches, direct + tree).
    3. Resolve repo via GitHub API (handles org renames like inferen-sh → inference-sh).
    4. Query skills.sh search API to discover the correct source.
    """
    if skill_name not in allowed_skills:
        return f"Error: Skill '{skill_name}' is not in the user's harness."

    # Try Convex first (where ensureSkillDetails stores them)
    result = await query_convex(
        http_client, "skills:getByName", {"name": skill_name}
    )
    if result and result.get("detail"):
        return result["detail"]

    try:
        parts = skill_name.split("/")
        skill_id = parts[-1] if parts else skill_name
        source = "/".join(parts[:-1]) if len(parts) > 1 else ""

        if not source:
            return f"Could not retrieve content for skill '{skill_name}'."

        sources_tried: set[str] = set()

        # Attempt 1: original source
        sources_tried.add(source)
        content = await _fetch_skill_md_from_repo(http_client, source, skill_id)
        if content:
            return content

        # Attempt 2: resolve via GitHub API (handles org renames)
        resolved = await _resolve_github_repo(http_client, source)
        if resolved and resolved not in sources_tried:
            sources_tried.add(resolved)
            logger.info("Skill '%s': GitHub resolved '%s' → '%s'", skill_name, source, resolved)
            content = await _fetch_skill_md_from_repo(http_client, resolved, skill_id)
            if content:
                return content

        # Attempt 3: ask skills.sh for the correct source
        sh_source = await _search_skills_sh(http_client, skill_id)
        if sh_source and sh_source not in sources_tried:
            sources_tried.add(sh_source)
            logger.info("Skill '%s': skills.sh resolved source → '%s'", skill_name, sh_source)
            content = await _fetch_skill_md_from_repo(http_client, sh_source, skill_id)
            if content:
                return content

            # The skills.sh source might also need GitHub resolution
            sh_resolved = await _resolve_github_repo(http_client, sh_source)
            if sh_resolved and sh_resolved not in sources_tried:
                sources_tried.add(sh_resolved)
                content = await _fetch_skill_md_from_repo(http_client, sh_resolved, skill_id)
                if content:
                    return content

        logger.warning("Skill '%s': exhausted all sources %s", skill_name, sources_tried)
    except Exception:
        logger.exception("Failed to fetch skill detail for '%s'", skill_name)

    return f"Could not retrieve content for skill '{skill_name}'."


@router.post("/stream")
async def chat_stream(
    request: Request,
    body: ChatRequest,
    http_client: httpx.AsyncClient = Depends(get_http_client),
    user: dict = Depends(get_current_user),
):
    logger.info(
        "Chat stream started by user '%s' for conversation '%s'",
        user.get("sub", "unknown"),
        body.conversation_id,
    )
    logger.info(
        "Harness config: sandbox_enabled=%s, sandbox_id=%s, sandbox_config=%s, daytona_key=%s",
        body.harness.sandbox_enabled,
        body.harness.sandbox_id,
        body.harness.sandbox_config,
        bool(settings.daytona_api_key),
    )

    user_id = user.get("sub")
    netid = await resolve_princeton_netid(http_client, user)
    if not netid:
        logger.warning(
            "No Princeton netid for user '%s' (primary email: '%s')",
            user_id,
            user.get("email", "<MISSING>"),
        )
    user_ctx = UserContext(
        user_id=user_id,
        princeton_netid=netid,
    )

    async def event_generator():
        # Check cost budget before processing
        budget = await check_user_budget(http_client, user_id)
        if not budget.allowed:
            yield {
                "event": "error",
                "data": json.dumps({
                    "message": "Usage limit reached",
                    "code": "BUDGET_EXCEEDED",
                    "usage": {
                        "dailyPct": budget.daily_pct,
                        "weeklyPct": budget.weekly_pct,
                        "dailyReset": budget.daily_reset,
                        "weeklyReset": budget.weekly_reset,
                    },
                }),
            }
            return

        # Fetch available MCP tools for this harness
        tools: list[dict] | None = None
        if body.harness.mcp_servers:
            tools, mcp_failures = await list_tools(
                http_client, body.harness.mcp_servers, user_ctx=user_ctx
            )
            if not tools:
                tools = None

            # Notify frontend about MCP servers that failed to connect
            for failure in mcp_failures:
                yield {
                    "event": "mcp_error",
                    "data": json.dumps(
                        {
                            "server_name": failure.server_name,
                            "server_url": failure.server_url,
                            "reason": failure.reason,
                        }
                    ),
                }

        # Build skills manifest and inject get_skill_content tool
        skill_refs = body.harness.skills
        allowed_skill_names: set[str] = {s.name for s in skill_refs}
        skill_manifest: list[dict] = []
        if skill_refs:
            if tools is None:
                tools = []
            tools.append(SKILL_TOOL_DEFINITION)

            # Fetch cached SKILL.md content to build short summaries.
            # Non-essential: fall back to empty summaries on timeout so we
            # don't block the first token on a slow Convex cold-start.
            details_by_name: dict[str, str] = {}
            try:
                skill_details_list = await asyncio.wait_for(
                    query_convex(
                        http_client,
                        "skills:getByNames",
                        {"names": [s.name for s in skill_refs]},
                    ),
                    timeout=3.0,
                )
                if skill_details_list:
                    for d in skill_details_list:
                        if d and d.get("detail"):
                            details_by_name[d["name"]] = _extract_summary(d["detail"])
            except (asyncio.TimeoutError, Exception):
                logger.warning("Skill summary fetch timed out or failed; proceeding without summaries")

            skill_manifest = [
                {"name": s.name, "summary": details_by_name.get(s.name, "")}
                for s in skill_refs
            ]

        # Inject sandbox tools if harness has sandbox enabled
        sandbox_id: str | None = None
        daytona_service = None
        if body.harness.sandbox_enabled and settings.daytona_api_key:
            daytona_service = get_daytona_service()

            if body.harness.sandbox_id:
                # Existing sandbox — use it directly
                sandbox_id = body.harness.sandbox_id
            else:
                # Auto-provision a new sandbox on first chat message
                yield {
                    "event": "sandbox_status",
                    "data": json.dumps({"sandbox_id": "", "status": "creating"}),
                }
                try:
                    sandbox_config = body.harness.sandbox_config
                    resource_tier = sandbox_config.resource_tier if sandbox_config else "basic"
                    language = sandbox_config.default_language if sandbox_config else "python"
                    ephemeral = not (sandbox_config and sandbox_config.persistent)

                    sandbox = await asyncio.get_running_loop().run_in_executor(
                        None,
                        lambda: daytona_service.create_sandbox(
                            user_id=user_id,
                            harness_id=None,
                            language=language,
                            resource_tier=resource_tier,
                            ephemeral=ephemeral,
                        ),
                    )
                    sandbox_id = sandbox.id
                    logger.info(
                        "Auto-provisioned sandbox '%s' for harness '%s'",
                        sandbox_id, body.harness.name,
                    )

                    # Persist sandbox record to Convex and link to harness
                    tier = RESOURCE_TIERS.get(
                        resource_tier, RESOURCE_TIERS["basic"],
                    )
                    await create_sandbox_record(
                        http_client,
                        user_id=user_id,
                        harness_id=body.harness.harness_id,
                        daytona_sandbox_id=sandbox_id,
                        name=f"{body.harness.name} sandbox",
                        language=language,
                        ephemeral=ephemeral,
                        resources={
                            "cpu": tier["cpu"],
                            "memoryGB": tier["memory"],
                            "diskGB": tier["disk"],
                        },
                    )
                except Exception:
                    logger.exception(
                        "Failed to auto-provision sandbox for harness '%s'",
                        body.harness.name,
                    )
                    yield {
                        "event": "sandbox_status",
                        "data": json.dumps({"sandbox_id": "", "status": "error"}),
                    }
                    # Continue without sandbox — MCP tools still work
                    daytona_service = None

            if sandbox_id and daytona_service:
                if tools is None:
                    tools = []
                tools.extend(SANDBOX_TOOL_DEFINITIONS)
                logger.info(
                    "Sandbox tools injected for harness '%s' (sandbox_id=%s)",
                    body.harness.name, sandbox_id,
                )
                yield {
                    "event": "sandbox_status",
                    "data": json.dumps({"sandbox_id": sandbox_id, "status": "active"}),
                }

        # Resolve GitHub OAuth credentials for sandbox git operations.
        # Check standalone GitHub token first, then fall back to MCP token.
        git_credentials: dict | None = None
        if sandbox_id and daytona_service:
            gh_token = await get_valid_token(
                http_client, user_id, GITHUB_STANDALONE_URL,
            )
            # Fallback: check if a GitHub MCP server has a token
            if not gh_token and body.harness.mcp_servers:
                for server in body.harness.mcp_servers:
                    if server.auth_type == "oauth" and "github" in server.url.lower():
                        gh_token = await get_valid_token(
                            http_client, user_id, server.url,
                        )
                        break

            if gh_token:
                git_credentials = {
                    "username": "x-access-token",
                    "password": gh_token,
                }
                logger.info(
                    "Resolved GitHub OAuth token for sandbox git operations",
                )
                # Configure git credential store inside the sandbox
                # so raw `git push` via run_command also works
                try:
                    _tok = gh_token
                    await asyncio.get_running_loop().run_in_executor(
                        None,
                        lambda: daytona_service.setup_git_credentials(
                            sandbox_id, "x-access-token", _tok,
                        ),
                    )
                except Exception:
                    logger.warning(
                        "Failed to configure git credentials in sandbox",
                        exc_info=True,
                    )

        messages = [m.model_dump() for m in body.messages]

        # Prepend a system message with the skills manifest
        if skill_manifest:
            skills_block = _build_skills_system_block(skill_manifest)
            messages.insert(0, {"role": "system", "content": skills_block})

        # Accumulate across all iterations so reasoning/tool history isn't lost
        all_reasoning = ""
        all_tool_calls_history: list[dict] = []  # [{tool, arguments, call_id, result}]
        all_parts: list[dict] = []  # Chronological ordering of all content

        # Track usage across all iterations (last iteration's usage wins)
        collected_usage: dict | None = None
        collected_model: str | None = None

        # Agentic loop: stream response, handle tool calls, repeat
        for iteration in range(MAX_TOOL_ITERATIONS):
            collected_content = ""
            collected_reasoning = ""
            collected_tool_calls: list[dict] = []
            finish_reason: str | None = None

            client_disconnected = False

            try:
                async for chunk in stream_chat(
                    http_client,
                    messages,
                    body.harness.model,
                    tools,
                ):
                    if not client_disconnected and await request.is_disconnected():
                        logger.info(
                            "Client disconnected from conversation '%s', draining stream for usage",
                            body.conversation_id,
                        )
                        client_disconnected = True

                    if chunk.get("type") == "done":
                        break

                    # Always capture usage & model, even after disconnect
                    if chunk.get("model"):
                        collected_model = chunk["model"]
                    if chunk.get("usage"):
                        collected_usage = chunk["usage"]

                    # After disconnect, just drain chunks without yielding
                    if client_disconnected:
                        continue

                    choices = chunk.get("choices", [])
                    if not choices:
                        continue

                    delta = choices[0].get("delta", {})
                    fr = choices[0].get("finish_reason")
                    if fr is not None:
                        finish_reason = fr

                    # Stream reasoning/thinking tokens to client
                    reasoning_details = delta.get("reasoning_details")
                    if reasoning_details:
                        for rd in reasoning_details:
                            text = rd.get("text", "")
                            if text:
                                collected_reasoning += text
                                yield {
                                    "event": "thinking",
                                    "data": json.dumps({"content": text}),
                                }

                    # Stream content tokens to client
                    if delta.get("content"):
                        collected_content += delta["content"]
                        yield {
                            "event": "token",
                            "data": json.dumps({"content": delta["content"]}),
                        }

                    # Accumulate tool call deltas
                    if delta.get("tool_calls"):
                        for tc_delta in delta["tool_calls"]:
                            idx = tc_delta.get("index", 0)
                            while len(collected_tool_calls) <= idx:
                                collected_tool_calls.append(
                                    {
                                        "id": "",
                                        "function": {
                                            "name": "",
                                            "arguments": "",
                                        },
                                    }
                                )
                            tc = collected_tool_calls[idx]
                            if "id" in tc_delta:
                                tc["id"] = tc_delta["id"]
                            if "function" in tc_delta:
                                fn = tc_delta["function"]
                                if "name" in fn:
                                    tc["function"]["name"] += fn["name"]
                                if "arguments" in fn:
                                    tc["function"]["arguments"] += fn["arguments"]

                if client_disconnected:
                    # Client disconnected but we drained the stream.
                    # The frontend saved the interrupted message — update it
                    # with usage data if we captured any.
                    if collected_usage:
                        usage_for_update = {
                            "promptTokens": collected_usage.get("prompt_tokens", 0),
                            "completionTokens": collected_usage.get(
                                "completion_tokens", 0
                            ),
                            "totalTokens": collected_usage.get("total_tokens", 0),
                        }
                        if "cost" in collected_usage:
                            usage_for_update["cost"] = collected_usage["cost"]
                        logger.info(
                            "Captured usage after disconnect for conversation '%s': %s",
                            body.conversation_id,
                            usage_for_update,
                        )
                        await patch_message_usage(
                            http_client,
                            body.conversation_id,
                            usage_for_update,
                            collected_model,
                        )
                        # Record usage for budget tracking even on disconnect
                        await record_usage(
                            http_client,
                            user_id=user_id,
                            conversation_id=body.conversation_id,
                            harness_id=body.harness.harness_id,
                            harness_name=body.harness.name,
                            model=collected_model or body.harness.model,
                            usage_data=collected_usage,
                        )
                    return

            except httpx.HTTPStatusError as e:
                # Response may be streaming (unread), so use str(e) instead of e.response.text
                logger.error(
                    "OpenRouter HTTP error: %s",
                    e.response.status_code,
                )
                yield {
                    "event": "error",
                    "data": json.dumps(
                        {
                            "message": f"Upstream service error ({e.response.status_code})"
                        }
                    ),
                }
                return
            except httpx.HTTPError as e:
                logger.error("HTTP error during chat stream: %s", e)
                yield {
                    "event": "error",
                    "data": json.dumps({"message": "Service unavailable"}),
                }
                return
            except Exception:
                logger.exception(
                    "Unexpected error in chat stream for conversation '%s'",
                    body.conversation_id,
                )
                yield {
                    "event": "error",
                    "data": json.dumps({"message": "Internal server error"}),
                }
                return

            logger.debug(
                "Stream loop ended: finish_reason=%s, tool_calls=%d, content_len=%d",
                finish_reason,
                len(collected_tool_calls),
                len(collected_content),
            )

            # Accumulate reasoning across iterations
            if collected_reasoning:
                all_reasoning += collected_reasoning
                all_parts.append({"type": "reasoning", "content": collected_reasoning})

            # Append text part for this iteration's content (before tool calls)
            if collected_content:
                all_parts.append({"type": "text", "content": collected_content})

            # If no tool calls, we're done
            if finish_reason != "tool_calls" or not collected_tool_calls:
                # Remap usage keys from snake_case to camelCase for Convex
                usage_for_convex: dict | None = None
                if collected_usage:
                    usage_for_convex = {
                        "promptTokens": collected_usage.get("prompt_tokens", 0),
                        "completionTokens": collected_usage.get("completion_tokens", 0),
                        "totalTokens": collected_usage.get("total_tokens", 0),
                    }
                    cost = collected_usage.get("cost")
                    if cost is not None:
                        usage_for_convex["cost"] = cost

                # Save to Convex first, then notify client
                await save_assistant_message(
                    http_client,
                    body.conversation_id,
                    collected_content,
                    reasoning=all_reasoning or None,
                    tool_calls=all_tool_calls_history or None,
                    parts=all_parts or None,
                    usage=usage_for_convex,
                    model=collected_model,
                )

                # Record usage for budget tracking
                if collected_usage:
                    await record_usage(
                        http_client,
                        user_id=user_id,
                        conversation_id=body.conversation_id,
                        harness_id=body.harness.harness_id,
                        harness_name=body.harness.name,
                        model=collected_model or body.harness.model,
                        usage_data=collected_usage,
                    )

                done_data: dict = {"content": collected_content}
                if usage_for_convex:
                    done_data["usage"] = usage_for_convex
                if collected_model:
                    done_data["model"] = collected_model

                yield {
                    "event": "done",
                    "data": json.dumps(done_data),
                }
                return

            # Add assistant message with tool calls to history
            messages.append(
                {
                    "role": "assistant",
                    "content": collected_content or None,
                    "tool_calls": [
                        {
                            "id": tc["id"],
                            "type": "function",
                            "function": tc["function"],
                        }
                        for tc in collected_tool_calls
                    ],
                }
            )

            # Phase 1: Parse args + notify frontend of all tool calls upfront
            parsed_tool_calls = []
            for tc in collected_tool_calls:
                tool_name = tc["function"]["name"]
                try:
                    args = json.loads(tc["function"]["arguments"])
                except json.JSONDecodeError:
                    logger.warning(
                        "Failed to parse arguments for tool '%s': %s",
                        tool_name,
                        tc["function"]["arguments"][:200],
                    )
                    args = {}

                parsed_tool_calls.append(
                    {"id": tc["id"], "tool_name": tool_name, "args": args}
                )

                yield {
                    "event": "tool_call",
                    "data": json.dumps(
                        {
                            "tool": tool_name,
                            "arguments": args,
                            "call_id": tc["id"],
                        }
                    ),
                }

            # Yield control so the SSE framework flushes tool_call events to the
            # client before we start executing (avoids transport-level coalescing).
            await asyncio.sleep(0)

            # Phase 2: Execute all tool calls in parallel, stream results as they complete
            async def _execute_tool(tool_info: dict) -> tuple[dict, str]:
                """Execute a tool and return (tool_info, result) for identification."""
                tool_name = tool_info["tool_name"]

                # Route sandbox tools to the Daytona service
                if tool_name in SANDBOX_TOOL_NAMES and sandbox_id and daytona_service:
                    logger.info(
                        "Executing sandbox tool '%s' with args: %s",
                        tool_name,
                        json.dumps(tool_info["args"])[:200],
                    )
                    _creds = git_credentials
                    result = await asyncio.get_running_loop().run_in_executor(
                        None,
                        lambda: execute_sandbox_tool(
                            daytona_service,
                            sandbox_id,
                            tool_name,
                            tool_info["args"],
                            git_credentials=_creds,
                        ),
                    )
                    return tool_info, result

                # Route MCP tools to the MCP client
                logger.info(
                    "Executing MCP tool '%s' with args: %s",
                    tool_name,
                    json.dumps(tool_info["args"])[:200],
                )

                # Intercept get_skill_content — handle locally instead of MCP
                if tool_name == SKILL_TOOL_NAME:
                    skill_name = tool_info["args"].get("name", "")
                    result = await _handle_get_skill_content(
                        http_client, skill_name, allowed_skill_names
                    )
                    return tool_info, result

                result = await call_tool(
                    http_client,
                    tool_name,
                    tool_info["args"],
                    body.harness.mcp_servers,
                    user_ctx=user_ctx,
                )
                return tool_info, result

            # Pre-build history in request order; results filled in as they complete.
            history_by_call_id: dict[str, dict] = {}
            parts_by_call_id: dict[str, dict] = {}
            for tc_info in parsed_tool_calls:
                entry = {
                    "tool": tc_info["tool_name"],
                    "arguments": tc_info["args"],
                    "call_id": tc_info["id"],
                    "result": "",
                }
                history_by_call_id[tc_info["id"]] = entry
                all_tool_calls_history.append(entry)

                # Add a tool_call part in request order (result filled in later)
                part = {
                    "type": "tool_call",
                    "tool": tc_info["tool_name"],
                    "arguments": tc_info["args"],
                    "call_id": tc_info["id"],
                    "result": "",
                }
                parts_by_call_id[tc_info["id"]] = part
                all_parts.append(part)

            tasks = [asyncio.create_task(_execute_tool(tc)) for tc in parsed_tool_calls]

            # Stream each result to the frontend as soon as it finishes
            for coro in asyncio.as_completed(tasks):
                try:
                    tc_info, result = await coro
                except Exception as exc:
                    logger.error("MCP tool raised an exception: %s", exc)
                    continue

                logger.info(
                    "MCP tool '%s' returned: %s",
                    tc_info["tool_name"],
                    result[:200],
                )

                # Fill in the result in the pre-ordered history entry
                history_by_call_id[tc_info["id"]]["result"] = result
                parts_by_call_id[tc_info["id"]]["result"] = result

                yield {
                    "event": "tool_result",
                    "data": json.dumps(
                        {
                            "call_id": tc_info["id"],
                            "result": result,
                        }
                    ),
                }

                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc_info["id"],
                        "content": result,
                    }
                )

            logger.debug(
                "Tool iteration %d completed for conversation '%s'",
                iteration + 1,
                body.conversation_id,
            )

        # Max iterations reached
        logger.warning(
            "Max tool iterations (%d) reached for conversation '%s'",
            MAX_TOOL_ITERATIONS,
            body.conversation_id,
        )
        yield {
            "event": "error",
            "data": json.dumps({"message": "Max tool call iterations reached"}),
        }

    return EventSourceResponse(event_generator())
