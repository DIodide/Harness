"""Tests for agent-mode seamlessness hardening: Daytona error classification,
transient-retry behavior, friendly error mapping, and reaper safety."""

import asyncio

import pytest
from daytona_sdk import (
    DaytonaError,
    DaytonaNotFoundError,
    DaytonaRateLimitError,
    DaytonaTimeoutError,
)

from app.services.agents import daytona_runtime
from app.services.agents.daytona_runtime import (
    _retry_after_seconds,
    _with_retries,
    is_transient_daytona_error,
)
from app.config import settings
from app.models import HarnessConfig
from app.services.agents import session_manager as sm
from app.services.agents.daytona_runtime import ProvisionedRuntime
from app.services.agents.session_manager import (
    AgentSession,
    AgentSessionManager,
    SessionProvisioningError,
    _session_is_reapable,
    classify_agent_error,
)


def _make_session(**over):
    harness = HarnessConfig(model="x", name="h", agent="claude-code")
    kwargs = dict(
        id="s1", user_id="u1", agent_id="claude-code",
        harness=harness, conversation_id="c1",
    )
    kwargs.update(over)
    return AgentSession(**kwargs)


class TestIsTransientDaytonaError:
    def test_rate_limit_is_transient(self):
        assert is_transient_daytona_error(DaytonaRateLimitError("slow down")) is True

    def test_timeout_is_transient(self):
        assert is_transient_daytona_error(DaytonaTimeoutError("too slow")) is True

    @pytest.mark.parametrize("code", [500, 502, 503, 504, 429, 408])
    def test_5xx_and_throttle_are_transient(self, code):
        assert is_transient_daytona_error(DaytonaError("blip", status_code=code)) is True

    def test_network_level_none_status_is_transient(self):
        # No HTTP response at all (connection died) — worth a retry.
        assert is_transient_daytona_error(DaytonaError("net", status_code=None)) is True

    def test_not_found_is_permanent(self):
        assert is_transient_daytona_error(DaytonaNotFoundError("gone")) is False

    @pytest.mark.parametrize("code", [400, 401, 403, 422])
    def test_4xx_is_permanent(self, code):
        assert is_transient_daytona_error(DaytonaError("nope", status_code=code)) is False

    def test_oserror_is_transient(self):
        assert is_transient_daytona_error(OSError("connection reset")) is True

    def test_unrelated_exception_is_not_transient(self):
        assert is_transient_daytona_error(ValueError("bug")) is False


class TestRetryAfter:
    def test_honors_retry_after_header(self):
        e = DaytonaRateLimitError("x", headers={"Retry-After": "5"})
        assert _retry_after_seconds(e, 1.5) == 5.0

    def test_caps_retry_after(self):
        e = DaytonaRateLimitError("x", headers={"Retry-After": "9999"})
        assert _retry_after_seconds(e, 1.5) == 30.0

    def test_falls_back_without_header(self):
        assert _retry_after_seconds(DaytonaError("x"), 2.0) == 2.0

    def test_falls_back_on_garbage_header(self):
        e = DaytonaError("x", headers={"Retry-After": "soon"})
        assert _retry_after_seconds(e, 2.0) == 2.0


class TestWithRetries:
    @pytest.fixture(autouse=True)
    def _no_sleep(self, monkeypatch):
        monkeypatch.setattr(daytona_runtime.time, "sleep", lambda *_: None)

    def test_retries_transient_then_succeeds(self):
        calls = {"n": 0}

        def op():
            calls["n"] += 1
            if calls["n"] < 3:
                raise OSError("reset")
            return "ok"

        assert _with_retries(op, "flaky") == "ok"
        assert calls["n"] == 3

    def test_permanent_error_reraises_immediately(self):
        calls = {"n": 0}

        def op():
            calls["n"] += 1
            raise DaytonaNotFoundError("gone")

        # Permanent errors must NOT be wrapped or retried.
        with pytest.raises(DaytonaNotFoundError):
            _with_retries(op, "lookup")
        assert calls["n"] == 1

    def test_transient_exhaustion_raises_runtimeerror(self):
        calls = {"n": 0}

        def op():
            calls["n"] += 1
            raise DaytonaTimeoutError("still slow")

        with pytest.raises(RuntimeError, match="kept failing"):
            _with_retries(op, "start", attempts=3)
        assert calls["n"] == 3


