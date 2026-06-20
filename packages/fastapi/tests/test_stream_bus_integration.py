"""Integration tests for the Redis Streams fan-out bus against a REAL Redis.

These exercise the actual XADD/XREAD/XRANGE semantics the production path uses —
fan-out to multiple followers, late-joiner replay, the FOLLOW_EVENTS allowlist,
done.usage sanitization, and turn lifecycle.

Runs against `REDIS_URL_TEST` (default redis://localhost:6379/15, an isolated db).
SKIPS the whole module when no Redis is reachable, so a dev without Redis isn't
blocked — CI provides a Redis service so these always run there.
"""

import asyncio
import json
import os

import pytest

from app.config import settings
from app.services import stream_bus

TEST_URL = os.environ.get("REDIS_URL_TEST", "redis://localhost:6379/15")


@pytest.fixture
async def bus(monkeypatch):
    """Point stream_bus at the test Redis, flush the test db, skip if unreachable."""
    monkeypatch.setattr(settings, "redis_url", TEST_URL)
    monkeypatch.setattr(stream_bus, "_redis", None)
    monkeypatch.setattr(stream_bus, "_redis_init", False)
    client = stream_bus._client()
    if client is None:
        pytest.skip("redis client not built")
    try:
        await client.ping()
    except Exception:
        pytest.skip(f"redis not reachable at {TEST_URL}")
    await client.flushdb()
    yield stream_bus
    try:
        await client.flushdb()
        await client.aclose()
    except Exception:
        pass
    monkeypatch.setattr(stream_bus, "_redis", None)
    monkeypatch.setattr(stream_bus, "_redis_init", False)


async def _collect_until_done(bus, cid, timeout=5.0):
    """Follow a conversation, collecting frames until the terminal `done`/`error`."""
    got = []

    async def _run():
        async for ev in bus.follow(cid):
            got.append(ev)
            if ev["event"] in ("done", "error"):
                return

    await asyncio.wait_for(_run(), timeout)
    return got


def _events(frames):
    return [f["event"] for f in frames]


class TestFanout:
    async def test_two_followers_replay_the_whole_turn(self, bus):
        """Deterministic: publish a full turn, then TWO late joiners each replay
        the same token sequence — proves fan-out + replay with no timing race."""
        cid = "c-fanout"
        await bus.start_turn(cid)
        await bus.publish(cid, "token", '{"content":"Hello"}')
        await bus.publish(cid, "token", '{"content":" world"}')
        await bus.publish(cid, "done", '{"content":"Hello world","model":"m"}')

        got1 = await _collect_until_done(bus, cid)
        got2 = await _collect_until_done(bus, cid)

        for got in (got1, got2):
            tokens = [
                json.loads(f["data"])["content"]
                for f in got
                if f["event"] == "token"
            ]
            assert tokens == ["Hello", " world"]
            assert _events(got)[-1] == "done"
            # Replay leads with a reset so the client rebuilds cleanly.
            assert got[0]["event"] == "turn_start"
        # Fan-out is byte-identical: both followers see exactly the same frames.
        assert got1 == got2

    async def test_conversations_are_isolated(self, bus):
        """A follower of conversation A never sees conversation B's frames."""
        await bus.start_turn("cA")
        await bus.publish("cA", "token", '{"content":"A-only"}')
        await bus.publish("cA", "done", "{}")
        await bus.start_turn("cB")
        await bus.publish("cB", "token", '{"content":"B-only"}')
        await bus.publish("cB", "done", "{}")

        gotA = await _collect_until_done(bus, "cA")
        tokensA = [
            json.loads(f["data"])["content"] for f in gotA if f["event"] == "token"
        ]
        assert tokensA == ["A-only"]

    async def test_live_tail_to_a_follower_already_watching(self, bus):
        """A follower watching BEFORE the turn starts tails new frames live."""
        cid = "c-live"
        task = asyncio.create_task(_collect_until_done(bus, cid))
        await asyncio.sleep(0.2)  # let the follower reach its blocking XREAD
        await bus.start_turn(cid)
        await bus.publish(cid, "token", '{"content":"streamed"}')
        await bus.publish(cid, "done", '{"content":"streamed"}')
        got = await task
        tokens = [
            json.loads(f["data"])["content"] for f in got if f["event"] == "token"
        ]
        assert tokens == ["streamed"]

    async def test_late_joiner_sees_partial_then_live(self, bus):
        """Join mid-turn: replay the partial-so-far, then receive the rest live."""
        cid = "c-late"
        await bus.start_turn(cid)
        await bus.publish(cid, "token", '{"content":"first"}')
        # Join now — should replay "first", then get "second" + done live.
        task = asyncio.create_task(_collect_until_done(bus, cid))
        await asyncio.sleep(0.2)
        await bus.publish(cid, "token", '{"content":"second"}')
        await bus.publish(cid, "done", '{"content":"firstsecond"}')
        got = await task
        tokens = [
            json.loads(f["data"])["content"] for f in got if f["event"] == "token"
        ]
        assert tokens == ["first", "second"]


