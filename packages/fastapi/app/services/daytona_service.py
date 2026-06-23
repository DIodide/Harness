"""
Daytona sandbox service layer.

Wraps the Daytona Python SDK to provide sandbox lifecycle management,
code execution, filesystem operations, git operations, and terminal access.
"""

import logging
import shlex
import time
from dataclasses import dataclass
from typing import Any

from daytona_sdk import (
    CodeRunParams,
    CreateSandboxFromSnapshotParams,
    Daytona,
    DaytonaConfig,
    DaytonaError,
    DaytonaNotFoundError,
)

from app.config import settings

logger = logging.getLogger(__name__)


# Daytona's two terminal error states; the SDK's own wait loops gate failure
# on exactly this set. A sandbox here cannot be start()ed (start() raises).
_TERMINAL_ERROR_STATES = frozenset({"error", "build_failed"})


def _sandbox_state(sandbox: Any) -> str:
    """Lowercased lifecycle state of a sandbox.

    The SDK Sandbox object exposes `state` (a SandboxState str-enum); older
    code/objects used `status`, so fall back to it defensively. Returns "" if
    neither is present.
    """
    raw = getattr(sandbox, "state", None)
    if raw is None:
        raw = getattr(sandbox, "status", None)
    return (raw.value if hasattr(raw, "value") else str(raw or "")).lower()


def _sandbox_in_error_state(sandbox: Any) -> bool:
    """True when a sandbox is in a Daytona error state.

    Keys on `state` exactly like the SDK's own wait loops (which fail only on
    state in {error, build_failed}); a populated `error_reason` is honored
    ONLY when the state can't be resolved, so a healthy/started sandbox that
    happens to carry a stale error_reason is never misclassified.
    """
    state = _sandbox_state(sandbox)
    if state in _TERMINAL_ERROR_STATES:
        return True
    return not state and bool(getattr(sandbox, "error_reason", None))


def _sandbox_error_reason(sandbox: Any) -> str | None:
    """Return a message if a sandbox is wedged in an UNRECOVERABLE error state.

    A sandbox whose container vanished out-of-band (Daytona infra hiccup,
    docker prune) lands in 'error'/'build_failed' and can never be started —
    client.start() rejects it with "Sandbox is in an errored state". Daytona
    distinguishes these from RECOVERABLE errors via the `recoverable` flag
    (those are revived with recover(), preserving the workspace), so a
    recoverable error returns None here — only the unrecoverable ones are
    treated as gone. Returns None for a healthy/startable sandbox.
    """
    if not _sandbox_in_error_state(sandbox) or getattr(sandbox, "recoverable", False):
        return None
    reason = getattr(sandbox, "error_reason", None)
    return reason or f"sandbox is in an unrecoverable '{_sandbox_state(sandbox) or 'error'}' state"


def _sandbox_is_recoverable_error(sandbox: Any) -> bool:
    """True when a sandbox is in an error state that recover() can revive."""
    return _sandbox_in_error_state(sandbox) and bool(
        getattr(sandbox, "recoverable", False)
    )

# Resource tier presets
RESOURCE_TIERS = {
    "basic": {"cpu": 1, "memory": 1, "disk": 3},
    "standard": {"cpu": 2, "memory": 4, "disk": 8},
    "performance": {"cpu": 4, "memory": 8, "disk": 10},
}

# Map resource tiers to Daytona snapshot names
TIER_SNAPSHOTS = {
    "basic": "daytona-small",
    "standard": "daytona-medium",
    "performance": "daytona-large",
}


@dataclass
class CodeExecutionResult:
    exit_code: int
    stdout: str
    stderr: str
    execution_time: float | None = None
    charts: list[dict] | None = None


@dataclass
class CommandResult:
    exit_code: int
    stdout: str
    stderr: str


@dataclass
class FileInfo:
    name: str
    path: str
    is_dir: bool
    size: int | None = None
    modified: str | None = None


