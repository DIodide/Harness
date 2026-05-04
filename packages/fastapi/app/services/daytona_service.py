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
    Daytona,
    DaytonaConfig,
    CreateSandboxFromSnapshotParams,
)
from daytona_sdk.common.errors import DaytonaError

from app.config import settings

logger = logging.getLogger(__name__)

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

        params = CreateSandboxFromSnapshotParams(
            snapshot=snapshot,
            language=language,
            auto_stop_interval=15,
            labels=sandbox_labels,
            ephemeral=ephemeral,
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
        """Get a sandbox, auto-starting it if not already started.

        Uses a short-lived TTL cache to avoid a Daytona API round-trip on
        every filesystem/git/command operation. Daytona's `start` is
        idempotent for archived sandboxes (it restores them), so this also
        recovers transparently from idle auto-stop.

        Reactive LRU: if Daytona refuses to start the sandbox because the
        user is at the per-account started-sandbox limit, evicts the user's
        least-recently-used started sandbox and retries once.
        """
        cached = self._running_cache.get(sandbox_id)
        if cached is not None:
            sandbox, ts = cached
            if time.time() - ts < self._RUNNING_CACHE_TTL:
                return sandbox

        from app.services.convex import touch_sandbox_sync

        client = self._get_client()
        sandbox = client.get(sandbox_id)
        # The Daytona SDK exposes the sandbox state as `.state` (a
        # SandboxState enum), not `.status`.
        raw = getattr(sandbox, "state", None)
        state = (raw.value if hasattr(raw, "value") else str(raw)).lower()
        logger.info(
            "Sandbox '%s' state: %s (raw: %r)", sandbox_id, state, raw,
        )
        if state not in ("started",):
            logger.info(
                "Sandbox '%s' is %s — auto-starting", sandbox_id, state,
            )
            sandbox = self._start_with_lru_retry(client, sandbox, sandbox_id)
            new_raw = getattr(sandbox, "state", None)
            new_state = (
                new_raw.value if hasattr(new_raw, "value") else str(new_raw)
            ).lower()
            logger.info(
                "Auto-started sandbox '%s', now %s", sandbox_id, new_state,
            )

        # Bump the LRU clock on every cache miss — both for already-running
        # and freshly-started sandboxes. Best-effort; failures don't block.
        touch_sandbox_sync(sandbox_id)

        self._running_cache[sandbox_id] = (sandbox, time.time())
        return sandbox

    def _start_with_lru_retry(
        self, client: Daytona, sandbox: Any, sandbox_id: str,
    ) -> Any:
        """Start a sandbox, evicting the user's LRU started sandbox if Daytona
        rejects the start due to a concurrency limit. Returns the freshly
        re-fetched sandbox. Re-raises if eviction is impossible or the retry
        also fails.
        """
        try:
            client.start(sandbox, timeout=60)
            return client.get(sandbox_id)
        except DaytonaError as e:
            if not self._is_started_limit_error(e):
                raise
            logger.info(
                "Sandbox '%s' start hit started-limit (status=%s, msg=%s) — evicting LRU",
                sandbox_id, e.status_code, str(e)[:200],
            )
            evicted = self._evict_lru_for(sandbox_id)
            if not evicted:
                logger.warning(
                    "No LRU candidate to evict for sandbox '%s' — re-raising",
                    sandbox_id,
                )
                raise
            logger.info(
                "Evicted '%s' to free a started slot — retrying start of '%s'",
                evicted, sandbox_id,
            )
            client.start(sandbox, timeout=60)
            return client.get(sandbox_id)

    @staticmethod
    def _is_started_limit_error(err: DaytonaError) -> bool:
        """Heuristic: treat 402/429 as a started-sandbox concurrency limit
        unconditionally. For 403 ("forbidden", which Daytona uses for
        plan/quota enforcement), additionally require a quota-related
        keyword in the message body. Other status codes — especially 400s
        with messages like "Too many query parameters" or "Limit exceeded
        on payload size" — are not treated as concurrency limits, so they
        will not trigger an LRU eviction of an unrelated sandbox.
        """
        if err.status_code in (402, 429):
            return True
        if err.status_code == 403:
            msg = str(err).lower()
            return any(
                kw in msg
                for kw in ("limit", "quota", "exceeded", "concurrent")
            )
        return False

    def _evict_lru_for(self, target_sandbox_id: str) -> str | None:
        """Stop the user's least-recently-used currently-started sandbox to
        free a slot for `target_sandbox_id`. Does NOT write Convex — system
        evictions are invisible to the user-intent layer, so the user's
        recorded status (typically "running") is preserved and the agent
        can transparently resurrect the evicted sandbox later.

        Returns the daytona ID of the sandbox that was evicted, or None if
        there's no eligible candidate.
        """
        from app.services.convex import list_sibling_sandboxes_sync

        candidates = list_sibling_sandboxes_sync(target_sandbox_id)
        client = self._get_client()
        for candidate in candidates:
            cid = candidate.get("daytonaSandboxId")
            if not cid:
                continue
            try:
                sibling = client.get(cid)
                raw = getattr(sibling, "state", None)
                state = (
                    raw.value if hasattr(raw, "value") else str(raw)
                ).lower()
                if state != "started":
                    # Already not started in Daytona — wouldn't free a slot.
                    continue
                client.stop(sibling)
                self._invalidate_running_cache(cid)
                return cid
            except Exception:
                logger.exception(
                    "Failed to evict sandbox '%s' — trying next candidate",
                    cid,
                )
                continue
        return None

    def _invalidate_running_cache(self, sandbox_id: str) -> None:
        self._running_cache.pop(sandbox_id, None)

    # ── Code Execution ─────────────────────────────────────

    def execute_code(
        self,
        sandbox_id: str,
        code: str,
        language: str = "python",
        timeout: int = 30,
    ) -> CodeExecutionResult:
        """Execute code in a sandbox (stateless)."""
        sandbox = self._ensure_running(sandbox_id)
        logger.info(
            "Executing %s code in sandbox '%s' (timeout=%ds)",
            language, sandbox_id, timeout,
        )

        start = time.time()
        response = sandbox.process.code_run(
            code, timeout=timeout,
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
    ) -> CommandResult:
        """Execute a shell command in a sandbox."""
        sandbox = self._ensure_running(sandbox_id)
        logger.info(
            "Running command in sandbox '%s': %s",
            sandbox_id, command[:100],
        )
        response = sandbox.process.exec(
            command, cwd=cwd, timeout=timeout,
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
