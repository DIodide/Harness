"""Authorization guards on the live-follow SSE endpoint.

The streaming fan-out itself is covered by test_stream_bus_integration; here we
pin the security-critical, deterministic auth behavior of GET /api/chat/follow
(which otherwise opens a long-lived SSE we don't want to consume in a unit test).
"""

from fastapi.testclient import TestClient

from app.main import app


def test_follow_anonymous_without_token_is_forbidden():
    # No JWT and no share token → must 403 before any access check (never reach
    # the Convex dev fail-open).
    with TestClient(app) as client:
        resp = client.get("/api/chat/follow?conversation_id=c1")
    assert resp.status_code == 403


def test_follow_invalid_bearer_without_token_is_forbidden():
    # An unverifiable bearer resolves to anonymous (optional auth swallows it);
    # with no share token it is still forbidden.
    with TestClient(app) as client:
        resp = client.get(
            "/api/chat/follow?conversation_id=c1",
            headers={"Authorization": "Bearer not.a.real.jwt"},
        )
    assert resp.status_code == 403


def test_follow_authorized_relays_frames_as_sse(monkeypatch):
    """An authorized viewer (token grant) gets 200 text/event-stream and the
    bus frames are relayed verbatim. Uses a finite fake feed so the SSE closes;
    the real Redis follow() is covered by test_stream_bus_integration."""

    async def fake_access(http_client, conversation_id, user_id, token):
        return "viewer"

    async def fake_follow(conversation_id):
        yield {"event": "turn_start", "data": "{}"}
        yield {"event": "token", "data": '{"content":"hi"}'}
        yield {"event": "done", "data": "{}"}

    monkeypatch.setattr("app.routes.chat.verify_conversation_access", fake_access)
    monkeypatch.setattr("app.routes.chat.stream_bus.follow", fake_follow)

    with TestClient(app) as client:
        resp = client.get("/api/chat/follow?conversation_id=c1&token=shr_x")

    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    body = resp.text
    assert "event: turn_start" in body
    assert "event: token" in body and '"content":"hi"' in body
    assert "event: done" in body
