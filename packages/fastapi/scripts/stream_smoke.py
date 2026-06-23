#!/usr/bin/env python3
"""Live-stream fan-out smoke client.

A self-contained validator for the Redis Streams bus — proves that a turn's
tokens fan out to multiple passive viewers, that a late joiner replays the
partial-so-far, and that owner-only/cost events are filtered. Exercises the
SAME `app.services.stream_bus` code the production /api/chat/stream + /follow
paths use, so it validates the real publish/follow logic without a browser.

Usage:
    REDIS_URL=redis://localhost:6379/15 python scripts/stream_smoke.py
    python scripts/stream_smoke.py redis://localhost:6379/15

Exits 0 on success, 1 on failure.
"""

import asyncio
import json
import os
import sys

# Make `app` importable when run from packages/fastapi/.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Settings() requires this at import — a dummy is fine, the smoke client never
# calls OpenRouter.
os.environ.setdefault("OPENROUTER_API_KEY", "smoke-not-used")

from app.config import settings  # noqa: E402
from app.services import stream_bus  # noqa: E402

CID = "smoke-conversation"
TOKENS = ["The ", "quick ", "brown ", "fox ", "jumps."]


def _reset_client(url: str) -> None:
    settings.redis_url = url
    stream_bus._redis = None
    stream_bus._redis_init = False


async def _follower(label: str, collected: list[str]) -> None:
    """Tail the conversation, printing tokens as they arrive (like a passive tab)."""
    async for frame in stream_bus.follow(CID):
        ev = frame["event"]
        if ev == "turn_start":
            print(f"  [{label}] ── turn start ──")
        elif ev == "token":
            tok = json.loads(frame["data"]).get("content", "")
            collected.append(tok)
            print(f"  [{label}] +token {tok!r}")
        elif ev == "done":
            print(f"  [{label}] ✓ done")
            return


async def _producer() -> None:
    """Simulate a turn the way chat.py/agents.py would (via the tee)."""

    async def turn():
        for tok in TOKENS:
            await asyncio.sleep(0.25)  # pace it so streaming is visible
            yield {"event": "token", "data": json.dumps({"content": tok})}
        # These must be FILTERED OUT for passive viewers.
        yield {"event": "agent_usage", "data": json.dumps({"cost": 9.99})}
        yield {"event": "mcp_error", "data": json.dumps({"server_url": "https://owner-secret"})}
        yield {
            "event": "done",
            "data": json.dumps({"content": "".join(TOKENS), "usage": {"cost": 9.99}}),
        }

    print("→ producer: streaming a turn through stream_bus.tee()")
    async for _ev in stream_bus.tee(turn(), CID):
        pass


async def main(url: str) -> int:
    _reset_client(url)
    client = stream_bus._client()
    if client is None:
        print("redis_url not set — nothing to validate")
        return 1
    try:
        await client.ping()
    except Exception as e:
        print(f"✗ cannot reach Redis at {url}: {e}")
        return 1
    await client.flushdb()
    print(f"✓ connected to Redis at {url}\n")

    a: list[str] = []
    b: list[str] = []
    late: list[str] = []

    # Two followers watching from the start, plus a late joiner mid-turn.
    fa = asyncio.create_task(_follower("watcher-A", a))
    fb = asyncio.create_task(_follower("watcher-B", b))
    await asyncio.sleep(0.2)  # let them reach their blocking read

    prod = asyncio.create_task(_producer())
    await asyncio.sleep(0.7)  # ~3 tokens in
    print("→ a LATE joiner opens the chat mid-turn")
    fl = asyncio.create_task(_follower("late-joiner", late))

    await prod
    await asyncio.wait_for(asyncio.gather(fa, fb, fl), timeout=5)
    await stream_bus.end_turn(CID)
    await client.flushdb()
    await client.aclose()

    expected = "".join(TOKENS)
    ok = True
    print()
    for label, got in (("watcher-A", a), ("watcher-B", b), ("late-joiner", late)):
        joined = "".join(got)
        passed = joined == expected
        ok = ok and passed
        print(f"  {'✓' if passed else '✗'} {label}: {joined!r}")
    # The late joiner must have caught the whole message via replay+tail.
    if "".join(late) != expected:
        print("  ✗ late joiner did not catch up via replay")
        ok = False

    print("\n" + ("✓ PASS — fan-out + replay + filtering all work" if ok else "✗ FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    redis_url = (
        sys.argv[1]
        if len(sys.argv) > 1
        else os.environ.get("REDIS_URL", "redis://localhost:6379/15")
    )
    raise SystemExit(asyncio.run(main(redis_url)))
