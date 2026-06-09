"""Debug: verify session/new mcpServers actually reach codex-acp.

Shows agent stderr (via logging) and forces a DeepWiki tool call.
"""

import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s")

from app.models import HarnessConfig, McpServer
from app.services.agents.session_manager import get_session_manager

HARNESS = HarnessConfig(
    model="acp",
    name="DeepWiki",
    mcp_servers=[
        McpServer(name="deepwiki", url="https://mcp.deepwiki.com/mcp", auth_type="none"),
    ],
)

PROMPT = (
    "Do you have access to an MCP server named 'deepwiki' (tools like "
    "ask_question / read_wiki_structure)? If yes, call read_wiki_structure "
    "for repo 'openai/codex' and tell me the first two sections. "
    "If you do not have any deepwiki tools, reply exactly: NO DEEPWIKI"
)


async def main() -> None:
    manager = get_session_manager()
    session = await manager.create(
        user_id="debug-user", agent_id="codex", harness=HARNESS,
        conversation_id="debug-conv", user_ctx=None,
    )
    try:
        await asyncio.wait_for(session.ready_event.wait(), timeout=300)
        if session.status == "error":
            print(f"PROVISION ERROR: {session.error}")
            return
        async for event in manager.prompt(session.id, "debug-user", PROMPT, None):
            kind, data = event["event"], event["data"]
            if kind == "token":
                print(data["content"], end="", flush=True)
            elif kind == "tool_call":
                print(f"\n[tool_call {data['tool']}] args={str(data['arguments'])[:200]}")
            elif kind == "tool_result":
                print(f"[tool_result status={data.get('status')}] {str(data.get('result'))[:200]}")
            elif kind == "permission_request":
                opts = data["options"]
                allow = next((o for o in opts if "allow" in str(o).lower()), opts[0] if opts else None)
                print(f"\n[permission → {allow}]")
                await manager.answer_permission(
                    session.id, "debug-user", data["request_id"],
                    allow.get("optionId") if allow else None, cancelled=allow is None,
                )
            elif kind == "done":
                print(f"\nDONE {data.get('stop_reason')}")
            elif kind == "error":
                print(f"\nERROR {data['message']}")
    finally:
        await manager.close(session.id, "debug-user")


if __name__ == "__main__":
    asyncio.run(main())
