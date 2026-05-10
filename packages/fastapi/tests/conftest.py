"""Test configuration — populates env vars the Pydantic Settings loader needs."""
import os

# Must run before app modules import `settings`.
os.environ.setdefault("OPENROUTER_API_KEY", "sk-test")
os.environ.setdefault("CONVEX_URL", "https://test.convex.cloud")
os.environ.setdefault("CONVEX_DEPLOY_KEY", "deploy-test")
os.environ.setdefault("CLERK_SECRET_KEY", "sk_test_clerk")
os.environ.setdefault("CLERK_ISSUER", "https://test.clerk.accounts.dev")
os.environ.setdefault("FRONTEND_URL", "http://localhost:3000")
os.environ.setdefault("FASTAPI_BASE_URL", "http://localhost:8000")
