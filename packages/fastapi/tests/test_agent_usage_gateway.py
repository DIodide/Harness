"""Gateway-side agent-usage helpers: session/new _meta + per-turn cost delta."""

from app.models import HarnessConfig
from app.services.agents.event_encoder import SDK_TASK_MESSAGE_FILTERS
from app.services.agents.session_manager import (
    AgentSession,
    AgentSessionManager,
)


def _session(agent_id: str = "claude-code", system_prompt: str | None = None):
    return AgentSession(
        id="s",
        user_id="u",
        agent_id=agent_id,
        harness=HarnessConfig(model="m", name="h", system_prompt=system_prompt),
        conversation_id="c",
    )


class TestBuildSessionMeta:
    def test_claude_code_without_system_prompt_has_no_options(self):
        meta = AgentSessionManager._build_session_meta(_session())
        assert meta == {"claudeCode": {"emitRawSDKMessages": SDK_TASK_MESSAGE_FILTERS}}
        assert "options" not in meta["claudeCode"]

    def test_claude_code_with_system_prompt_appends_to_preset(self):
        meta = AgentSessionManager._build_session_meta(
            _session(system_prompt="Be terse.")
        )
        assert meta["claudeCode"]["emitRawSDKMessages"] == SDK_TASK_MESSAGE_FILTERS
        assert meta["claudeCode"]["options"]["systemPrompt"] == {
            "type": "preset",
            "preset": "claude_code",
            "append": "Be terse.",
        }

    def test_non_claude_agents_get_no_meta(self):
        assert AgentSessionManager._build_session_meta(_session(agent_id="codex")) is None
        assert AgentSessionManager._build_session_meta(_session(agent_id="cursor")) is None


class TestPerTurnCostDelta:
    def test_cumulative_snapshots_yield_per_turn_deltas(self):
        s = _session()
        assert s.last_cost_usd == 0.0
        assert AgentSessionManager._per_turn_cost_delta(s, 0.01) == 0.01
        # cumulative 0.06 on turn 2 → delta 0.05, NOT 0.06
        assert abs(AgentSessionManager._per_turn_cost_delta(s, 0.06) - 0.05) < 1e-9
        assert s.last_cost_usd == 0.06
        # a re-fire at the same cumulative records nothing more
        assert AgentSessionManager._per_turn_cost_delta(s, 0.06) == 0.0

    def test_sum_of_deltas_equals_final_cumulative_not_sum_of_snapshots(self):
        s = _session()
        total = sum(
            AgentSessionManager._per_turn_cost_delta(s, cum)
            for cum in (0.01, 0.06, 0.10, 0.10, 0.25)
        )
        # The whole point: 0.25, not 0.01+0.06+0.10+0.10+0.25 = 0.52.
        assert abs(total - 0.25) < 1e-9

    def test_clamps_when_cumulative_drops_without_reset(self):
        s = _session()
        AgentSessionManager._per_turn_cost_delta(s, 0.20)
        # If the SDK total ever appears lower than last seen (e.g. a reconnect
        # before _open_acp_session reset last_cost_usd), never record negative.
        assert AgentSessionManager._per_turn_cost_delta(s, 0.05) == 0.0
