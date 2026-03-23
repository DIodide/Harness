import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routes import chat, health, mcp_health, mcp_oauth, sandbox, terminal

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.validate_startup()
    logger.info("Starting Harness API")
    if settings.daytona_api_key:
        logger.info("Daytona sandbox support ENABLED (target=%s)", settings.daytona_target)
    else:
        logger.info("Daytona sandbox support DISABLED (no API key)")

    app.state.http_client = httpx.AsyncClient(
        limits=httpx.Limits(
            max_connections=100,
            max_keepalive_connections=20,
        ),
        timeout=httpx.Timeout(120.0, connect=10.0),
    )
    yield
    await app.state.http_client.aclose()
    logger.info("Harness API shut down")


app = FastAPI(
    title="Harness API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.frontend_url,
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:57177",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(mcp_oauth.router, prefix="/api/mcp/oauth", tags=["mcp-oauth"])
app.include_router(mcp_health.router, prefix="/api/mcp/health", tags=["mcp-health"])
app.include_router(sandbox.router, prefix="/api/sandbox", tags=["sandbox"])
app.include_router(terminal.router, prefix="/api/sandbox", tags=["terminal"])
