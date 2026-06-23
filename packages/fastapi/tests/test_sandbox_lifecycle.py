"""Persistent-sandbox lifecycle: Daytona auto-deletes abandoned ACP boxes
(the source-level bound that stops archived boxes piling up), and a provision
that attaches a box Daytona has since reclaimed self-heals instead of erroring.

Covers daytona_runtime._auto_delete_minutes (which grace period a new box gets)
and AgentSessionManager._recover_from_missing_attach / _unlink_dead_sandbox
(the heal when an attached box is gone from Daytona but still linked in Convex).
"""

import app.services.convex as convex_mod
from app.config import settings
from app.models import HarnessConfig
from app.services.agents.daytona_runtime import _auto_delete_minutes
from app.services.agents.session_manager import (
    AgentSession,
    AgentSessionManager,
)


def _session(harness: HarnessConfig) -> AgentSession:
    return AgentSession(
        id="s1", user_id="u1", agent_id="claude-code",
        harness=harness, conversation_id="c1",
    )


class TestAutoDeleteMinutes:
    def test_persistent_gets_long_grace(self):
        assert (
            _auto_delete_minutes(persist=True)
            == settings.acp_persistent_sandbox_auto_delete_minutes
        )

    def test_scratch_reclaimed_quickly(self):
        assert (
            _auto_delete_minutes(persist=False)
            == settings.acp_scratch_sandbox_auto_delete_minutes
        )

    def test_scratch_strictly_shorter_than_persistent(self):
        # A scratch box holds nothing durable, so it must be reclaimed sooner
        # than a workspace box that holds the user's files.
        assert _auto_delete_minutes(False) < _auto_delete_minutes(True)

    def test_non_positive_clamps_to_disabled(self, monkeypatch):
        # Daytona reads 0 as "delete immediately on stop" — a mis-set 0 must
        # mean "off" (-1), never instant deletion of a workspace box.
        monkeypatch.setattr(
            settings, "acp_persistent_sandbox_auto_delete_minutes", 0,
        )
        monkeypatch.setattr(
            settings, "acp_scratch_sandbox_auto_delete_minutes", -5,
        )
        assert _auto_delete_minutes(persist=True) == -1
        assert _auto_delete_minutes(persist=False) == -1


class TestRecoverFromMissingAttach:
    async def test_workspace_box_unlinks_and_recovers(self, monkeypatch):
        mgr = AgentSessionManager()
        monkeypatch.setattr(mgr, "_http_client", lambda: None)
        unlinked: list[str] = []

        async def fake_unlink(daytona_id):
            unlinked.append(daytona_id)

        monkeypatch.setattr(mgr, "_unlink_dead_sandbox", fake_unlink)
        # A workspace-unification attach: no explicit harness sandbox.
        h = HarnessConfig(
            model="x", name="h", agent="claude-code", workspace_id="ws1",
        )
        recover = await mgr._recover_from_missing_attach(_session(h), "dt-ws")
        assert recover is True  # caller creates a fresh persistent box
        assert unlinked == ["dt-ws"]  # stale Convex link dropped

    async def test_explicit_harness_sandbox_unlinks_but_surfaces(self, monkeypatch):
        mgr = AgentSessionManager()
        monkeypatch.setattr(mgr, "_http_client", lambda: None)
        unlinked: list[str] = []

        async def fake_unlink(daytona_id):
            unlinked.append(daytona_id)

        monkeypatch.setattr(mgr, "_unlink_dead_sandbox", fake_unlink)
        # The user explicitly pointed this harness at a sandbox.
        h = HarnessConfig(
            model="x", name="h", agent="claude-code",
            sandbox_enabled=True, sandbox_id="dt-explicit", workspace_id="ws1",
        )
        recover = await mgr._recover_from_missing_attach(
            _session(h), "dt-explicit",
        )
        # Can't fabricate the user's chosen box → surface (caller re-raises),
        # but the dead link is still cleared so the next session won't re-attach.
        assert recover is False
        assert unlinked == ["dt-explicit"]

    async def test_explicit_sandbox_id_mismatch_treated_as_workspace(
        self, monkeypatch,
    ):
        # An explicit sandbox is only "explicit" for ITS id; a workspace box on
        # the same harness (different id) still recovers transparently.
        mgr = AgentSessionManager()
        monkeypatch.setattr(mgr, "_http_client", lambda: None)

        async def fake_unlink(_daytona_id):
            return None

        monkeypatch.setattr(mgr, "_unlink_dead_sandbox", fake_unlink)
        h = HarnessConfig(
            model="x", name="h", agent="claude-code",
            sandbox_enabled=True, sandbox_id="dt-explicit", workspace_id="ws1",
        )
        assert await mgr._recover_from_missing_attach(_session(h), "dt-ws") is True


class TestUnlinkDeadSandbox:
    async def test_calls_remove_by_daytona_id(self, monkeypatch):
        mgr = AgentSessionManager()
        monkeypatch.setattr(mgr, "_http_client", lambda: None)
        calls: list[tuple] = []

        async def fake_mutation(_client, path, args):
            calls.append((path, args))

        monkeypatch.setattr(convex_mod, "run_convex_mutation", fake_mutation)
        await mgr._unlink_dead_sandbox("dt-gone")
        assert calls == [
            ("sandboxes:removeByDaytonaId", {"daytonaSandboxId": "dt-gone"}),
        ]

    async def test_swallows_convex_error(self, monkeypatch):
        # A Convex hiccup must not abort the recovery (a fresh box is created
        # regardless), so the unlink swallows ConvexMutationError.
        mgr = AgentSessionManager()
        monkeypatch.setattr(mgr, "_http_client", lambda: None)

        async def boom(_client, _path, _args):
            raise convex_mod.ConvexMutationError("convex down")

        monkeypatch.setattr(convex_mod, "run_convex_mutation", boom)
        await mgr._unlink_dead_sandbox("dt-gone")  # must not raise
