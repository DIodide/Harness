"""Daytona runtime for ACP agents.

Provisions a sandbox from the harness ACP snapshot, injects agent
credentials, uploads and launches the stdio⇄HTTP shim (acp_shim.mjs), and
returns the preview URL the FastAPI ACP client talks to.

All functions here are synchronous (the Daytona SDK is sync) — call them
via asyncio.to_thread from async code.
"""

import contextlib
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
RUNTIME_MARKER = "/opt/harness/.acp-runtime-v1"


def _shim_remote_path(agent: AgentDefinition) -> str:
    # Per-agent filename so pkill targets only this agent's shim and
    # multiple agents can coexist in one attached sandbox.
    return f"{SANDBOX_HOME}/acp-shim-{agent.id}.mjs"


def _launcher_remote_path(agent: AgentDefinition) -> str:
    return f"{SANDBOX_HOME}/acp-shim-start-{agent.id}.sh"


def shim_port(agent: AgentDefinition) -> int:
    return settings.acp_shim_port + agent.port_offset


# Idempotent bootstrap so agents can run inside harness sandboxes whose
# image predates the ACP snapshot (node + adapters installed on demand).
def _bootstrap_script() -> str:
    from app.services.agents.registry import CLAUDE_AGENT_ACP_VERSION, CODEX_ACP_URL

    return f"""#!/bin/bash
set -e
if [ -f {RUNTIME_MARKER} ]; then echo runtime-ready; exit 0; fi
# Tier-snapshot sandboxes exec as the daytona user; system installs need sudo.
SUDO=""
if [ "$(id -u)" != "0" ]; then
  if sudo -n true 2>/dev/null; then
    SUDO="sudo -n"
  else
    echo "ERROR: not root and passwordless sudo unavailable in this sandbox image"
    exit 1
  fi
fi
export DEBIAN_FRONTEND=noninteractive
if ! command -v node >/dev/null 2>&1; then
  $SUDO apt-get update -qq && $SUDO apt-get install -y -qq curl ca-certificates
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO bash -
  $SUDO apt-get install -y -qq nodejs
fi
if ! command -v claude-agent-acp >/dev/null 2>&1; then
  # User-prefix npm installs need no root; sudo (with the caller's PATH,
  # since npm may live outside secure_path) only as fallback.
  npm install -g --silent @agentclientprotocol/claude-agent-acp@{CLAUDE_AGENT_ACP_VERSION} \\
    || $SUDO env "PATH=$PATH" npm install -g --silent @agentclientprotocol/claude-agent-acp@{CLAUDE_AGENT_ACP_VERSION}
fi
if [ ! -x /usr/local/bin/codex-acp ]; then
  curl -fsSL -o /tmp/codex-acp.tgz {CODEX_ACP_URL}
  $SUDO tar -xzf /tmp/codex-acp.tgz -C /usr/local/bin
  $SUDO chmod +x /usr/local/bin/codex-acp && rm /tmp/codex-acp.tgz
fi
printf 'precedence ::ffff:0:0/96  100\\nprecedence ::/0  10\\n' | $SUDO tee /etc/gai.conf >/dev/null || true
$SUDO mkdir -p /opt/harness && $SUDO touch {RUNTIME_MARKER}
echo runtime-ready
"""


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
    # The agent's working directory: the user-visible home for attached
    # harness sandboxes, a scratch workspace for session-owned ones.
    cwd: str = SANDBOX_WORKSPACE
    # False when attached to a harness's persistent sandbox — teardown then
    # stops the shim instead of deleting the sandbox.
    owns_sandbox: bool = True


