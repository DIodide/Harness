"""Tests for SDK result-message usage parsing (authoritative agent usage)."""

from types import SimpleNamespace

from app.services.agents.session_manager import (
    AgentSessionManager,
    _is_sdk_result_message,
    _result_primary_model,
    _result_token_categories,
)


class TestIsResultMessage:
    def test_plain_result_shape(self):
        assert _is_sdk_result_message({"type": "result"}) is True

    def test_system_subtype_result_shape(self):
        assert _is_sdk_result_message({"type": "system", "subtype": "result"}) is True

    def test_non_result_rejected(self):
        assert _is_sdk_result_message({"type": "assistant"}) is False
        assert _is_sdk_result_message({"type": "system", "subtype": "init"}) is False
        assert _is_sdk_result_message({}) is False


class TestTokenCategories:
    def test_prefers_top_level_usage_snake_case(self):
        usage = {
            "input_tokens": 180,
            "output_tokens": 278,
            "cache_read_input_tokens": 66600,
            "cache_creation_input_tokens": 2300,
        }
        assert _result_token_categories(usage, None) == {
            "input": 180,
            "output": 278,
            "cache_read": 66600,
            "cache_creation": 2300,
        }

    def test_falls_back_to_model_usage_camel_case(self):
        model_usage = {
            "claude-opus-4-8": {
                "inputTokens": 100,
                "outputTokens": 200,
                "cacheReadInputTokens": 5000,
                "cacheCreationInputTokens": 50,
            },
            "claude-haiku-4-5": {
                "inputTokens": 10,
                "outputTokens": 2,
                "cacheReadInputTokens": 0,
                "cacheCreationInputTokens": 0,
            },
        }
        assert _result_token_categories(None, model_usage) == {
            "input": 110,
            "output": 202,
            "cache_read": 5000,
            "cache_creation": 50,
        }

    def test_unexpected_shape_degrades_to_zeros(self):
        assert _result_token_categories("nope", None) == {
            "input": 0,
            "output": 0,
            "cache_read": 0,
            "cache_creation": 0,
        }
        assert _result_token_categories(None, None) == {
            "input": 0,
            "output": 0,
            "cache_read": 0,
            "cache_creation": 0,
        }


class TestPrimaryModel:
    def test_picks_highest_output(self):
        model_usage = {
            "claude-opus-4-8": {"outputTokens": 278},
            "claude-haiku-4-5": {"outputTokens": 12},
        }
        assert _result_primary_model(model_usage) == "claude-opus-4-8"

    def test_none_when_absent(self):
        assert _result_primary_model(None) is None
        assert _result_primary_model({}) is None


def _session(**over):
    """Minimal AgentSession-like stub for the static payload computation."""
    base = dict(
        config_options=[{"id": "model", "currentValue": "opus"}],
        acp_session_id="acp1",
        turn_index=1,
        last_rate_limit=None,
    )
    base.update(over)
    return SimpleNamespace(**base)


class TestResultUsagePayload:
    def test_records_per_turn_totals_directly(self):
        # The result message fires once per turn with THAT turn's totals — no
        # cross-turn delta.
        s = _session()
        msg = {
            "type": "result",
            "total_cost_usd": 10.0,
            "usage": {
                "input_tokens": 100,
                "output_tokens": 50,
                "cache_read_input_tokens": 1000,
                "cache_creation_input_tokens": 5,
            },
        }
        out = AgentSessionManager._result_usage_payload(s, msg)
        assert out is not None
        assert out["cost"] == 10.0
        assert out["tokens"] == {
            "input": 100,
            "output": 50,
            "cache_read": 1000,
            "cache_creation": 5,
        }
        assert out["turn_key"] == "acp1:1"
        assert out["model"] == "opus"

    def test_each_turn_is_independent_no_baseline(self):
        # A later, SMALLER turn must record its own full values (the old delta
        # code would have clamped this to 0).
        s = _session(turn_index=2)
        msg = {
            "type": "result",
            "total_cost_usd": 3.0,
            "usage": {
                "input_tokens": 20,
                "output_tokens": 8,
                "cache_read_input_tokens": 500,
                "cache_creation_input_tokens": 2,
            },
        }
        out = AgentSessionManager._result_usage_payload(s, msg)
        assert out["cost"] == 3.0
        assert out["tokens"]["cache_read"] == 500
        assert out["turn_key"] == "acp1:2"

    def test_subscription_zero_cost_but_real_tokens_records(self):
        # Subscription accounts may report cost 0 with real token usage — still
        # record (tokens are the signal).
        s = _session()
        out = AgentSessionManager._result_usage_payload(
            s,
            {"type": "result", "total_cost_usd": 0.0, "usage": {"input_tokens": 42}},
        )
        assert out is not None
        assert out["cost"] == 0.0
        assert out["tokens"]["input"] == 42

    def test_carries_latest_rate_limit(self):
        s = _session(last_rate_limit={"buckets": {"five_hour": {"utilization": 0.66}}})
        out = AgentSessionManager._result_usage_payload(
            s, {"type": "result", "total_cost_usd": 1.0, "usage": {"input_tokens": 1}}
        )
        assert out["rate_limit"] == {"buckets": {"five_hour": {"utilization": 0.66}}}

    def test_hollow_result_returns_none_so_it_cannot_clobber_thin_row(self):
        s = _session()
        # No cost, no usage (error/aborted turn) → skip entirely.
        assert AgentSessionManager._result_usage_payload(s, {"type": "result"}) is None
        # Cost present but 0 and zero tokens → still skip.
        assert (
            AgentSessionManager._result_usage_payload(
                s, {"type": "result", "total_cost_usd": 0.0}
            )
            is None
        )
