"""Chat endpoint with background inference and progressive Convex updates."""

import json
import logging
import time

from fastapi import APIRouter, BackgroundTasks

from app.models.schemas import ChatRequest, ChatResponse
from app.services import convex as convex_client
from app.services.llm import stream_chat_completion
from app.services.mcp_manager import MCPManager

logger = logging.getLogger(__name__)
router = APIRouter(tags=["chat"])


@router.post("/chat/stream", response_model=ChatResponse)
async def chat_stream(
    request: ChatRequest,
    background_tasks: BackgroundTasks,
):
    """Start a streaming chat inference.

    1. Creates an empty assistant message in Convex (isStreaming=true)
    2. Returns the messageId immediately
    3. Runs inference in a background task, progressively updating Convex
    """
    message_id = await convex_client.run_mutation(
        "messages:createAssistant",
        {"conversationId": request.conversation_id},
    )

    background_tasks.add_task(
        _run_inference,
        conversation_id=request.conversation_id,
        harness_id=request.harness_id,
        model=request.model,
        user_id=request.user_id,
        message_id=message_id,
    )

    return ChatResponse(message_id=message_id, status="streaming")


async def _run_inference(
    conversation_id: str,
    harness_id: str,
    model: str,
    user_id: str,
    message_id: str,
) -> None:
    """Background task: stream LLM inference and update Convex progressively."""
    mcp = MCPManager()
    accumulated_content = ""
    all_tool_calls = []
    all_tool_results = []

    try:
        # Fetch the harness to know which MCP servers to connect
        harness = await convex_client.run_query(
            "harnesses:get", {"id": harness_id}
        )
        if not harness:
            raise ValueError(f"Harness not found: {harness_id}")

        server_names = [s["name"] for s in harness.get("mcpServers", [])]

        # Connect to MCP servers and get tools
        tools = []
        connected_servers: list[str] = []
        failed_servers: list[str] = []
        if server_names:
            tools = await mcp.connect_servers(server_names, user_id)
            connected_servers = list(mcp.connected_server_names)
            failed_servers = [n for n in server_names if n not in connected_servers]

        logger.info(
            f"Harness '{harness['name']}': "
            f"connected={connected_servers}, failed={failed_servers}, "
            f"tools={len(tools)}"
        )

        # Fetch conversation messages for context
        messages_raw = await convex_client.run_query(
            "messages:listByConversation",
            {"conversationId": conversation_id},
        )

        # Build system message describing the harness and available tools
        harness_name = harness["name"]
        harness_desc = harness.get("description", "")
        tool_names = [t["function"]["name"] for t in tools]

        system_parts = [
            f'You are an AI assistant using the "{harness_name}" harness. {harness_desc}',
        ]
        if tool_names:
            system_parts.append(
                f"You have access to the following tools: {', '.join(tool_names)}. "
                "Use them proactively when the user's request can be answered with these tools."
            )
        if failed_servers:
            system_parts.append(
                f"Note: the following MCP servers failed to connect: {', '.join(failed_servers)}. "
                "If the user asks about capabilities from these servers, let them know the connection is unavailable."
            )

        # Build message history for the LLM (exclude the empty assistant message we just created)
        llm_messages: list[dict] = [
            {"role": "system", "content": " ".join(system_parts)}
        ]
        for msg in (messages_raw or []):
            if msg["_id"] == message_id:
                continue
            role = msg["role"]
            if role in ("user", "assistant", "system"):
                llm_messages.append({"role": role, "content": msg["content"]})
            elif role == "tool" and msg.get("toolResults"):
                llm_messages.append({
                    "role": "tool",
                    "content": json.dumps(msg["toolResults"]),
                    "tool_call_id": msg.get("toolCalls", {}).get("id", "unknown"),
                })

        MAX_TOOL_ROUNDS = 10
        MAX_TOOL_RESULT_CHARS = 8000

        for _round in range(MAX_TOOL_ROUNDS):
            logger.info(f"[inference] round={_round}, messages={len(llm_messages)}")

            stream = await stream_chat_completion(
                messages=llm_messages,
                model=model,
                tools=tools if tools else None,
            )

            last_update = time.time()
            pending_tool_calls: dict[int, dict] = {}
            finish_reason: str | None = None

            async for chunk in stream:
                delta = chunk.choices[0].delta if chunk.choices else None
                if not delta:
                    continue

                if delta.content:
                    accumulated_content += delta.content
                    now = time.time()
                    if now - last_update >= 0.15:
                        await convex_client.run_mutation(
                            "messages:updateStreaming",
                            {"messageId": message_id, "content": accumulated_content},
                        )
                        last_update = now

                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        idx = tc.index
                        if idx not in pending_tool_calls:
                            pending_tool_calls[idx] = {
                                "id": tc.id or f"call_{idx}",
                                "name": "",
                                "arguments": "",
                            }
                        if tc.function:
                            if tc.function.name:
                                pending_tool_calls[idx]["name"] = tc.function.name
                            if tc.function.arguments:
                                pending_tool_calls[idx]["arguments"] += tc.function.arguments

                if chunk.choices:
                    finish_reason = chunk.choices[0].finish_reason

            logger.info(f"[inference] stream done: finish_reason={finish_reason}, pending_tools={len(pending_tool_calls)}")

            if not pending_tool_calls:
                break

            # Build the assistant message with ALL tool calls in one message
            assistant_tool_calls = []
            for idx in sorted(pending_tool_calls.keys()):
                tc_data = pending_tool_calls[idx]
                assistant_tool_calls.append({
                    "id": tc_data["id"],
                    "type": "function",
                    "function": {
                        "name": tc_data["name"],
                        "arguments": tc_data["arguments"],
                    },
                })

            llm_messages.append({
                "role": "assistant",
                "content": accumulated_content or None,
                "tool_calls": assistant_tool_calls,
            })

            # Execute each tool and append tool-result messages
            for idx in sorted(pending_tool_calls.keys()):
                tc_data = pending_tool_calls[idx]
                tool_name = tc_data["name"]
                try:
                    tool_args = json.loads(tc_data["arguments"])
                except json.JSONDecodeError:
                    tool_args = {}

                logger.info(f"[inference] calling tool: {tool_name}({tool_args})")
                all_tool_calls.append(tc_data)
                result = await mcp.call_tool(tool_name, tool_args)

                if len(result) > MAX_TOOL_RESULT_CHARS:
                    logger.warning(
                        f"[inference] truncating tool result from {len(result)} to {MAX_TOOL_RESULT_CHARS} chars"
                    )
                    result = result[:MAX_TOOL_RESULT_CHARS] + "\n...(truncated)"

                logger.info(f"[inference] tool result: {len(result)} chars")

                all_tool_results.append({
                    "tool_call_id": tc_data["id"],
                    "name": tool_name,
                    "result": result,
                })
                llm_messages.append({
                    "role": "tool",
                    "tool_call_id": tc_data["id"],
                    "content": result,
                })

            # Show tool activity in UI while waiting for follow-up
            tool_names_called = [pending_tool_calls[i]["name"] for i in sorted(pending_tool_calls.keys())]
            status_content = accumulated_content + f"\n\n*Used tools: {', '.join(tool_names_called)}*\n\n"
            await convex_client.run_mutation(
                "messages:updateStreaming",
                {"messageId": message_id, "content": status_content},
            )
            accumulated_content = ""

        # Final flush
        await convex_client.run_mutation(
            "messages:finalizeMessage",
            {
                "messageId": message_id,
                "content": accumulated_content,
                "toolCalls": all_tool_calls if all_tool_calls else None,
                "toolResults": all_tool_results if all_tool_results else None,
                "isError": False,
            },
        )

    except BaseException as e:
        logger.exception(f"Inference failed: {type(e).__name__}: {e}")
        error_msg = accumulated_content or f"Error: {type(e).__name__}: {e}"
        try:
            await convex_client.run_mutation(
                "messages:finalizeMessage",
                {
                    "messageId": message_id,
                    "content": error_msg,
                    "isError": True,
                },
            )
        except BaseException:
            logger.exception("Failed to save error message")
    finally:
        await mcp.close()
