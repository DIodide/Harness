"""Skill-pack context injection: the ACP gateway resolves a harness's skill
packs into sandbox context files (AGENTS.md / CLAUDE.md / ~/.claude/skills)."""

import app.services.convex as convex_mod
from app.models import HarnessConfig
from app.services.agents.registry import (
    HARNESS_MANAGED_MARKER,
    SANDBOX_HOME,
    AgentCredentials,
)
from app.services.agents.daytona_runtime import _prune_managed_context_command
from app.services.agents.session_manager import (
    AgentSessionManager,
    _skill_dir_slug,
)

AGENTS = f"{SANDBOX_HOME}/AGENTS.md"
CLAUDE = f"{SANDBOX_HOME}/CLAUDE.md"
M = HARNESS_MANAGED_MARKER


def _mock_resolve(monkeypatch, value):
    async def fake(_client, _user_id, _ids):
        return value

    monkeypatch.setattr(convex_mod, "resolve_skill_pack_context", fake)


async def _attach(monkeypatch, agent_id, value, pack_ids=("p1",), fetched=None):
    mgr = AgentSessionManager()
    monkeypatch.setattr(mgr, "_http_client", lambda: None)
    _mock_resolve(monkeypatch, value)

    # Mock the GitHub SKILL.md fallback so tests never hit the network.
    async def fake_fetch(_names):
        return fetched or {}

    monkeypatch.setattr(mgr, "_fetch_uncached_skill_md", fake_fetch)
    creds = AgentCredentials()
    harness = HarnessConfig(
        model="x", name="h", agent=agent_id, harness_id="h1",
        skill_pack_ids=list(pack_ids),
    )
    await mgr._attach_skill_pack_context(creds, harness, agent_id, "owner")
    return creds


class TestSkillDirSlug:
    def test_sanitizes_and_bounds(self):
        assert _skill_dir_slug("owner/repo/React Best-Practices") == "owner-repo-react-best-practices"
        assert _skill_dir_slug("Skill_A.v2") == "skill_a.v2"
        assert _skill_dir_slug("  ") == ""
        assert _skill_dir_slug(None) == ""
        # No path traversal: separators collapse to dashes, so the result is a
        # single literal dir name with no "/" and ".." alone is rejected.
        assert _skill_dir_slug("..") == ""
        assert "/" not in _skill_dir_slug("../../etc")
        assert _skill_dir_slug("../../etc") == "..-..-etc"