def _build_launcher(agent: AgentDefinition, shim_token: str) -> str:
    """Launcher script: exports NON-SECRET config and backgrounds the shim.

    Agent credentials (creds.env: OAuth tokens, API keys) are deliberately
    NOT written here — they are passed via the exec environment so they
    never land in a readable file on the sandbox disk (which users can see
    through the sandbox terminal). The nohup'd shim inherits them from the
    launching shell's environment instead.
    """
    env = {
        "SHIM_PORT": str(shim_port(agent)),
        "SHIM_TOKEN": shim_token,
        "AGENT_CMD": json.dumps(agent.command),
        "HOME": SANDBOX_HOME,
        # Node ignores gai.conf ordering by default; force IPv4-first for
        # the shim and any Node-based agent (claude-agent-acp).
        "NODE_OPTIONS": "--dns-result-order=ipv4first",
        **agent.env,
    }
    shim_file = _shim_remote_path(agent)
    shim_name = shim_file.rsplit("/", 1)[-1]
    pidfile = f"/tmp/acp-shim-{agent.id}.pid"
    lines = ["#!/bin/bash", "set -e"]
    # Replace any stale shim for this agent: the sandbox survives gateway
    # restarts with the old shim still bound to the port, and a port clash
    # means the NEW shim dies (EADDRINUSE) while the OLD one keeps answering
    # healthz with the old token → endless 401s. procps (pkill/ps) is NOT
    # in the slim images, so kill via the pid file plus a pure-/proc scan.
    lines.append(f'[ -f {pidfile} ] && kill "$(cat {pidfile})" 2>/dev/null || true')
    lines.append(
        "for d in /proc/[0-9]*; do "
        f'grep -q {shlex.quote(shim_name)} "$d/cmdline" 2>/dev/null '
        '&& kill "${d#/proc/}" 2>/dev/null || true; '
        "done"
    )
    # Give the kernel a beat to release the listen socket.
    lines.append("sleep 0.3")
    lines += [f"export {key}={shlex.quote(value)}" for key, value in env.items()]
    # `exec env -i`-free: the shell already holds the secret env vars passed
    # to process.exec; nohup'd node inherits them without them appearing here.
    lines.append(
        f"nohup node {shim_file} > /tmp/acp-shim-{agent.id}.log 2>&1 &"
    )
    lines.append(f"echo $! > {pidfile}")
    lines.append("echo started")
    return "\n".join(lines) + "\n"


