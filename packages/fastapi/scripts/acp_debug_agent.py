"""Debug: provision any agent for any user and run one tiny prompt.

Usage:
    .venv/bin/python scripts/acp_debug_agent.py <agent-id> <user-id> [prompt]

Uses the user's real stored (encrypted) credential via the normal path,
with INFO logging so agent stderr / shim logs are visible.
"""

import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)

from app.models import HarnessConfig
from app.services.agents.session_manager import get_session_manager


async def main() -> None:
    agent_id = sys.argv[1] if len(sys.argv) > 1 else "claude-code"
    user_id = sys.argv[2] if len(sys.argv) > 2 else "debug-user"
    prompt = sys.argv[3] if len(sys.argv) > 3 else "Say exactly: HELLO FROM THE SANDBOX"

    manager = get_session_manager()
    session = await manager.create(
        user_id=user_id,
        agent_id=agent_id,
        harness=HarnessConfig(model="acp", name="Debug", mcp_servers=[]),
        conversation_id="debug-agent-conv",
        user_ctx=None,
    )
    try:
        await asyncio.wait_for(session.ready_event.wait(), timeout=300)
        if session.status == "error":
            print(f"\nPROVISION ERROR:\n{session.error}")
            return
        print(f"\nready: caps={session.agent_capabilities}\n")
        async for event in manager.prompt(session.id, user_id, prompt, None):
            kind, data = event["event"], event["data"]
            if kind == "token":
                print(data["content"], end="", flush=True)
            elif kind == "permission_request":
                opts = data["options"]
                allow = next((o for o in opts if "allow" in str(o).lower()), None)
                await manager.answer_permission(
                    session.id, user_id, data["request_id"],
                    allow.get("optionId") if allow else None, cancelled=allow is None,
                )
            elif kind in ("done", "error"):
                print(f"\n[{kind}] {data}")
    finally:
        await manager.close(session.id, user_id)


if __name__ == "__main__":
    asyncio.run(main())
