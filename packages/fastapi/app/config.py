from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    openrouter_api_key: str = ""
    convex_url: str = ""
    convex_deploy_key: str = ""
    frontend_url: str = "http://localhost:3000"
    junction_engine_url: str = (
        "https://placeholder.junction-engine.example.com/mcp"
    )

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()

MCP_SERVERS: dict[str, dict] = {
    "notion": {
        "url": "https://mcp.notion.com/mcp",
        "auth": "oauth",
    },
    "github": {
        "url": "https://api.githubcopilot.com/mcp/",
        "auth": "oauth",
    },
    "linear": {
        "url": "https://mcp.linear.app/mcp",
        "auth": "oauth",
    },
    "junction-engine": {
        "url": settings.junction_engine_url,
        "auth": "none",
    },
}

AVAILABLE_MODELS = [
    {"id": "openai/gpt-4o", "name": "GPT-4o"},
    {"id": "anthropic/claude-sonnet-4", "name": "Claude Sonnet 4"},
    {"id": "google/gemini-2.5-pro-preview-06-05", "name": "Gemini 2.5 Pro"},
    {"id": "openai/gpt-4.1-mini", "name": "GPT-4.1 Mini"},
    {"id": "x-ai/grok-3", "name": "Grok 3"},
    {"id": "x-ai/grok-3-mini", "name": "Grok 3 Mini"},
]
