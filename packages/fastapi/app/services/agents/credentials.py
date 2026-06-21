"""Per-user encrypted credentials for external ACP agents.

Plaintext exists only transiently in this process: the browser submits a
secret over HTTPS, we AES-256-GCM encrypt it with a key held only in the
FastAPI environment, and Convex stores the ciphertext. At agent-spawn time
the ciphertext is fetched, decrypted, and materialized into the sandbox
(auth file or env var). The browser can never read a stored value back.
"""

import json
import logging

import httpx

from app.config import settings
from app.services.agents.registry import (
    SANDBOX_HOME,
    AgentCredentials,
    AgentCredentialsError,
)
from app.services.convex import ConvexMutationError, query_convex, run_convex_mutation
from app.services.secrets_crypto import (
    MAX_SECRET_LENGTH,
    CredentialCryptoError,
    decrypt_secret,
    encrypt_secret,
)

logger = logging.getLogger(__name__)

# kind values accepted per agent (mirrors the Convex schema union).
VALID_KINDS: dict[str, set[str]] = {
    "codex": {"auth_json", "api_key"},
    "claude-code": {"oauth_token", "api_key"},
    "cursor": {"auth_json", "api_key"},
}

# Crypto (encrypt_secret / decrypt_secret / MAX_SECRET_LENGTH /
# CredentialCryptoError) now lives in app.services.secrets_crypto and is
# re-imported above so existing call sites here stay unchanged. One key
# (AGENT_CREDENTIALS_KEY), one rotation story across agent + workspace creds.


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
        if not isinstance(parsed, dict):
            return "auth.json must be a JSON object"
        if agent_id == "codex" and not ("tokens" in parsed or "OPENAI_API_KEY" in parsed):
            return "This does not look like a codex auth.json (run `codex login` locally first)"
        if agent_id == "cursor" and "accessToken" not in parsed:
            return (
                "This does not look like a cursor auth.json "
                "(expected accessToken/refreshToken from `cursor-agent login`)"
            )
    return None


async def store_user_credential(
    http_client: httpx.AsyncClient,
    user_id: str,
    agent_id: str,
    kind: str,
    value: str,
    label: str | None = None,
    credential_id: str | None = None,
) -> str:
    """Encrypt and store a credential. Returns the credential id.

    With credential_id the existing row's secret is replaced in place
    (rotating a token); otherwise a new credential is created — users may
    hold several per agent (e.g. work + personal accounts), each harness
    referencing one.
    """
    ciphertext = encrypt_secret(value)
    try:
        if credential_id:
            result = await run_convex_mutation(
                http_client,
                "agentCredentials:updateSecret",
                {
                    "credentialId": credential_id,
                    "userId": user_id,
                    # The mutation rejects rotation when the stored row
                    # belongs to a different agent — `kind` is validated
                    # against the REQUEST's agent, so a mismatch would
                    # otherwise corrupt the row (e.g. a codex auth.json
                    # exported as ANTHROPIC_API_KEY).
                    "agent": agent_id,
                    "kind": kind,
                    "ciphertext": ciphertext,
                    **({"label": label} if label else {}),
                },
            )
        else:
            result = await run_convex_mutation(
                http_client,
                "agentCredentials:create",
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
    return str(result)


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
        merge_files: dict[str, dict] = {}
        if settings.claude_available_models:
            models = [
                m.strip()
                for m in settings.claude_available_models.split(",")
                if m.strip()
            ]
            # availableModels entries surface in ACP configOptions and pass
            # to setModel verbatim — exposes models (e.g. Fable) the
            # headless SDK doesn't list by default. Merged, not replaced:
            # attached persistent sandboxes may hold the user's own
            # settings.json (hooks, permissions, env).
            merge_files[f"{SANDBOX_HOME}/.claude/settings.json"] = {
                "availableModels": models
            }
        if kind == "oauth_token":
            return AgentCredentials(
                json_merge_files=merge_files,
                env={"CLAUDE_CODE_OAUTH_TOKEN": value.strip()},
            )
        return AgentCredentials(
            json_merge_files=merge_files,
            env={"ANTHROPIC_API_KEY": value.strip()},
        )
    if agent_id == "cursor":
        if kind == "auth_json":
            # cursor-agent's file-based auth store on Linux
            # ({accessToken, refreshToken} from `cursor-agent login`).
            return AgentCredentials(
                files={f"{SANDBOX_HOME}/.config/cursor/auth.json": value}
            )
        return AgentCredentials(env={"CURSOR_API_KEY": value.strip()})
    raise AgentCredentialsError(f"Unknown agent '{agent_id}'")


async def resolve_agent_credentials(
    http_client: httpx.AsyncClient,
    agent_id: str,
    user_id: str,
    credential_id: str | None = None,
) -> AgentCredentials:
    """Resolve a stored credential for an agent run.

    With credential_id (the harness's linked credential), that exact row is
    used — ownership and agent match are enforced. Without one, the user's
    most recent credential for the agent is the fallback. No server-level
    fallback — the web app is the only place credentials come from.
    """
    if credential_id:
        row = await query_convex(
            http_client,
            "agentCredentials:getById",
            {"credentialId": credential_id, "userId": user_id},
        )
        if row and row.get("agent") != agent_id:
            raise AgentCredentialsError(
                f"This harness's credential belongs to '{row.get('agent')}', "
                f"not '{agent_id}' — pick a matching credential in the "
                "harness settings."
            )
    else:
        row = await query_convex(
            http_client,
            "agentCredentials:getForAgent",
            {"userId": user_id, "agent": agent_id},
        )
    if not row or not row.get("ciphertext"):
        raise AgentCredentialsError(
            "No credential connected for this agent — add one in the "
            "harness settings."
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
            "may have rotated). Reconnect it in the harness settings."
        ) from e
    creds = _to_agent_credentials(agent_id, row.get("kind", ""), value)
    # lastUsedAt bookkeeping is best-effort.
    import contextlib

    touch_id = credential_id or row.get("credentialId")
    if touch_id:
        with contextlib.suppress(ConvexMutationError):
            await run_convex_mutation(
                http_client,
                "agentCredentials:touch",
                {"credentialId": touch_id},
            )
    return creds


async def credential_sources(
    http_client: httpx.AsyncClient, user_id: str,
) -> dict[str, dict]:
    """Per-agent credential summary for the catalog endpoint.

    Each agent lists ALL of the user's stored credentials (newest first) so
    the harness flow can offer reuse; `available` means at least one exists.
    """
    rows = await list_user_credentials(http_client, user_id)
    by_agent: dict[str, list[dict]] = {}
    for row in sorted(rows, key=lambda r: r.get("createdAt") or 0, reverse=True):
        by_agent.setdefault(row["agent"], []).append(
            {
                "credential_id": row.get("credentialId"),
                "kind": row.get("kind"),
                "label": row.get("label"),
                "created_at": row.get("createdAt"),
            }
        )
    out: dict[str, dict] = {}
    from app.services.agents.registry import AGENT_REGISTRY

    for agent_id in AGENT_REGISTRY:
        creds = by_agent.get(agent_id, [])
        newest = creds[0] if creds else None
        out[agent_id] = {
            "credentials": creds,
            # Back-compat summary fields (newest credential)
            "source": "user" if creds else None,
            "kind": newest.get("kind") if newest else None,
            "connected_at": newest.get("created_at") if newest else None,
            "available": bool(creds),
            "unavailable_reason": None if creds else (
                "Not connected — add a credential in the harness settings."
            ),
        }
    return out