class TestFiltering:
    async def test_owner_only_events_never_reach_a_follower(self, bus):
        cid = "c-filter"
        await bus.start_turn(cid)
        # These must be dropped — owner infra / cost / interactive prompts.
        await bus.publish(cid, "mcp_error", '{"server_url":"https://secret"}')
        await bus.publish(cid, "sandbox_status", '{"sandbox_id":"dsbx_owner"}')
        await bus.publish(cid, "agent_usage", '{"cost":1.23}')
        await bus.publish(cid, "permission_request", '{"request_id":"r1"}')
        await bus.publish(cid, "token", '{"content":"visible"}')
        await bus.publish(cid, "done", '{"content":"visible"}')

        got = await _collect_until_done(bus, cid)
        evs = set(_events(got))
        assert "mcp_error" not in evs
        assert "sandbox_status" not in evs
        assert "agent_usage" not in evs
        assert "permission_request" not in evs
        assert "token" in evs and "done" in evs

    async def test_done_usage_cost_is_stripped(self, bus):
        cid = "c-usage"
        await bus.start_turn(cid)
        await bus.publish(
            cid,
            "done",
            '{"content":"hi","model":"m","usage":{"cost":0.42,"totalTokens":99}}',
        )
        got = await _collect_until_done(bus, cid)
        done = next(f for f in got if f["event"] == "done")
        obj = json.loads(done["data"])
        assert "usage" not in obj
        assert obj["content"] == "hi"


class TestTrim:
    async def test_replay_after_maxlen_trim_leads_with_synthetic_reset(
        self, bus, monkeypatch
    ):
        """When a turn outgrows MAXLEN the real turn_start frame is trimmed; the
        replay must STILL lead with a synthetic reset so a reconnecting client
        rebuilds cleanly instead of double-appending the surviving tail."""
        monkeypatch.setattr(stream_bus, "_STREAM_MAXLEN", 3)
        cid = "c-trim"
        await bus.start_turn(cid)
        for i in range(15):
            await bus.publish(cid, "token", json.dumps({"content": str(i)}))

        first = None
        seen = []

        async def _run():
            nonlocal first
            async for ev in bus.follow(cid):
                if first is None:
                    first = ev["event"]
                seen.append(ev["event"])
                if len(seen) >= 4:
                    return

        await asyncio.wait_for(_run(), 3)
        # The real turn_start is long trimmed, yet replay still leads with one.
        assert first == "turn_start"


