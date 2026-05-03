import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.routes import chat, commands, harness_suggest, health, mcp_health, mcp_oauth, sandbox, terminal
from app.services.daytona_service import SandboxStoppedByUserError

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

_local_dev_origins = [
    f"http://{host}:{port}"
    for host in ("localhost", "127.0.0.1")
    for port in range(3000, 3021)
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.frontend_url,
        *_local_dev_origins,
        "http://127.0.0.1:57177",
        "https://harness.nz",
        "https://staging.harness.nz",
        "https://harness-web.harness-ai.workers.dev",
        "https://harness-web-staging.harness-ai.workers.dev",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(SandboxStoppedByUserError)
async def _sandbox_stopped_handler(_: Request, exc: SandboxStoppedByUserError) -> JSONResponse:
    """Translate user-stopped intent into a 409 with a stable error code so
    the browser panel can render a friendly empty state instead of a 500.
    """
    return JSONResponse(
        status_code=409,
        content={
            "code": "sandbox_stopped_by_user",
            "message": str(exc),
            "sandbox_status": exc.status,
        },
    )


app.include_router(health.router)
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(mcp_oauth.router, prefix="/api/mcp/oauth", tags=["mcp-oauth"])
app.include_router(mcp_health.router, prefix="/api/mcp/health", tags=["mcp-health"])
app.include_router(commands.router, prefix="/api/commands", tags=["commands"])
app.include_router(sandbox.router, prefix="/api/sandbox", tags=["sandbox"])
app.include_router(terminal.router, prefix="/api/sandbox", tags=["terminal"])
app.include_router(harness_suggest.router, prefix="/api/harness/suggest", tags=["harness-suggest"])
