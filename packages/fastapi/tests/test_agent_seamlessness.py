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
from app.services.agents.session_manager import (
    SessionProvisioningError,
    _session_is_reapable,
    classify_agent_error,
)


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
    def test_not_found_is_friendly_and_retryable(self):
        msg, retryable = classify_agent_error(DaytonaNotFoundError("gone"))
        assert retryable is True
        assert "no longer exists" in msg

    def test_timeout_is_friendly_and_retryable(self):
        msg, retryable = classify_agent_error(asyncio.TimeoutError())
        assert retryable is True
        assert "longer than usual" in msg

    def test_transient_daytona_is_reconnect_message(self):
        msg, retryable = classify_agent_error(DaytonaError("boom", status_code=503))
        assert retryable is True
        assert "Lost connection" in msg

    def test_generic_provisioning_failure_is_retryable(self):
        msg, retryable = classify_agent_error(RuntimeError("shim log dump"))
        assert retryable is True
        assert "failed to start" in msg
        # The raw dump must NOT leak into the user-facing message.
        assert "shim log dump" not in msg

    def test_provisioning_error_message_passed_through(self):
        # The sandbox-cap guidance is already user-actionable — keep it verbatim.
        e = SessionProvisioningError("Sandbox limit reached (5/5) — delete one.")
        msg, retryable = classify_agent_error(e)
        assert msg == "Sandbox limit reached (5/5) — delete one."
        assert retryable is False

    def test_provisioning_error_is_not_transient(self):
        # A cap error must not trigger the cold-start retry loop.
        assert (
            is_transient_daytona_error(SessionProvisioningError("cap")) is False
        )


class TestSessionIsReapable:
    NOW = 1000.0
    TTL = 100.0

    def test_idle_ready_session_is_reapable(self):
        assert _session_is_reapable("ready", 0, 800.0, self.NOW, self.TTL) is True

    def test_recently_active_is_not_reapable(self):
        assert _session_is_reapable("ready", 0, 950.0, self.NOW, self.TTL) is False

    @pytest.mark.parametrize("status", ["provisioning", "reviving", "prompting"])
    def test_active_status_never_reaped_even_when_old(self, status):
        # last_activity is ancient, but the session is mid-flight.
        assert _session_is_reapable(status, 0, 0.0, self.NOW, self.TTL) is False

    def test_turn_guard_blocks_reaping(self):
        # A turn is in its pre-lock awaits (turn_guard incremented).
        assert _session_is_reapable("ready", 1, 0.0, self.NOW, self.TTL) is False
