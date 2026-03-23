from typing import Any, Literal

from pydantic import BaseModel


class McpServer(BaseModel):
    name: str
    url: str
    auth_type: Literal["none", "bearer", "oauth"] = "none"
    auth_token: str | None = None


class HarnessConfig(BaseModel):
    model: str
    mcp_servers: list[McpServer] = []
    name: str


class MessagePayload(BaseModel):
    role: str
    content: Any  # str for text-only, list[dict] for multimodal


class ChatRequest(BaseModel):
    messages: list[MessagePayload]
    harness: HarnessConfig
    conversation_id: str
