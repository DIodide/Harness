"""Unit tests for the Daytona service's user-intent gating + LRU eviction.

These tests don't hit the real Daytona API — they mock the SDK client so we
can exercise `_ensure_running`, `_evict_lru_for`, and `_start_with_lru_retry`
in isolation.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from daytona_sdk.common.errors import DaytonaError

from app.services.daytona_service import (
    DaytonaService,
    SandboxStoppedByUserError,
)


def _make_sandbox_obj(status: str) -> MagicMock:
    """Build a fake Daytona Sandbox object with a `.status.value` like the SDK."""
    sb = MagicMock()
    status_obj = MagicMock()
    status_obj.value = status
    sb.status = status_obj
    return sb


@pytest.fixture
def service() -> DaytonaService:
    """A fresh DaytonaService with no cached sandboxes."""
    return DaytonaService()


# ── _is_started_limit_error heuristic ─────────────────────────────────────


@pytest.mark.parametrize(
    "err,expected",
    [
        (DaytonaError("started-sandbox limit exceeded", 402), True),
        (DaytonaError("Rate limited", 429), True),
        (DaytonaError("Concurrent sandbox limit reached", 400), True),
        (DaytonaError("Too many active sandboxes", 400), True),
        (DaytonaError("Quota exceeded", 400), True),
        (DaytonaError("Sandbox not found", 404), False),
        (DaytonaError("Internal server error", 500), False),
        (DaytonaError("Bad request: malformed payload", 400), False),
    ],
)
def test_is_started_limit_error_heuristic(err: DaytonaError, expected: bool):
    """The heuristic should catch limit/quota errors via status_code or message,
    and ignore unrelated errors like 404/500."""
    assert DaytonaService._is_started_limit_error(err) is expected


# ── _ensure_running honors user intent ────────────────────────────────────


def test_ensure_running_blocks_when_user_stopped(service: DaytonaService):
    """If Daytona says stopped AND Convex says user-stopped, raise the
    intent error and do not auto-start."""
    fake_client = MagicMock()
    fake_client.get.return_value = _make_sandbox_obj("stopped")

    with patch.object(service, "_get_client", return_value=fake_client), patch(
        "app.services.convex.read_sandbox_intent_sync", return_value="stopped"
    ), patch("app.services.convex.touch_sandbox_sync"):
        with pytest.raises(SandboxStoppedByUserError) as exc:
            service._ensure_running("sb-1")

    assert exc.value.status == "stopped"
    assert exc.value.sandbox_id == "sb-1"
    fake_client.start.assert_not_called()


def test_ensure_running_blocks_when_archived(service: DaytonaService):
    """Archive intent should also block auto-start."""
    fake_client = MagicMock()
    fake_client.get.return_value = _make_sandbox_obj("stopped")

    with patch.object(service, "_get_client", return_value=fake_client), patch(
        "app.services.convex.read_sandbox_intent_sync", return_value="archived"
    ), patch("app.services.convex.touch_sandbox_sync"):
        with pytest.raises(SandboxStoppedByUserError) as exc:
            service._ensure_running("sb-1")

    assert exc.value.status == "archived"
    fake_client.start.assert_not_called()


def test_ensure_running_auto_starts_when_idle_stopped(service: DaytonaService):
    """If Daytona says stopped but Convex still says running (typical of
    Daytona's own idle auto-stop), `_ensure_running` should auto-start."""
    fake_client = MagicMock()
    # First get() (status check) returns stopped; second get() (post-start) returns started.
    fake_client.get.side_effect = [
        _make_sandbox_obj("stopped"),
        _make_sandbox_obj("started"),
    ]

    with patch.object(service, "_get_client", return_value=fake_client), patch(
        "app.services.convex.read_sandbox_intent_sync", return_value="running"
    ), patch("app.services.convex.touch_sandbox_sync") as touch_mock:
        result = service._ensure_running("sb-1")

    fake_client.start.assert_called_once()
    touch_mock.assert_called_once_with("sb-1")
    assert result is not None


def test_ensure_running_no_op_when_already_started(service: DaytonaService):
    """If Daytona already says started, no auto-start should fire — just touch."""
    fake_client = MagicMock()
    fake_client.get.return_value = _make_sandbox_obj("started")

    with patch.object(service, "_get_client", return_value=fake_client), patch(
        "app.services.convex.read_sandbox_intent_sync"
    ) as intent_mock, patch(
        "app.services.convex.touch_sandbox_sync"
    ) as touch_mock:
        service._ensure_running("sb-1")

    fake_client.start.assert_not_called()
    touch_mock.assert_called_once_with("sb-1")
    # Intent doesn't even need to be read when already started.
    intent_mock.assert_not_called()


def test_ensure_running_uses_cache(service: DaytonaService):
    """A second call within the cache TTL should not re-query Daytona at all."""
    fake_client = MagicMock()
    fake_client.get.return_value = _make_sandbox_obj("started")

    with patch.object(service, "_get_client", return_value=fake_client), patch(
        "app.services.convex.read_sandbox_intent_sync", return_value="running"
    ), patch("app.services.convex.touch_sandbox_sync"):
        service._ensure_running("sb-1")
        service._ensure_running("sb-1")

    # Second call hits the cache, so client.get is only called once.
    assert fake_client.get.call_count == 1


# ── LRU eviction ──────────────────────────────────────────────────────────


def test_evict_lru_picks_oldest_started_sibling(service: DaytonaService):
    """`_evict_lru_for` should iterate siblings in order and stop the first
    one that is currently started in Daytona."""
    siblings = [
        # Convex returns these oldest-first.
        {"daytonaSandboxId": "old-stopped", "lastAccessedAt": 100},
        {"daytonaSandboxId": "old-started", "lastAccessedAt": 200},
        {"daytonaSandboxId": "new-started", "lastAccessedAt": 300},
    ]
    fake_client = MagicMock()
    fake_client.get.side_effect = lambda sid: {
        "old-stopped": _make_sandbox_obj("stopped"),
        "old-started": _make_sandbox_obj("started"),
        "new-started": _make_sandbox_obj("started"),
    }[sid]

    with patch.object(service, "_get_client", return_value=fake_client), patch(
        "app.services.convex.list_sibling_sandboxes_sync",
        return_value=siblings,
    ):
        evicted = service._evict_lru_for("target")

    assert evicted == "old-started"
    fake_client.stop.assert_called_once()
    # Should NOT have stopped "new-started" — that's not the LRU.
    stopped_arg = fake_client.stop.call_args[0][0]
    assert stopped_arg.status.value == "started"


def test_evict_lru_returns_none_when_no_started_candidates(
    service: DaytonaService,
):
    """If no sibling is actually started, eviction can't free a slot."""
    siblings = [
        {"daytonaSandboxId": "a", "lastAccessedAt": 100},
        {"daytonaSandboxId": "b", "lastAccessedAt": 200},
    ]
    fake_client = MagicMock()
    fake_client.get.return_value = _make_sandbox_obj("stopped")

    with patch.object(service, "_get_client", return_value=fake_client), patch(
        "app.services.convex.list_sibling_sandboxes_sync",
        return_value=siblings,
    ):
        evicted = service._evict_lru_for("target")

    assert evicted is None
    fake_client.stop.assert_not_called()


def test_evict_lru_skips_failing_candidate_and_tries_next(
    service: DaytonaService,
):
    """If stopping one sibling errors, eviction should fall through to the
    next candidate rather than giving up."""
    siblings = [
        {"daytonaSandboxId": "broken", "lastAccessedAt": 100},
        {"daytonaSandboxId": "ok", "lastAccessedAt": 200},
    ]
    fake_client = MagicMock()
    fake_client.get.side_effect = lambda sid: {
        "broken": _make_sandbox_obj("started"),
        "ok": _make_sandbox_obj("started"),
    }[sid]

    def stop_side_effect(sb):
        if sb.status.value == "started" and not stop_side_effect.first_done:
            stop_side_effect.first_done = True
            raise DaytonaError("boom", 500)

    stop_side_effect.first_done = False
    fake_client.stop.side_effect = stop_side_effect

    with patch.object(service, "_get_client", return_value=fake_client), patch(
        "app.services.convex.list_sibling_sandboxes_sync",
        return_value=siblings,
    ):
        evicted = service._evict_lru_for("target")

    assert evicted == "ok"
    assert fake_client.stop.call_count == 2


def test_evict_lru_invalidates_cache_for_evicted_sandbox(
    service: DaytonaService,
):
    """After eviction, the in-memory cache for the evicted sandbox should be
    invalidated so subsequent agent calls re-check Daytona."""
    siblings = [{"daytonaSandboxId": "victim", "lastAccessedAt": 100}]
    fake_client = MagicMock()
    fake_client.get.return_value = _make_sandbox_obj("started")

    # Pre-populate the cache for the victim.
    service._running_cache["victim"] = (MagicMock(), 0.0)

    with patch.object(service, "_get_client", return_value=fake_client), patch(
        "app.services.convex.list_sibling_sandboxes_sync",
        return_value=siblings,
    ):
        service._evict_lru_for("target")

    assert "victim" not in service._running_cache


# ── _start_with_lru_retry: end-to-end retry logic ─────────────────────────


def test_start_with_lru_retry_passes_through_normal_start(
    service: DaytonaService,
):
    """Happy path — `client.start` succeeds and we don't touch the LRU."""
    fake_client = MagicMock()
    fake_client.get.return_value = _make_sandbox_obj("started")

    sandbox_obj = _make_sandbox_obj("stopped")
    with patch.object(service, "_evict_lru_for") as evict_mock:
        result = service._start_with_lru_retry(
            fake_client, sandbox_obj, "sb-1"
        )

    fake_client.start.assert_called_once()
    evict_mock.assert_not_called()
    assert result is not None


def test_start_with_lru_retry_evicts_then_succeeds(service: DaytonaService):
    """Limit error on first start → evict → second start succeeds."""
    fake_client = MagicMock()
    fake_client.get.return_value = _make_sandbox_obj("started")
    # First start fails with limit error, second succeeds.
    fake_client.start.side_effect = [
        DaytonaError("started-sandbox limit reached", 402),
        None,
    ]
    sandbox_obj = _make_sandbox_obj("stopped")

    with patch.object(
        service, "_evict_lru_for", return_value="victim"
    ) as evict_mock:
        result = service._start_with_lru_retry(
            fake_client, sandbox_obj, "sb-1"
        )

    assert fake_client.start.call_count == 2
    evict_mock.assert_called_once_with("sb-1")
    assert result is not None


def test_start_with_lru_retry_reraises_on_non_limit_error(
    service: DaytonaService,
):
    """Non-limit Daytona errors should propagate without an eviction attempt."""
    fake_client = MagicMock()
    fake_client.start.side_effect = DaytonaError("Sandbox not found", 404)
    sandbox_obj = _make_sandbox_obj("stopped")

    with patch.object(service, "_evict_lru_for") as evict_mock:
        with pytest.raises(DaytonaError):
            service._start_with_lru_retry(fake_client, sandbox_obj, "sb-1")

    evict_mock.assert_not_called()


def test_start_with_lru_retry_reraises_when_no_eviction_candidate(
    service: DaytonaService,
):
    """Limit error + nothing to evict → re-raise the original limit error."""
    fake_client = MagicMock()
    fake_client.start.side_effect = DaytonaError(
        "limit exceeded", 402,
    )
    sandbox_obj = _make_sandbox_obj("stopped")

    with patch.object(service, "_evict_lru_for", return_value=None):
        with pytest.raises(DaytonaError) as exc:
            service._start_with_lru_retry(fake_client, sandbox_obj, "sb-1")

    assert "limit" in str(exc.value).lower()
    # Only the first start was attempted; no retry without eviction.
    assert fake_client.start.call_count == 1


def test_start_with_lru_retry_reraises_when_retry_also_fails(
    service: DaytonaService,
):
    """Limit error → eviction succeeds → retry fails for unrelated reasons →
    propagate the retry error so callers see what actually went wrong."""
    fake_client = MagicMock()
    fake_client.start.side_effect = [
        DaytonaError("limit exceeded", 402),
        DaytonaError("network glitch", 503),
    ]
    sandbox_obj = _make_sandbox_obj("stopped")

    with patch.object(service, "_evict_lru_for", return_value="victim"):
        with pytest.raises(DaytonaError) as exc:
            service._start_with_lru_retry(fake_client, sandbox_obj, "sb-1")

    assert "network glitch" in str(exc.value)
    assert fake_client.start.call_count == 2


# ── _ensure_running with LRU integration ──────────────────────────────────


def test_ensure_running_evicts_and_retries(service: DaytonaService):
    """Full path: agent calls a stopped sandbox, Convex says running, Daytona
    rejects start with a limit error, LRU evicts a sibling, retry succeeds."""
    fake_client = MagicMock()
    # get() sequence: initial status check (stopped), post-start (started).
    fake_client.get.side_effect = [
        _make_sandbox_obj("stopped"),
        _make_sandbox_obj("started"),
    ]
    # First start raises limit error, second succeeds.
    fake_client.start.side_effect = [
        DaytonaError("started-sandbox limit reached", 402),
        None,
    ]

    with patch.object(service, "_get_client", return_value=fake_client), patch(
        "app.services.convex.read_sandbox_intent_sync", return_value="running"
    ), patch("app.services.convex.touch_sandbox_sync"), patch.object(
        service, "_evict_lru_for", return_value="victim"
    ) as evict_mock:
        result = service._ensure_running("sb-1")

    evict_mock.assert_called_once_with("sb-1")
    assert fake_client.start.call_count == 2
    assert result is not None


def test_ensure_running_does_not_evict_for_user_stopped_sandbox(
    service: DaytonaService,
):
    """User-stopped sandboxes should be blocked at the intent check, never
    reach the LRU path. This is the architectural invariant."""
    fake_client = MagicMock()
    fake_client.get.return_value = _make_sandbox_obj("stopped")

    with patch.object(service, "_get_client", return_value=fake_client), patch(
        "app.services.convex.read_sandbox_intent_sync", return_value="stopped"
    ), patch("app.services.convex.touch_sandbox_sync"), patch.object(
        service, "_evict_lru_for"
    ) as evict_mock, patch.object(
        service, "_start_with_lru_retry"
    ) as start_mock:
        with pytest.raises(SandboxStoppedByUserError):
            service._ensure_running("sb-1")

    evict_mock.assert_not_called()
    start_mock.assert_not_called()
    fake_client.start.assert_not_called()
