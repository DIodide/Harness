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
