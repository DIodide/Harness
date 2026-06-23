"""REST endpoints for workspace credentials (env-var secrets).

Write-only from the browser's perspective: a value can be created or rotated
but never read back. Listing/assignment/deletion of credential *metadata* goes
directly through Convex (user-authenticated), so this router only needs the
secret-bearing write path. Auth is the Clerk JWT via `get_current_user`.
"""

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import get_current_user, get_http_client
from app.models import WorkspaceCredentialStoreRequest
from app.services.secrets_crypto import CredentialCryptoError
from app.services.workspace_credentials import (
    WorkspaceCredentialError,
    store_workspace_credential,
    validate_env_credential,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("")
async def store_credential(
    body: WorkspaceCredentialStoreRequest,
    user: dict = Depends(get_current_user),
    http_client: httpx.AsyncClient = Depends(get_http_client),
):
    """Create or rotate a workspace credential (write-only; never echoed back).

    Without credential_id this upserts by (user, name) — re-creating an
    existing name rotates its value. With credential_id the specified row is
    rotated in place. Returns the credential id so the UI can assign it.
    """
    error = validate_env_credential(body.name, body.value)
    if error:
        raise HTTPException(status_code=422, detail=error)
    try:
        credential_id = await store_workspace_credential(
            http_client,
            user["sub"],
            body.name,
            body.value,
            body.label,
            credential_id=body.credential_id,
        )
    except CredentialCryptoError as e:
        # Encryption key missing/misconfigured on this deployment.
        raise HTTPException(status_code=503, detail=str(e)) from e
    except WorkspaceCredentialError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return {
        "ok": True,
        "name": body.name,
        "credential_id": credential_id,
    }
