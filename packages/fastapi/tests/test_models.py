"""Pydantic model validation — boundary checks on validators."""
import pytest
from pydantic import ValidationError

from app.models import (
    ChatRequest,
    HarnessConfig,
    McpServer,
    MessagePayload,
    SandboxCommandRequest,
    SandboxConfig,
    SandboxExecuteRequest,
    SkillRef,
)


class TestMcpServer:
    def test_defaults_to_none_auth(self):
        s = McpServer(name="gh", url="https://example.com/mcp")
        assert s.auth_type == "none"
        assert s.auth_token is None

    def test_rejects_unknown_auth_type(self):
        with pytest.raises(ValidationError):
            McpServer(name="x", url="u", auth_type="magic")


class TestSandboxConfig:
    def test_defaults(self):
        c = SandboxConfig()
        assert c.persistent is False
        assert c.auto_start is True
        assert c.default_language == "python"
        assert c.resource_tier == "basic"

    def test_rejects_unknown_tier(self):
        with pytest.raises(ValidationError):
            SandboxConfig(resource_tier="xl")


class TestHarnessConfig:
    def test_minimal(self):
        h = HarnessConfig(model="gpt-5.4", name="test")
        assert h.mcp_servers == []
        assert h.skills == []
        assert h.system_prompt is None
        assert h.sandbox_enabled is False

    def test_system_prompt_at_limit(self):
        h = HarnessConfig(model="gpt-5.4", name="t", system_prompt="x" * 4000)
        assert h.system_prompt is not None
        assert len(h.system_prompt) == 4000

    def test_system_prompt_over_limit_rejected(self):
        with pytest.raises(ValidationError):
            HarnessConfig(model="gpt-5.4", name="t", system_prompt="x" * 4001)


class TestChatRequest:
    def test_requires_messages_and_harness(self):
        req = ChatRequest(
            messages=[MessagePayload(role="user", content="hi")],
            harness=HarnessConfig(model="gpt-5.4", name="t"),
            conversation_id="c1",
        )
        assert req.forced_tool is None
        assert len(req.messages) == 1


class TestSandboxExecuteRequest:
    def test_default_timeout(self):
        r = SandboxExecuteRequest(code="print('hi')")
        assert r.timeout == 30
        assert r.language == "python"

    def test_timeout_lower_bound_exclusive(self):
        with pytest.raises(ValidationError):
            SandboxExecuteRequest(code="x", timeout=0)

    def test_timeout_upper_bound_inclusive(self):
        r = SandboxExecuteRequest(code="x", timeout=300)
        assert r.timeout == 300

    def test_timeout_above_limit_rejected(self):
        with pytest.raises(ValidationError):
            SandboxExecuteRequest(code="x", timeout=301)

    def test_rejects_unknown_language(self):
        with pytest.raises(ValidationError):
            SandboxExecuteRequest(code="x", language="ruby")


class TestSandboxCommandRequest:
    def test_default_wd(self):
        r = SandboxCommandRequest(command="ls")
        assert r.working_directory == "/home/daytona"
        assert r.timeout == 60


class TestSkillRef:
    def test_description_defaults_empty(self):
        s = SkillRef(name="code-review")
        assert s.description == ""
