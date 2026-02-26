from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    openrouter_api_key: str = ""
    convex_url: str = ""
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")
    frontend_url: str = "http://localhost:3001"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()


AVAILABLE_MODELS = [
    {"id": "openai/gpt-4o", "name": "GPT-4o"},
    {"id": "anthropic/claude-sonnet-4", "name": "Claude Sonnet 4"},
    {"id": "google/gemini-2.5-pro-preview-06-05", "name": "Gemini 2.5 Pro"},
    {"id": "openai/gpt-4.1-mini", "name": "GPT-4.1 Mini"},
    {"id": "x-ai/grok-3", "name": "Grok 3"},
    {"id": "x-ai/grok-3-mini", "name": "Grok 3 Mini"},
]
