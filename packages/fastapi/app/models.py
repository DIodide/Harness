from typing import Any, Literal

from pydantic import BaseModel, Field


class McpServer(BaseModel):
    name: str
    url: str
    auth_type: Literal["none", "bearer", "oauth", "tiger_junction"] = "none"
    auth_token: str | None = None


class SkillRef(BaseModel):
    name: str
    description: str = ""


class SandboxConfig(BaseModel):
    persistent: bool = False
    auto_start: bool = True
    default_language: str = "python"
    resource_tier: Literal["basic", "standard", "performance"] = "basic"
    snapshot_id: str | None = None
    git_repo: str | None = None
    network_restricted: bool | None = None


class HarnessConfig(BaseModel):
    model: str
    mcp_servers: list[McpServer] = []
    skills: list[SkillRef] = []
    name: str
    harness_id: str | None = None
    system_prompt: str | None = Field(default=None, max_length=4000)
    # Agent loop: "default" (Harness via OpenRouter) or an ACP agent id.
    agent: str | None = None
    # The stored credential this harness's agent runs with.
    agent_credential_id: str | None = None
    # Persisted ACP session defaults (Claude Code et al), seeded into a new
    # session; applied only if the wrapper offers the value. The agent MODEL
    # reuses `model` above.
    agent_mode: str | None = None
    reasoning_effort: str | None = None
    sandbox_enabled: bool = False
    sandbox_id: str | None = None
    sandbox_config: SandboxConfig | None = None


class MessagePayload(BaseModel):
    role: str
    content: Any  # str for text-only, list[dict] for multimodal


class ChatRequest(BaseModel):
    messages: list[MessagePayload]
    # Required for the owner's own run; omitted by an editor-grant collaborator
    # (they don't have it — the server resolves the owner's harness). The route
    # enforces presence for the owner path.
    harness: HarnessConfig | None = None
    conversation_id: str
    forced_tool: str | None = None
    # Editor-grant collaboration: the share link the (signed-in) collaborator
    # arrived through. When present and the caller is an editor (not the owner),
    # the server IGNORES `harness` and resolves the owner's harness server-side,
    # billing the owner. Absent/owner → the caller's own harness is used.
    token: str | None = None


def harness_config_from_resolved(resolved: dict) -> "HarnessConfig":
    """Build a HarnessConfig from harnesses:resolveForCollab output (the owner's
    harness, fetched server-side for a collaborator's turn). Never built from
    untrusted client input — `resolved` comes from Convex via the deploy key."""
    sc = resolved.get("sandboxConfig")
    sandbox_config = (
        SandboxConfig(
            persistent=sc.get("persistent", False),
            auto_start=sc.get("autoStart", True),
            default_language=sc.get("defaultLanguage", "python"),
            resource_tier=sc.get("resourceTier", "basic"),
            snapshot_id=sc.get("snapshotId"),
            git_repo=sc.get("gitRepo"),
            network_restricted=sc.get("networkRestricted"),
        )
        if sc
        else None
    )
    return HarnessConfig(
        name=resolved.get("name") or "Shared",
        model=resolved["model"],
        system_prompt=resolved.get("systemPrompt"),
        skills=[
            SkillRef(name=s["name"], description=s.get("description", ""))
            for s in resolved.get("skills", [])
        ],
        mcp_servers=[
            McpServer(
                name=s["name"],
                url=s["url"],
                auth_type=s.get("authType", "none"),
                auth_token=s.get("authToken"),
            )
            for s in resolved.get("mcpServers", [])
        ],
        agent=resolved.get("agent"),
        agent_credential_id=resolved.get("agentCredentialId"),
        agent_mode=resolved.get("agentMode"),
        reasoning_effort=resolved.get("reasoningEffort"),
        harness_id=resolved.get("harnessId"),
        sandbox_enabled=resolved.get("sandboxEnabled", False),
        sandbox_id=resolved.get("sandboxId"),
        sandbox_config=sandbox_config,
    )


class SandboxCreateRequest(BaseModel):
    harness_id: str | None = None
    name: str = "sandbox"
    language: str = "python"
    resource_tier: Literal["basic", "standard", "performance"] = "basic"
    ephemeral: bool = True
    git_repo: str | None = None


class SandboxExecuteRequest(BaseModel):
    code: str
    language: Literal["python", "javascript", "typescript", "bash"] = "python"
    timeout: int = Field(default=30, gt=0, le=300)


class SandboxCommandRequest(BaseModel):
    command: str
    working_directory: str = "/home/daytona"
    timeout: int = Field(default=60, gt=0, le=300)


class SandboxFileWriteRequest(BaseModel):
    path: str
    content: str


class SandboxFileMoveRequest(BaseModel):
    source: str
    destination: str


class SandboxMkdirRequest(BaseModel):
    path: str


class GitAddRequest(BaseModel):
    path: str = "/home/daytona"
    files: list[str] = ["."]


class GitCommitRequest(BaseModel):
    path: str = "/home/daytona"
    message: str


class CommandListRequest(BaseModel):
    mcp_servers: list[McpServer] = []


# ── ACP agent gateway ──────────────────────────────────────


class AgentSessionCreateRequest(BaseModel):
    agent: str  # registry id: "codex" | "claude-code"
    # Optional for editor-grant collaboration: a collaborator does not have the
    # owner's harness, so they send `token` and the server resolves the owner's
    # harness. The owner's own create still sends a harness.
    harness: HarnessConfig | None = None
    conversation_id: str
    token: str | None = None


class AgentPromptRequest(BaseModel):
    message: str
    # Prior conversation messages (text-only), used to seed the agent's
    # context when a session is created mid-conversation.
    history: list[MessagePayload] | None = None
    # Extra ACP content blocks for this message — image attachments as
    # {type: "image", data: <base64>, mimeType: "image/..."}.
    blocks: list[dict] | None = None
    # Per-turn reasoning-effort override (used by editor collaborators, who
    # can't persist the owner's sticky session config). Applied for THIS turn
    # only and restored after. The agent rejects unknown values.
    effort_config_id: str | None = None
    effort_value: str | None = None


class AgentQueuePromptRequest(BaseModel):
    message: str


class AgentConfigOptionRequest(BaseModel):
    config_id: str  # e.g. "model", "mode", "effort"
    value: str


class AgentPermissionAnswer(BaseModel):
    request_id: str
    option_id: str | None = None
    cancelled: bool = False


class AgentQuestionAnswer(BaseModel):
    """Answer to an agent question (ACP form elicitation / AskUserQuestion).

    accept carries the per-field answers; decline means "skipped" (the turn
    continues); cancel aborts the asking tool call.
    """

    request_id: str
    action: Literal["accept", "decline", "cancel"]
    content: dict | None = None


class AgentSwitchHarnessRequest(BaseModel):
    harness: HarnessConfig


class AgentCredentialStoreRequest(BaseModel):
    agent: str  # "codex" | "claude-code" | "cursor"
    kind: Literal["auth_json", "api_key", "oauth_token"]
    value: str  # plaintext secret; encrypted server-side, never echoed back
    label: str | None = Field(default=None, max_length=80)
    # Replace this existing credential's secret instead of creating a new one.
    credential_id: str | None = None


