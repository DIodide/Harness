"""POST /api/harness-shares/claim — binds pending email invites to verified emails."""

from fastapi.testclient import TestClient

from app.dependencies import get_current_user
from app.main import app


def _as_user(uid: str):
    app.dependency_overrides[get_current_user] = lambda: {"sub": uid}


def _clear():
    app.dependency_overrides.pop(get_current_user, None)


def test_claim_binds_verified_emails(monkeypatch):
    async def fake_emails(http_client, user_id):
        assert user_id == "bob"
        return ["bob@x.com"]

    calls = []

    async def fake_mutation(http_client, path, args):
        calls.append((path, args))
        return {"bound": 2}

    monkeypatch.setattr("app.routes.harness_shares._verified_emails", fake_emails)
    monkeypatch.setattr("app.routes.harness_shares.run_convex_mutation", fake_mutation)
    _as_user("bob")
    try:
        with TestClient(app) as client:
            resp = client.post("/api/harness-shares/claim")
    finally:
        _clear()
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "bound": 2}
    assert calls == [
        (
            "harnessShares:bindHarnessGrantsInternal",
            {"userId": "bob", "verifiedEmails": ["bob@x.com"]},
        )
    ]


def test_claim_no_verified_emails_skips_mutation(monkeypatch):
    async def fake_emails(http_client, user_id):
        return []

    called = False

    async def fake_mutation(http_client, path, args):
        nonlocal called
        called = True
        return {"bound": 0}

    monkeypatch.setattr("app.routes.harness_shares._verified_emails", fake_emails)
    monkeypatch.setattr("app.routes.harness_shares.run_convex_mutation", fake_mutation)
    _as_user("bob")
    try:
        with TestClient(app) as client:
            resp = client.post("/api/harness-shares/claim")
    finally:
        _clear()
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "bound": 0}
    assert called is False  # no mutation when there's nothing to bind


def test_claim_transient_failure_reports_not_ok(monkeypatch):
    # _verified_emails returns None on a transient Clerk error → ok:false so the
    # client clears its once-per-session flag and retries next visit.
    async def fake_emails(http_client, user_id):
        return None

    called = False

    async def fake_mutation(http_client, path, args):
        nonlocal called
        called = True
        return {"bound": 0}

    monkeypatch.setattr("app.routes.harness_shares._verified_emails", fake_emails)
    monkeypatch.setattr("app.routes.harness_shares.run_convex_mutation", fake_mutation)
    _as_user("bob")
    try:
        with TestClient(app) as client:
            resp = client.post("/api/harness-shares/claim")
    finally:
        _clear()
    assert resp.status_code == 200
    assert resp.json() == {"ok": False, "bound": 0}
    assert called is False  # no bind attempted on a transient lookup failure


def test_claim_requires_auth():
    # No override → real get_current_user runs → no/invalid JWT → 401/403.
    with TestClient(app) as client:
        resp = client.post("/api/harness-shares/claim")
    assert resp.status_code in (401, 403)
