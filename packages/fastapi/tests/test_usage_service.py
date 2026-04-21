"""Usage service — budget checking and recording via Convex HTTP."""
from datetime import datetime, timezone
from unittest.mock import patch

import httpx
import pytest
import respx

from app.services import usage
from app.services.usage import (
    _current_day,
    _current_week,
    _next_daily_reset,
    _next_weekly_reset,
    check_user_budget,
    record_usage,
)

CONVEX_URL = "https://test.convex.cloud"


class TestDateHelpers:
    def test_current_day_format(self):
        with patch.object(usage, "datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 4, 21, 15, 30, tzinfo=timezone.utc)
            assert _current_day() == "2026-04-21"

    def test_current_week_iso_format(self):
        # 2026-04-21 is a Tuesday — ISO week 17 of 2026.
        with patch.object(usage, "datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 4, 21, tzinfo=timezone.utc)
            wk = _current_week()
            assert wk.startswith("2026-W")
            assert wk == "2026-W17"

    def test_week_pads_single_digit(self):
        with patch.object(usage, "datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 1, 5, tzinfo=timezone.utc)  # Mon, ISO W2
            assert _current_week() == "2026-W02"

    def test_next_daily_reset_is_next_midnight(self):
        with patch.object(usage, "datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 4, 21, 15, 30, tzinfo=timezone.utc)
            mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)
            result = _next_daily_reset()
            assert result.startswith("2026-04-22T00:00:00")

    def test_next_weekly_reset_from_midweek(self):
        # 2026-04-21 Tue → next Mon is 2026-04-27
        with patch.object(usage, "datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 4, 21, 10, 0, tzinfo=timezone.utc)
            mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)
            result = _next_weekly_reset()
            assert result.startswith("2026-04-27T00:00:00")

    def test_next_weekly_reset_from_monday_moves_seven_days(self):
        # On Monday, next Monday is 7 days away, not today.
        with patch.object(usage, "datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 4, 20, 10, 0, tzinfo=timezone.utc)
            mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)
            result = _next_weekly_reset()
            assert result.startswith("2026-04-27T00:00:00")


@pytest.fixture
def convex_settings(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "convex_url", CONVEX_URL)
    monkeypatch.setattr(settings, "convex_deploy_key", "deploy-test")


@pytest.fixture
def no_convex_settings(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "convex_url", "")
    monkeypatch.setattr(settings, "convex_deploy_key", "")


class TestCheckUserBudget:
    async def test_fails_open_when_not_configured(self, no_convex_settings):
        async with httpx.AsyncClient() as client:
            result = await check_user_budget(client, "user_1")
        assert result.allowed is True
        assert result.daily_pct == 0

    @respx.mock
    async def test_returns_allowed_from_convex(self, convex_settings):
        respx.post(f"{CONVEX_URL}/api/query").mock(
            return_value=httpx.Response(
                200,
                json={
                    "value": {
                        "allowed": True,
                        "daily": {"pctUsed": 0.25},
                        "weekly": {"pctUsed": 0.1},
                    }
                },
            )
        )
        async with httpx.AsyncClient() as client:
            result = await check_user_budget(client, "user_1")
        assert result.allowed is True
        assert result.daily_pct == 0.25
        assert result.weekly_pct == 0.1

    @respx.mock
    async def test_returns_denied_when_over_budget(self, convex_settings):
        respx.post(f"{CONVEX_URL}/api/query").mock(
            return_value=httpx.Response(
                200,
                json={
                    "value": {
                        "allowed": False,
                        "daily": {"pctUsed": 1.2},
                        "weekly": {"pctUsed": 0.5},
                    }
                },
            )
        )
        async with httpx.AsyncClient() as client:
            result = await check_user_budget(client, "user_1")
        assert result.allowed is False
        assert result.daily_pct == 1.2

    @respx.mock
    async def test_fails_open_on_null_value(self, convex_settings):
        respx.post(f"{CONVEX_URL}/api/query").mock(
            return_value=httpx.Response(200, json={"value": None})
        )
        async with httpx.AsyncClient() as client:
            result = await check_user_budget(client, "user_1")
        assert result.allowed is True

    @respx.mock
    async def test_fails_open_on_http_error(self, convex_settings):
        respx.post(f"{CONVEX_URL}/api/query").mock(
            return_value=httpx.Response(500, text="boom")
        )
        async with httpx.AsyncClient() as client:
            result = await check_user_budget(client, "user_1")
        assert result.allowed is True

    @respx.mock
    async def test_fails_open_on_network_error(self, convex_settings):
        respx.post(f"{CONVEX_URL}/api/query").mock(
            side_effect=httpx.ConnectError("down")
        )
        async with httpx.AsyncClient() as client:
            result = await check_user_budget(client, "user_1")
        assert result.allowed is True

    @respx.mock
    async def test_sends_correct_payload(self, convex_settings):
        route = respx.post(f"{CONVEX_URL}/api/query").mock(
            return_value=httpx.Response(
                200,
                json={
                    "value": {
                        "allowed": True,
                        "daily": {"pctUsed": 0},
                        "weekly": {"pctUsed": 0},
                    }
                },
            )
        )
        async with httpx.AsyncClient() as client:
            await check_user_budget(client, "user_1")
        import json as _json
        body = _json.loads(route.calls.last.request.content)
        assert body["path"] == "usage:checkBudget"
        assert body["args"]["userId"] == "user_1"
        assert "day" in body["args"] and "week" in body["args"]


class TestRecordUsage:
    async def test_skips_when_cost_missing(self, convex_settings):
        async with httpx.AsyncClient() as client:
            await record_usage(
                client, "u1", "c1", None, None, "gpt-4o",
                {"prompt_tokens": 100, "completion_tokens": 50},
            )
        # no exception — cost absent means noop

    async def test_skips_when_not_configured(self, no_convex_settings):
        async with httpx.AsyncClient() as client:
            await record_usage(
                client, "u1", "c1", None, None, "gpt-4o",
                {"cost": 0.01},
            )

    @respx.mock
    async def test_posts_usage_with_harness_metadata(self, convex_settings):
        route = respx.post(f"{CONVEX_URL}/api/mutation").mock(
            return_value=httpx.Response(200, json={"value": None})
        )
        async with httpx.AsyncClient() as client:
            await record_usage(
                client, "u1", "c1", "h1", "My Harness", "gpt-4o",
                {
                    "cost": 0.0123,
                    "prompt_tokens": 100,
                    "completion_tokens": 50,
                    "total_tokens": 150,
                },
            )
        import json as _json
        body = _json.loads(route.calls.last.request.content)
        assert body["path"] == "usage:recordUsage"
        assert body["args"]["userId"] == "u1"
        assert body["args"]["conversationId"] == "c1"
        assert body["args"]["harnessId"] == "h1"
        assert body["args"]["harnessName"] == "My Harness"
        assert body["args"]["cost"] == 0.0123
        assert body["args"]["totalTokens"] == 150

    @respx.mock
    async def test_omits_harness_fields_when_none(self, convex_settings):
        route = respx.post(f"{CONVEX_URL}/api/mutation").mock(
            return_value=httpx.Response(200, json={"value": None})
        )
        async with httpx.AsyncClient() as client:
            await record_usage(
                client, "u1", "c1", None, None, "gpt-4o",
                {"cost": 0.001},
            )
        import json as _json
        body = _json.loads(route.calls.last.request.content)
        assert "harnessId" not in body["args"]
        assert "harnessName" not in body["args"]

    @respx.mock
    async def test_swallows_http_errors(self, convex_settings):
        respx.post(f"{CONVEX_URL}/api/mutation").mock(
            return_value=httpx.Response(500, text="nope")
        )
        async with httpx.AsyncClient() as client:
            await record_usage(
                client, "u1", "c1", None, None, "gpt-4o",
                {"cost": 0.001},
            )
        # no exception propagates
