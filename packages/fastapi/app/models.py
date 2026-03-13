from typing import Literal

from pydantic import BaseModel


class McpServer(BaseModel):
    name: str
    url: str
    auth_type: Literal["none", "bearer", "oauth"] = "none"
    auth_token: str | None = None


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
    name: str
    harness_id: str | None = None
    sandbox_enabled: bool = False
    sandbox_id: str | None = None
    sandbox_config: SandboxConfig | None = None


class MessagePayload(BaseModel):
    role: str
    content: str


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
    timeout: int = 30


class SandboxCommandRequest(BaseModel):
    command: str
    working_directory: str = "/home/daytona"
    timeout: int = 60


class SandboxFileWriteRequest(BaseModel):
    path: str
    content: str
