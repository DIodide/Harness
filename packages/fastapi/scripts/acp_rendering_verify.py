"""Live verification of first-class rendering events through the gateway.

With the new _meta.terminal_output capability, asserts that real agents emit:
- live terminal output deltas (tool_result append + output_delta) while a
  command runs, plus an exit_code at the end;
- a subagent tool_call (synthetic kind "subagent") with a brief, when a Task
  is spawned (claude only — codex has no subagents);
- tool status on tool calls.

Usage:
  CLAUDE_CODE_OAUTH_TOKEN=... .venv/bin/python scripts/acp_rendering_verify.py claude-code
  .venv/bin/python scripts/acp_rendering_verify.py codex
"""

import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
logging.basicConfig(level=logging.WARNING)

from acp_e2e import seed_claude_credential, seed_codex_credential

from app.models import HarnessConfig
from app.services.agents.session_manager import get_session_manager

AGENT = sys.argv[1] if len(sys.argv) > 1 else "claude-code"
USER = f"render-verify-{AGENT}"

CMD_PROMPT = (
    "Run this exact shell command and report when done: "
    "`for i in 1 2 3 4 5; do echo line-$i; sleep 1; done`. "
    "After it finishes tell me the exit status."
)
SUBAGENT_PROMPT = (
    "Use the Task tool to launch a subagent whose prompt is exactly: "
    "'List the files in the current directory and report the count.' "
    "Wait for it and summarize."
)


async def run(manager, sid, prompt, tally):
    async for event in manager.prompt(sid, USER, prompt, None):
        ev, data = event["event"], event["data"]
        if ev == "tool_call":
            tally["tool_calls"] += 1
            k = data.get("kind")
            tally["kinds"].add(k)
            if k == "subagent":
                tally["subagent_brief"] = data.get("arguments", {}).get("prompt")
            if data.get("status"):
                tally["saw_status"] = True
        elif ev == "tool_result":
            if data.get("append"):
                if data.get("output_delta"):
                    tally["deltas"] += 1
                if data.get("exit_code") is not None:
                    tally["exit_codes"] += 1
        elif ev == "permission_request":
            opts = data["options"]
            allow = next((o for o in opts if "allow" in str(o).lower()), None)
            await manager.answer_permission(
                sid, USER, data["request_id"],
                allow.get("optionId") if allow else None, cancelled=allow is None,
            )
        elif ev == "error":
            print(f"[ERROR] {data}")


async def main():
    if AGENT == "claude-code":
        await seed_claude_credential(USER)
    else:
        await seed_codex_credential(USER)
    manager = get_session_manager()
    session = await manager.create(
        user_id=USER, agent_id=AGENT,
        harness=HarnessConfig(model="acp", name="Verify", mcp_servers=[]),
        conversation_id="render-verify-conv", user_ctx=None,
    )
    tally = {
        "tool_calls": 0, "kinds": set(), "deltas": 0, "exit_codes": 0,
        "subagent_brief": None, "saw_status": False,
    }
    try:
        await asyncio.wait_for(session.ready_event.wait(), timeout=300)
        if session.status == "error":
            print(f"PROVISION ERROR: {session.error}")
            return
        print(f"caps: {session.agent_capabilities.get('promptCapabilities')}")
        print(">>> command-stream prompt")
        await run(manager, session.id, CMD_PROMPT, tally)
        if AGENT == "claude-code":
            print(">>> subagent prompt")
            await run(manager, session.id, SUBAGENT_PROMPT, tally)
        print("\n── results ──")
        print(f"tool_calls: {tally['tool_calls']}")
        print(f"kinds seen: {sorted(k for k in tally['kinds'] if k)}")
        print(f"terminal output deltas: {tally['deltas']} (expect >0 — LIVE STREAM)")
        print(f"exit_code updates: {tally['exit_codes']} (expect >0)")
        print(f"tool status seen: {tally['saw_status']}")
        if AGENT == "claude-code":
            print(f"subagent kind seen: {'subagent' in tally['kinds']}")
            print(f"subagent brief captured: {bool(tally['subagent_brief'])}")
    finally:
        await manager.close(session.id, USER)


if __name__ == "__main__":
    asyncio.run(main())
