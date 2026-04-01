import logging

from pydantic import Field
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    openrouter_api_key: str = Field(..., min_length=1)
    convex_url: str = ""
    convex_deploy_key: str = ""
    frontend_url: str = "http://localhost:3000"
    # Public base URL of the FastAPI backend, used for OAuth redirect URIs.
    fastapi_base_url: str = "http://localhost:8000"
    # Pre-registered GitHub OAuth App credentials (for GitHub MCP server).
    # Create one at https://github.com/settings/applications/new
    github_oauth_client_id: str = ""
    github_oauth_client_secret: str = ""
    # Daytona sandbox configuration
    daytona_api_key: str = ""
    daytona_api_url: str = "https://app.daytona.io/api"
    daytona_target: str = "us"

    # Pre-registered Slack OAuth App credentials (for Slack MCP server).
    # Create one at https://api.slack.com/apps
    slack_oauth_client_id: str = ""
    slack_oauth_client_secret: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    def validate_startup(self) -> None:
        """Validate that critical configuration is present. Call during app startup."""
        if not self.openrouter_api_key:
            raise RuntimeError("OPENROUTER_API_KEY is required but not set")
        if not self.convex_url:
            logger.warning("CONVEX_URL is not set")
        if not self.convex_deploy_key:
            logger.warning(
                "CONVEX_DEPLOY_KEY is not set — backend cannot save messages to Convex"
            )


settings = Settings()


AVAILABLE_MODELS = [
    {"id": "openai/gpt-4o", "name": "GPT-4o"},
    {"id": "openai/gpt-4.1", "name": "GPT-4.1"},
    {"id": "openai/gpt-4.1-mini", "name": "GPT-4.1 Mini"},
    {"id": "anthropic/claude-sonnet-4", "name": "Claude Sonnet 4"},
    {"id": "anthropic/claude-sonnet-4", "name": "Claude Sonnet 4 (Thinking)"},
    {"id": "anthropic/claude-opus-4", "name": "Claude Opus 4"},
    {"id": "anthropic/claude-opus-4", "name": "Claude Opus 4 (Thinking)"},
    {"id": "google/gemini-2.5-pro-preview-06-05", "name": "Gemini 2.5 Pro"},
    {"id": "google/gemini-2.5-flash", "name": "Gemini 2.5 Flash"},
    {"id": "deepseek/deepseek-r1", "name": "DeepSeek R1"},
    {"id": "deepseek/deepseek-chat", "name": "DeepSeek V3"},
    {"id": "x-ai/grok-3", "name": "Grok 3"},
    {"id": "x-ai/grok-3-mini", "name": "Grok 3 Mini"},
]

# Maps short model names (stored in harness.model) to full OpenRouter model IDs.
# Thinking variants use the same provider model but trigger the reasoning parameter.
MODEL_MAP = {
    "gpt-4o": "openai/gpt-4o",
    "gpt-4.1": "openai/gpt-4.1",
    "gpt-4.1-mini": "openai/gpt-4.1-mini",
    "claude-sonnet-4": "anthropic/claude-sonnet-4",
    "claude-sonnet-4-thinking": "anthropic/claude-sonnet-4",
    "claude-opus-4": "anthropic/claude-opus-4",
    "claude-opus-4-thinking": "anthropic/claude-opus-4",
    "gemini-2.5-pro": "google/gemini-2.5-pro-preview-06-05",
    "gemini-2.5-flash": "google/gemini-2.5-flash",
    "deepseek-r1": "deepseek/deepseek-r1",
    "deepseek-v3": "deepseek/deepseek-chat",
    "grok-3": "x-ai/grok-3",
    "grok-3-mini": "x-ai/grok-3-mini",
    "kimi-k2": "moonshotai/kimi-k2",
}

# Short model names that should send the `reasoning` parameter to OpenRouter.
# The base Claude/Opus variants do NOT send reasoning — use the -thinking suffix.
THINKING_MODELS: set[str] = {
    "claude-sonnet-4-thinking",
    "claude-opus-4-thinking",
    "deepseek-r1",
}
