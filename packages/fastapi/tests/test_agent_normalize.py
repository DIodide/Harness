"""Tests for ACP session/update normalization — the kind synthesis and
first-class flow detection that drives Harness's agent rendering."""

from app.services.agents.event_encoder import (
    _parse_workflow_script,
    normalize_sdk_task_message,
    normalize_session_update,
    parse_sdk_compaction,
)
from app.services.agents.session_manager import _build_replay_preamble

COMPACTION_SUMMARY = (
    "This session is being continued from a previous conversation that ran "
    "out of context.\n\nSummary:\n1. Primary Request and Intent: ..."
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


def one(message):
    """Single-event helper: assert exactly one event and return its data."""
    events = normalize_sdk_task_message(message)
    assert len(events) == 1
    return events[0]


class TestSdkTaskMessage:
    def test_task_started_top_level_shape(self):
        ev = one(
            {
                "type": "task_started",
                "task_id": "t1",
                "subagent_type": "reviewer",
                "description": "Review the diff",
            }
        )
        assert ev["event"] == "tool_call"
        d = ev["data"]
        assert d["call_id"] == "wf-task:t1"
        assert d["kind"] == "subagent"
        assert d["status"] == "in_progress"
        # Title leads with the agent type for at-a-glance "what each agent is".
        assert d["tool"] == "reviewer: Review the diff"
        assert d["arguments"]["subagent_type"] == "reviewer"

    def test_task_started_title_not_duplicated_when_type_in_desc(self):
        d = one(
            {"type": "task_started", "task_id": "t", "subagent_type": "reviewer",
             "description": "reviewer audits the diff"}
        )["data"]
        # subagent_type already present in the description — don't prefix it.
        assert d["tool"] == "reviewer audits the diff"

    def test_task_started_system_subtype_shape(self):
        ev = one(
            {
                "type": "system",
                "subtype": "task_started",
                "task_id": "t2",
                "subagent_type": "writer",
                "description": "Draft",
            }
        )
        assert ev["data"]["kind"] == "subagent"
        assert ev["data"]["call_id"] == "wf-task:t2"

    def test_task_started_falls_back_to_prompt_then_subagent_type(self):
        d = one({"type": "task_started", "task_id": "t", "prompt": "do x"})["data"]
        assert d["tool"] == "do x"
        d2 = one({"type": "task_started", "task_id": "t", "subagent_type": "k"})["data"]
        assert d2["tool"] == "k"

    def test_task_started_nests_under_tool_use_id(self):
        d = one(
            {"type": "task_started", "task_id": "t", "tool_use_id": "wf-call-1"}
        )["data"]
        assert d["parent_id"] == "wf-call-1"

    def test_task_started_no_parent_when_absent(self):
        d = one({"type": "task_started", "task_id": "t"})["data"]
        assert "parent_id" not in d

    def test_task_progress_appends_and_stays_running(self):
        d = one(
            {"type": "task_progress", "task_id": "t", "last_tool_name": "Grep"}
        )["data"]
        assert d["append"] is True
        assert d["status"] == "in_progress"
        assert d["output_delta"] == "Grep\n"

    def test_task_progress_never_terminal_even_with_status(self):
        # progress carrying a terminal-looking status must NOT finish the call
        d = one(
            {"type": "task_progress", "task_id": "t", "status": "completed",
             "output": "x"}
        )["data"]
        assert d["append"] is True
        assert d["status"] == "in_progress"

    def test_task_updated_completed(self):
        d = one(
            {"type": "task_updated", "task_id": "t", "status": "completed",
             "result": "done well"}
        )["data"]
        assert d["status"] == "completed"
        assert d["result"] == "done well"
        assert "append" not in d

    def test_task_updated_failed_and_killed_map_to_failed(self):
        assert one({"type": "task_updated", "task_id": "t", "status": "failed"})[
            "data"
        ]["status"] == "failed"
        assert one({"type": "task_updated", "task_id": "t", "status": "killed"})[
            "data"
        ]["status"] == "failed"

    def test_terminal_without_summary_has_empty_result(self):
        # Bare terminal status must not echo the status word as output.
        d = one({"type": "task_updated", "task_id": "t", "status": "completed"})["data"]
        assert d["status"] == "completed"
        assert d["result"] == ""

    def test_task_updated_running_is_non_terminal(self):
        d = one({"type": "task_updated", "task_id": "t", "status": "running"})["data"]
        assert d["append"] is True
        assert d["status"] == "in_progress"

    def test_task_updated_status_dict_shape(self):
        d = one(
            {"type": "task_updated", "task_id": "t", "status": {"status": "completed"},
             "summary": "ok"}
        )["data"]
        assert d["status"] == "completed"
        assert d["result"] == "ok"

    def test_task_notification_with_output_file(self):
        d = one(
            {"type": "task_notification", "task_id": "t", "status": "completed",
             "summary": "all good", "output_file": "/tmp/out.md"}
        )["data"]
        assert d["status"] == "completed"
        assert "all good" in d["result"]
        assert "/tmp/out.md" in d["result"]

    def test_non_task_message_ignored(self):
        assert normalize_sdk_task_message({"type": "assistant"}) == []
        assert normalize_sdk_task_message({"type": "result"}) == []
        assert normalize_sdk_task_message({"type": "system", "subtype": "init"}) == []

    def test_missing_task_id_ignored(self):
        assert normalize_sdk_task_message({"type": "task_started"}) == []

    def test_uuid_used_as_task_id_fallback(self):
        d = one({"type": "task_started", "uuid": "u9"})["data"]
        assert d["call_id"] == "wf-task:u9"

    def test_non_dict_ignored(self):
        assert normalize_sdk_task_message(None) == []
        assert normalize_sdk_task_message("nope") == []


class TestParseSdkCompaction:
    def test_compact_boundary_metadata(self):
        out = parse_sdk_compaction(
            {
                "type": "system",
                "subtype": "compact_boundary",
                "compact_metadata": {
                    "trigger": "manual",
                    "pre_tokens": 24798,
                    "post_tokens": 3194,
                },
            }
        )
        assert out == {
            "kind": "boundary",
            "trigger": "manual",
            "pre_tokens": 24798,
            "post_tokens": 3194,
        }

    def test_compact_boundary_top_level_type(self):
        out = parse_sdk_compaction(
            {"type": "compact_boundary", "compact_metadata": {"trigger": "auto"}}
        )
        assert out["kind"] == "boundary"
        assert out["trigger"] == "auto"

    def test_boundary_invalid_trigger_is_none(self):
        out = parse_sdk_compaction(
            {"type": "system", "subtype": "compact_boundary", "compact_metadata": {}}
        )
        assert out["trigger"] is None

    def test_summary_user_message_string_content(self):
        out = parse_sdk_compaction(
            {"type": "user", "message": {"role": "user", "content": COMPACTION_SUMMARY}}
        )
        assert out["kind"] == "summary"
        assert out["summary"].startswith("This session is being continued")

    def test_summary_user_message_leading_whitespace(self):
        out = parse_sdk_compaction(
            {"type": "user", "message": {"role": "user", "content": "\n  " + COMPACTION_SUMMARY}}
        )
        assert out["kind"] == "summary"

    def test_normal_user_echo_array_content_ignored(self):
        # Ordinary user-message echoes carry array content — not a summary.
        out = parse_sdk_compaction(
            {
                "type": "user",
                "message": {
                    "role": "user",
                    "content": [{"type": "text", "text": "write a haiku"}],
                },
            }
        )
        assert out is None

    def test_user_message_not_starting_with_preamble_ignored(self):
        out = parse_sdk_compaction(
            {"type": "user", "message": {"role": "user", "content": "Tell me about databases"}}
        )
        assert out is None

    def test_unrelated_and_malformed_ignored(self):
        assert parse_sdk_compaction({"type": "assistant"}) is None
        assert parse_sdk_compaction({"type": "system", "subtype": "init"}) is None
        assert parse_sdk_compaction(None) is None
        assert parse_sdk_compaction("nope") is None
        # boundary message with no compact_metadata still classifies
        assert parse_sdk_compaction(
            {"type": "system", "subtype": "compact_boundary"}
        )["kind"] == "boundary"


class TestReplayPreambleSummarySeed:
    def test_single_summary_message_full_summary_framing(self):
        out = _build_replay_preamble([{"role": "user", "content": COMPACTION_SUMMARY}])
        assert "compacted" in out
        assert "switched the" not in out  # NOT the harness-switch wording
        assert "This session is being continued" in out

    def test_multi_message_uses_switch_framing(self):
        out = _build_replay_preamble(
            [
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": "hello"},
            ]
        )
        assert "switched the" in out  # harness-switch wording
        assert "User: hi" in out

    def test_single_non_summary_message_uses_switch_framing(self):
        out = _build_replay_preamble([{"role": "user", "content": "just one message"}])
        assert "switched the" in out
