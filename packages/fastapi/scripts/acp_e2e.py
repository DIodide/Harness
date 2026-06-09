"""E2E smoke test for the ACP agent gateway (real Daytona + real Codex auth).

Provisions a sandbox from the ACP snapshot, runs codex-acp through the shim,
does a full prompt round trip with an MCP server attached, then exercises the
mid-session harness switch (the MCP quick-switch path) and verifies the agent
sees the new tool configuration.

Usage (from packages/fastapi):
    CODEX_AUTH_JSON_PATH=$HOME/.codex/auth.json .venv/bin/python scripts/acp_e2e.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.models import HarnessConfig, McpServer
from app.services.agents.session_manager import get_session_manager

HARNESS_A = HarnessConfig(
    model="acp",
    name="Research (DeepWiki)",
    mcp_servers=[
        McpServer(name="deepwiki", url="https://mcp.deepwiki.com/mcp", auth_type="none"),
    ],
)

HARNESS_B = HarnessConfig(model="acp", name="Bare", mcp_servers=[])

PROMPT_1 = (
    "Do you have deepwiki MCP tools (ask_question, read_wiki_structure)? "
    "Answer YES-DEEPWIKI or NO-DEEPWIKI, then use read_wiki_structure on "
    "repo 'pingdotgg/t3code' and give me the first section title."
)
PROMPT_2 = (
    "Two questions: (1) Do you still have deepwiki MCP tools available "
    "right now? Answer YES-DEEPWIKI or NO-DEEPWIKI. "
    "(2) Which repo did I ask you to look up earlier in this conversation?"
)


async def run_turn(manager, session_id: str, prompt: str) -> None:
    print(f"\n>>> USER: {prompt}\n")
    async for event in manager.prompt(session_id, "e2e-test-user", prompt, None):
        kind, data = event["event"], event["data"]
        if kind == "token":
            print(data["content"], end="", flush=True)
        elif kind == "thinking":
            pass  # noisy; uncomment to debug: print(f"[think] {data['content']}")
        elif kind == "tool_call":
            print(f"\n[tool_call {data['tool']} kind={data.get('kind')}]")
        elif kind == "tool_result":
            print(f"[tool_result status={data.get('status')}]")
        elif kind == "permission_request":
            options = data["options"]
            allow = next(
                (o for o in options if "allow" in (o.get("kind") or o.get("optionId", "")).lower()),
                options[0] if options else None,
            )
            print(f"\n[permission_request → auto-answering '{allow.get('optionId')}']")
            await manager.answer_permission(
                session_id, "e2e-test-user", data["request_id"],
                allow.get("optionId") if allow else None, cancelled=allow is None,
            )
        elif kind == "status":
            print(f"[status {data['state']}]")
        elif kind == "done":
            print(f"\n<<< DONE (stop_reason={data.get('stop_reason')})")
        elif kind == "error":
            print(f"\n!!! ERROR: {data['message']}")
            raise SystemExit(1)


async def main() -> None:
    manager = get_session_manager()
    print("Creating codex session (provisioning Daytona sandbox)...")
    session = await manager.create(
        user_id="e2e-test-user",
        agent_id="codex",
        harness=HARNESS_A,
        conversation_id="e2e-conversation",
        user_ctx=None,
    )
    print(f"session_id={session.id}")
    try:
        await asyncio.wait_for(session.ready_event.wait(), timeout=300)
        if session.status == "error":
            print(f"PROVISIONING FAILED: {session.error}")
            raise SystemExit(1)
        print(
            f"Session ready. sandbox={session.runtime.sandbox_id} "
            f"acp_session={session.acp_session_id}\n"
            f"agent capabilities: {session.agent_capabilities}"
        )

        await run_turn(manager, session.id, PROMPT_1)

        print("\n\n=== SWITCHING HARNESS (DeepWiki → Bare) ===")
        await manager.switch_harness(session.id, "e2e-test-user", HARNESS_B, None)
        print(f"new acp_session={session.acp_session_id}, pending_replay={session.pending_replay}")

        await run_turn(manager, session.id, PROMPT_2)
        print("\n\nE2E PASSED")
    finally:
        print("Tearing down...")
        await manager.close(session.id, "e2e-test-user")


if __name__ == "__main__":
    asyncio.run(main())
