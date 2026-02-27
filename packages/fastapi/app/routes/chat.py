import json

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

from app.models import ChatRequest
from app.services.mcp_client import call_tool, list_tools
from app.services.openrouter import stream_chat

router = APIRouter()

MAX_TOOL_ITERATIONS = 10


@router.post("/stream")
async def chat_stream(request: Request, body: ChatRequest):
    http_client = request.app.state.http_client

    async def event_generator():
        # Fetch available MCP tools for this harness
        tools: list[dict] | None = None
        if body.harness.mcps:
            tools = await list_tools(http_client, body.harness.mcps)
            if not tools:
                tools = None

        messages = [m.model_dump() for m in body.messages]

        # Agentic loop: stream response, handle tool calls, repeat
        for _ in range(MAX_TOOL_ITERATIONS):
            collected_content = ""
            collected_tool_calls: list[dict] = []
            finish_reason: str | None = None

            try:
                async for chunk in stream_chat(
                    http_client, messages, body.harness.model, tools
                ):
                    # Check if client disconnected
                    if await request.is_disconnected():
                        return

                    if chunk.get("type") == "done":
                        break

                    choices = chunk.get("choices", [])
                    if not choices:
                        continue

                    delta = choices[0].get("delta", {})
                    finish_reason = choices[0].get("finish_reason")

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
                            idx = tc_delta["index"]
                            while len(collected_tool_calls) <= idx:
                                collected_tool_calls.append(
                                    {
                                        "id": "",
                                        "function": {"name": "", "arguments": ""},
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

            except Exception as e:
                yield {
                    "event": "error",
                    "data": json.dumps({"message": str(e)}),
                }
                return

            # If no tool calls, we're done
            if finish_reason != "tool_calls" or not collected_tool_calls:
                yield {
                    "event": "done",
                    "data": json.dumps({"content": collected_content}),
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

            # Execute each tool call
            for tc in collected_tool_calls:
                tool_name = tc["function"]["name"]
                try:
                    args = json.loads(tc["function"]["arguments"])
                except json.JSONDecodeError:
                    args = {}

                # Notify frontend
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

                # Execute the tool via MCP
                result = await call_tool(http_client, tool_name, args)

                yield {
                    "event": "tool_result",
                    "data": json.dumps(
                        {
                            "call_id": tc["id"],
                            "result": result[:1000],
                        }
                    ),
                }

                # Add tool result to message history for next LLM call
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": result,
                    }
                )

            # Loop continues — LLM will be called again with tool results

        # Max iterations reached
        yield {
            "event": "error",
            "data": json.dumps({"message": "Max tool call iterations reached"}),
        }

    return EventSourceResponse(event_generator())