def provision_agent_sandbox(
    user_id: str,
    agent: AgentDefinition,
    creds: AgentCredentials,
    attach_sandbox_id: str | None = None,
    reuse: ProvisionedRuntime | None = None,
) -> ProvisionedRuntime:
    """Start the agent shim in a sandbox and wait until it is healthy.

    With attach_sandbox_id the agent runs inside the harness's existing
    persistent sandbox (bootstrapping node + adapters on first use) so it
    works on the user's real files; otherwise a fresh session-owned sandbox
    is created from the ACP snapshot.

    With `reuse`, the shim is relaunched into the session's EXISTING sandbox
    (auto-started if stopped) with a fresh shim token and preview link —
    Daytona rotates preview tokens across stop/start and the shim process
    does not survive a restart, so a stale session must re-provision rather
    than reuse its old runtime.
    """
    service = get_daytona_service()
    client = service._get_client()

    if reuse is not None:
        logger.info(
            "Reviving agent '%s' shim in sandbox '%s' for user '%s'",
            agent.id, reuse.sandbox_id, user_id,
        )
        sandbox = service._ensure_running(reuse.sandbox_id)
        sandbox_id = reuse.sandbox_id
        owns_sandbox = reuse.owns_sandbox
        cwd = reuse.cwd
        if not owns_sandbox:
            _ensure_agent_runtime(sandbox)
    elif attach_sandbox_id:
        owns_sandbox = False
        logger.info(
            "Attaching agent '%s' to harness sandbox '%s' for user '%s'",
            agent.id, attach_sandbox_id, user_id,
        )
        sandbox = service._ensure_running(attach_sandbox_id)
        sandbox_id = attach_sandbox_id
        _ensure_agent_runtime(sandbox)
        cwd = SANDBOX_HOME
    else:
        owns_sandbox = True
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
        cwd = SANDBOX_WORKSPACE

    try:
        # Daytona sandboxes blackhole outbound IPv6 (TCP connects, TLS gets
        # reset), and many MCP hosts are dual-stack. Prefer IPv4 for every
        # getaddrinfo consumer (full table: a lone precedence line would
        # drop glibc's defaults). Attached sandboxes get this via the sudo
        # bootstrap — the toolbox user can't write /etc there.
        if owns_sandbox:
            _with_retries(
                lambda: sandbox.fs.upload_file(
                    b"precedence ::ffff:0:0/96  100\nprecedence ::/0  10\n",
                    "/etc/gai.conf",
                ),
                "upload gai.conf",
            )

        # Working dir the agent runs in (ACP session cwd).
        _with_retries(
            lambda: sandbox.fs.create_folder(cwd, "0755"),
            "create workspace",
        )

        # Credential files (e.g. ~/.codex/auth.json) — the agents' native
        # on-disk credential stores. chmod 600 so they aren't world-readable
        # within the sandbox (the user owns them, but defense in depth).
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
            with contextlib.suppress(Exception):
                sandbox.process.exec(f"chmod 600 {shlex.quote(remote_path)}", timeout=15)

        # Shim + launcher.
        shim_token = secrets.token_urlsafe(24)
        _with_retries(
            lambda: sandbox.fs.upload_file(
                SHIM_PATH.read_bytes(), _shim_remote_path(agent),
            ),
            "upload shim",
        )
        launcher = _build_launcher(agent, shim_token)
        _with_retries(
            lambda: sandbox.fs.upload_file(
                launcher.encode("utf-8"), _launcher_remote_path(agent),
            ),
            "upload launcher",
        )
        # Secrets travel only through the exec environment — the launcher
        # script on disk holds no credentials. The nohup'd shim (and the
        # agent it spawns) inherit them from this shell's environment.
        _with_retries(
            lambda: sandbox.process.exec(
                f"bash {_launcher_remote_path(agent)}",
                cwd=SANDBOX_HOME,
                env=creds.env or None,
                timeout=30,
            ),
            "start shim",
        )

        preview = sandbox.get_preview_link(shim_port(agent))
        base_url = preview.url.rstrip("/")
        headers = {"x-shim-token": shim_token}
        preview_token = getattr(preview, "token", None)
        if preview_token:
            headers["x-daytona-preview-token"] = preview_token

        _wait_for_shim(sandbox, base_url, headers, agent=agent)
        logger.info(
            "ACP sandbox '%s' ready (agent=%s, url=%s)",
            sandbox_id, agent.id, base_url,
        )
        return ProvisionedRuntime(
            sandbox_id=sandbox_id,
            base_url=base_url,
            headers=headers,
            cwd=cwd,
            owns_sandbox=owns_sandbox,
        )
    except Exception:
        # Don't leak half-provisioned sandboxes — but never delete a
        # harness's own sandbox on attach failure, and never delete an
        # existing session sandbox on a failed revive (workspace files!).
        if owns_sandbox and reuse is None:
            try:
                client.delete(sandbox)
            except Exception:
                logger.exception("Failed to clean up sandbox '%s'", sandbox_id)
        raise


def _ensure_agent_runtime(sandbox) -> None:
    """Install node + ACP adapters into an attached sandbox (idempotent)."""
    script_path = f"{SANDBOX_HOME}/.harness-acp-bootstrap.sh"
    _with_retries(
        lambda: sandbox.fs.upload_file(
            _bootstrap_script().encode("utf-8"), script_path,
        ),
        "upload bootstrap",
    )
    result = sandbox.process.exec(f"bash {script_path}", timeout=300)
    output = (result.result or "")[-1500:]
    if result.exit_code != 0 or "runtime-ready" not in output:
        raise RuntimeError(
            "Could not prepare the harness sandbox for agents (node/adapter "
            f"install failed):\n{output}"
        )