class TestClassifyAgentError:
    def test_not_found_is_friendly(self):
        assert "no longer available" in classify_agent_error(
            DaytonaNotFoundError("gone")
        )

    def test_timeout_is_friendly(self):
        assert "longer than usual" in classify_agent_error(asyncio.TimeoutError())

    def test_transient_daytona_is_reconnect_message(self):
        assert "Lost connection" in classify_agent_error(
            DaytonaError("boom", status_code=503)
        )

    def test_permanent_daytona_is_not_a_reconnect_message(self):
        # A 403/401/422 is permanent — telling the user "it restarted, resend"
        # would send them into a deterministic-failure loop.
        for code in (400, 401, 403, 422):
            msg = classify_agent_error(DaytonaError("denied", status_code=code))
            assert "Lost connection" not in msg
            assert "restarted" not in msg

    def test_generic_provisioning_failure_message(self):
        msg = classify_agent_error(RuntimeError("shim log dump"))
        assert "failed to start" in msg
        # The raw dump must NOT leak into the user-facing message.
        assert "shim log dump" not in msg

    def test_provisioning_error_message_passed_through(self):
        # The sandbox-cap guidance is already user-actionable — keep it verbatim.
        e = SessionProvisioningError("Sandbox limit reached (5/5) — delete one.")
        assert classify_agent_error(e) == "Sandbox limit reached (5/5) — delete one."

    def test_provisioning_error_is_not_transient(self):
        # A cap error must not trigger the cold-start retry loop.
        assert (
            is_transient_daytona_error(SessionProvisioningError("cap")) is False
        )


class TestSessionIsReapable:
    NOW = 1000.0
    TTL = 100.0

    def _reapable(self, status, turn_guard, last_activity, lock_held=False):
        return _session_is_reapable(
            status, turn_guard, last_activity, self.NOW, self.TTL, lock_held
        )

    def test_idle_ready_session_is_reapable(self):
        assert self._reapable("ready", 0, 800.0) is True

    def test_recently_active_is_not_reapable(self):
        assert self._reapable("ready", 0, 950.0) is False

    @pytest.mark.parametrize("status", ["provisioning", "reviving", "prompting"])
    def test_active_status_never_reaped_even_when_old(self, status):
        # last_activity is ancient, but the session is mid-flight.
        assert self._reapable(status, 0, 0.0) is False

    def test_turn_guard_blocks_reaping(self):
        # A turn is in its pre-lock awaits (turn_guard incremented).
        assert self._reapable("ready", 1, 0.0) is False

    def test_held_lock_blocks_reaping(self):
        # An idle 'ready' session whose lock is held (e.g. switch_harness
        # opening a new ACP session) must not be torn down underneath it.
        assert self._reapable("ready", 0, 0.0, lock_held=True) is False


