"""Regression coverage for Claude Code "bypassPermissions" mode.

claude-agent-acp only advertises/accepts the bypassPermissions mode when
ALLOW_BYPASS = !IS_ROOT || !!process.env.IS_SANDBOX is true. Our Daytona
sandboxes run the wrapper as root, so the wrapper must inherit IS_SANDBOX=1
from its launch environment — otherwise set_config_option(mode,
bypassPermissions) throws and surfaces as JSON-RPC -32603 in the UI.
"""

from app.services.agents.daytona_runtime import _build_launcher
from app.services.agents.registry import get_agent


class TestBypassPermissionsEnv:
    def test_claude_code_agent_carries_is_sandbox(self):
        agent = get_agent("claude-code")
        assert agent.env.get("IS_SANDBOX") == "1"

    def test_launcher_exports_is_sandbox_for_claude_code(self):
        # The wrapper reads process.env.IS_SANDBOX; the launcher exports
        # agent.env, the nohup'd shim inherits it, and spawns the agent with
        # env: process.env — so this exported line is what unlocks the mode.
        script = _build_launcher(get_agent("claude-code"), "tok")
        assert "export IS_SANDBOX=1" in script

    def test_is_sandbox_is_claude_specific(self):
        # IS_SANDBOX is a Claude Agent SDK flag; other agents must not inherit
        # it (defense against scope creep, not a functional requirement).
        assert "IS_SANDBOX" not in get_agent("codex").env
        assert "IS_SANDBOX" not in get_agent("cursor").env
        assert "export IS_SANDBOX" not in _build_launcher(get_agent("codex"), "t")
