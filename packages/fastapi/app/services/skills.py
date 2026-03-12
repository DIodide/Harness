"""Skill content loading, manifest generation, and tool definitions.

Skills are markdown files in the `skills/` directory at the package root.
They are loaded once at import time and served from memory.
"""

import logging
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

SKILLS_DIR = Path(__file__).resolve().parent.parent.parent / "skills"

SKILL_DESCRIPTIONS: dict[str, str] = {
    "coding": "Write clean, secure, well-structured code with best practices for style and documentation.",
    "research": "Gather information from multiple sources, evaluate credibility, and synthesize findings.",
    "writing": "Draft clear, well-organized documents, emails, and technical content.",
    "analysis": "Analyze datasets, identify trends, and present insights with appropriate visualizations.",
    "debugging": "Systematically isolate bugs, trace root causes, and verify fixes across the stack.",
    "devops": "Manage infrastructure, CI/CD pipelines, containers, and deployment workflows.",
}


@dataclass(frozen=True)
class SkillContent:
    id: str
    name: str
    description: str
    content: str


def _load_skills() -> dict[str, SkillContent]:
    """Load all .md files from the skills directory."""
    skills: dict[str, SkillContent] = {}
    if not SKILLS_DIR.is_dir():
        logger.warning("Skills directory not found at %s", SKILLS_DIR)
        return skills

    for md_file in sorted(SKILLS_DIR.glob("*.md")):
        skill_id = md_file.stem
        content = md_file.read_text(encoding="utf-8").strip()
        # Extract name from the first H1 heading, fall back to id
        first_line = content.split("\n", 1)[0].strip()
        name = first_line.lstrip("# ").strip() if first_line.startswith("#") else skill_id
        description = SKILL_DESCRIPTIONS.get(skill_id, "")
        skills[skill_id] = SkillContent(
            id=skill_id,
            name=name,
            description=description,
            content=content,
        )

    logger.info("Loaded %d skills: %s", len(skills), list(skills.keys()))
    return skills


_SKILLS: dict[str, SkillContent] = _load_skills()


def get_skill_manifest(skill_ids: list[str]) -> str:
    """Build a manifest listing selected skills with descriptions.

    This is prepended to the system prompt so the model knows what skills
    are available and can decide whether to fetch full content.
    """
    lines = [
        "# Available Skills",
        "",
        "You have access to the following specialized skills. "
        "Each skill contains detailed guidelines and best practices. "
        'Use the `get_skill_content` tool with the skill\'s id to retrieve '
        "the full instructions when you need them.",
        "",
    ]
    for sid in skill_ids:
        skill = _SKILLS.get(sid)
        if skill:
            lines.append(f"- **{skill.name}** (`{skill.id}`): {skill.description}")
    lines.append("")
    return "\n".join(lines)


def get_skill_content(skill_id: str) -> str:
    """Return the full markdown content for a skill, or an error message."""
    skill = _SKILLS.get(skill_id)
    if skill:
        return skill.content
    available = ", ".join(sorted(_SKILLS.keys()))
    return f"Unknown skill '{skill_id}'. Available skills: {available}"


def get_skill_tool_definition() -> dict:
    """Return the OpenAI function-calling tool definition for get_skill_content."""
    available_ids = sorted(_SKILLS.keys())
    return {
        "type": "function",
        "function": {
            "name": "get_skill_content",
            "description": (
                "Retrieve the full detailed guidelines for a specific skill. "
                "Call this when you need the in-depth instructions for a skill "
                "listed in your skills manifest."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "skill_id": {
                        "type": "string",
                        "description": f"The skill identifier. One of: {', '.join(available_ids)}",
                        "enum": available_ids,
                    }
                },
                "required": ["skill_id"],
            },
        },
    }
