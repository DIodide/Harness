"""Per-user, workspace-assignable environment-variable credentials.

A "workspace credential" is a named secret (e.g. GITHUB_TOKEN, LINEAR_API_KEY)
that the user creates once and assigns to one or more workspaces. At run time
the assigned credentials are decrypted here and injected as environment
variables into whatever sandbox runs the workspace's code — the ACP agent
sandbox AND standalone code-execution sandboxes.

Security (mirrors agents/credentials.py):
  * Plaintext exists only transiently in this process. The browser submits a
    value over HTTPS (Clerk JWT), we AES-256-GCM encrypt it with the key held
    only in this FastAPI env, and Convex stores ciphertext. The value is never
    returned to the browser.
  * Decrypted values ride ONLY `sandbox.process.exec(..., env=...)`. They are
    NEVER written to the on-disk launcher, baked into a snapshot, or logged
    (commit 9f7bf0a). Do not add the env dict to any log line.
  * The Convex deploy key can read any tenant, so every internal fn re-checks
    `row.userId === userId`; we always pass the authenticated user_id through.
"""

import asyncio
import contextlib
import logging
import re

import httpx

from app.services.convex import (
    ConvexMutationError,
    query_convex,
    run_convex_mutation,
)
from app.services.secrets_crypto import (
    MAX_SECRET_LENGTH,
    CredentialCryptoError,
    decrypt_secret,
    encrypt_secret,
)

logger = logging.getLogger(__name__)

# A POSIX-ish env-var name: a letter/underscore followed by letters/digits/
# underscores. Env names are case-sensitive, so both GITHUB_TOKEN and my_var are
# allowed by shape; the denylist below is what blocks dangerous names. No
# anchors here on purpose — we match with .fullmatch(), which requires the WHOLE
# string to match. (`$` would match just before a trailing "\n", so "PATH\n"
# would pass shape and then dodge the reserved-name check.)
_NAME_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
MAX_ENV_NAME_LENGTH = 128

# Exact names that must never be user-settable (compared case-insensitively).
# These either let a credential hijack process behavior (loader/runtime
# injection, the login shell), impersonate the agent's own auth, or leak the
# server's secrets. The user explicitly chose to reject these at creation time.
_RESERVED_NAMES: frozenset[str] = frozenset(
    n.upper()
    for n in (
        # Shell / process environment
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "SHELL",
        "PWD",
        "OLDPWD",
        "TMPDIR",
        "IFS",
        "ENV",
        "BASH_ENV",
        "PS1",
        "PS2",
        "PS4",
        "PROMPT_COMMAND",
        # Loader / language-runtime injection
        "NODE_OPTIONS",
        "NODE_PATH",
        "PYTHONPATH",
        "PYTHONSTARTUP",
        "PERL5LIB",
        "RUBYOPT",
        "GEM_PATH",
        "GIT_SSH_COMMAND",
        # Outbound-proxy / TLS-trust / package-registry env can silently MITM the
        # sandbox's traffic (Anthropic API, git-over-https, npm/pip) or pin a
        # rogue CA — reject so a credential can't reroute or intercept it.
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "FTP_PROXY",
        "NO_PROXY",
        "NODE_EXTRA_CA_CERTS",
        "NODE_TLS_REJECT_UNAUTHORIZED",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "REQUESTS_CA_BUNDLE",
        "CURL_CA_BUNDLE",
        "GIT_SSL_CAINFO",
        "PIP_INDEX_URL",
        "PIP_EXTRA_INDEX_URL",
        # git-config injection: GIT_CONFIG_* can set arbitrary config (e.g.
        # core.sshCommand) → command execution during git ops; GIT_PROXY_COMMAND
        # / GIT_SSH run an arbitrary binary. Bare names here; the dynamic
        # GIT_CONFIG_* / NPM_CONFIG_* families are caught by _RESERVED_PREFIXES.
        "GIT_CONFIG",
        "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_SYSTEM",
        "GIT_PROXY_COMMAND",
        "GIT_SSH",
        # Harness ACP shim / launcher internals
        "SHIM_PORT",
        "SHIM_TOKEN",
        "AGENT_CMD",
        "CODEX_HOME",
        "CLAUDE_HOME",
        # Set by the claude-code launcher to unlock bypassPermissions as root;
        # a user value here must not shadow or inject it into other agents.
        "IS_SANDBOX",
        # Agent auth (managed by agent credentials, not here)
        "CLAUDE_CODE_OAUTH_TOKEN",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
        "OPENAI_API_KEY",
        "CURSOR_API_KEY",
        # Server secrets — must never originate from a user value
        "AGENT_CREDENTIALS_KEY",
        "CONVEX_DEPLOY_KEY",
        "CONVEX_URL",
    )
)

# Name prefixes that are categorically dangerous (case-insensitive):
#   LD_*    dynamic-linker injection on Linux (LD_PRELOAD, LD_LIBRARY_PATH, …)
#   DYLD_*  the macOS equivalent
#   BASH_FUNC_*  exported shell functions (shellshock-style injection)
#   GIT_CONFIG_*  GIT_CONFIG_COUNT/KEY_n/VALUE_n inject arbitrary git config
#   NPM_CONFIG_*  npm config overrides (registry, cafile, …) reroute installs
_RESERVED_PREFIXES: tuple[str, ...] = (
    "LD_",
    "DYLD_",
    "BASH_FUNC_",
    "GIT_CONFIG_",
    "NPM_CONFIG_",
)


