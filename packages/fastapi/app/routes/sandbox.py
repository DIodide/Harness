"""
Sandbox REST API routes.

Provides direct frontend access to sandbox lifecycle, code execution,
filesystem, and git operations. These are separate from the chat agentic
loop tools — they power the sandbox management UI, file explorer, and
terminal panel.
"""

import logging
import mimetypes
import shlex

import httpx
from daytona_sdk import DaytonaNotFoundError
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import Response
from app.dependencies import get_current_user, get_http_client
from app.models import (
    SandboxCreateRequest,
    SandboxExecuteRequest,
    SandboxCommandRequest,
    SandboxFileWriteRequest,
    SandboxFileMoveRequest,
    SandboxMkdirRequest,
    GitAddRequest,
    GitCommitRequest,
)
from app.services.convex import (
    SandboxRecordError,
    create_sandbox_record,
    verify_sandbox_owner,
    verify_sandbox_read_access,
)
from app.services.daytona_service import (
    RESOURCE_TIERS,
    DaytonaService,
    _sandbox_state,
    get_daytona_service,
)
from app.services.workspace_credentials import resolve_workspace_env

router = APIRouter()
logger = logging.getLogger(__name__)


def _get_service() -> DaytonaService:
    return get_daytona_service()


async def _resolve_workspace_env(
    http_client: httpx.AsyncClient,
    workspace_id: str | None,
    user: dict,
) -> dict[str, str] | None:
    """Resolve a workspace's assigned credentials for code/command execution.

    Ownership of the workspace is re-checked server-side inside
    resolve_workspace_env. Best-effort: returns None when there's no workspace,
    no assigned credentials, or resolution fails — never blocks execution.
    NEVER log the result.
    """
    if not workspace_id:
        return None
    try:
        env = await resolve_workspace_env(http_client, workspace_id, user["sub"])
    except Exception:
        logger.warning(
            "Failed to resolve workspace credentials for sandbox execution",
            exc_info=True,
        )
        return None
    return env or None


async def _assert_sandbox_owner(sandbox_id: str, user: dict) -> None:
    """Raise 403 if the authenticated user does not own the sandbox. Used by
    every MUTATING / lifecycle / terminal route — collaborators never pass."""
    user_id = user.get("sub")
    if not await verify_sandbox_owner(sandbox_id, user_id):
        raise HTTPException(
            status_code=403, detail="You do not have access to this sandbox"
        )


async def _assert_sandbox_read_access(
    sandbox_id: str,
    user: dict,
    conversation_id: str | None,
    token: str | None,
    http_client: httpx.AsyncClient,
) -> None:
    """Authorize a READ-ONLY sandbox op: the owner, OR an editor-grant
    collaborator on `conversation_id` whose owner's harness is bound to this
    sandbox. Only the read routes use this; mutating routes stay owner-only, so
    even a forged write to a browsable sandbox still 403s."""
    sub = user.get("sub")
    if await verify_sandbox_owner(sandbox_id, sub):
        return
    if conversation_id and await verify_sandbox_read_access(
        http_client, conversation_id, sandbox_id, sub, token
    ):
        return
    raise HTTPException(
        status_code=403, detail="You do not have access to this sandbox"
    )


@router.post("")
async def create_sandbox(
    body: SandboxCreateRequest,
    user: dict = Depends(get_current_user),
):
    """Create a new Daytona sandbox.

    The per-user sandbox cap is enforced inside Convex's `sandboxes.createInternal`
    mutation. If Convex rejects the record after Daytona has provisioned the
    sandbox, we roll back the Daytona sandbox so we don't leak resources.
    """
    user_id = user.get("sub")
    service = _get_service()
    try:
        sandbox = service.create_sandbox(
            user_id=user_id,
            harness_id=body.harness_id,
            language=body.language,
            resource_tier=body.resource_tier,
            ephemeral=body.ephemeral,
            git_repo=body.git_repo,
        )
    except Exception as e:
        logger.error("Failed to create sandbox: %s", e)
        raise HTTPException(status_code=500, detail=str(e))

    tier = RESOURCE_TIERS.get(body.resource_tier, RESOURCE_TIERS["basic"])
    try:
        async with httpx.AsyncClient() as http_client:
            await create_sandbox_record(
                http_client,
                user_id=user_id,
                harness_id=body.harness_id,
                daytona_sandbox_id=sandbox.id,
                name=body.name,
                language=body.language,
                ephemeral=body.ephemeral,
                resources={
                    "cpu": tier["cpu"],
                    "memoryGB": tier["memory"],
                    "diskGB": tier["disk"],
                },
            )
    except SandboxRecordError as e:
        # Convex rejected the record (e.g. sandbox cap hit). Clean up the
        # Daytona sandbox we just provisioned so we don't orphan it.
        try:
            service.delete_sandbox(sandbox.id)
        except Exception:
            logger.exception(
                "Failed to roll back Daytona sandbox '%s' after Convex rejection",
                sandbox.id,
            )
        status = 400 if e.code == "sandbox_limit_reached" else 502
        raise HTTPException(status_code=status, detail=str(e))

    return {
        "id": sandbox.id,
        "status": "running",
        "language": body.language,
        "resource_tier": body.resource_tier,
        "ephemeral": body.ephemeral,
    }


