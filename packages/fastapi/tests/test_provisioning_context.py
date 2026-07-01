"""ProvisioningContext bakes an agent session's credentials + workspace env +
skill-pack context behind one interface (prepare for create, reprepare for
revive). These tests pin the load-bearing invariants the consolidation must
preserve: the resolve->inject->attach ORDER, the fingerprint surfaced as a
first-class sibling (never folded into creds), resolve-error propagation vs.
best-effort inject/attach, and NO memoization (revive must re-resolve)."""

import pytest

import app.services.agents.session_manager as sm
from app.models import HarnessConfig
from app.services.agents.registry import (
    AgentCredentials,
    AgentCredentialsError,
    PreparedProvisioning,
)
from app.services.agents.session_manager import AgentSession, AgentSessionManager


def _harness(**over) -> HarnessConfig:
    kw = dict(
        model="claude-opus-4-8", name="h", agent="claude-code",
        harness_id="h1", agent_credential_id="cred-1",
    )
    kw.update(over)
    return HarnessConfig(**kw)


def _session(**over) -> AgentSession:
    kw = dict(
        id="s1", user_id="u1", agent_id="claude-code",
        harness=_harness(), conversation_id="c1",
    )
    kw.update(over)
    return AgentSession(**kw)


def _stub_mgr(monkeypatch, *, creds=None, ws_version="", resolve_error=None):
    """A manager with its three provisioning dependencies stubbed; records the
    args each received so ordering/threading can be asserted."""
    mgr = AgentSessionManager()
    monkeypatch.setattr(mgr, "_http_client", lambda: object())
    calls: dict[str, list] = {"resolve": [], "inject": [], "attach": [], "order": []}

    async def fake_resolve(_http, agent_id, user_id, credential_id=None):
        calls["resolve"].append((agent_id, user_id, credential_id))
        calls["order"].append("resolve")
        if resolve_error is not None:
            raise resolve_error
        return creds if creds is not None else AgentCredentials()

    async def fake_inject(c, harness, user_id):
        calls["inject"].append((c, user_id))
        calls["order"].append("inject")
        return ws_version

    async def fake_attach(c, harness, agent_id, user_id):
        calls["attach"].append((c, agent_id, user_id))
        calls["order"].append("attach")

    monkeypatch.setattr(sm, "resolve_agent_credentials", fake_resolve)
    monkeypatch.setattr(mgr, "_inject_workspace_env", fake_inject)
    monkeypatch.setattr(mgr, "_attach_skill_pack_context", fake_attach)
    return mgr, calls


class TestPrepare:
    async def test_returns_creds_and_fingerprint_as_siblings(self, monkeypatch):
        c = AgentCredentials(env={"CLAUDE_CODE_OAUTH_TOKEN": "tok"})
        mgr, _ = _stub_mgr(monkeypatch, creds=c, ws_version="fp-123")
        prepared = await mgr._provisioning.prepare("u1", _harness(), "claude-code")
        assert isinstance(prepared, PreparedProvisioning)
        # The exact creds object flows through; the fingerprint is a separate
        # field, NOT folded into creds — that's what guards _claim_parked.
        assert prepared.creds is c
        assert prepared.workspace_env_version == "fp-123"

    async def test_order_is_resolve_inject_attach(self, monkeypatch):
        mgr, calls = _stub_mgr(monkeypatch)
        await mgr._provisioning.prepare("u1", _harness(), "claude-code")
        assert calls["order"] == ["resolve", "inject", "attach"]

    async def test_threads_credential_id_and_raw_agent_id(self, monkeypatch):
        mgr, calls = _stub_mgr(monkeypatch)
        await mgr._provisioning.prepare(
            "u1", _harness(agent_credential_id="cred-x"), "codex",
        )
        assert calls["resolve"] == [("codex", "u1", "cred-x")]
        # inject mutates the same creds; attach receives the raw agent_id.
        assert calls["attach"][0][1] == "codex"
        assert calls["inject"][0][0] is calls["attach"][0][0]

    async def test_resolve_error_propagates_and_short_circuits(self, monkeypatch):
        mgr, calls = _stub_mgr(
            monkeypatch, resolve_error=AgentCredentialsError("nope"),
        )
        with pytest.raises(AgentCredentialsError):
            await mgr._provisioning.prepare("u1", _harness(), "claude-code")
        # resolve is the only raising step — inject/attach never run.
        assert calls["inject"] == []
        assert calls["attach"] == []

    async def test_best_effort_inject_attach_do_not_break_prepare(self, monkeypatch):
        # inject/attach degrade internally (return ""/None) — prepare must still
        # return usable creds so a Convex/GitHub hiccup never blocks a session.
        mgr, _ = _stub_mgr(monkeypatch, ws_version="")
        prepared = await mgr._provisioning.prepare("u1", _harness(), "claude-code")
        assert prepared.workspace_env_version == ""
        assert isinstance(prepared.creds, AgentCredentials)


class TestReprepare:
    async def test_reads_ids_off_the_session(self, monkeypatch):
        mgr, calls = _stub_mgr(monkeypatch, ws_version="fp")
        s = _session(
            user_id="uZ", agent_id="codex",
            harness=_harness(agent="codex", agent_credential_id="cred-Z"),
        )
        prepared = await mgr._provisioning.reprepare(s)
        assert prepared.workspace_env_version == "fp"
        assert calls["resolve"] == [("codex", "uZ", "cred-Z")]

    async def test_not_memoized_picks_up_latest_credentials(self, monkeypatch):
        # The revocation seam: a second revive must reflect the LATEST resolve
        # (a rotated/revoked token), never a cached PreparedProvisioning.
        tokens = iter(["t1", "t2"])
        mgr = AgentSessionManager()
        monkeypatch.setattr(mgr, "_http_client", lambda: object())

        async def fake_resolve(*_a, **_k):
            return AgentCredentials(env={"CLAUDE_CODE_OAUTH_TOKEN": next(tokens)})

        async def fake_inject(*_a, **_k):
            return ""

        async def fake_attach(*_a, **_k):
            return None

        monkeypatch.setattr(sm, "resolve_agent_credentials", fake_resolve)
        monkeypatch.setattr(mgr, "_inject_workspace_env", fake_inject)
        monkeypatch.setattr(mgr, "_attach_skill_pack_context", fake_attach)

        s = _session()
        first = await mgr._provisioning.reprepare(s)
        second = await mgr._provisioning.reprepare(s)
        assert first.creds.env["CLAUDE_CODE_OAUTH_TOKEN"] == "t1"
        assert second.creds.env["CLAUDE_CODE_OAUTH_TOKEN"] == "t2"

    async def test_prepare_and_reprepare_share_one_body(self, monkeypatch):
        # Both faces delegate to _prepare — same inputs yield the same shape,
        # so the two call sites (create / _revive) can never drift.
        mgr, calls = _stub_mgr(monkeypatch, ws_version="fp")
        s = _session(user_id="u9", harness=_harness(agent_credential_id="cred-9"))
        await mgr._provisioning.prepare("u9", s.harness, "claude-code")
        await mgr._provisioning.reprepare(s)
        assert calls["resolve"] == [
            ("claude-code", "u9", "cred-9"),
            ("claude-code", "u9", "cred-9"),
        ]
