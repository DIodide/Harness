"""ACP agent registry.

Defines which external agents Harness can run and how to launch them inside
a Daytona sandbox. Launch specs follow the ACP registry
(https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json):

  - codex:       zed-industries/codex-acp prebuilt linux binary, baked into
                 the harness ACP snapshot at /usr/local/bin/codex-acp.
  - claude-code: @agentclientprotocol/claude-agent-acp, npm-installed
                 globally in the snapshot.

The "default" agent (Harness-provided chat loop via OpenRouter) is NOT in
this registry — it stays on /api/chat/stream.
"""

from dataclasses import dataclass, field

# Versions pinned from the ACP registry; bump together with the snapshot.
CODEX_ACP_VERSION = "0.16.0"
CLAUDE_AGENT_ACP_VERSION = "0.44.0"

CODEX_ACP_URL = (
    "https://github.com/zed-industries/codex-acp/releases/download/"
    f"v{CODEX_ACP_VERSION}/codex-acp-{CODEX_ACP_VERSION}-x86_64-unknown-linux-gnu.tar.gz"
)

SANDBOX_HOME = "/home/daytona"
SANDBOX_WORKSPACE = f"{SANDBOX_HOME}/workspace"


@dataclass
class AgentCredentials:
    """Materialized credentials for one agent run.

    files: absolute path inside the sandbox → file content.
    env:   extra environment variables for the agent process.
    """

    files: dict[str, str] = field(default_factory=dict)
    env: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class AgentDefinition:
    id: str
    name: str
    command: list[str]
    # Static env always set for this agent (credentials add to this).
    env: dict[str, str]
    # Offset on settings.acp_shim_port so multiple agents can run shims in
    # the same (attached harness) sandbox without port clashes.
    port_offset: int = 0
    # Models selectable for harnesses on this agent. Applied to live
    # sessions via the ACP "model" config option (best-effort — sessions
    # surface the authoritative list); the harness flow uses this statically.
    models: tuple[str, ...] = ()


AGENT_REGISTRY: dict[str, AgentDefinition] = {
    "codex": AgentDefinition(
        id="codex",
        name="Codex CLI",
        command=["/usr/local/bin/codex-acp"],
        # RUST_LOG=error: surface codex-acp failures on stderr (visible as
        # "[agent stderr]" in gateway logs) without info-level noise.
        env={"CODEX_HOME": f"{SANDBOX_HOME}/.codex", "RUST_LOG": "error"},
        port_offset=0,
        models=("gpt-5.5-codex", "gpt-5.5", "gpt-5.4-codex"),
    ),
    "claude-code": AgentDefinition(
        id="claude-code",
        name="Claude Code",
        # PATH lookup: npm global bin location depends on the node install
        # (/usr/bin with nodesource, /usr/local/bin with the official image).
        command=["claude-agent-acp"],
        env={},
        port_offset=1,
        # Mirrors settings.claude_available_models (written to the
        # sandbox's ~/.claude/settings.json availableModels).
        models=("claude-fable-5", "opus", "sonnet", "haiku"),
    ),
    "cursor": AgentDefinition(
        id="cursor",
        name="Cursor",
        # Installed by the snapshot via cursor.com/install; `acp` speaks
        # ACP over stdio (same adapter Zed/T3 use). `--force` auto-approves
        # MCP servers so file-configured servers load headlessly (Cursor
        # otherwise marks them "needs approval").
        command=["/usr/local/bin/cursor-agent", "--force", "acp"],
        env={},
        port_offset=2,
        models=("composer-2.5", "sonnet-4.6", "gpt-5.5"),
    ),
}


class AgentCredentialsError(Exception):
    """Raised when no usable credentials exist for an agent."""


def get_agent(agent_id: str) -> AgentDefinition:
    agent = AGENT_REGISTRY.get(agent_id)
    if agent is None:
        raise KeyError(f"Unknown agent '{agent_id}'")
    return agent
