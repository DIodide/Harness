"""Tests for ACP session/update normalization — the kind synthesis and
first-class flow detection that drives Harness's agent rendering."""

from app.services.agents.session_manager import (
    _parse_workflow_script,
    normalize_session_update,
)

WORKFLOW_SCRIPT = """export const meta = {
  name: 'demo',
  description: 'add two numbers via agents',
  phases: [
    { title: 'Compute', detail: 'fan out 2 agents returning 7 and 9' },
    { title: 'Sum', detail: 'add the two results together' },
  ],
}

phase('Compute')
const [a, b] = await parallel([...])
"""


def tc(**update):
    update.setdefault("sessionUpdate", "tool_call")
    return normalize_session_update(update)["data"]


def tcu(**update):
    update.setdefault("sessionUpdate", "tool_call_update")
    return normalize_session_update(update)["data"]


class TestKindSynthesis:
    def test_workflow_tool_detected(self):
        d = tc(toolCallId="w", title="Workflow", kind="other", rawInput={})
        assert d["kind"] == "workflow"

    def test_subagent_by_task_title(self):
        d = tc(toolCallId="t", title="Task", kind="think", rawInput={"prompt": "x"})
        assert d["kind"] == "subagent"

    def test_todowrite_stays_think(self):
        d = tc(
            toolCallId="t", title="Update todos (3)", kind="think",
            rawInput={"todos": []},
        )
        assert d["kind"] == "think"

    def test_tool_search_detected(self):
        d = tc(toolCallId="s", title="ToolSearch", kind="other", rawInput={"query": "x"})
        assert d["kind"] == "tool_search"

    def test_mcp_attribution(self):
        d = tc(
            toolCallId="m", title="mcp__github__create_issue", kind="other",
            rawInput={},
        )
        assert d["server_name"] == "github"
        assert d["tool"] == "create issue"

    def test_mcp_named_toolsearch_is_mcp_not_tool_search(self):
        # An MCP tool literally named ToolSearch must keep MCP attribution.
        d = tc(toolCallId="m", title="mcp__srv__ToolSearch", kind="other", rawInput={})
        assert d["kind"] != "tool_search"
        assert d["server_name"] == "srv"


class TestToolCallUpdate:
    def test_terminal_output_append(self):
        d = tcu(toolCallId="x", _meta={"terminal_output": {"data": "hello\n"}})
        assert d["append"] is True
        assert d["output_delta"] == "hello\n"

    def test_terminal_exit_code(self):
        d = tcu(
            toolCallId="x", status="completed",
            _meta={"terminal_exit": {"exit_code": 0}},
        )
        assert d["append"] is True
        assert d["exit_code"] == 0

    def test_refined_arguments_forwarded(self):
        # The full input (incl. Workflow script) arrives on a later update.
        d = tcu(toolCallId="w", rawInput={"script": WORKFLOW_SCRIPT})
        wf = d["arguments"]["workflow"]
        assert wf["name"] == "demo"
        assert [p["title"] for p in wf["phases"]] == ["Compute", "Sum"]

    def test_status_only_update_no_blank(self):
        d = tcu(toolCallId="x", status="in_progress")
        assert d["result"] == ""
        assert d["status"] == "in_progress"

    def test_content_completion_defaults_to_completed(self):
        # A content-bearing update with no explicit status is a completion.
        d = tcu(
            toolCallId="x",
            content=[{"type": "content", "content": {"type": "text", "text": "ok"}}],
        )
        assert d["result"] == "ok"
        assert d["status"] == "completed"

    def test_refined_input_only_update_stays_pending(self):
        # The Workflow script arriving (no result) must NOT mark completed.
        d = tcu(toolCallId="w", rawInput={"script": WORKFLOW_SCRIPT})
        assert d["status"] is None


class TestWorkflowParser:
    def test_full_parse(self):
        wf = _parse_workflow_script({"script": WORKFLOW_SCRIPT})
        assert wf["name"] == "demo"
        assert wf["description"] == "add two numbers via agents"
        assert wf["phases"] == [
            {"title": "Compute", "detail": "fan out 2 agents returning 7 and 9"},
            {"title": "Sum", "detail": "add the two results together"},
        ]
        assert wf["script"].startswith("export const meta")

    def test_no_script_returns_none(self):
        assert _parse_workflow_script({}) is None
        assert _parse_workflow_script({"foo": 1}) is None

    def test_script_without_meta_still_preserved(self):
        wf = _parse_workflow_script({"script": "phase('x'); agent('y')"})
        assert wf["script"] == "phase('x'); agent('y')"
        assert wf.get("phases", []) == []

    def test_double_quotes_and_no_detail(self):
        script = 'export const meta = { name: "n", phases: [ { title: "Only" } ] }'
        wf = _parse_workflow_script({"script": script})
        assert wf["name"] == "n"
        assert wf["phases"] == [{"title": "Only"}]

    def test_malformed_never_raises(self):
        wf = _parse_workflow_script({"script": "export const meta = { name: 'x', phases:"})
        assert wf["script"].startswith("export const meta")

    def test_braces_inside_string_literals(self):
        # Braces inside meta string values must not break brace-matching.
        script = (
            "export const meta = { name: 'demo', "
            "description: 'uses {curly} and }unbalanced', "
            "phases: [ { title: 'P1', detail: 'do }this{ thing' } ] }"
        )
        wf = _parse_workflow_script({"script": script})
        assert wf["name"] == "demo"
        assert wf["description"] == "uses {curly} and }unbalanced"
        assert wf["phases"] == [{"title": "P1", "detail": "do }this{ thing"}]

    def test_oversized_script_capped(self):
        big = "export const meta = { name: 'x' }\n" + ("a" * 50_000)
        wf = _parse_workflow_script({"script": big})
        assert len(wf["script"]) == 20_000
