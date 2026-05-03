"""Tests for the agent loop's handling of `SandboxStoppedByUserError`.

The agent should receive a structured JSON error with code
`sandbox_stopped_by_user` rather than a generic 500 — that lets the LLM
explain to the user what happened instead of looking like a transient bug.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock

from app.services.daytona_service import SandboxStoppedByUserError
from app.services.sandbox_tools import execute_sandbox_tool


def test_run_command_translates_user_stopped_to_structured_error():
    service = MagicMock()
    service.run_command.side_effect = SandboxStoppedByUserError(
        "sb-1", "stopped",
    )

    result = execute_sandbox_tool(
        service,
        sandbox_id="sb-1",
        tool_name="sandbox__run_command",
        arguments={"command": "ls", "working_directory": "/home/daytona"},
    )

    payload = json.loads(result)
    assert payload["type"] == "error"
    assert payload["code"] == "sandbox_stopped_by_user"
    assert payload["sandbox_status"] == "stopped"
    assert "stopped" in payload["message"].lower()


def test_archived_sandbox_carries_archived_status():
    service = MagicMock()
    service.run_command.side_effect = SandboxStoppedByUserError(
        "sb-1", "archived",
    )

    result = execute_sandbox_tool(
        service,
        sandbox_id="sb-1",
        tool_name="sandbox__run_command",
        arguments={"command": "ls"},
    )

    payload = json.loads(result)
    assert payload["code"] == "sandbox_stopped_by_user"
    assert payload["sandbox_status"] == "archived"


def test_unrelated_exception_takes_generic_error_path():
    service = MagicMock()
    service.run_command.side_effect = RuntimeError("unrelated bug")

    result = execute_sandbox_tool(
        service,
        sandbox_id="sb-1",
        tool_name="sandbox__run_command",
        arguments={"command": "ls"},
    )

    payload = json.loads(result)
    assert payload["type"] == "error"
    # Should NOT be tagged with the user-stopped code.
    assert payload.get("code") != "sandbox_stopped_by_user"
    assert "unrelated bug" in payload["message"]
