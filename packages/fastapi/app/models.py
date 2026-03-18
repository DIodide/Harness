from typing import Literal

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


class AttachmentPayload(BaseModel):
    url: str
    mime_type: str
    file_name: str


class MessagePayload(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[MessagePayload]
    harness: HarnessConfig
    conversation_id: str
    attachments: list[AttachmentPayload] | None = None
