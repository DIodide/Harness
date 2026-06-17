"""Tests for error-state sandbox handling.

A sandbox whose container vanished out-of-band (Daytona 'error'/'build_failed'
state) must be detected from its real `state` attribute and either recover()ed
(recoverable) or surfaced as gone (unrecoverable) — never blindly started,
which yields the opaque "Sandbox is in an errored state"."""

import pytest
from daytona_sdk import DaytonaError, DaytonaNotFoundError, SandboxState

from app.services.daytona_service import (
    DaytonaService,
    _sandbox_error_reason,
    _sandbox_is_recoverable_error,
    _sandbox_state,
)


def _sb(**attrs):
    """Build a fake sandbox. Uses the REAL attribute name `state` (a
    SandboxState enum), matching what client.get()/list() return."""
    attrs.setdefault("recoverable", False)
    attrs.setdefault("error_reason", None)
    return type("Sandbox", (), attrs)()


class TestSandboxState:
    def test_reads_state_enum(self):
        assert _sandbox_state(_sb(state=SandboxState.STARTED)) == "started"

    def test_falls_back_to_status_string(self):
        # Defensive: an object that only carries the legacy `status` attr.
        assert _sandbox_state(type("S", (), {"status": "stopped"})()) == "stopped"

    def test_missing_state_is_empty(self):
        assert _sandbox_state(type("S", (), {})()) == ""


class TestSandboxErrorReason:
    def test_unrecoverable_error_state(self):
        sb = _sb(state=SandboxState.ERROR, error_reason="No such container")
        assert _sandbox_error_reason(sb) == "No such container"

    def test_unrecoverable_build_failed_state(self):
        # build_failed is the SECOND terminal error state — must be caught even
        # without an error_reason.
        sb = _sb(state=SandboxState.BUILD_FAILED, error_reason=None)
        assert _sandbox_error_reason(sb) is not None

    def test_error_state_without_reason(self):
        sb = _sb(state=SandboxState.ERROR, error_reason=None)
        assert _sandbox_error_reason(sb) is not None

    def test_recoverable_error_is_not_reported_gone(self):
        # A recoverable error must NOT be tombstoned — recover() preserves it.
        sb = _sb(state=SandboxState.ERROR, error_reason="blip", recoverable=True)
        assert _sandbox_error_reason(sb) is None
        assert _sandbox_is_recoverable_error(sb) is True

    def test_started_with_stale_reason_is_healthy(self):
        # A running box must NOT be tombstoned just because it carries a
        # leftover error_reason — gate on state, like the SDK does.
        sb = _sb(state=SandboxState.STARTED, error_reason="old blip")
        assert _sandbox_error_reason(sb) is None
        assert _sandbox_is_recoverable_error(sb) is False

    def test_unresolvable_state_with_reason_is_errored(self):
        # Defensive fallback: no resolvable state but a populated reason.
        sb = type("S", (), {"error_reason": "boom"})()
        assert _sandbox_error_reason(sb) == "boom"

    def test_started_is_healthy(self):
        assert _sandbox_error_reason(_sb(state=SandboxState.STARTED)) is None
        assert _sandbox_is_recoverable_error(_sb(state=SandboxState.STARTED)) is False

    def test_stopped_is_healthy(self):
        assert _sandbox_error_reason(_sb(state=SandboxState.STOPPED)) is None

    def test_archived_is_healthy(self):
        assert _sandbox_error_reason(_sb(state=SandboxState.ARCHIVED)) is None


class _FakeSandbox:
    def __init__(self, state, *, recoverable=False, error_reason=None, recover_raises=False):
        self.state = state
        self.recoverable = recoverable
        self.error_reason = error_reason
        self.recover_calls = 0
        self._recover_raises = recover_raises

    def recover(self, *_a, **_k):
        self.recover_calls += 1
        if self._recover_raises:
            raise DaytonaError("Sandbox failed to recover")
        # recover() leaves the sandbox ready.
        self.state = SandboxState.STARTED
        self.error_reason = None


class _FakeClient:
    def __init__(self, sandbox):
        self._sandbox = sandbox
        self.start_calls: list = []

    def get(self, _sandbox_id):
        return self._sandbox

    def start(self, _sandbox, timeout=None):
        self.start_calls.append(timeout)


