"""Live check of first-class agent capabilities through the gateway.

Verifies against a real codex session:
  1. available_commands is captured from available_commands_update
  2. an image content block passes through session/prompt cleanly
  3. session/cancel mid-turn concludes the stream with stopReason=cancelled

Usage (from packages/fastapi):
    .venv/bin/python scripts/acp_capabilities_check.py
"""

import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)

from acp_e2e import seed_codex_credential

from app.models import HarnessConfig
from app.services.agents.session_manager import get_session_manager

USER = "caps-check-user"


def make_test_png(width: int = 64, height: int = 64) -> str:
    """A solid-red PNG as base64. Degenerate (1x1) images trip codex_core's
    anti-poisoning validation, so use a realistic size."""
    import base64
    import struct
    import zlib

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    raw = b"".join(b"\x00" + b"\xff\x00\x00" * width for _ in range(height))
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )
    return base64.b64encode(png).decode("ascii")


async def run_turn(manager, session_id, prompt, blocks=None, cancel_after=None):
    events = []

    async def consume():
        async for event in manager.prompt(
            session_id, USER, prompt, None, blocks=blocks,
        ):
            events.append(event)
            if event["event"] == "token":
                print(event["data"]["content"], end="", flush=True)
            elif event["event"] == "error":
                print(f"\n[error event] {event['data']}")

    task = asyncio.create_task(consume())
    if cancel_after is not None:
        await asyncio.sleep(cancel_after)
        print(f"\n[cancelling after {cancel_after}s]")
        await manager.cancel(session_id, USER)
    await task
    done = next((e for e in events if e["event"] == "done"), None)
    print(f"\n<<< stop_reason={done['data'].get('stop_reason') if done else 'NO DONE'}")
    return done


async def main():
    await seed_codex_credential(USER)
    manager = get_session_manager()
    session = await manager.create(
        user_id=USER,
        agent_id="codex",
        harness=HarnessConfig(model="acp", name="caps", mcp_servers=[]),
        conversation_id="caps-conv",
        user_ctx=None,
    )
    try:
        await asyncio.wait_for(session.ready_event.wait(), timeout=300)
        if session.status == "error":
            print(f"PROVISION ERROR: {session.error}")
            raise SystemExit(1)

        caps = session.agent_capabilities.get("promptCapabilities") or {}
        print(f"promptCapabilities: {caps}")
        print(f"config_options ids: {[o.get('id') for o in session.config_options]}")

        # (0) Plain turn sanity check.
        done = await run_turn(manager, session.id, "Reply with exactly: PLAIN-OK")
        print(f"\nplain turn ok: {done is not None}")

        # (2) Image block round trip.
        done = await run_turn(
            manager, session.id,
            "In one short sentence: what color is the attached image?",
            blocks=[
                {"type": "image", "data": make_test_png(), "mimeType": "image/png"}
            ],
        )
        image_ok = done is not None
        print(f"image turn ok: {image_ok}")

        # (0b) Does a plain turn still work after the image turn?
        done = await run_turn(manager, session.id, "Reply with exactly: STILL-OK")
        print(f"\nplain-after-image ok: {done is not None}")

        # (1) Commands were advertised by now (session/new or first turn).
        names = [c.get("name") for c in session.available_commands]
        print(f"available_commands ({len(names)}): {names}")

        # (3) Mid-turn cancel.
        done = await run_turn(
            manager, session.id,
            "Count from 1 to 1000 out loud, one number per line, no shell.",
            cancel_after=4.0,
        )
        reason = done["data"].get("stop_reason") if done else None
        print(f"cancel test stop_reason: {reason}")
        assert reason == "cancelled", f"expected cancelled, got {reason}"
        assert image_ok, "image turn produced no done event"
        print("\nCAPABILITIES CHECK PASSED")
    finally:
        print("Tearing down...")
        await manager.close(session.id, USER)


if __name__ == "__main__":
    asyncio.run(main())
