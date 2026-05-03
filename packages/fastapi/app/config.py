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

    # Tiger Junction engine shared bearer token (MCP_ACCESS_TOKEN on the engine side)
    tiger_junction_mcp_token: str = ""

    # Clerk secret key for Backend API calls (e.g. resolving Princeton netid from verified emails).
    clerk_secret_key: str = ""

    # Clerk JWT verification — pinned issuer prevents attacker-controlled JWKS.
    clerk_issuer: str = ""

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
        if not self.clerk_secret_key:
            raise RuntimeError(
                "CLERK_SECRET_KEY is required — Princeton netid resolution needs the Clerk Backend API key"
            )
        if not self.clerk_issuer:
            raise RuntimeError(
                "CLERK_ISSUER is required — JWT verification cannot pin the issuer without it"
            )


settings = Settings()


AVAILABLE_MODELS = [
    {"id": "openai/gpt-5.5", "name": "GPT-5.5"},
    {"id": "openai/gpt-5.4", "name": "GPT-5.4"},
    {"id": "anthropic/claude-sonnet-4.6", "name": "Claude Sonnet 4.6"},
    {"id": "anthropic/claude-sonnet-4.6", "name": "Claude Sonnet 4.6 (Thinking)"},
    {"id": "anthropic/claude-opus-4.6-fast", "name": "Claude Opus 4.6 (Fast)"},
    {"id": "anthropic/claude-opus-4.7", "name": "Claude Opus 4.7"},
    {"id": "anthropic/claude-opus-4.7", "name": "Claude Opus 4.7 (Thinking)"},
    {"id": "google/gemini-3.1-pro-preview", "name": "Gemini 3.1 Pro Preview"},
    {"id": "google/gemini-3-flash-preview", "name": "Gemini 3 Flash Preview"},
    {"id": "google/gemini-3.1-flash-lite-preview", "name": "Gemini 3.1 Flash Lite Preview"},
]

# Maps short model names (stored in harness.model) to full OpenRouter model IDs.
# Thinking variants use the same provider model but trigger the reasoning parameter.
MODEL_MAP = {
    "gpt-5.5": "openai/gpt-5.5",
    "gpt-5.4": "openai/gpt-5.4",
    "claude-sonnet-4.6": "anthropic/claude-sonnet-4.6",
    "claude-sonnet-4.6-thinking": "anthropic/claude-sonnet-4.6",
    "claude-opus-4.6-fast": "anthropic/claude-opus-4.6-fast",
    "claude-opus-4.7": "anthropic/claude-opus-4.7",
    "claude-opus-4.7-thinking": "anthropic/claude-opus-4.7",
    "gemini-3.1-pro": "google/gemini-3.1-pro-preview",
    "gemini-3-flash": "google/gemini-3-flash-preview",
    "gemini-3.1-flash-lite": "google/gemini-3.1-flash-lite-preview",
}

# Short model names that should send the `reasoning` parameter to OpenRouter.
# The base Claude/Opus variants do NOT send reasoning — use the -thinking suffix.
THINKING_MODELS: set[str] = {
    "claude-sonnet-4.6-thinking",
    "claude-opus-4.7-thinking",
}