class TestEnsureRunningErrored:
    def _service(self, sandbox, monkeypatch):
        svc = DaytonaService()
        client = _FakeClient(sandbox)
        monkeypatch.setattr(svc, "_get_client", lambda: client)
        return svc, client

    def test_unrecoverable_raises_not_found_without_starting(self, monkeypatch):
        sb = _FakeSandbox(SandboxState.ERROR, error_reason="No such container")
        svc, client = self._service(sb, monkeypatch)
        with pytest.raises(DaytonaNotFoundError):
            svc._ensure_running("x")
        assert client.start_calls == []  # never tried to start an errored box

    def test_build_failed_raises_not_found(self, monkeypatch):
        sb = _FakeSandbox(SandboxState.BUILD_FAILED)
        svc, client = self._service(sb, monkeypatch)
        with pytest.raises(DaytonaNotFoundError):
            svc._ensure_running("x")
        assert client.start_calls == []

    def test_recoverable_error_is_recovered_not_tombstoned(self, monkeypatch):
        sb = _FakeSandbox(SandboxState.ERROR, recoverable=True, error_reason="blip")
        svc, client = self._service(sb, monkeypatch)
        result = svc._ensure_running("x")
        assert sb.recover_calls == 1  # recovered in place
        assert client.start_calls == []  # already ready after recover()
        assert result is sb

    def test_failed_recover_becomes_not_found(self, monkeypatch):
        # recover() that itself fails must surface as 'gone' so the caller
        # re-provisions uniformly (not a hard error).
        sb = _FakeSandbox(SandboxState.ERROR, recoverable=True, recover_raises=True)
        svc, client = self._service(sb, monkeypatch)
        with pytest.raises(DaytonaNotFoundError):
            svc._ensure_running("x")
        assert sb.recover_calls == 1
        assert client.start_calls == []

    def test_started_sandbox_returned_without_start(self, monkeypatch):
        sb = _FakeSandbox(SandboxState.STARTED)
        svc, client = self._service(sb, monkeypatch)
        assert svc._ensure_running("x") is sb
        assert client.start_calls == []  # state-aware: no needless start

    def test_stopped_sandbox_is_started(self, monkeypatch):
        sb = _FakeSandbox(SandboxState.STOPPED)
        svc, client = self._service(sb, monkeypatch)
        svc._ensure_running("x")
        assert client.start_calls == [60]  # stopped → 60s budget

    def test_archived_sandbox_gets_longer_budget(self, monkeypatch):
        sb = _FakeSandbox(SandboxState.ARCHIVED)
        svc, client = self._service(sb, monkeypatch)
        svc._ensure_running("x")
        assert client.start_calls == [180]  # archived restore → 180s


class TestStartSandbox:
    def _service(self, sandbox, monkeypatch):
        svc = DaytonaService()
        client = _FakeClient(sandbox)
        monkeypatch.setattr(svc, "_get_client", lambda: client)
        return svc, client

    def test_unrecoverable_rejected(self, monkeypatch):
        sb = _FakeSandbox(SandboxState.ERROR)
        svc, client = self._service(sb, monkeypatch)
        with pytest.raises(DaytonaNotFoundError):
            svc.start_sandbox("x")
        assert client.start_calls == []

    def test_recoverable_recovered(self, monkeypatch):
        sb = _FakeSandbox(SandboxState.ERROR, recoverable=True)
        svc, client = self._service(sb, monkeypatch)
        svc.start_sandbox("x")
        assert sb.recover_calls == 1
        assert client.start_calls == []  # recover() already made it ready

    def test_stopped_started(self, monkeypatch):
        sb = _FakeSandbox(SandboxState.STOPPED)
        svc, client = self._service(sb, monkeypatch)
        svc.start_sandbox("x")
        assert client.start_calls == [None]  # start_sandbox passes no timeout


class TestStartRoute:
    """POST /api/sandbox/{id}/start maps an unrecoverable sandbox to 409."""

    def _client(self, monkeypatch, start_impl):
        from fastapi.testclient import TestClient

        from app.dependencies import get_current_user
        from app.main import app
        from app.routes import sandbox as sandbox_route

        app.dependency_overrides[get_current_user] = lambda: {"sub": "user_1"}

        async def _owner(*_a, **_k):
            return True

        monkeypatch.setattr(sandbox_route, "verify_sandbox_owner", _owner)
        svc = type("Svc", (), {"start_sandbox": staticmethod(start_impl)})()
        monkeypatch.setattr(sandbox_route, "get_daytona_service", lambda: svc)
        return TestClient(app), app

    def test_errored_sandbox_returns_409(self, monkeypatch):
        def boom(_id):
            raise DaytonaNotFoundError("container gone")

        client, app = self._client(monkeypatch, boom)
        try:
            resp = client.post("/api/sandbox/abc/start")
        finally:
            app.dependency_overrides.clear()
        assert resp.status_code == 409
        assert "unrecoverable error state" in resp.json()["detail"]

    def test_healthy_start_returns_200(self, monkeypatch):
        client, app = self._client(monkeypatch, lambda _id: None)
        try:
            resp = client.post("/api/sandbox/abc/start")
        finally:
            app.dependency_overrides.clear()
        assert resp.status_code == 200
        assert resp.json()["success"] is True