class TestLifecycle:
    async def test_end_turn_clears_replay_marker(self, bus):
        """After end_turn a new follower tails the live edge (no stale replay)."""
        cid = "c-end"
        await bus.start_turn(cid)
        await bus.publish(cid, "token", '{"content":"old"}')
        await bus.publish(cid, "done", '{"content":"old"}')
        await bus.end_turn(cid)
        # New follower joins; no active turn → it should NOT replay "old".
        # Drive a fresh turn live and confirm it only sees the new content.
        task = asyncio.create_task(_collect_until_done(bus, cid))
        await asyncio.sleep(0.2)
        await bus.start_turn(cid)
        await bus.publish(cid, "token", '{"content":"new"}')
        await bus.publish(cid, "done", '{"content":"new"}')
        got = await task
        tokens = [
            json.loads(f["data"])["content"] for f in got if f["event"] == "token"
        ]
        assert "old" not in tokens
        assert tokens == ["new"]

    async def test_tee_publishes_while_yielding_to_the_initiator(self, bus):
        """The actual producer path: tee() yields every event to the initiator
        unchanged AND fans it out. Event-gated (no timing race) — the turn won't
        finish until a concurrent follower has joined + replayed the partial."""
        cid = "c-tee"
        joined = asyncio.Event()

        async def turn():
            yield {"event": "token", "data": '{"content":"A"}'}
            yield {"event": "token", "data": '{"content":"B"}'}
            await asyncio.wait_for(joined.wait(), 5)  # keep the turn live til joined
            yield {"event": "done", "data": '{"content":"AB"}'}

        async def follow_collect():
            got = []
            async for ev in bus.follow(cid):
                got.append(ev)
                joined.set()  # we've received the replayed partial — let the turn end
                if ev["event"] == "done":
                    return got
            return got

        follower = asyncio.create_task(follow_collect())
        # Initiator drains the teed generator (as EventSourceResponse would).
        initiator_events = [ev["event"] async for ev in bus.tee(turn(), cid)]
        follower_frames = await asyncio.wait_for(follower, 5)

        # Initiator got the full, unmodified turn.
        assert initiator_events == ["token", "token", "done"]
        # Follower saw the same tokens (via replay of the still-live turn + tail).
        ftokens = [
            json.loads(f["data"])["content"]
            for f in follower_frames
            if f["event"] == "token"
        ]
        assert ftokens == ["A", "B"]

    async def test_tee_survives_a_failing_bus(self, bus, monkeypatch):
        """Fail-soft: if every bus write RAISES, the initiator still gets the
        COMPLETE turn — a broken Redis never breaks the turn."""

        async def boom(*a, **k):
            raise RuntimeError("redis down")

        monkeypatch.setattr(stream_bus, "start_turn", boom)
        monkeypatch.setattr(stream_bus, "publish", boom)
        monkeypatch.setattr(stream_bus, "end_turn", boom)

        async def turn():
            yield {"event": "token", "data": '{"content":"A"}'}
            yield {"event": "token", "data": '{"content":"B"}'}
            yield {"event": "done", "data": "{}"}

        out = [ev["event"] async for ev in stream_bus.tee(turn(), "c-boom")]
        assert out == ["token", "token", "done"]

    async def test_tee_does_not_stall_on_a_hung_bus(self, bus, monkeypatch):
        """A hung Redis must not stall the turn: the per-op timeout + per-turn
        breaker bound the cost to ~one timeout, not one per event."""
        import time

        monkeypatch.setattr(stream_bus, "_BUS_OP_TIMEOUT", 0.15)

        async def hang(*a, **k):
            await asyncio.sleep(30)

        # start_turn succeeds (real); publish hangs → first publish trips the
        # breaker → the rest of the turn skips the bus.
        monkeypatch.setattr(stream_bus, "publish", hang)

        async def turn():
            for _ in range(6):
                yield {"event": "token", "data": "{}"}
            yield {"event": "done", "data": "{}"}

        t0 = time.monotonic()
        out = [ev["event"] async for ev in stream_bus.tee(turn(), "c-hang")]
        elapsed = time.monotonic() - t0

        assert out == ["token"] * 6 + ["done"]
        # Only the first publish pays the ~0.15s timeout; not 6×.
        assert elapsed < 1.0
