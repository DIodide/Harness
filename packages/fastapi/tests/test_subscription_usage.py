"""Subscription usage: parse Anthropic's unified rate-limit headers into the
multi-window snapshot the panel renders, and read them off a /v1/messages ping."""

import httpx
import respx

from app.services.usage import (
    _parse_unified_rate_limit_headers,
    fetch_subscription_usage,
)


def _headers(**overrides: str) -> httpx.Headers:
    base = {
        "anthropic-ratelimit-unified-5h-utilization": "0.06",
        "anthropic-ratelimit-unified-5h-status": "allowed",
        "anthropic-ratelimit-unified-5h-reset": "1782095400",
        "anthropic-ratelimit-unified-7d-utilization": "0.44",
        "anthropic-ratelimit-unified-7d-status": "allowed",
        "anthropic-ratelimit-unified-7d-reset": "1782226800",
        "anthropic-ratelimit-unified-7d_sonnet-utilization": "0.07",
        "anthropic-ratelimit-unified-7d_sonnet-status": "allowed",
        "anthropic-ratelimit-unified-7d_sonnet-reset": "1782226800",
    }
    base.update(overrides)
    return httpx.Headers(base)


def test_parses_all_three_windows():
    out = _parse_unified_rate_limit_headers(_headers())
    assert out == {
        "buckets": {
            "five_hour": {
                "utilization": 0.06,
                "status": "allowed",
                "resetsAt": 1782095400,
            },
            "seven_day": {
                "utilization": 0.44,
                "status": "allowed",
                "resetsAt": 1782226800,
            },
            "seven_day_sonnet": {
                "utilization": 0.07,
                "status": "allowed",
                "resetsAt": 1782226800,
            },
        }
    }


def test_no_unified_headers_returns_none():
    # An api-key credential's response has standard rate-limit headers but no
    # subscription windows — nothing to show.
    assert _parse_unified_rate_limit_headers(httpx.Headers({})) is None
    assert (
        _parse_unified_rate_limit_headers(
            httpx.Headers({"anthropic-ratelimit-requests-remaining": "100"})
        )
        is None
    )


def test_rejected_window_is_kept():
    out = _parse_unified_rate_limit_headers(
        _headers(**{"anthropic-ratelimit-unified-7d-status": "rejected"})
    )
    assert out["buckets"]["seven_day"]["status"] == "rejected"


def test_non_numeric_utilization_skipped():
    out = _parse_unified_rate_limit_headers(
        _headers(**{"anthropic-ratelimit-unified-5h-utilization": "n/a"})
    )
    assert "five_hour" not in out["buckets"]
    assert "seven_day" in out["buckets"]


@respx.mock
async def test_fetch_reads_headers_off_the_ping():
    respx.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(200, headers=dict(_headers()), json={"id": "x"})
    )
    async with httpx.AsyncClient() as client:
        out = await fetch_subscription_usage(client, "sk-ant-oat01-fake")
    assert out["buckets"]["five_hour"]["utilization"] == 0.06
    assert out["buckets"]["seven_day"]["utilization"] == 0.44


@respx.mock
async def test_fetch_reads_headers_even_on_429():
    # A maxed-out subscription returns 429 but still reports the windows.
    respx.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            429,
            headers=dict(
                _headers(**{"anthropic-ratelimit-unified-5h-status": "rejected"})
            ),
        )
    )
    async with httpx.AsyncClient() as client:
        out = await fetch_subscription_usage(client, "sk-ant-oat01-fake")
    assert out["buckets"]["five_hour"]["status"] == "rejected"


async def test_fetch_returns_none_on_network_error():
    # No respx route registered + a real client → connection error → None, never
    # raises into the turn.
    async with httpx.AsyncClient(transport=httpx.MockTransport(
        lambda req: (_ for _ in ()).throw(httpx.ConnectError("boom"))
    )) as client:
        assert await fetch_subscription_usage(client, "tok") is None
