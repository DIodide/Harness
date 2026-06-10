"""E2E: Claude Code first-class features.

Exercises in one live session:
- background agent (Task tool) with subagent activity nesting (parent_id)
- message-boundary metadata (message_id) across the background wait
- usage_update → agent_usage events
- prompt queueing: a second prompt sent mid-turn flows through the same stream

Usage: .venv/bin/python scripts/acp_claude_features_e2e.py <user-id>
"""

import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

logging.basicConfig(level=logging.WARNING)

from app.models import HarnessConfig
from app.services.agents.session_manager import get_session_manager

PROMPT = (
    "Start a background agent (Task tool) that runs `sleep 4` and then "
    "reports back the exact text DONE-BG. Tell me you are waiting, and when "
    "it finishes, confirm with BG-CONFIRMED."
)
QUEUED = "Separate question: what is 2+2? Reply with exactly QUEUED-ANSWER-4."


async def main() -> None:
    user_id = sys.argv[1] if len(sys.argv) > 1 else "debug-user"
    manager = get_session_manager()
    session = await manager.create(
        user_id=user_id, agent_id="claude-code",
        harness=HarnessConfig(model="acp", name="Debug", mcp_servers=[]),
        conversation_id="claude-features-conv", user_ctx=None,
    )
    seen = {"message_ids": set(), "parent_ids": set(), "agent_usage": 0, "queued": False}
    try:
        await asyncio.wait_for(session.ready_event.wait(), timeout=300)
        if session.status == "error":
            print(f"PROVISION ERROR: {session.error}")
            return
        print(f"queueing supported: {session.supports_prompt_queueing}")

        async def queue_later():
            await asyncio.sleep(6)
            try:
                await manager.queue_prompt(session.id, user_id, QUEUED)
                seen["queued"] = True
                print("\n*** queued second prompt mid-turn ***")
            except Exception as e:
                print(f"\n*** queue_prompt failed: {e} ***")

        queue_task = asyncio.create_task(queue_later())
        async for event in manager.prompt(session.id, user_id, PROMPT, None):
            kind, data = event["event"], event["data"]
            if kind == "token":
                seen["message_ids"].add(data.get("message_id"))
                if data.get("parent_id"):
                    seen["parent_ids"].add(data["parent_id"])
                print(data["content"], end="", flush=True)
            elif kind == "tool_call":
                pid = data.get("parent_id")
                if pid:
                    seen["parent_ids"].add(pid)
                print(f"\n[tool_call {data['tool']} kind={data.get('kind')}"
                      f"{' parent=' + pid[:12] if pid else ''}]")
            elif kind == "agent_usage":
                seen["agent_usage"] += 1
            elif kind == "permission_request":
                opts = data["options"]
                allow = next((o for o in opts if "allow" in str(o).lower()), None)
                await manager.answer_permission(
                    session.id, user_id, data["request_id"],
                    allow.get("optionId") if allow else None, cancelled=allow is None,
                )
            elif kind == "done":
                print(f"\n[done stop_reason={data.get('stop_reason')}]")
            elif kind == "error":
                print(f"\n[ERROR] {data}")
        queue_task.cancel()

        content_done = "".join(
            m["content"] for m in session.transcript if m["role"] == "assistant"
        )
        print("\n── assertions ──")
        print(f"distinct message_ids: {len(seen['message_ids'])} (expect >1)")
        print(f"subagent parent_ids seen: {len(seen['parent_ids'])}")
        print(f"agent_usage events: {seen['agent_usage']} (expect >0)")
        print(f"queued prompt sent: {seen['queued']}")
        print(f"queued answered in stream: {'QUEUED-ANSWER-4' in content_done}")
        print(f"background confirmed: {'BG-CONFIRMED' in content_done}")
    finally:
        await manager.close(session.id, user_id)


if __name__ == "__main__":
    asyncio.run(main())
