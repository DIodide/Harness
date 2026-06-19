"""Redis Streams fan-out bus — fail-soft behavior when Redis is unconfigured."""

import pytest

from app.services import stream_bus


@pytest.fixture
def no_redis(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "redis_url", "")
    # Reset the lazy client so a prior test's state doesn't leak.
    monkeypatch.setattr(stream_bus, "_redis", None)
    monkeypatch.setattr(stream_bus, "_redis_init", False)


class TestDisabled:
    def test_enabled_is_false_without_url(self, no_redis):
        assert stream_bus.enabled() is False

    async def test_tee_is_passthrough(self, no_redis):
        async def gen():
            yield {"event": "token", "data": '{"content":"hi"}'}
            yield {"event": "done", "data": "{}"}

        out = [ev async for ev in stream_bus.tee(gen(), "c1")]
        assert [e["event"] for e in out] == ["token", "done"]

    async def test_follow_yields_nothing(self, no_redis):
        out = [ev async for ev in stream_bus.follow("c1")]
        assert out == []

    async def test_publish_lifecycle_are_noops(self, no_redis):
        # Must not raise when Redis is absent.
        await stream_bus.start_turn("c1")
        await stream_bus.publish("c1", "token", '{"content":"x"}')
        await stream_bus.end_turn("c1")


class TestEventFilter:
    def test_owner_only_events_are_not_followed(self):
        # A passive viewer must never receive interactive prompts (only the
        # driver answers) NOR the owner's infra/cost (mcp url, sandbox id, $).
        for ev in (
            "permission_request",
            "question_request",
            "permission_resolved",
            "question_resolved",
            "question_answered",
            "mcp_error",
            "sandbox_status",
            "agent_usage",
        ):
            assert ev not in stream_bus.FOLLOW_EVENTS

    def test_display_events_are_followed(self):
        for ev in ("turn_start", "token", "thinking", "tool_call", "tool_result", "done", "error"):
            assert ev in stream_bus.FOLLOW_EVENTS


class TestSanitize:
    def test_done_strips_usage_cost(self):
        out = stream_bus._sanitize(
            "done", '{"content":"hi","model":"m","usage":{"cost":0.5}}'
        )
        import json as _json

        obj = _json.loads(out)
        assert "usage" not in obj
        assert obj["content"] == "hi"
        assert obj["model"] == "m"

    def test_non_done_passthrough(self):
        p = '{"content":"x"}'
        assert stream_bus._sanitize("token", p) == p
