"""Daytona runtime for ACP agents.

Provisions a sandbox from the harness ACP snapshot, injects agent
credentials, uploads and launches the stdio⇄HTTP shim (acp_shim.mjs), and
returns the preview URL the FastAPI ACP client talks to.

All functions here are synchronous (the Daytona SDK is sync) — call them
via asyncio.to_thread from async code.
"""

import json
import logging
import secrets
import shlex
import time
from dataclasses import dataclass
from pathlib import Path

import httpx
from daytona_sdk import CreateSandboxFromSnapshotParams

from app.config import settings
from app.services.agents.registry import (
    SANDBOX_HOME,
    SANDBOX_WORKSPACE,
    AgentCredentials,
    AgentDefinition,
)
from app.services.daytona_service import get_daytona_service

logger = logging.getLogger(__name__)

SHIM_PATH = Path(__file__).parent / "acp_shim.mjs"
SHIM_REMOTE_PATH = f"{SANDBOX_HOME}/acp-shim.mjs"
LAUNCHER_REMOTE_PATH = f"{SANDBOX_HOME}/acp-shim-start.sh"


def _with_retries(operation, what: str, attempts: int = 4):
    """Run a Daytona toolbox call, retrying transient connection failures.

    Freshly created sandboxes occasionally reset the first toolbox
    connection ("Connection aborted / reset by peer"), and the SDK does not
    retry non-idempotent requests itself. requests.ConnectionError is an
    OSError subclass, so OSError covers the whole family.
    """
    last: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return operation()
        except OSError as e:
            last = e
            logger.warning(
                "Daytona toolbox call '%s' failed (attempt %d/%d): %s",
                what, attempt, attempts, e,
            )
            time.sleep(1.5 * attempt)
    raise RuntimeError(f"Daytona toolbox call '{what}' kept failing: {last}")


@dataclass
class ProvisionedRuntime:
    sandbox_id: str
    base_url: str  # preview URL for the shim port (no trailing slash)
    headers: dict[str, str]  # auth headers for every shim request


def _build_launcher(agent: AgentDefinition, creds: AgentCredentials, shim_token: str) -> str:
    """Launcher script: exports env and backgrounds the shim with nohup."""
    env = {
        "SHIM_PORT": str(settings.acp_shim_port),
        "SHIM_TOKEN": shim_token,
        "AGENT_CMD": json.dumps(agent.command),
        "HOME": SANDBOX_HOME,
        # Node ignores gai.conf ordering by default; force IPv4-first for
        # the shim and any Node-based agent (claude-agent-acp).
        "NODE_OPTIONS": "--dns-result-order=ipv4first",
        **agent.env,
        **creds.env,
    }
    lines = ["#!/bin/bash", "set -e"]
    lines += [f"export {key}={shlex.quote(value)}" for key, value in env.items()]
    lines.append(
        f"nohup node {SHIM_REMOTE_PATH} > /tmp/acp-shim.log 2>&1 &"
    )
    lines.append("echo started")
    return "\n".join(lines) + "\n"