class TestProvisionBounding:
    def test_timeout_marks_errored_and_unblocks_awaiters(self, monkeypatch):
        # A wedged provision must not hang ready_event awaiters forever.
        mgr = AgentSessionManager()
        session = _make_session()
        monkeypatch.setattr(settings, "acp_provision_timeout_seconds", 0.05)

        async def hang(*_a, **_k):
            await asyncio.sleep(5)

        monkeypatch.setattr(mgr, "_provision_with_retry", hang)
        asyncio.run(mgr._provision(session, creds=None, user_ctx=None))

        assert session.status == "error"
        assert "longer than usual" in session.error
        assert session.ready_event.is_set()

    def test_transient_cold_start_is_retried_once(self, monkeypatch):
        mgr = AgentSessionManager()
        session = _make_session()
        calls = {"n": 0}

        async def once(s, _creds, _user_ctx):
            calls["n"] += 1
            if calls["n"] == 1:
                raise DaytonaError("blip")  # status_code None → transient
            s.status = "ready"

        # First attempt raises a transient DaytonaError, second succeeds.
        monkeypatch.setattr(mgr, "_provision_once", once)

        async def no_sleep(*_a, **_k):
            return None

        monkeypatch.setattr(sm.asyncio, "sleep", no_sleep)
        asyncio.run(mgr._provision(session, creds=None, user_ctx=None))

        assert calls["n"] == 2
        assert session.status == "ready"
        assert session.ready_event.is_set()

    def test_permanent_failure_is_not_retried(self, monkeypatch):
        mgr = AgentSessionManager()
        session = _make_session()
        calls = {"n": 0}

        async def once(_s, _creds, _user_ctx):
            calls["n"] += 1
            raise SessionProvisioningError("Sandbox limit reached — delete one.")

        monkeypatch.setattr(mgr, "_provision_once", once)
        asyncio.run(mgr._provision(session, creds=None, user_ctx=None))

        assert calls["n"] == 1  # no retry
        assert session.status == "error"
        assert session.error == "Sandbox limit reached — delete one."


class TestReviveReprovision:
    def _patch_common(self, monkeypatch, mgr):
        async def fake_creds(*_a, **_k):
            return object()

        monkeypatch.setattr(sm, "resolve_agent_credentials", fake_creds)
        monkeypatch.setattr(
            sm, "get_agent", lambda _id: type("A", (), {"name": "Claude"})()
        )

        async def fake_rebuild(s):
            s.acp_session_id = "acp-new"

        monkeypatch.setattr(mgr, "_rebuild_connection", fake_rebuild)

    def test_gone_owned_sandbox_reprovisions_fresh(self, monkeypatch):
        mgr = AgentSessionManager()
        self._patch_common(monkeypatch, mgr)
        session = _make_session()
        session.runtime = ProvisionedRuntime(
            sandbox_id="old", base_url="http://old", headers={}, owns_sandbox=True,
        )
        session.transcript = [{"role": "user", "content": "hi"}]

        calls = []

        def fake_provision(_uid, _agent, _creds, _attach, reuse):
            calls.append("reuse" if reuse is not None else "fresh")
            if reuse is not None:
                raise sm.DaytonaNotFoundError("gone")
            return ProvisionedRuntime(
                sandbox_id="new", base_url="http://new", headers={},
                owns_sandbox=True,
            )

        monkeypatch.setattr(sm, "provision_agent_sandbox", fake_provision)
        # Patch teardown so the test never hits the live Daytona API, and so we
        # can assert the dead tombstone is cleaned up with the OLD id.
        torn = []
        monkeypatch.setattr(sm, "teardown_sandbox", lambda sid: torn.append(sid))
        reregistered = []

        async def fake_reregister(_uid, old, new, _name):
            reregistered.append((old, new))

        monkeypatch.setattr(mgr, "_reregister_after_loss", fake_reregister)

        async def drive():
            await mgr._revive(session)
            await asyncio.sleep(0)  # let the fire-and-forget reregister run

        asyncio.run(drive())

        assert calls == ["reuse", "fresh"]
        assert torn == ["old"]  # the wedged tombstone was torn down (by old id)
        assert session.runtime.sandbox_id == "new"
        assert session.status == "ready"
        assert session.pending_replay is True
        assert reregistered == [("old", "new")]

    def test_gone_attached_sandbox_reraises(self, monkeypatch):
        # A non-owned (attached harness) sandbox can't be fabricated.
        mgr = AgentSessionManager()
        self._patch_common(monkeypatch, mgr)
        session = _make_session()
        session.runtime = ProvisionedRuntime(
            sandbox_id="old", base_url="http://old", headers={}, owns_sandbox=False,
        )

        def fake_provision(_uid, _agent, _creds, _attach, _reuse):
            raise sm.DaytonaNotFoundError("gone")

        monkeypatch.setattr(sm, "provision_agent_sandbox", fake_provision)

        with pytest.raises(sm.DaytonaNotFoundError):
            asyncio.run(mgr._revive(session))