class TestAttachSkillPackContext:
    async def test_no_packs_writes_nothing(self, monkeypatch):
        mgr = AgentSessionManager()
        monkeypatch.setattr(mgr, "_http_client", lambda: None)
        creds = AgentCredentials()
        h = HarnessConfig(model="x", name="h", agent="claude-code")
        await mgr._attach_skill_pack_context(creds, h, "claude-code", "owner")
        assert creds.context_files == {}

    async def test_none_resolution_writes_nothing(self, monkeypatch):
        creds = await _attach(monkeypatch, "claude-code", None)
        assert creds.context_files == {}

    async def test_claude_full_context(self, monkeypatch):
        creds = await _attach(
            monkeypatch, "claude-code",
            {
                "agentsMd": "# Agents",
                "claudeMd": "# Claude",
                "claudeImportsAgents": True,
                "skills": [
                    {"name": "o/r/skill-a", "skillName": "skill-a", "detail": "A body"},
                    {"name": "o/r/skill-b", "skillName": "skill-b", "detail": ""},
                ],
            },
        )
        # Files carry the managed marker so a re-provision can prune them.
        assert creds.context_files[AGENTS] == f"{M}\n# Agents\n"
        # CLAUDE.md @-imports AGENTS.md, then the pack content.
        assert creds.context_files[CLAUDE] == f"{M}\n@AGENTS.md\n\n# Claude\n"
        # Skill with cached detail is materialized (+ a managed marker file);
        # the empty one is skipped.
        skill_a = f"{SANDBOX_HOME}/.claude/skills/skill-a"
        assert creds.context_files[f"{skill_a}/SKILL.md"] == "A body\n"
        assert creds.context_files[f"{skill_a}/.harness-managed"] == ""
        assert f"{SANDBOX_HOME}/.claude/skills/skill-b/SKILL.md" not in creds.context_files

    async def test_import_flag_without_agents_md_omits_prefix(self, monkeypatch):
        creds = await _attach(
            monkeypatch, "claude-code",
            {"agentsMd": "", "claudeMd": "# Claude", "claudeImportsAgents": True,
             "skills": []},
        )
        assert AGENTS not in creds.context_files
        assert creds.context_files[CLAUDE] == f"{M}\n# Claude\n"  # no @AGENTS.md

    async def test_codex_gets_agents_md_only(self, monkeypatch):
        creds = await _attach(
            monkeypatch, "codex",
            {"agentsMd": "# Agents", "claudeMd": "# Claude",
             "claudeImportsAgents": True,
             "skills": [{"name": "o/r/s", "skillName": "s", "detail": "body"}]},
        )
        # AGENTS.md for any agentic harness; CLAUDE.md + skills are Claude-only.
        assert creds.context_files == {AGENTS: f"{M}\n# Agents\n"}

    async def test_uncached_skill_materialized_via_github_fallback(self, monkeypatch):
        # A skill whose detail isn't cached is fetched from GitHub and written
        # (fixes the silent-skip race vs. the frontend's ensureSkillDetails).
        creds = await _attach(
            monkeypatch, "claude-code",
            {"agentsMd": "", "claudeMd": "",
             "skills": [{"name": "o/r/fresh", "skillName": "fresh", "detail": ""}]},
            fetched={"o/r/fresh": "# Fresh body"},
        )
        path = f"{SANDBOX_HOME}/.claude/skills/fresh/SKILL.md"
        assert creds.context_files[path] == "# Fresh body\n"

    async def test_same_skillname_different_repos_no_overwrite(self, monkeypatch):
        # Two skills with the same trailing id from different repos must NOT
        # collide on one dir (the second would silently overwrite the first).
        creds = await _attach(
            monkeypatch, "claude-code",
            {"agentsMd": "", "claudeMd": "", "skills": [
                {"name": "anthropics/skills/pdf", "skillName": "pdf", "detail": "A"},
                {"name": "other/repo/pdf", "skillName": "pdf", "detail": "B"},
            ]},
        )
        skill_mds = {
            k: v for k, v in creds.context_files.items() if k.endswith("/SKILL.md")
        }
        assert len(skill_mds) == 2  # two distinct dirs, no overwrite
        assert creds.context_files[f"{SANDBOX_HOME}/.claude/skills/pdf/SKILL.md"] == "A\n"

    async def test_backfill_is_capped(self, monkeypatch):
        import app.services.skill_content as sc

        mgr = AgentSessionManager()
        monkeypatch.setattr(mgr, "_http_client", lambda: None)
        seen: list[str] = []

        async def fake_md(_client, name):
            seen.append(name)
            return f"body-{name}"

        monkeypatch.setattr(sc, "fetch_skill_md", fake_md)
        out = await mgr._fetch_uncached_skill_md([f"o/r/s{i}" for i in range(30)])
        assert len(seen) == 20  # capped at 20
        assert len(out) == 20


class TestPruneCommand:
    def test_prunes_only_marked_context(self):
        cmd = _prune_managed_context_command()
        # Skill dirs deleted ONLY when they carry the managed marker file.
        assert ".harness-managed" in cmd
        assert "/.claude/skills" in cmd
        # AGENTS.md / CLAUDE.md removed ONLY when the first line is the sentinel,
        # so user-authored files survive.
        assert "head -1" in cmd
        assert HARNESS_MANAGED_MARKER in cmd
        assert "AGENTS.md" in cmd and "CLAUDE.md" in cmd
