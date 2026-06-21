"""Per-workspace agent-sandbox unification: the ACP gateway should attach an
agent to the workspace's sandbox (or create+link a persistent one) rather than
spinning a separate session-owned box.

Covers AgentSessionManager._resolve_sandbox_plan (which sandbox a session uses)
and _register_workspace_sandbox (link-back + orphan-avoidance on failure)."""

import app.services.convex as convex_mod
from app.models import HarnessConfig
from app.services.agents.daytona_runtime import ProvisionedRuntime
from app.services.agents.session_manager import (
    AgentSession,
    AgentSessionManager,
)


def _session(harness: HarnessConfig, **over) -> AgentSession:
    kwargs = dict(
        id="s1", user_id="u1", agent_id="claude-code",
        harness=harness, conversation_id="c1",
    )
    kwargs.update(over)
    return AgentSession(**kwargs)


def _mock_convex(monkeypatch, *, ws_sandbox=None, owner_ok=True):
    async def fake_resolve(_client, _workspace_id):
        return ws_sandbox

    async def fake_verify(_daytona_id, _user_id):
        return owner_ok

    monkeypatch.setattr(convex_mod, "resolve_workspace_sandbox", fake_resolve)
    monkeypatch.setattr(convex_mod, "verify_sandbox_owner", fake_verify)


class TestResolveSandboxPlan:
    async def test_explicit_harness_sandbox_attaches(self, monkeypatch):
        mgr = AgentSessionManager()
        monkeypatch.setattr(mgr, "_http_client", lambda: None)
        h = HarnessConfig(
            model="x", name="h", agent="claude-code",
            sandbox_enabled=True, sandbox_id="dt-explicit", workspace_id="ws1",
        )
        # Explicit harness sandbox wins without touching Convex.
        assert await mgr._resolve_sandbox_plan(_session(h)) == ("dt-explicit", False)

    async def test_no_workspace_keeps_session_sandbox(self, monkeypatch):
        mgr = AgentSessionManager()
        monkeypatch.setattr(mgr, "_http_client", lambda: None)
        h = HarnessConfig(model="x", name="h", agent="claude-code")
        assert await mgr._resolve_sandbox_plan(_session(h)) == (None, False)

    async def test_workspace_with_sandbox_attaches(self, monkeypatch):
        mgr = AgentSessionManager()
        monkeypatch.setattr(mgr, "_http_client", lambda: None)
        _mock_convex(
            monkeypatch,
            ws_sandbox={"daytonaSandboxId": "dt-ws", "status": "running"},
            owner_ok=True,
        )
        h = HarnessConfig(
            model="x", name="h", agent="claude-code", workspace_id="ws1",
        )
        assert await mgr._resolve_sandbox_plan(_session(h)) == ("dt-ws", False)

    async def test_workspace_sandbox_not_owned_creates_fresh(self, monkeypatch):
        mgr = AgentSessionManager()
        monkeypatch.setattr(mgr, "_http_client", lambda: None)
        _mock_convex(
            monkeypatch,
            ws_sandbox={"daytonaSandboxId": "dt-foreign", "status": "running"},
            owner_ok=False,
        )
        h = HarnessConfig(
            model="x", name="h", agent="claude-code", workspace_id="ws1",
        )
        # Stale/foreign link → create a new unified sandbox.
        assert await mgr._resolve_sandbox_plan(_session(h)) == (None, True)

    async def test_workspace_without_sandbox_creates_persistent(self, monkeypatch):
        mgr = AgentSessionManager()
        monkeypatch.setattr(mgr, "_http_client", lambda: None)
        _mock_convex(monkeypatch, ws_sandbox=None)
        h = HarnessConfig(
            model="x", name="h", agent="claude-code", workspace_id="ws1",
        )
        assert await mgr._resolve_sandbox_plan(_session(h)) == (None, True)


class _Agent:
    name = "Claude Code"


def _owned_runtime() -> ProvisionedRuntime:
    # A freshly-created persistent box is OWNED until Convex confirms the link.
    return ProvisionedRuntime(
        sandbox_id="dt-new", base_url="", headers={}, owns_sandbox=True,
    )


class TestRegisterWorkspaceSandbox:
    async def test_links_and_persists_on_success(self, monkeypatch):
        mgr = AgentSessionManager()
        monkeypatch.setattr(mgr, "_http_client", lambda: None)
        captured = {}

        async def fake_create(_client, user_id, harness_id, daytona_id, name,
                              language, ephemeral, resources, workspace_id=None):
            captured.update(
                user_id=user_id, harness_id=harness_id, daytona_id=daytona_id,
                name=name, ephemeral=ephemeral, workspace_id=workspace_id,
            )
            return "sb_doc"

        monkeypatch.setattr(convex_mod, "create_sandbox_record", fake_create)
        h = HarnessConfig(
            model="x", name="My Harness", agent="claude-code",
            harness_id="harn1", workspace_id="ws1",
        )
        s = _session(h, runtime=_owned_runtime())
        await mgr._register_workspace_sandbox(s, _Agent())

        assert captured["name"] == "Claude Code · My Harness"
        assert captured["harness_id"] == "harn1"
        assert captured["workspace_id"] == "ws1"
        assert captured["ephemeral"] is False
        # Linked → flips to persistent (survives teardown).
        assert s.runtime.owns_sandbox is False

    async def test_stays_owned_on_failure(self, monkeypatch):
        mgr = AgentSessionManager()
        monkeypatch.setattr(mgr, "_http_client", lambda: None)

        async def boom(*_a, **_k):
            raise RuntimeError("convex down")

        monkeypatch.setattr(convex_mod, "create_sandbox_record", boom)
        h = HarnessConfig(
            model="x", name="h", agent="claude-code",
            harness_id="harn1", workspace_id="ws1",
        )
        s = _session(h, runtime=_owned_runtime())
        await mgr._register_workspace_sandbox(s, _Agent())
        # Not linked → stays owned so teardown reclaims the box (no orphan).
        assert s.runtime.owns_sandbox is True

    async def test_stays_owned_on_lost_race(self, monkeypatch):
        mgr = AgentSessionManager()
        monkeypatch.setattr(mgr, "_http_client", lambda: None)

        async def already_linked(*_a, **_k):
            return None  # createInternal declined: workspace already links one

        monkeypatch.setattr(convex_mod, "create_sandbox_record", already_linked)
        h = HarnessConfig(
            model="x", name="h", agent="claude-code",
            harness_id="harn1", workspace_id="ws1",
        )
        s = _session(h, runtime=_owned_runtime())
        await mgr._register_workspace_sandbox(s, _Agent())
        # Lost the race → reclaim the duplicate box on teardown.
        assert s.runtime.owns_sandbox is True
