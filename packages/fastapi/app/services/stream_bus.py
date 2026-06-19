"""Redis Streams live-token fan-out bus.

A chat/agent turn streams its SSE 1:1 to the initiating client. To let PASSIVE
viewers (the owner's other tabs, a sharee watching, a late joiner) see the same
tokens render live, the turn ALSO tees every display event into a per-conversation
Redis Stream. Any viewer opens GET /api/chat/follow, which replays the current
turn then BLOCK-tails the stream and relays each event.

Fail-soft: when `redis_url` is unset (or Redis is unreachable) every function is a
no-op and `follow()` yields nothing — turns then stream only to the initiator,
exactly as before. A shared Redis instance also makes fan-out work across multiple
FastAPI workers/boxes (the reason to pick Streams over an in-process hub).
"""

import asyncio
import json
import logging
from collections.abc import AsyncIterator

from app.config import settings

logger = logging.getLogger(__name__)

# Display-only events relayed to passive viewers — exactly the transcript a
# viewer can already see persisted, nothing more. DELIBERATELY excluded:
#   - permission_request / question_request (+resolutions): only the turn's
#     driver answers them, and they carry tool/prompt detail to act on.
#   - mcp_error / sandbox_status: carry the OWNER's infra (MCP server URL,
#     sandbox id) — a passive sharee must not learn those.
#   - agent_usage: the owner's agent context-window + real $ cost.
# The `done` frame's per-turn usage/cost is stripped in `publish` (the persisted
# shared transcript never exposes usage either).
FOLLOW_EVENTS = frozenset(
    {
        "turn_start",
        "token",
        "thinking",
        "tool_call",
        "tool_result",
        "done",
        "error",
        "plan",
        "status",
    }
)

# Approximate cap on entries kept per conversation stream (a long turn with
# verbose tool output stays well under this; XADD trims opportunistically).
_STREAM_MAXLEN = 4000
# How long the "a turn is live" marker survives without an explicit end (so a
# crashed producer can't leave late joiners replaying a frozen partial forever).
_TURN_TTL_SECONDS = 600
# Idle stream key expiry — a conversation no one streams into is reclaimed.
# Generous so even a very long single turn can't self-expire its own key mid-flight.
_STREAM_TTL_SECONDS = 21600  # 6h
# Time box on a single bus op in the turn's critical path — a hung Redis must
# never freeze the initiator's turn; a slow/hung op trips a per-turn breaker.
_BUS_OP_TIMEOUT = 1.0

_redis = None
_redis_init = False


def _client():
    """Lazily build the async Redis client, or None when not configured."""
    global _redis, _redis_init
    if not settings.redis_url:
        return None
    if not _redis_init:
        _redis_init = True
        try:
            from redis.asyncio import Redis

            _redis = Redis.from_url(
                settings.redis_url,
                decode_responses=True,
                socket_connect_timeout=2.0,
                socket_timeout=20.0,
                health_check_interval=30,
                # Each /follow holds a connection for its blocking XREAD window —
                # a generous pool so many concurrent followers don't starve it.
                max_connections=256,
            )
        except Exception:
            logger.exception("Failed to init Redis client — live fan-out disabled")
            _redis = None
    return _redis


def enabled() -> bool:
    return _client() is not None


def _stream_key(conversation_id: str) -> str:
    return f"harness:stream:{conversation_id}"


def _turn_key(conversation_id: str) -> str:
    return f"harness:turn:{conversation_id}"


async def start_turn(conversation_id: str) -> None:
    """Mark a new turn live: append a turn_start frame and record its id so a
    late joiner can replay from exactly the start of the CURRENT turn."""
    r = _client()
    if r is None:
        return
    try:
        skey = _stream_key(conversation_id)
        sid = await r.xadd(
            skey,
            {"event": "turn_start", "data": "{}"},
            maxlen=_STREAM_MAXLEN,
            approximate=True,
        )
        await r.set(_turn_key(conversation_id), sid, ex=_TURN_TTL_SECONDS)
        await r.expire(skey, _STREAM_TTL_SECONDS)
    except Exception:
        logger.warning("stream start_turn failed for '%s'", conversation_id)


