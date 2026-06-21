"""Fetch a skill's SKILL.md from GitHub.

Shared by the default-loop `get_skill_content` tool (routes/chat.py) and the
ACP gateway's skill materialization (agents/session_manager.py) so both have
the SAME resilient resolution: direct paths on main/master, a recursive tree
search, then org-rename + skills.sh source resolution. Mirrors the Convex
`fetchSkillMd` chain (convex/skills.ts).
"""

import logging
import os
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)

_GH_RAW = "https://raw.githubusercontent.com"
_GH_API = "https://api.github.com"
_BASES = ["skills", ".agents/skills", ".claude/skills"]
_BRANCHES = ["main", "master"]


def _api_headers() -> dict[str, str]:
    """GitHub API headers; include auth when GITHUB_TOKEN is set so we get the
    5000/hr limit instead of 60/hr per IP (which is shared server-wide). The
    Convex side already authenticates — keep parity here."""
    headers = {"Accept": "application/vnd.github.v3+json"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"token {token}"
    return headers


def _raw_headers() -> dict[str, str] | None:
    token = os.environ.get("GITHUB_TOKEN")
    return {"Authorization": f"token {token}"} if token else None


async def resolve_github_repo(
    http_client: httpx.AsyncClient, source: str
) -> str | None:
    """Canonical owner/repo via the GitHub API (follows renames/redirects)."""
    try:
        resp = await http_client.get(
            f"{_GH_API}/repos/{source}",
            headers=_api_headers(),
            timeout=10.0,
            follow_redirects=True,
        )
        if resp.status_code == 200:
            return resp.json().get("full_name")
    except Exception:
        pass
    return None


async def search_skills_sh(
    http_client: httpx.AsyncClient, skill_id: str
) -> str | None:
    """Ask skills.sh for the correct source (owner/repo) of a skill id."""
    try:
        resp = await http_client.get(
            f"https://skills.sh/api/search?q={quote(skill_id, safe='')}&limit=20",
            timeout=10.0,
        )
        if resp.status_code != 200:
            return None
        skills = resp.json().get("skills", [])
        normalized = skill_id.replace(":", "-").lower()
        for s in skills:
            if s.get("skillId") == skill_id:
                return s.get("source")
        for s in skills:
            if s.get("skillId", "").replace(":", "-").lower() == normalized:
                return s.get("source")
    except Exception:
        pass
    return None


async def fetch_skill_md_from_repo(
    http_client: httpx.AsyncClient, source: str, skill_id: str
) -> str | None:
    """SKILL.md from a specific repo: direct paths (main/master), then a
    recursive tree search to find it under a non-standard dir."""
    normalized_id = skill_id.replace(":", "-").lower()
    ids_to_try = [skill_id] + (
        [normalized_id] if normalized_id != skill_id else []
    )

    # 1. Direct paths (both branches).
    for branch in _BRANCHES:
        for sid in ids_to_try:
            for base in _BASES:
                try:
                    resp = await http_client.get(
                        f"{_GH_RAW}/{source}/{branch}/{base}/{sid}/SKILL.md",
                        headers=_raw_headers(),
                        timeout=10.0,
                    )
                    if resp.status_code == 200:
                        return resp.text
                except Exception:
                    continue
        # 2. Repo-root SKILL.md.
        try:
            resp = await http_client.get(
                f"{_GH_RAW}/{source}/{branch}/SKILL.md",
                headers=_raw_headers(),
                timeout=10.0,
            )
            if resp.status_code == 200:
                return resp.text
        except Exception:
            pass

    # 3. Full repo tree search.
    for branch in _BRANCHES:
        try:
            resp = await http_client.get(
                f"{_GH_API}/repos/{source}/git/trees/{branch}?recursive=1",
                headers=_api_headers(),
                timeout=10.0,
                follow_redirects=True,
            )
            if resp.status_code != 200:
                continue
            tree = resp.json().get("tree", [])
            skill_files = [
                e["path"]
                for e in tree
                if e.get("type") == "blob" and e["path"].endswith("/SKILL.md")
            ]
            if not skill_files:
                continue

            def _dir(p: str) -> str:
                segs = p.split("/")
                return segs[-2] if len(segs) >= 2 else ""

            match = next(
                (p for p in skill_files if _dir(p) in (skill_id, normalized_id)),
                None,
            ) or next(
                (
                    p
                    for p in skill_files
                    if normalized_id in _dir(p).lower()
                    or _dir(p).lower() in normalized_id
                ),
                None,
            )
            if match:
                md = await http_client.get(
                    f"{_GH_RAW}/{source}/{branch}/{match}",
                    headers=_raw_headers(),
                    timeout=10.0,
                )
                if md.status_code == 200:
                    return md.text

            root_md = next((p for p in skill_files if p.count("/") <= 1), None)
            if root_md:
                md = await http_client.get(
                    f"{_GH_RAW}/{source}/{branch}/{root_md}",
                    headers=_raw_headers(),
                    timeout=10.0,
                )
                if md.status_code == 200:
                    return md.text
        except Exception:
            pass

    return None


async def fetch_skill_md(
    http_client: httpx.AsyncClient, full_id: str
) -> str | None:
    """SKILL.md for a `owner/repo/skill` full id, with source fallbacks:
    original source → GitHub repo resolution (org renames) → skills.sh source.
    Returns the markdown, or None when it can't be found."""
    parts = full_id.split("/")
    skill_id = parts[-1] if parts else full_id
    source = "/".join(parts[:-1]) if len(parts) > 1 else ""
    if not source:
        return None

    tried: set[str] = {source}
    content = await fetch_skill_md_from_repo(http_client, source, skill_id)
    if content:
        return content

    resolved = await resolve_github_repo(http_client, source)
    if resolved and resolved not in tried:
        tried.add(resolved)
        content = await fetch_skill_md_from_repo(http_client, resolved, skill_id)
        if content:
            return content

    sh_source = await search_skills_sh(http_client, skill_id)
    if sh_source and sh_source not in tried:
        tried.add(sh_source)
        content = await fetch_skill_md_from_repo(http_client, sh_source, skill_id)
        if content:
            return content
        sh_resolved = await resolve_github_repo(http_client, sh_source)
        if sh_resolved and sh_resolved not in tried:
            tried.add(sh_resolved)
            content = await fetch_skill_md_from_repo(
                http_client, sh_resolved, skill_id
            )
            if content:
                return content

    logger.info("Skill '%s': SKILL.md not found (tried %s)", full_id, tried)
    return None
