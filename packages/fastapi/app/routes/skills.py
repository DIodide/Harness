import logging
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Request

logger = logging.getLogger(__name__)

router = APIRouter()

HF_DATASET = "tickleliu/all-skills-from-skills-sh"
HF_BASE = "https://datasets-server.huggingface.co"
HF_COMMON_PARAMS = f"dataset={HF_DATASET}&config=default&split=train"


def _strip_detail(row: dict) -> dict:
    """Return a row dict without the heavy 'detail' field."""
    r = row.get("row", row)
    return {
        "name": r.get("name", ""),
        "skill_name": r.get("skill_name", ""),
        "description": r.get("description", ""),
        "code": r.get("code", ""),
    }


@router.get("")
async def list_skills(
    request: Request,
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
):
    """Paginated browse of the full skills catalog (no detail field)."""
    client = request.app.state.http_client
    url = f"{HF_BASE}/rows?{HF_COMMON_PARAMS}&offset={offset}&length={limit}"

    resp = await client.get(url)
    if resp.status_code != 200:
        logger.error("HuggingFace /rows returned %s: %s", resp.status_code, resp.text[:300])
        raise HTTPException(502, "Failed to fetch skills from catalog")

    data = resp.json()
    rows = [_strip_detail(r) for r in data.get("rows", [])]
    return {
        "rows": rows,
        "total": data.get("num_rows_total", 0),
        "offset": offset,
        "limit": limit,
    }


@router.get("/search")
async def search_skills(
    request: Request,
    q: str = Query(..., min_length=1),
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
):
    """Full-text search across skills (no detail field)."""
    client = request.app.state.http_client
    encoded_q = quote(q)
    url = f"{HF_BASE}/search?{HF_COMMON_PARAMS}&query={encoded_q}&offset={offset}&length={limit}"

    resp = await client.get(url)
    if resp.status_code != 200:
        logger.error("HuggingFace /search returned %s: %s", resp.status_code, resp.text[:300])
        raise HTTPException(502, "Failed to search skills catalog")

    data = resp.json()
    rows = [_strip_detail(r) for r in data.get("rows", [])]
    return {
        "rows": rows,
        "total": data.get("num_rows_total", 0),
        "offset": offset,
        "limit": limit,
    }


@router.get("/detail")
async def get_skill_detail(
    request: Request,
    name: str = Query(..., min_length=1),
):
    """Fetch the full detail (markdown) for a single skill by exact name.

    Called server-to-server by Convex actions, not by the browser.
    """
    client = request.app.state.http_client
    encoded_name = quote(name)
    url = f"{HF_BASE}/search?{HF_COMMON_PARAMS}&query={encoded_name}&offset=0&length=5"

    resp = await client.get(url)
    if resp.status_code != 200:
        logger.error("HuggingFace /search returned %s: %s", resp.status_code, resp.text[:300])
        raise HTTPException(502, "Failed to fetch skill detail")

    data = resp.json()
    for entry in data.get("rows", []):
        row = entry.get("row", entry)
        if row.get("name") == name:
            return {
                "name": row.get("name", ""),
                "skill_name": row.get("skill_name", ""),
                "description": row.get("description", ""),
                "detail": row.get("detail", ""),
                "code": row.get("code", ""),
            }

    raise HTTPException(404, f"Skill not found: {name}")
