"""
Sandbox REST API routes.

Provides direct frontend access to sandbox lifecycle, code execution,
filesystem, and git operations. These are separate from the chat agentic
loop tools — they power the sandbox management UI, file explorer, and
terminal panel.
"""

import logging
import mimetypes

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from app.dependencies import get_current_user
from app.models import (
    SandboxCreateRequest,
    SandboxExecuteRequest,
    SandboxCommandRequest,
    SandboxFileWriteRequest,
)
from app.services.daytona_service import get_daytona_service, DaytonaService

router = APIRouter()
logger = logging.getLogger(__name__)


def _get_service() -> DaytonaService:
    return get_daytona_service()


@router.post("")
async def create_sandbox(
    body: SandboxCreateRequest,
    user: dict = Depends(get_current_user),
):
    """Create a new Daytona sandbox."""
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
        return {
            "id": sandbox.id,
            "status": "running",
            "language": body.language,
            "resource_tier": body.resource_tier,
        }
    except Exception as e:
        logger.error("Failed to create sandbox: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{sandbox_id}")
async def get_sandbox(
    sandbox_id: str,
    user: dict = Depends(get_current_user),
):
    """Get sandbox details and status."""
    service = _get_service()
    try:
        sandbox = service.get_sandbox(sandbox_id)
        return {
            "id": sandbox.id,
            "status": str(sandbox.status) if hasattr(sandbox, 'status') else "unknown",
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
    service = _get_service()
    try:
        service.start_sandbox(sandbox_id)
        return {"success": True, "status": "running"}
    except Exception as e:
        logger.error("Failed to start sandbox '%s': %s", sandbox_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{sandbox_id}/stop")
async def stop_sandbox(
    sandbox_id: str,
    user: dict = Depends(get_current_user),
):
    """Stop a running sandbox."""
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
):
    """Execute code in a sandbox."""
    service = _get_service()
    try:
        result = service.execute_code(
            sandbox_id, body.code, body.language, body.timeout
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
):
    """Run a shell command in a sandbox."""
    service = _get_service()
    try:
        result = service.run_command(
            sandbox_id, body.command, body.working_directory, body.timeout
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
    user: dict = Depends(get_current_user),
):
    """List files in a sandbox directory."""
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
    user: dict = Depends(get_current_user),
):
    """Read a file from a sandbox."""
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
    user: dict = Depends(get_current_user),
):
    """Download a raw file from a sandbox (images, binaries, etc.)."""
    service = _get_service()
    try:
        sandbox = service._ensure_running(sandbox_id)
        data = sandbox.fs.download_file(path)
        if data is None:
            raise HTTPException(status_code=404, detail="File not found")
        content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
        return Response(
            content=data if isinstance(data, bytes) else data.encode(),
            media_type=content_type,
            headers={"Cache-Control": "public, max-age=300"},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("File download failed in sandbox '%s': %s", sandbox_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{sandbox_id}/git/status")
async def git_status(
    sandbox_id: str,
    path: str = Query(...),
    user: dict = Depends(get_current_user),
):
    """Get git status for a repo in a sandbox."""
    service = _get_service()
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
