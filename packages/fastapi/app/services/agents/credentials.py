"""Per-user encrypted credentials for external ACP agents.

Plaintext exists only transiently in this process: the browser submits a
secret over HTTPS, we AES-256-GCM encrypt it with a key held only in the
FastAPI environment, and Convex stores the ciphertext. At agent-spawn time
the ciphertext is fetched, decrypted, and materialized into the sandbox
(auth file or env var). The browser can never read a stored value back.
"""

import base64
import hashlib
import json
import logging
import os

import httpx

from app.config import settings
from app.services.agents.registry import (
    SANDBOX_HOME,
    AgentCredentials,
    AgentCredentialsError,
)
from app.services.convex import ConvexMutationError, query_convex, run_convex_mutation

logger = logging.getLogger(__name__)

# kind values accepted per agent (mirrors the Convex schema union).
VALID_KINDS: dict[str, set[str]] = {
    "codex": {"auth_json", "api_key"},
    "claude-code": {"oauth_token", "api_key"},
    "cursor": {"api_key"},
}

MAX_SECRET_LENGTH = 32_768


class CredentialCryptoError(Exception):
    """Encryption key missing or ciphertext cannot be decrypted."""


def _aes_key() -> bytes:
    raw = settings.agent_credentials_key
    if not raw:
        raise CredentialCryptoError(
            "AGENT_CREDENTIALS_KEY is not set — per-user agent credentials "
            "are disabled on this deployment."
        )
    # Accept any non-empty string; derive a uniform 32-byte key.
    return hashlib.sha256(raw.encode("utf-8")).digest()


def encrypt_secret(plaintext: str) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    nonce = os.urandom(12)
    sealed = AESGCM(_aes_key()).encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.b64encode(nonce + sealed).decode("ascii")


def decrypt_secret(ciphertext_b64: str) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    try:
        blob = base64.b64decode(ciphertext_b64)
        nonce, sealed = blob[:12], blob[12:]
        return AESGCM(_aes_key()).decrypt(nonce, sealed, None).decode("utf-8")
    except CredentialCryptoError:
        raise
    except Exception as e:
        raise CredentialCryptoError(f"Failed to decrypt credential: {e}") from e


def validate_secret(agent_id: str, kind: str, value: str) -> str | None:
    """Sanity-check a submitted secret. Returns an error string or None."""
    if kind not in VALID_KINDS.get(agent_id, set()):
        return f"'{kind}' is not a valid credential type for {agent_id}"
    if not value.strip():
        return "Credential value is empty"
    if len(value) > MAX_SECRET_LENGTH:
        return "Credential value is too large"
    if kind == "auth_json":
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return "auth.json must be valid JSON (paste the full file contents)"
        if not isinstance(parsed, dict) or not (
            "tokens" in parsed or "OPENAI_API_KEY" in parsed
        ):
            return "This does not look like a codex auth.json (run `codex login` locally first)"
    return None


async def store_user_credential(
    http_client: httpx.AsyncClient,
    user_id: str,
    agent_id: str,
    kind: str,
    value: str,
    label: str | None = None,
) -> None:
    ciphertext = encrypt_secret(value)
    try:
        await run_convex_mutation(
            http_client,
            "agentCredentials:store",
            {
                "userId": user_id,
                "agent": agent_id,
                "kind": kind,
                "ciphertext": ciphertext,
                **({"label": label} if label else {}),
            },
        )
    except ConvexMutationError as e:
        raise AgentCredentialsError(f"Could not save the credential: {e}") from e


async def delete_user_credential(
    http_client: httpx.AsyncClient, user_id: str, agent_id: str,
) -> None:
    try:
        await run_convex_mutation(
            http_client,
            "agentCredentials:remove",
            {"userId": user_id, "agent": agent_id},
        )
    except ConvexMutationError as e:
        raise AgentCredentialsError(f"Could not remove the credential: {e}") from e


async def list_user_credentials(
    http_client: httpx.AsyncClient, user_id: str,
) -> list[dict]:
    rows = await query_convex(
        http_client, "agentCredentials:listForUser", {"userId": user_id},
    )
    return rows or []


def _to_agent_credentials(agent_id: str, kind: str, value: str) -> AgentCredentials:
    """Materialize a decrypted secret into files/env for the sandbox."""
    if agent_id == "codex":
        if kind == "auth_json":
            return AgentCredentials(
                files={f"{SANDBOX_HOME}/.codex/auth.json": value}
            )
        return AgentCredentials(env={"OPENAI_API_KEY": value.strip()})
    if agent_id == "claude-code":
        files: dict[str, str] = {}
        if settings.claude_available_models:
            models = [
                m.strip()
                for m in settings.claude_available_models.split(",")
                if m.strip()
            ]
            # availableModels entries surface in ACP configOptions and pass
            # to setModel verbatim — exposes models (e.g. Fable) the
            # headless SDK doesn't list by default.
            files[f"{SANDBOX_HOME}/.claude/settings.json"] = json.dumps(
                {"availableModels": models}
            )
        if kind == "oauth_token":
            return AgentCredentials(
                files=files, env={"CLAUDE_CODE_OAUTH_TOKEN": value.strip()}
            )
        return AgentCredentials(files=files, env={"ANTHROPIC_API_KEY": value.strip()})
    if agent_id == "cursor":
        return AgentCredentials(env={"CURSOR_API_KEY": value.strip()})
    raise AgentCredentialsError(f"Unknown agent '{agent_id}'")


async def resolve_agent_credentials(
    http_client: httpx.AsyncClient, agent_id: str, user_id: str,
) -> AgentCredentials:
    """Resolve the user's stored credential. No server-level fallback —
    the web app is the only place credentials come from."""
    row = await query_convex(
        http_client,
        "agentCredentials:getForAgent",
        {"userId": user_id, "agent": agent_id},
    )
    if not row or not row.get("ciphertext"):
        raise AgentCredentialsError(
            "No credentials connected for this agent — add them in "
            "Settings → Agent Connections."
        )
    try:
        value = decrypt_secret(row["ciphertext"])
    except CredentialCryptoError as e:
        logger.error(
            "Stored credential for user '%s' agent '%s' is unreadable: %s",
            user_id, agent_id, e,
        )
        raise AgentCredentialsError(
            "Your stored credential could not be decrypted (the server key "
            "may have rotated). Reconnect it in Settings → Agent Connections."
        ) from e
    creds = _to_agent_credentials(agent_id, row.get("kind", ""), value)
    # lastUsedAt bookkeeping is best-effort.
    import contextlib

    with contextlib.suppress(ConvexMutationError):
        await run_convex_mutation(
            http_client,
            "agentCredentials:touch",
            {"userId": user_id, "agent": agent_id},
        )
    return creds


async def credential_sources(
    http_client: httpx.AsyncClient, user_id: str,
) -> dict[str, dict]:
    """Per-agent availability summary for the catalog endpoint."""
    user_rows = {row["agent"]: row for row in await list_user_credentials(http_client, user_id)}
    out: dict[str, dict] = {}
    from app.services.agents.registry import AGENT_REGISTRY

    for agent_id in AGENT_REGISTRY:
        row = user_rows.get(agent_id)
        if row:
            out[agent_id] = {
                "source": "user",
                "kind": row.get("kind"),
                "connected_at": row.get("createdAt"),
                "available": True,
                "unavailable_reason": None,
            }
        else:
            out[agent_id] = {
                "source": None,
                "kind": None,
                "connected_at": None,
                "available": False,
                "unavailable_reason": (
                    "Not connected — add credentials in Settings → Agent Connections."
                ),
            }
    return out
