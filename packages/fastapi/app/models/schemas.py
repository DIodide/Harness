from pydantic import BaseModel


class ChatRequest(BaseModel):
    conversation_id: str
    harness_id: str
    model: str
    user_id: str


class ChatResponse(BaseModel):
    message_id: str
    status: str