def stop_agent_shim(sandbox_id: str, agent: AgentDefinition) -> None:
    """Stop one agent's shim in an attached sandbox (best-effort)."""
    try:
        sandbox = get_daytona_service().get_sandbox(sandbox_id)
        sandbox.process.exec(
            f"pkill -f {shlex.quote(_shim_remote_path(agent))} || true",
            timeout=15,
        )
    except Exception:
        logger.exception("Failed to stop shim for '%s' in '%s'", agent.id, sandbox_id)


def _wait_for_shim(
    sandbox, base_url: str, headers: dict[str, str], timeout: float = 60.0,
    agent: AgentDefinition | None = None,
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
            time.sleep(0.5)

    # Pull the shim log + the agent's buffered stderr for a useful error.
    shim_log = ""
    log_path = f"/tmp/acp-shim-{agent.id}.log" if agent else "/tmp/acp-shim.log"
    try:
        result = sandbox.process.exec(
            f"tail -50 {log_path}", cwd=SANDBOX_HOME, timeout=10,
        )
        shim_log = result.result or ""
    except Exception:
        pass
    agent_stderr = _collect_agent_stderr(base_url, headers)
    raise RuntimeError(
        f"ACP shim failed to become healthy: {last_error}\n"
        f"shim log:\n{shim_log}\nagent output:\n{agent_stderr}"
    )


def _collect_agent_stderr(
    base_url: str, headers: dict[str, str], budget: float = 4.0,
) -> str:
    """Briefly read the shim's event stream to capture agent stderr/exit
    lines buffered before the agent process died."""
    lines: list[str] = []
    try:
        with httpx.Client(timeout=httpx.Timeout(budget, read=budget)) as http:
            with http.stream(
                "GET", f"{base_url}/events", params={"since": 0}, headers=headers,
            ) as resp:
                current_event = "message"
                for raw in resp.iter_lines():
                    line = raw.rstrip("\r")
                    if line.startswith("event: "):
                        current_event = line[7:]
                    elif line.startswith("data: ") and current_event in (
                        "stderr", "exit", "spawn_error",
                    ):
                        lines.append(f"[{current_event}] {line[6:]}")
                    if len(lines) >= 40:
                        break
    except httpx.HTTPError:
        pass  # read timeout simply ends collection
    return "\n".join(lines) or "(none captured)"


def write_cursor_mcp_config(
    sandbox_id: str, shim_port: int, servers: list,
) -> None:
    """Write ~/.cursor/{mcp.json,permissions.json} for the cursor agent.

    Unlike codex/claude, `cursor-agent acp` does not connect to the MCP
    servers passed in `session/new` — it loads them from its config file.
    We point each at the same local relay endpoint (index-aligned with
    session.relay_targets) and allowlist them so they load headlessly.
    """
    mcp_servers = {
        server.name: {"url": f"http://127.0.0.1:{shim_port}/mcp/{index}"}
        for index, server in enumerate(servers)
    }
    allowlist = [f"{server.name}:*" for server in servers]
    sandbox = get_daytona_service()._get_client().get(sandbox_id)
    cursor_dir = f"{SANDBOX_HOME}/.cursor"
    _with_retries(
        lambda: sandbox.fs.create_folder(cursor_dir, "0755"), "create .cursor",
    )
    _with_retries(
        lambda: sandbox.fs.upload_file(
            json.dumps({"mcpServers": mcp_servers}).encode(),
            f"{cursor_dir}/mcp.json",
        ),
        "write cursor mcp.json",
    )
    _with_retries(
        lambda: sandbox.fs.upload_file(
            json.dumps({"mcpAllowlist": allowlist}).encode(),
            f"{cursor_dir}/permissions.json",
        ),
        "write cursor permissions.json",
    )


def teardown_sandbox(sandbox_id: str) -> None:
    """Delete an agent sandbox (best-effort)."""
    try:
        get_daytona_service().delete_sandbox(sandbox_id)
    except Exception:
        logger.exception("Failed to delete ACP sandbox '%s'", sandbox_id)
