from pydantic import BaseModel


class HarnessConfig(BaseModel):
    model: str
    mcps: list[str]
    name: str


class MessagePayload(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[MessagePayload]
    harness: HarnessConfig
    conversation_id: str