def _sanitize(event: str, payload: str) -> str:
    """Strip owner-only fields from a frame before fan-out. The `done` frame
    carries per-turn usage/cost (the persisted shared transcript never exposes
    usage either) — a passive viewer must not see it."""
    if event != "done":
        return payload
    try:
        obj = json.loads(payload)
    except Exception:
        return payload
    if isinstance(obj, dict) and "usage" in obj:
        obj = {k: v for k, v in obj.items() if k != "usage"}
        return json.dumps(obj)
    return payload


async def publish(conversation_id: str, event: str, data) -> None:
    """Tee one display event into the conversation stream. `data` is the same
    JSON string already sent to the initiating client (or a dict)."""
    r = _client()
    if r is None or event not in FOLLOW_EVENTS:
        return
    try:
        payload = data if isinstance(data, str) else json.dumps(data)
        payload = _sanitize(event, payload)
        await r.xadd(
            _stream_key(conversation_id),
            {"event": event, "data": payload},
            maxlen=_STREAM_MAXLEN,
            approximate=True,
        )
    except Exception:
        # A dropped delta must never break the live turn for the initiator.
        logger.debug("stream publish failed for '%s'", conversation_id)


async def end_turn(conversation_id: str) -> None:
    """Clear the live-turn marker (the terminal done/error frame is already in
    the stream). New followers then tail from the live edge, not a replay."""
    r = _client()
    if r is None:
        return
    try:
        await r.delete(_turn_key(conversation_id))
    except Exception:
        logger.debug("stream end_turn failed for '%s'", conversation_id)


async def _safe(coro) -> bool:
    """Run a bus op time-boxed. Returns False if it timed out or failed so the
    caller can stop teeing for the rest of the turn — a hung Redis must NEVER
    stall the initiator's turn (the SSE to the driver is the critical path)."""
    try:
        await asyncio.wait_for(coro, timeout=_BUS_OP_TIMEOUT)
        return True
    except Exception:
        return False


async def tee(gen: AsyncIterator[dict], conversation_id: str) -> AsyncIterator[dict]:
    """Wrap a turn's SSE event generator: publish each display event to the bus
    while yielding it unchanged to the initiating client. One wrap per endpoint;
    a no-op (pure passthrough) when Redis is unconfigured.

    Each bus op is time-boxed; the first hang/failure trips a per-turn breaker so
    we never pay the timeout twice — the turn streams to the driver regardless.
    """
    if not enabled():
        async for ev in gen:
            yield ev
        return
    healthy = await _safe(start_turn(conversation_id))
    try:
        async for ev in gen:
            if healthy:
                healthy = await _safe(
                    publish(conversation_id, ev.get("event", ""), ev.get("data", "{}"))
                )
            yield ev
    finally:
        await _safe(end_turn(conversation_id))


async def follow(conversation_id: str) -> AsyncIterator[dict]:
    """Yield {event, data} frames for a passive viewer: replay the current turn
    (if one is live) then BLOCK-tail for new frames. Returns immediately when
    Redis is unconfigured."""
    r = _client()
    if r is None:
        return
    skey = _stream_key(conversation_id)
    cursor = "$"
    try:
        turn_start = await r.get(_turn_key(conversation_id))
        if turn_start:
            # Always lead a replay with a synthetic reset so the client rebuilds
            # cleanly — even on a reconnect where the real turn_start frame was
            # already trimmed by MAXLEN (otherwise the tail would double-append).
            yield {"event": "turn_start", "data": "{}"}
            # Replay the current turn from its start so a late joiner catches up.
            entries = await r.xrange(skey, min=turn_start, max="+")
            for sid, fields in entries:
                yield {"event": fields.get("event", ""), "data": fields.get("data", "{}")}
                cursor = sid
    except Exception:
        logger.debug("stream follow replay failed for '%s'", conversation_id)

    while True:
        try:
            resp = await r.xread({skey: cursor}, block=15000, count=100)
        except Exception:
            logger.debug("stream follow xread failed for '%s'", conversation_id)
            return
        if not resp:
            # Block timed out with nothing new — loop to keep the SSE alive.
            continue
        for _stream, entries in resp:
            for sid, fields in entries:
                yield {"event": fields.get("event", ""), "data": fields.get("data", "{}")}
                cursor = sid
