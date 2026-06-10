"""E2E verification for the Cursor agent (cursor-agent acp in Daytona).

Seeds CURSOR_API_KEY through the encrypted credential path, provisions a
sandbox from the ACP snapshot, and runs an ACP round trip with a DeepWiki
MCP server attached.

Usage (from packages/fastapi):
    CURSOR_API_KEY=key_... .venv/bin/python scripts/acp_cursor_e2e.py

Without CURSOR_API_KEY set, runs in plumbing mode with a dummy key: the
spawn + ACP handshake are verified and the auth rejection point is shown.
"""

import asyncio
import logging
import os
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).parent.parent))

logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s")

from app.models import HarnessConfig, McpServer
from app.services.agents.credentials import store_user_credential
from app.services.agents.session_manager import get_session_manager

USER = "cursor-e2e-user"

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
    "for repo 'openai/codex' and tell me the first two section titles. "
    "If you do not have any deepwiki tools, reply exactly: NO DEEPWIKI"
)


async def main() -> None:
    auth_json_path = os.environ.get("CURSOR_AUTH_JSON_PATH", "")
    api_key = os.environ.get("CURSOR_API_KEY", "")
    if auth_json_path:
        with open(auth_json_path, encoding="utf-8") as f:
            kind, value = "auth_json", f.read()
        plumbing_only = False
    elif api_key:
        kind, value = "api_key", api_key
        plumbing_only = False
    else:
        print(
            "No CURSOR_AUTH_JSON_PATH / CURSOR_API_KEY — plumbing mode "
            "(expect an auth error from cursor, not a successful turn)."
        )
        kind, value = "api_key", "dummy-key-for-plumbing-verification"
        plumbing_only = True

    async with httpx.AsyncClient() as http:
        await store_user_credential(http, USER, "cursor", kind, value)
    print(f"Seeded encrypted cursor credential (kind={kind}).")

    manager = get_session_manager()
    session = await manager.create(
        user_id=USER, agent_id="cursor", harness=HARNESS,
        conversation_id="cursor-e2e-conv", user_ctx=None,
    )
    try:
        await asyncio.wait_for(session.ready_event.wait(), timeout=300)
        if session.status == "error":
            print(f"PROVISION ERROR: {session.error}")
            raise SystemExit(1)
        print(
            f"Session ready. sandbox={session.runtime.sandbox_id}\n"
            f"agent capabilities: {session.agent_capabilities}"
        )

        async for event in manager.prompt(session.id, USER, PROMPT, None):
            kind, data = event["event"], event["data"]
            if kind == "token":
                print(data["content"], end="", flush=True)
            elif kind == "tool_call":
                print(f"\n[tool_call {data['tool']} kind={data.get('kind')}]")
            elif kind == "tool_result":
                print(f"[tool_result status={data.get('status')}] {str(data.get('result'))[:160]}")
            elif kind == "permission_request":
                options = data["options"]
                allow = next(
                    (o for o in options if "allow" in str(o).lower()),
                    options[0] if options else None,
                )
                print(f"\n[permission → {allow}]")
                await manager.answer_permission(
                    session.id, USER, data["request_id"],
                    allow.get("optionId") if allow else None, cancelled=allow is None,
                )
            elif kind == "status":
                print(f"[status {data}]")
            elif kind == "done":
                print(f"\nDONE stop_reason={data.get('stop_reason')}")
            elif kind == "error":
                print(f"\nERROR: {data['message']}")
                if plumbing_only:
                    print(
                        "(auth rejection is the expected outcome in "
                        "plumbing mode if the handshake got this far)"
                    )
    finally:
        print("\nTearing down...")
        await manager.close(session.id, USER)


if __name__ == "__main__":
    asyncio.run(main())