def provision_agent_sandbox(
    user_id: str,
    agent: AgentDefinition,
    creds: AgentCredentials,
) -> ProvisionedRuntime:
    """Create a sandbox, start the shim, and wait until it is healthy."""
    service = get_daytona_service()
    client = service._get_client()

    params = CreateSandboxFromSnapshotParams(
        snapshot=settings.acp_snapshot_name,
        labels={
            "harness_user_id": user_id,
            "harness_acp_agent": agent.id,
        },
        auto_stop_interval=30,
        ephemeral=False,
    )
    logger.info(
        "Provisioning ACP sandbox (agent=%s, snapshot=%s) for user '%s'",
        agent.id, settings.acp_snapshot_name, user_id,
    )
    sandbox = client.create(params)
    sandbox_id = sandbox.id

    try:
        # Daytona sandboxes blackhole outbound IPv6 (TCP connects, TLS gets
        # reset), and many MCP hosts are dual-stack. Prefer IPv4 for every
        # getaddrinfo consumer (full table: a lone precedence line would
        # drop glibc's defaults).
        _with_retries(
            lambda: sandbox.fs.upload_file(
                b"precedence ::ffff:0:0/96  100\nprecedence ::/0  10\n",
                "/etc/gai.conf",
            ),
            "upload gai.conf",
        )

        # Workspace dir the agent runs in (ACP session cwd).
        _with_retries(
            lambda: sandbox.fs.create_folder(SANDBOX_WORKSPACE, "0755"),
            "create workspace",
        )

        # Credential files (e.g. ~/.codex/auth.json).
        for remote_path, content in creds.files.items():
            parent = remote_path.rsplit("/", 1)[0]
            if parent and parent != SANDBOX_HOME:
                _with_retries(
                    lambda parent=parent: sandbox.fs.create_folder(parent, "0700"),
                    "create credential dir",
                )
            _with_retries(
                lambda remote_path=remote_path, content=content: sandbox.fs.upload_file(
                    content.encode("utf-8"), remote_path,
                ),
                "upload credential file",
            )

        # Shim + launcher.
        shim_token = secrets.token_urlsafe(24)
        _with_retries(
            lambda: sandbox.fs.upload_file(SHIM_PATH.read_bytes(), SHIM_REMOTE_PATH),
            "upload shim",
        )
        launcher = _build_launcher(agent, creds, shim_token)
        _with_retries(
            lambda: sandbox.fs.upload_file(
                launcher.encode("utf-8"), LAUNCHER_REMOTE_PATH,
            ),
            "upload launcher",
        )
        _with_retries(
            lambda: sandbox.process.exec(
                f"bash {LAUNCHER_REMOTE_PATH}", cwd=SANDBOX_HOME, timeout=30,
            ),
            "start shim",
        )

        preview = sandbox.get_preview_link(settings.acp_shim_port)
        base_url = preview.url.rstrip("/")
        headers = {"x-shim-token": shim_token}
        preview_token = getattr(preview, "token", None)
        if preview_token:
            headers["x-daytona-preview-token"] = preview_token

        _wait_for_shim(sandbox, base_url, headers)
        logger.info(
            "ACP sandbox '%s' ready (agent=%s, url=%s)",
            sandbox_id, agent.id, base_url,
        )
        return ProvisionedRuntime(
            sandbox_id=sandbox_id, base_url=base_url, headers=headers,
        )
    except Exception:
        # Don't leak half-provisioned sandboxes.
        try:
            client.delete(sandbox)
        except Exception:
            logger.exception("Failed to clean up sandbox '%s'", sandbox_id)
        raise


def _wait_for_shim(
    sandbox, base_url: str, headers: dict[str, str], timeout: float = 60.0,
) -> None:
    """Poll the shim /healthz until the agent process is confirmed running."""
    deadline = time.monotonic() + timeout
    last_error: str = "no response"
    with httpx.Client(timeout=10.0, follow_redirects=True) as http:
        while time.monotonic() < deadline:
            try:
                resp = http.get(f"{base_url}/healthz", headers=headers)
                if resp.status_code == 200:
                    health = resp.json()
                    if health.get("agentRunning"):
                        return
                    last_error = "shim up but agent process exited"
                else:
                    last_error = f"healthz HTTP {resp.status_code}"
            except httpx.HTTPError as e:
                last_error = str(e)
            time.sleep(1.5)

    # Pull the shim log for a useful error before giving up.
    shim_log = ""
    try:
        result = sandbox.process.exec(
            "tail -50 /tmp/acp-shim.log", cwd=SANDBOX_HOME, timeout=10,
        )
        shim_log = result.result or ""
    except Exception:
        pass
    raise RuntimeError(
        f"ACP shim failed to become healthy: {last_error}\nshim log:\n{shim_log}"
    )


def teardown_sandbox(sandbox_id: str) -> None:
    """Delete an agent sandbox (best-effort)."""
    try:
        get_daytona_service().delete_sandbox(sandbox_id)
    except Exception:
        logger.exception("Failed to delete ACP sandbox '%s'", sandbox_id)