@router.get("/{sandbox_id}")
async def get_sandbox(
    sandbox_id: str,
    conversation_id: str | None = Query(default=None),
    x_share_token: str | None = Header(default=None),
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    """Get sandbox details and status."""
    await _assert_sandbox_read_access(
        sandbox_id, user, conversation_id, x_share_token, http_client
    )
    service = _get_service()
    try:
        sandbox = service.get_sandbox(sandbox_id)
        # The SDK object exposes `state` (a SandboxState enum), not `status`;
        # _sandbox_state normalizes it (the old `sandbox.status` read always
        # fell through to "unknown").
        return {
            "id": sandbox.id,
            "status": _sandbox_state(sandbox) or "unknown",
        }
    except Exception as e:
        logger.error("Failed to get sandbox '%s': %s", sandbox_id, e)
        raise HTTPException(status_code=404, detail="Sandbox not found")


@router.delete("/{sandbox_id}")
async def delete_sandbox(
    sandbox_id: str,
    user: dict = Depends(get_current_user),
):
    """Delete a sandbox."""
    await _assert_sandbox_owner(sandbox_id, user)
    service = _get_service()
    try:
        service.delete_sandbox(sandbox_id)
        return {"success": True}
    except Exception as e:
        logger.error("Failed to delete sandbox '%s': %s", sandbox_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{sandbox_id}/start")
async def start_sandbox(
    sandbox_id: str,
    user: dict = Depends(get_current_user),
):
    """Start a stopped sandbox."""
    await _assert_sandbox_owner(sandbox_id, user)
    service = _get_service()
    try:
        service.start_sandbox(sandbox_id)
        return {"success": True, "status": "running"}
    except DaytonaNotFoundError as e:
        # Errored/vanished sandbox: it can't be started — tell the user to
        # recreate it rather than surfacing the opaque Daytona error.
        logger.warning("Cannot start sandbox '%s': %s", sandbox_id, e)
        raise HTTPException(
            status_code=409,
            detail=(
                "This sandbox is in an unrecoverable error state (its "
                "container no longer exists). Delete it and create a new one."
            ),
        )
    except Exception as e:
        logger.error("Failed to start sandbox '%s': %s", sandbox_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{sandbox_id}/stop")
async def stop_sandbox(
    sandbox_id: str,
    user: dict = Depends(get_current_user),
):
    """Stop a running sandbox."""
    await _assert_sandbox_owner(sandbox_id, user)
    service = _get_service()
    try:
        service.stop_sandbox(sandbox_id)
        return {"success": True, "status": "stopped"}
    except Exception as e:
        logger.error("Failed to stop sandbox '%s': %s", sandbox_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{sandbox_id}/execute")
async def execute_code(
    sandbox_id: str,
    body: SandboxExecuteRequest,
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    """Execute code in a sandbox."""
    await _assert_sandbox_owner(sandbox_id, user)
    service = _get_service()
    env = await _resolve_workspace_env(http_client, body.workspace_id, user)
    try:
        result = service.execute_code(
            sandbox_id, body.code, body.language, body.timeout, env=env
        )
        return {
            "exit_code": result.exit_code,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "execution_time": result.execution_time,
        }
    except Exception as e:
        logger.error("Code execution failed in sandbox '%s': %s", sandbox_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{sandbox_id}/command")
async def run_command(
    sandbox_id: str,
    body: SandboxCommandRequest,
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    """Run a shell command in a sandbox."""
    await _assert_sandbox_owner(sandbox_id, user)
    service = _get_service()
    env = await _resolve_workspace_env(http_client, body.workspace_id, user)
    try:
        result = service.run_command(
            sandbox_id, body.command, body.working_directory, body.timeout,
            env=env,
        )
        return {
            "exit_code": result.exit_code,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except Exception as e:
        logger.error("Command failed in sandbox '%s': %s", sandbox_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{sandbox_id}/files")
async def list_files(
    sandbox_id: str,
    path: str = Query(default="/home/daytona"),
    conversation_id: str | None = Query(default=None),
    x_share_token: str | None = Header(default=None),
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    """List files in a sandbox directory."""
    await _assert_sandbox_read_access(
        sandbox_id, user, conversation_id, x_share_token, http_client
    )
    service = _get_service()
    try:
        files = service.list_files(sandbox_id, path)
        return {
            "path": path,
            "files": [
                {"name": f.name, "path": f.path, "is_dir": f.is_dir, "size": f.size}
                for f in files
            ],
        }
    except Exception as e:
        logger.error("File listing failed in sandbox '%s': %s", sandbox_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{sandbox_id}/files/read")
async def read_file(
    sandbox_id: str,
    path: str = Query(...),
    conversation_id: str | None = Query(default=None),
    x_share_token: str | None = Header(default=None),
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    """Read a file from a sandbox."""
    await _assert_sandbox_read_access(
        sandbox_id, user, conversation_id, x_share_token, http_client
    )
    service = _get_service()
    try:
        content = service.read_file(sandbox_id, path)
        return {"path": path, "content": content}
    except Exception as e:
        logger.error("File read failed in sandbox '%s': %s", sandbox_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{sandbox_id}/files/write")
async def write_file(
    sandbox_id: str,
    body: SandboxFileWriteRequest,
    user: dict = Depends(get_current_user),
):
    """Write a file in a sandbox."""
    await _assert_sandbox_owner(sandbox_id, user)
    service = _get_service()
    try:
        service.write_file(sandbox_id, body.path, body.content)
        return {"success": True, "path": body.path}
    except Exception as e:
        logger.error("File write failed in sandbox '%s': %s", sandbox_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{sandbox_id}/files/download")
async def download_file(
    sandbox_id: str,
    path: str = Query(...),
    conversation_id: str | None = Query(default=None),
    x_share_token: str | None = Header(default=None),
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    """Download a raw file from a sandbox (images, binaries, etc.)."""
    await _assert_sandbox_read_access(
        sandbox_id, user, conversation_id, x_share_token, http_client
    )
    service = _get_service()
    try:
        data = service.download_file_bytes(sandbox_id, path)
        if data is None:
            raise HTTPException(status_code=404, detail="File not found")
        content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
        return Response(
            content=data,
            media_type=content_type,
            # private: a collaborator may now read the owner's sandbox files —
            # keep them out of shared/proxy caches.
            headers={"Cache-Control": "private, max-age=60"},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("File download failed in sandbox '%s': %s", sandbox_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{sandbox_id}/files")
async def delete_file(
    sandbox_id: str,
    path: str = Query(...),
    recursive: bool = Query(default=False),
    user: dict = Depends(get_current_user),
):
    """Delete a file or directory in a sandbox."""
    await _assert_sandbox_owner(sandbox_id, user)
    service = _get_service()
    try:
        service.delete_file(sandbox_id, path, recursive=recursive)
        return {"success": True, "path": path}
    except Exception as e:
        logger.error("File delete failed in sandbox '%s': %s", sandbox_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{sandbox_id}/files/move")
async def move_file(
    sandbox_id: str,
    body: SandboxFileMoveRequest,
    user: dict = Depends(get_current_user),
):
    """Move/rename a file or directory in a sandbox."""
    await _assert_sandbox_owner(sandbox_id, user)
    service = _get_service()
    try:
        service.move_file(sandbox_id, body.source, body.destination)
        return {"success": True, "source": body.source, "destination": body.destination}
    except Exception as e:
        logger.error("File move failed in sandbox '%s': %s", sandbox_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{sandbox_id}/files/mkdir")
async def create_directory(
    sandbox_id: str,
    body: SandboxMkdirRequest,
    user: dict = Depends(get_current_user),
):
    """Create a directory in a sandbox."""
    await _assert_sandbox_owner(sandbox_id, user)
    service = _get_service()
    try:
        service.create_directory(sandbox_id, body.path)
        return {"success": True, "path": body.path}
    except Exception as e:
        logger.error("Mkdir failed in sandbox '%s': %s", sandbox_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{sandbox_id}/files/search")
async def search_files(
    sandbox_id: str,
    path: str = Query(default="/home/daytona"),
    pattern: str = Query(...),
    conversation_id: str | None = Query(default=None),
    x_share_token: str | None = Header(default=None),
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    """Search file contents in a sandbox (grep-like)."""
    await _assert_sandbox_read_access(
        sandbox_id, user, conversation_id, x_share_token, http_client
    )
    service = _get_service()
    try:
        matches = service.search_file_contents(sandbox_id, path, pattern)
        return {"matches": matches, "pattern": pattern}
    except Exception as e:
        logger.error("Search failed in sandbox '%s': %s", sandbox_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{sandbox_id}/git/status")
async def git_status(
    sandbox_id: str,
    path: str = Query(...),
    conversation_id: str | None = Query(default=None),
    x_share_token: str | None = Header(default=None),
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    """Get git status for a repo in a sandbox."""
    await _assert_sandbox_read_access(
        sandbox_id, user, conversation_id, x_share_token, http_client
    )
    service = _get_service()
    # First check if this is a git repo via a simple command
    try:
        check = service.run_command(
            sandbox_id, f"git -C {shlex.quote(path)} rev-parse --is-inside-work-tree",
        )
        if check.exit_code != 0:
            raise HTTPException(
                status_code=400, detail="Not a git repository",
            )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=400, detail="Not a git repository",
        )
    try:
        status = service.git_status(sandbox_id, path)
        return {
            "branch": status.branch,
            "ahead": status.ahead,
            "behind": status.behind,
            "files": status.files,
        }
    except Exception as e:
        logger.error("Git status failed in sandbox '%s': %s", sandbox_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{sandbox_id}/git/add")
async def git_add(
    sandbox_id: str,
    body: GitAddRequest,
    user: dict = Depends(get_current_user),
):
    """Stage files for commit."""
    await _assert_sandbox_owner(sandbox_id, user)
    service = _get_service()
    try:
        service.git_add(sandbox_id, body.path, body.files)
        return {"success": True}
    except Exception as e:
        logger.error("Git add failed in sandbox '%s': %s", sandbox_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{sandbox_id}/git/commit")
async def git_commit(
    sandbox_id: str,
    body: GitCommitRequest,
    user: dict = Depends(get_current_user),
):
    """Commit staged changes."""
    await _assert_sandbox_owner(sandbox_id, user)
    service = _get_service()
    try:
        sha = service.git_commit(sandbox_id, body.path, body.message)
        return {"success": True, "sha": sha}
    except Exception as e:
        logger.error("Git commit failed in sandbox '%s': %s", sandbox_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{sandbox_id}/git/diff")
async def git_diff(
    sandbox_id: str,
    path: str = Query(...),
    staged: bool = Query(default=False),
    conversation_id: str | None = Query(default=None),
    x_share_token: str | None = Header(default=None),
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    """Get git diff."""
    await _assert_sandbox_read_access(
        sandbox_id, user, conversation_id, x_share_token, http_client
    )
    service = _get_service()
    try:
        diff = service.git_diff(sandbox_id, path, staged=staged)
        return {"diff": diff}
    except Exception as e:
        logger.error("Git diff failed in sandbox '%s': %s", sandbox_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{sandbox_id}/git/log")
async def git_log(
    sandbox_id: str,
    path: str = Query(...),
    count: int = Query(default=20),
    conversation_id: str | None = Query(default=None),
    x_share_token: str | None = Header(default=None),
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    """Get git log."""
    await _assert_sandbox_read_access(
        sandbox_id, user, conversation_id, x_share_token, http_client
    )
    service = _get_service()
    try:
        commits = service.git_log(sandbox_id, path, count=count)
        return {"commits": commits}
    except Exception as e:
        logger.error("Git log failed in sandbox '%s': %s", sandbox_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{sandbox_id}/git/branches")
async def git_branches(
    sandbox_id: str,
    path: str = Query(...),
    conversation_id: str | None = Query(default=None),
    x_share_token: str | None = Header(default=None),
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    """List git branches."""
    await _assert_sandbox_read_access(
        sandbox_id, user, conversation_id, x_share_token, http_client
    )
    service = _get_service()
    try:
        result = service.git_branches(sandbox_id, path)
        return result
    except Exception as e:
        logger.error("Git branches failed in sandbox '%s': %s", sandbox_id, e)
        raise HTTPException(status_code=500, detail=str(e))
