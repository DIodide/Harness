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
    sandbox_enabled: bool = False
    sandbox_id: str | None = None
    sandbox_config: SandboxConfig | None = None


class MessagePayload(BaseModel):
    role: str
    content: Any  # str for text-only, list[dict] for multimodal


class ChatRequest(BaseModel):
    messages: list[MessagePayload]
    harness: HarnessConfig
    conversation_id: str
    forced_tool: str | None = None


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
    harness: HarnessConfig
    conversation_id: str


class AgentPromptRequest(BaseModel):
    message: str
    # Prior conversation messages (text-only), used to seed the agent's
    # context when a session is created mid-conversation.
    history: list[MessagePayload] | None = None
    # Extra ACP content blocks for this message — image attachments as
    # {type: "image", data: <base64>, mimeType: "image/..."}.
    blocks: list[dict] | None = None


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


