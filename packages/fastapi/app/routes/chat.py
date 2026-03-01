import asyncio
import json
import logging

import httpx
from fastapi import APIRouter, Depends, Request
from sse_starlette.sse import EventSourceResponse
from app.dependencies import get_current_user, get_http_client
from app.models import ChatRequest
from app.services.convex import save_assistant_message
from app.services.mcp_client import call_tool, list_tools
from app.services.openrouter import stream_chat

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_TOOL_ITERATIONS = 10


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

    async def event_generator():
        # Fetch available MCP tools for this harness
        tools: list[dict] | None = None
        if body.harness.mcp_servers:
            tools = await list_tools(http_client, body.harness.mcp_servers)
            if not tools:
                tools = None

        messages = [m.model_dump() for m in body.messages]

        # Accumulate across all iterations so reasoning/tool history isn't lost
        all_reasoning = ""
        all_tool_calls_history: list[dict] = []  # [{tool, arguments, call_id, result}]

        # Track usage across all iterations (last iteration's usage wins)
        collected_usage: dict | None = None
        collected_model: str | None = None

        # Agentic loop: stream response, handle tool calls, repeat
        for iteration in range(MAX_TOOL_ITERATIONS):
            collected_content = ""
            collected_reasoning = ""
            collected_tool_calls: list[dict] = []
            finish_reason: str | None = None

            try:
                async for chunk in stream_chat(
                    http_client,
                    messages,
                    body.harness.model,
                    tools,
                ):
                    if await request.is_disconnected():
                        logger.info(
                            "Client disconnected from conversation '%s'",
                            body.conversation_id,
                        )
                        return

                    if chunk.get("type") == "done":
                        break

                    # Capture usage & model (present on each chunk)
                    if chunk.get("usage"):
                        collected_usage = chunk["usage"]
                        yield {
                            "event": "usage",
                            "data": json.dumps({
                                "promptTokens": collected_usage.get("prompt_tokens", 0),
                                "completionTokens": collected_usage.get("completion_tokens", 0),
                                "totalTokens": collected_usage.get("total_tokens", 0),
                                **({"cost": collected_usage["cost"]} if "cost" in collected_usage else {}),
                            }),
                        }
                    if chunk.get("model"):
                        collected_model = chunk["model"]

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

            except httpx.HTTPStatusError as e:
                logger.error(
                    "OpenRouter HTTP error: %s %s",
                    e.response.status_code,
                    e.response.text[:200],
                )
                yield {
                    "event": "error",
                    "data": json.dumps({"message": "Upstream service error"}),
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
                    usage=usage_for_convex,
                    model=collected_model,
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
                logger.info(
                    "Executing MCP tool '%s' with args: %s",
                    tool_info["tool_name"],
                    json.dumps(tool_info["args"])[:200],
                )
                result = await call_tool(
                    http_client,
                    tool_info["tool_name"],
                    tool_info["args"],
                    body.harness.mcp_servers,
                )
                return tool_info, result

            # Pre-build history in request order; results filled in as they complete.
            history_by_call_id: dict[str, dict] = {}
            for tc_info in parsed_tool_calls:
                entry = {
                    "tool": tc_info["tool_name"],
                    "arguments": tc_info["args"],
                    "call_id": tc_info["id"],
                    "result": "",
                }
                history_by_call_id[tc_info["id"]] = entry
                all_tool_calls_history.append(entry)

            tasks = [
                asyncio.create_task(_execute_tool(tc))
                for tc in parsed_tool_calls
            ]

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