@dataclass
class GitStatus:
    branch: str
    ahead: int
    behind: int
    files: list[dict]


class DaytonaService:
    """Manages Daytona sandbox lifecycle and operations."""

    _RUNNING_CACHE_TTL = 30  # seconds

    def __init__(self):
        self._client: Daytona | None = None
        # Cache of sandbox_id -> (sandbox, timestamp) for _ensure_running
        self._running_cache: dict[str, tuple[Any, float]] = {}

    def _get_client(self) -> Daytona:
        if self._client is None:
            config = DaytonaConfig(
                api_key=settings.daytona_api_key,
                api_url=settings.daytona_api_url,
                target=settings.daytona_target,
            )
            self._client = Daytona(config)
        return self._client

    # ── Lifecycle ──────────────────────────────────────────

    def create_sandbox(
        self,
        user_id: str,
        harness_id: str | None = None,
        language: str = "python",
        resource_tier: str = "basic",
        ephemeral: bool = True,
        labels: dict[str, str] | None = None,
        git_repo: str | None = None,
    ) -> Any:
        """Create a new Daytona sandbox."""
        client = self._get_client()

        snapshot = TIER_SNAPSHOTS.get(resource_tier, TIER_SNAPSHOTS["basic"])

        sandbox_labels = {
            "harness_user_id": user_id,
            "harness_resource_tier": resource_tier,
            **({"harness_id": harness_id} if harness_id else {}),
            **(labels or {}),
        }

        # User-visible workspace/code-exec boxes hold the user's files, so give
        # them the long grace period before Daytona reclaims an untouched one —
        # the bound that stops stopped/archived boxes from accumulating without
        # surprise-deleting an actively-used sandbox. Clamp non-positive to -1
        # (disabled): Daytona reads 0 as "delete immediately on stop".
        auto_delete = settings.acp_persistent_sandbox_auto_delete_minutes
        params = CreateSandboxFromSnapshotParams(
            snapshot=snapshot,
            language=language,
            auto_stop_interval=15,
            auto_delete_interval=auto_delete if auto_delete > 0 else -1,
            labels=sandbox_labels,
            ephemeral=False,
        )

        logger.info(
            "Creating Daytona sandbox for user '%s' "
            "(tier=%s, snapshot=%s, language=%s, ephemeral=%s)",
            user_id, resource_tier, snapshot, language, ephemeral,
        )

        sandbox = client.create(params)
        logger.info(
            "Created sandbox '%s' for user '%s'",
            sandbox.id, user_id,
        )
        return sandbox

    def get_sandbox(self, sandbox_id: str) -> Any:
        """Get a sandbox by its Daytona ID."""
        client = self._get_client()
        return client.get(sandbox_id)

    def _ensure_running(self, sandbox_id: str) -> Any:
        """Get a sandbox, auto-starting it if stopped/archived.

        Uses a short-lived TTL cache to avoid a Daytona API round-trip on
        every filesystem/git/command operation.
        """
        cached = self._running_cache.get(sandbox_id)
        if cached is not None:
            sandbox, ts = cached
            if time.time() - ts < self._RUNNING_CACHE_TTL:
                return sandbox

        client = self._get_client()
        sandbox = self._resolve_error_state(client, sandbox_id, client.get(sandbox_id))
        state = _sandbox_state(sandbox)
        logger.info("Sandbox '%s' state: %s", sandbox_id, state)
        if state not in ("started",):
            # Archiving moves the whole filesystem to object storage, so a
            # restore is materially slower than waking a merely-stopped
            # sandbox — give it a much larger budget before timing out.
            start_timeout = 180 if state == "archived" else 60
            logger.info(
                "Sandbox '%s' is %s — auto-starting (timeout=%ds)",
                sandbox_id, state, start_timeout,
            )
            client.start(sandbox, timeout=start_timeout)
            sandbox = client.get(sandbox_id)
            logger.info(
                "Auto-started sandbox '%s', now %s",
                sandbox_id, _sandbox_state(sandbox),
            )

        self._running_cache[sandbox_id] = (sandbox, time.time())
        return sandbox

    def _resolve_error_state(self, client: Daytona, sandbox_id: str, sandbox: Any) -> Any:
        """Handle a sandbox sitting in a Daytona error state.

        - recoverable error  → recover() it in place (preserves the workspace)
          and return the revived sandbox.
        - unrecoverable error → raise DaytonaNotFoundError so callers treat it
          as gone (re-provision) instead of looping on the opaque "Sandbox is
          in an errored state" that client.start() would raise.
        - healthy             → return unchanged.
        """
        if _sandbox_is_recoverable_error(sandbox):
            logger.warning(
                "Sandbox '%s' is in a recoverable error state — recovering",
                sandbox_id,
            )
            try:
                sandbox.recover()
            except DaytonaError as e:
                # recover() itself failed (it re-raises if the box lands back
                # in error). Fall through to the 'gone' path so callers
                # re-provision uniformly instead of hard-failing.
                self._invalidate_running_cache(sandbox_id)
                raise DaytonaNotFoundError(
                    f"Sandbox {sandbox_id} failed to recover: {e}"
                ) from e
            return client.get(sandbox_id)
        err = _sandbox_error_reason(sandbox)
        if err:
            self._invalidate_running_cache(sandbox_id)
            logger.warning(
                "Sandbox '%s' is in an unrecoverable error state (%s) — "
                "treating as gone", sandbox_id, err,
            )
            raise DaytonaNotFoundError(
                f"Sandbox {sandbox_id} is in an unrecoverable error state: {err}"
            )
        return sandbox

    def _invalidate_running_cache(self, sandbox_id: str) -> None:
        self._running_cache.pop(sandbox_id, None)

    def start_sandbox(self, sandbox_id: str) -> None:
        """Start a stopped sandbox.

        A recoverable error sandbox is recover()ed; an unrecoverable one
        raises DaytonaNotFoundError (so the route can tell the user to
        recreate it) rather than firing client.start() at a sandbox that can
        only answer with the opaque "Sandbox is in an errored state".
        """
        client = self._get_client()
        sandbox = self._resolve_error_state(client, sandbox_id, client.get(sandbox_id))
        if _sandbox_state(sandbox) == "started":
            self._invalidate_running_cache(sandbox_id)
            logger.info("Sandbox '%s' already started", sandbox_id)
            return
        client.start(sandbox)
        self._invalidate_running_cache(sandbox_id)
        logger.info("Started sandbox '%s'", sandbox_id)

    def stop_sandbox(self, sandbox_id: str) -> None:
        """Stop a running sandbox."""
        client = self._get_client()
        sandbox = client.get(sandbox_id)
        client.stop(sandbox)
        self._invalidate_running_cache(sandbox_id)
        logger.info("Stopped sandbox '%s'", sandbox_id)

    def delete_sandbox(self, sandbox_id: str) -> None:
        """Delete a sandbox permanently."""
        client = self._get_client()
        sandbox = client.get(sandbox_id)
        client.delete(sandbox)
        self._invalidate_running_cache(sandbox_id)
        logger.info("Deleted sandbox '%s'", sandbox_id)

    # ── Code Execution ─────────────────────────────────────

    def execute_code(
        self,
        sandbox_id: str,
        code: str,
        language: str = "python",
        timeout: int = 30,
        env: dict[str, str] | None = None,
    ) -> CodeExecutionResult:
        """Execute code in a sandbox (stateless).

        `env` (e.g. resolved workspace credentials) is passed only to the SDK
        call — it is never logged. NEVER add it to any log line below.
        """
        sandbox = self._ensure_running(sandbox_id)
        logger.info(
            "Executing %s code in sandbox '%s' (timeout=%ds)",
            language, sandbox_id, timeout,
        )

        start = time.time()
        response = sandbox.process.code_run(
            code,
            params=CodeRunParams(env=env) if env else None,
            timeout=timeout,
        )
        elapsed = time.time() - start

        # Extract chart images (base64 PNGs) from artifacts
        charts: list[dict] | None = None
        if response.artifacts and response.artifacts.charts:
            charts = []
            for chart in response.artifacts.charts:
                entry: dict = {}
                if chart.title:
                    entry["title"] = chart.title
                if chart.png:
                    entry["png"] = chart.png
                if entry:
                    charts.append(entry)

        return CodeExecutionResult(
            exit_code=response.exit_code,
            stdout=response.result or "",
            stderr="",
            execution_time=round(elapsed, 2),
            charts=charts if charts else None,
        )

    # ── Command Execution ──────────────────────────────────

    def run_command(
        self,
        sandbox_id: str,
        command: str,
        cwd: str = "/home/daytona",
        timeout: int = 60,
        env: dict[str, str] | None = None,
    ) -> CommandResult:
        """Execute a shell command in a sandbox.

        `env` (e.g. resolved workspace credentials) is passed only to the SDK
        call — it is never logged. NEVER add it to the command log line.
        """
        sandbox = self._ensure_running(sandbox_id)
        logger.info(
            "Running command in sandbox '%s': %s",
            sandbox_id, command[:100],
        )
        response = sandbox.process.exec(
            command, cwd=cwd, timeout=timeout, env=env or None,
        )
        return CommandResult(
            exit_code=response.exit_code,
            stdout=response.result or "",
            stderr="",
        )

    # ── Filesystem ─────────────────────────────────────────

    def list_files(
        self, sandbox_id: str, path: str = "/home/daytona",
    ) -> list[FileInfo]:
        """List files in a sandbox directory."""
        sandbox = self._ensure_running(sandbox_id)
        files = sandbox.fs.list_files(path)
        return [
            FileInfo(
                name=getattr(f, "name", str(f)),
                path=f"{path}/{getattr(f, 'name', str(f))}",
                is_dir=getattr(f, "is_dir", False),
                size=getattr(f, "size", None),
            )
            for f in files
        ]

    def read_file(self, sandbox_id: str, path: str) -> str:
        """Read file content from a sandbox."""
        sandbox = self._ensure_running(sandbox_id)
        content = sandbox.fs.download_file(path)
        if isinstance(content, bytes):
            return content.decode("utf-8", errors="replace")
        return str(content) if content else ""

    def download_file_bytes(self, sandbox_id: str, path: str) -> bytes | None:
        """Download raw file bytes from a sandbox."""
        sandbox = self._ensure_running(sandbox_id)
        data = sandbox.fs.download_file(path)
        if data is None:
            return None
        return data if isinstance(data, bytes) else data.encode()

    def write_file(
        self, sandbox_id: str, path: str, content: str,
    ) -> None:
        """Write content to a file in a sandbox."""
        sandbox = self._ensure_running(sandbox_id)
        sandbox.fs.upload_file(content.encode("utf-8"), path)

    def delete_file(
        self, sandbox_id: str, path: str, recursive: bool = False,
    ) -> None:
        """Delete a file or directory in a sandbox."""
        sandbox = self._ensure_running(sandbox_id)
        sandbox.fs.delete_file(path, recursive=recursive)

    def create_directory(
        self, sandbox_id: str, path: str,
    ) -> None:
        """Create a directory in a sandbox."""
        sandbox = self._ensure_running(sandbox_id)
        sandbox.fs.create_folder(path, "0755")

    def move_file(
        self, sandbox_id: str, source: str, destination: str,
    ) -> None:
        """Move/rename a file in a sandbox."""
        sandbox = self._ensure_running(sandbox_id)
        sandbox.fs.move_files(source, destination)

    def search_file_contents(
        self, sandbox_id: str, path: str, pattern: str,
    ) -> list[dict]:
        """Search file contents in a sandbox (grep-like)."""
        sandbox = self._ensure_running(sandbox_id)
        matches = sandbox.fs.find_files(path, pattern)
        return [
            {
                "file": getattr(m, "file", str(m)),
                "line": getattr(m, "line", None),
                "content": getattr(m, "content", str(m)),
            }
            for m in matches
        ]

    def search_file_names(
        self, sandbox_id: str, path: str, pattern: str,
    ) -> list[str]:
        """Search file names in a sandbox (glob-like)."""
        sandbox = self._ensure_running(sandbox_id)
        result = sandbox.fs.search_files(path, pattern)
        if hasattr(result, "files"):
            return result.files
        return [str(r) for r in result] if result else []

    def find_and_replace(
        self,
        sandbox_id: str,
        files: list[str],
        pattern: str,
        replacement: str,
    ) -> list[dict]:
        """Find and replace across files in a sandbox."""
        sandbox = self._ensure_running(sandbox_id)
        results = sandbox.fs.replace_in_files(
            files, pattern, replacement,
        )
        return [
            {
                "file": getattr(r, "file", str(r)),
                "replacements": getattr(r, "replacements", 0),
            }
            for r in results
        ]

    # ── Git Operations ─────────────────────────────────────

    def git_clone(
        self,
        sandbox_id: str,
        url: str,
        path: str | None = None,
        branch: str | None = None,
        username: str | None = None,
        password: str | None = None,
    ) -> str:
        """Clone a git repository into a sandbox."""
        sandbox = self._ensure_running(sandbox_id)
        if path is None:
            repo_name = url.rstrip("/").split("/")[-1]
            repo_name = repo_name.replace(".git", "")
            path = f"/home/daytona/{repo_name}"
        kwargs: dict[str, Any] = {"branch": branch}
        if username:
            kwargs["username"] = username
        if password:
            kwargs["password"] = password
        sandbox.git.clone(url, path, **kwargs)
        logger.info(
            "Cloned %s into sandbox '%s' at %s",
            url, sandbox_id, path,
        )
        return path

    def git_status(
        self, sandbox_id: str, path: str,
    ) -> GitStatus:
        """Get git status for a repo in a sandbox."""
        sandbox = self._ensure_running(sandbox_id)
        status = sandbox.git.status(path)
        files = []
        file_status = getattr(status, "file_status", None)
        if file_status:
            for f in file_status:
                files.append({
                    "path": getattr(f, "path", str(f)),
                    "status": getattr(f, "status", "unknown"),
                })
        return GitStatus(
            branch=getattr(
                status, "current_branch", "unknown",
            ),
            ahead=getattr(status, "ahead", 0),
            behind=getattr(status, "behind", 0),
            files=files,
        )

    def git_add(
        self, sandbox_id: str, path: str, files: list[str],
    ) -> None:
        """Stage files in a sandbox repo."""
        sandbox = self._ensure_running(sandbox_id)
        sandbox.git.add(path, files)

    def git_commit(
        self, sandbox_id: str, path: str, message: str,
    ) -> str:
        """Commit staged changes. Returns the commit SHA."""
        sandbox = self._ensure_running(sandbox_id)
        result = sandbox.git.commit(
            path, message, "Harness", "harness@daytona.io",
        )
        return getattr(result, "sha", str(result))

    def git_push(
        self,
        sandbox_id: str,
        path: str,
        username: str | None = None,
        password: str | None = None,
    ) -> None:
        """Push commits to remote."""
        sandbox = self._ensure_running(sandbox_id)
        kwargs: dict[str, Any] = {}
        if username:
            kwargs["username"] = username
        if password:
            kwargs["password"] = password
        sandbox.git.push(path, **kwargs)

    def git_pull(
        self,
        sandbox_id: str,
        path: str,
        username: str | None = None,
        password: str | None = None,
    ) -> None:
        """Pull from remote."""
        sandbox = self._ensure_running(sandbox_id)
        kwargs: dict[str, Any] = {}
        if username:
            kwargs["username"] = username
        if password:
            kwargs["password"] = password
        sandbox.git.pull(path, **kwargs)

    def git_branches(
        self, sandbox_id: str, path: str,
    ) -> dict:
        """List branches in a sandbox repo."""
        sandbox = self._ensure_running(sandbox_id)
        result = sandbox.git.branches(path)
        branches = []
        if hasattr(result, "branches"):
            branches = [
                getattr(b, "name", str(b))
                for b in result.branches
            ]
        return {"branches": branches}

    def git_checkout(
        self,
        sandbox_id: str,
        path: str,
        branch: str,
        create: bool = False,
    ) -> None:
        """Checkout a branch in a sandbox repo."""
        sandbox = self._ensure_running(sandbox_id)
        if create:
            sandbox.git.create_branch(path, branch)
        sandbox.git.checkout_branch(path, branch)

    def git_log(
        self, sandbox_id: str, path: str, count: int = 10,
    ) -> list[dict]:
        """Get git log via shell command."""
        fmt = "%H|%s|%an|%aI"
        result = self.run_command(
            sandbox_id,
            f'git -C {shlex.quote(path)} log --oneline -{count}'
            f' --format="{fmt}"',
        )
        commits = []
        for line in result.stdout.strip().split("\n"):
            if "|" in line:
                parts = line.split("|", 3)
                commits.append({
                    "sha": parts[0],
                    "message": parts[1] if len(parts) > 1 else "",
                    "author": parts[2] if len(parts) > 2 else "",
                    "date": parts[3] if len(parts) > 3 else "",
                })
        return commits

    def git_diff(
        self, sandbox_id: str, path: str, staged: bool = False,
    ) -> str:
        """Get git diff via shell command."""
        flag = " --cached" if staged else ""
        result = self.run_command(
            sandbox_id, f"git -C {shlex.quote(path)} diff{flag}",
        )
        return result.stdout

    # ── Credentials ────────────────────────────────────────

    def setup_git_credentials(
        self,
        sandbox_id: str,
        username: str,
        token: str,
    ) -> None:
        """Configure git credential store in a sandbox.

        Writes credentials to ~/.git-credentials and sets the credential
        helper so that both SDK git operations and raw `git push/pull`
        commands via run_command authenticate automatically.
        """
        cred_line = f"https://{username}:{token}@github.com"
        sandbox = self._ensure_running(sandbox_id)
        # Write the credentials file
        sandbox.process.exec(
            f'printf "%s\\n" "{cred_line}" > /home/daytona/.git-credentials'
            " && chmod 600 /home/daytona/.git-credentials"
            " && git config --global credential.helper store",
            cwd="/home/daytona",
        )
        logger.info(
            "Configured git credential store in sandbox '%s'", sandbox_id,
        )

    # ── Preview URLs ───────────────────────────────────────

    def get_preview_url(
        self, sandbox_id: str, port: int,
    ) -> str:
        """Get a preview URL for a port on the sandbox.

        Uses create_signed_preview_url for a self-contained signed URL
        that works in iframes without cookie/callback auth flow.
        Falls back to get_preview_link if signed URL is unavailable.
        """
        sandbox = self._ensure_running(sandbox_id)
        try:
            # Signed URL: self-contained, works in iframes, 5 min expiry
            result = sandbox.create_signed_preview_url(
                port, expires_in_seconds=300,
            )
            return result.url
        except Exception:
            # Fallback to regular preview link
            result = sandbox.get_preview_link(port)
            return result.url


# Module-level singleton
_service: DaytonaService | None = None


def get_daytona_service() -> DaytonaService:
    global _service
    if _service is None:
        _service = DaytonaService()
    return _service
