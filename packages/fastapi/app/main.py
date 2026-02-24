import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routes.chat import router as chat_router
from app.routes.oauth import router as oauth_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("harness_debug.log", mode="w"),
    ],
)

app = FastAPI(title="Harness API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat_router, prefix="/api")
app.include_router(oauth_router, prefix="/auth")


@app.get("/health")
async def health():
    return {"status": "ok"}
