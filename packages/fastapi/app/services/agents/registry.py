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


AGENT_REGISTRY: dict[str, AgentDefinition] = {
    "codex": AgentDefinition(
        id="codex",
        name="Codex CLI",
        command=["/usr/local/bin/codex-acp"],
        env={"CODEX_HOME": f"{SANDBOX_HOME}/.codex"},
    ),
    "claude-code": AgentDefinition(
        id="claude-code",
        name="Claude Code",
        command=["/usr/local/bin/claude-agent-acp"],
        env={},
    ),
}


class AgentCredentialsError(Exception):
    """Raised when no usable credentials exist for an agent."""


def get_agent(agent_id: str) -> AgentDefinition:
    agent = AGENT_REGISTRY.get(agent_id)
    if agent is None:
        raise KeyError(f"Unknown agent '{agent_id}'")
    return agent
