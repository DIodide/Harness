import logging

from pydantic import Field
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    openrouter_api_key: str = Field(..., min_length=1)
    convex_url: str = ""
    convex_deploy_key: str = ""
    frontend_url: str = "http://localhost:3000"
    junction_engine_url: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    def validate_startup(self) -> None:
        """Validate that critical configuration is present. Call during app startup."""
        if not self.openrouter_api_key:
            raise RuntimeError("OPENROUTER_API_KEY is required but not set")
        if not self.junction_engine_url:
            logger.warning("JUNCTION_ENGINE_URL is not set — MCP tools will be unavailable")
        if not self.convex_url:
            logger.warning("CONVEX_URL is not set")
        if not self.convex_deploy_key:
            logger.warning("CONVEX_DEPLOY_KEY is not set — backend cannot save messages to Convex")


settings = Settings()


AVAILABLE_MODELS = [
    {"id": "openai/gpt-4o", "name": "GPT-4o"},
    {"id": "anthropic/claude-sonnet-4", "name": "Claude Sonnet 4"},
    {"id": "google/gemini-2.5-pro-preview-06-05", "name": "Gemini 2.5 Pro"},
    {"id": "openai/gpt-4.1-mini", "name": "GPT-4.1 Mini"},
    {"id": "x-ai/grok-3", "name": "Grok 3"},
    {"id": "x-ai/grok-3-mini", "name": "Grok 3 Mini"},
]

# Maps short model names (stored in harness.model) to full OpenRouter model IDs
MODEL_MAP = {
    "gpt-4o": "openai/gpt-4o",
    "claude-sonnet-4": "anthropic/claude-sonnet-4",
    "claude-opus-4": "anthropic/claude-opus-4",
    "gemini-2.5-pro": "google/gemini-2.5-pro-preview-06-05",
    "gpt-4.1-mini": "openai/gpt-4.1-mini",
    "grok-3": "x-ai/grok-3",
    "grok-3-mini": "x-ai/grok-3-mini",
}