def is_reserved_env_name(name: str | None) -> bool:
    """True if `name` is a reserved env var that must never originate from a
    user credential (loader/proxy/registry/git injection, the login shell,
    agent auth, server secrets). Case-insensitive.

    Enforced at BOTH creation (validate_env_credential) AND resolve/injection
    time (resolve_workspace_env), so a row stored before the denylist was
    expanded can never be injected into a sandbox."""
    upper = (name or "").upper()
    return upper in _RESERVED_NAMES or any(
        upper.startswith(p) for p in _RESERVED_PREFIXES
    )


class WorkspaceCredentialError(Exception):
    """A workspace credential could not be stored or resolved."""


def validate_env_credential(name: str, value: str) -> str | None:
    """Sanity-check a submitted env-var credential.

    Returns a human-readable error string, or None when the credential is OK.
    """
    name = name or ""
    # fullmatch (not match): the name must be ENTIRELY [A-Za-z_][A-Za-z0-9_]* —
    # any stray character (newline, space, NUL, …) fails here before the
    # reserved-name check runs, so e.g. "PATH\n" can't slip past the denylist.
    if not _NAME_RE.fullmatch(name):
        return (
            "Name must start with a letter or underscore and contain only "
            "letters, digits, and underscores (e.g. GITHUB_TOKEN)."
        )
    if len(name) > MAX_ENV_NAME_LENGTH:
        return "Name is too long."
    if is_reserved_env_name(name):
        return (
            f"'{name}' is a reserved name and can't be used as a credential "
            "(it controls how the sandbox runs or is managed elsewhere)."
        )
    if not value or not value.strip():
        return "Value is empty."
    if len(value) > MAX_SECRET_LENGTH:
        return "Value is too large."
    return None


async def store_workspace_credential(
    http_client: httpx.AsyncClient,
    user_id: str,
    name: str,
    value: str,
    label: str | None = None,
    credential_id: str | None = None,
) -> str:
    """Encrypt and persist a workspace credential. Returns its id.

    Without credential_id this upserts by (user, name): re-creating an existing
    name rotates its value. With credential_id the specific row is rotated in
    place (ownership re-checked in Convex).
    """
    ciphertext = encrypt_secret(value)
    try:
        if credential_id:
            result = await run_convex_mutation(
                http_client,
                "workspaceCredentials:updateSecret",
                {
                    "credentialId": credential_id,
                    "userId": user_id,
                    "ciphertext": ciphertext,
                    **({"label": label} if label else {}),
                },
            )
        else:
            result = await run_convex_mutation(
                http_client,
                "workspaceCredentials:create",
                {
                    "userId": user_id,
                    "name": name,
                    "ciphertext": ciphertext,
                    **({"label": label} if label else {}),
                },
            )
    except ConvexMutationError as e:
        raise WorkspaceCredentialError(
            f"Could not save the credential: {e}"
        ) from e
    return str(result)


async def resolve_workspace_env(
    http_client: httpx.AsyncClient,
    workspace_id: str,
    user_id: str,
) -> dict[str, str]:
    """Resolve a workspace's assigned credentials to a {NAME: value} env dict.

    Best-effort: a credential that fails to decrypt (e.g. after a key rotation)
    is skipped with a logged error rather than failing the whole run — it is
    supplementary env, not the agent's own auth. Returns {} when the workspace
    has no assigned credentials, isn't owned by the user, or Convex is down.

    NEVER log the returned dict — it holds plaintext secrets.
    """
    if not workspace_id or not user_id:
        return {}
    rows = await query_convex(
        http_client,
        "workspaceCredentials:getForWorkspace",
        {"workspaceId": workspace_id, "userId": user_id},
    )
    if not rows:
        return {}

    env: dict[str, str] = {}
    touch_ids: list[str] = []
    for row in rows:
        name = row.get("name")
        ciphertext = row.get("ciphertext")
        if not name or not ciphertext:
            continue
        # Enforce the reserved-name denylist HERE too, not just at creation: a
        # row stored before the denylist was expanded must never be injected
        # (its MITM / git-config-injection / rogue-CA vector is exactly what the
        # denylist exists to close). Skip it; never inject.
        if is_reserved_env_name(name):
            logger.warning(
                "Skipping reserved-name workspace credential '%s' (workspace "
                "'%s') — not injected into the sandbox.",
                name,
                workspace_id,
            )
            continue
        try:
            env[name] = decrypt_secret(ciphertext)
        except CredentialCryptoError as e:
            logger.error(
                "Workspace credential '%s' (workspace '%s', user '%s') is "
                "unreadable and will be skipped: %s",
                name,
                workspace_id,
                user_id,
                e,
            )
            continue
        cid = row.get("credentialId")
        if cid:
            touch_ids.append(cid)

    if touch_ids:
        await _touch_all(http_client, touch_ids)
    return env


async def _touch_all(
    http_client: httpx.AsyncClient, credential_ids: list[str]
) -> None:
    """Fire lastUsedAt bumps concurrently; failures are ignored (best-effort)."""

    async def _one(cid: str) -> None:
        with contextlib.suppress(ConvexMutationError):
            await run_convex_mutation(
                http_client,
                "workspaceCredentials:touch",
                {"credentialId": cid},
            )

    await asyncio.gather(*(_one(cid) for cid in credential_ids))
