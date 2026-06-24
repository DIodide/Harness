"""Pure ACP-update -> SSE event normalization.

The encoding rules that turn a raw ACP session/update (or an SDK task /
result message) into the frontend's SSE event shape. Deliberately stateless
and pure (dict -> dict): no session, connection, queue, or I/O. This is the
highest-churn surface (it shifts with every agent / model update), so it
lives behind a small interface and is tested directly through it
(tests/test_agent_normalize.py, tests/test_agent_questions.py).

Public interface: normalize_session_update, normalize_sdk_task_message,
parse_sdk_compaction, parse_elicitation_fields, plus the
SDK_TASK_MESSAGE_FILTERS list and the COMPACTION_SUMMARY_PREAMBLE marker
(both also referenced by the session's meta / replay-preamble builders).
The leading-underscore helpers are private internals of this module.
"""

import json
import logging
import re

logger = logging.getLogger(__name__)


def _content_block_text(block: dict) -> str:
    if block.get("type") == "text":
        return block.get("text", "")
    return ""


def _claude_meta(update: dict) -> dict:
    """claude-agent-acp tucks subagent parentage under _meta.claudeCode."""
    meta = update.get("_meta") or {}
    claude = meta.get("claudeCode") or {}
    return claude if isinstance(claude, dict) else {}


def _is_subagent_call(kind: str, title: str, raw_input: dict) -> bool:
    """True for an Agent/Task tool that spawns a background subagent.

    claude-agent-acp maps Agent/Task to kind "think" (same as TodoWrite and
    the Task* tools). It titles the call from `input.description`, falling
    back to the literal "Task"/"Agent" when there is none — so we match
    either that fallback title or the subagent brief signature (a `prompt`).
    TodoWrite ("Update todos (N)") and TaskCreate ("Create task: X") have
    neither and stay plain "think".
    """
    if kind != "think":
        return False
    if title in ("Task", "Agent"):
        return True
    return isinstance(raw_input, dict) and "prompt" in raw_input and (
        "description" in raw_input or "subagent_type" in raw_input
    )


def _is_tool_search(title: str, raw_input: dict) -> bool:
    """True for a tool-discovery call (Claude's ToolSearch / server tool)."""
    if (title or "").startswith("mcp__"):
        return False  # an MCP tool named *ToolSearch* is still an MCP call
    t = (title or "").lower()
    return "toolsearch" in t or "tool search" in t or "tool_search" in t


def _parse_mcp_title(title: str) -> tuple[str, str] | None:
    """Split an MCP tool title into (server, clean_tool).

    Claude names MCP tools `mcp__<server>__<tool>`; this is the unambiguous
    form. Returns None for non-MCP titles (slash/path forms are too risky to
    parse — the frontend keeps its own light heuristic for those).
    """
    if not title or not title.startswith("mcp__"):
        return None
    rest = title[len("mcp__") :]
    if "__" not in rest:
        return None
    server, tool = rest.split("__", 1)
    return server, tool.replace("_", " ").strip()


def _extract_balanced(text: str, start: int, open_ch: str, close_ch: str) -> str | None:
    """Return text[start:end] spanning a balanced open/close pair, or None.

    Skips braces inside JS string literals ('...', "...", `...`) so brace
    characters in workflow meta values (e.g. a phase detail) aren't counted.
    """
    depth = 0
    quote: str | None = None
    escaped = False
    for i in range(start, len(text)):
        c = text[i]
        if quote is not None:
            if escaped:
                escaped = False
            elif c == "\\":
                escaped = True
            elif c == quote:
                quote = None
            continue
        if c in ("'", '"', "`"):
            quote = c
        elif c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


_WF_NAME = re.compile(r"""name\s*:\s*["'`]([^"'`]+)""")
_WF_DESC = re.compile(r"""description\s*:\s*["'`]([^"'`]*)""")
_WF_TITLE = re.compile(r"""title\s*:\s*["'`]([^"'`]+)""")
_WF_DETAIL = re.compile(r"""detail\s*:\s*["'`]([^"'`]*)""")


def _parse_workflow_script(raw_input: dict) -> dict | None:
    """Parse a Claude Workflow tool's script (JS) into {name, description,
    phases:[{title,detail}], script}. Tolerant + string-only (the script is
    untrusted agent output — never eval). Returns None when there is no
    script; always preserves the raw script so the disclosure still works.
    """
    if not isinstance(raw_input, dict):
        return None
    script = raw_input.get("script")
    if not isinstance(script, str) or not script.strip():
        script = next(
            (v for v in raw_input.values() if isinstance(v, str) and v.strip()),
            None,
        )
    if not script:
        return None
    out: dict = {"script": script[:20000]}
    try:
        midx = script.find("meta")
        brace = script.find("{", midx) if midx != -1 else -1
        meta_block = (
            _extract_balanced(script, brace, "{", "}") if brace != -1 else None
        )
        if meta_block:
            m = _WF_NAME.search(meta_block)
            if m:
                out["name"] = m.group(1)
            d = _WF_DESC.search(meta_block)
            if d and d.group(1):
                out["description"] = d.group(1)
            pidx = meta_block.find("phases")
            pbr = meta_block.find("[", pidx) if pidx != -1 else -1
            arr = (
                _extract_balanced(meta_block, pbr, "[", "]") if pbr != -1 else None
            )
            phases: list[dict] = []
            if arr:
                i = 0
                while len(phases) < 40:
                    ob = arr.find("{", i)
                    if ob == -1:
                        break
                    obj = _extract_balanced(arr, ob, "{", "}")
                    if not obj:
                        break
                    t = _WF_TITLE.search(obj)
                    if t:
                        ph = {"title": t.group(1)}
                        de = _WF_DETAIL.search(obj)
                        if de and de.group(1):
                            ph["detail"] = de.group(1)
                        phases.append(ph)
                    i = ob + len(obj)
            out["phases"] = phases
    except Exception:
        logger.debug("workflow meta parse failed", exc_info=True)
    return out


def _with_workflow(raw_input: dict) -> dict:
    """Inject parsed workflow metadata into a tool's arguments when present.

    Also caps the raw `script` (which is persisted with the tool call) to the
    same bound as the parsed copy so a very large generated script can't bloat
    the persisted message.
    """
    wf = _parse_workflow_script(raw_input)
    if wf is None:
        return raw_input
    out = {**raw_input, "workflow": wf}
    if isinstance(out.get("script"), str):
        out["script"] = out["script"][:20000]
    return out


def normalize_session_update(update: dict) -> dict | None:
    """Map an ACP session/update payload to a Harness SSE event."""
    kind = update.get("sessionUpdate")
    parent_id = _claude_meta(update).get("parentToolUseId")
    if kind == "agent_message_chunk":
        return {
            "event": "token",
            "data": {
                "content": _content_block_text(update.get("content") or {}),
                # Distinct assistant messages within one turn (e.g. before and
                # after a background task completes) carry distinct messageIds;
                # the UI starts a new text part on change.
                "message_id": update.get("messageId"),
                **({"parent_id": parent_id} if parent_id else {}),
            },
        }
    if kind == "agent_thought_chunk":
        return {
            "event": "thinking",
            "data": {
                "content": _content_block_text(update.get("content") or {}),
                "message_id": update.get("messageId"),
                **({"parent_id": parent_id} if parent_id else {}),
            },
        }
    if kind == "tool_call":
        raw_input = update.get("rawInput") or {}
        title = update.get("title") or update.get("kind") or "tool"
        tool_kind = update.get("kind") or "other"
        extra: dict = {}
        # Refine the kind so the UI can render each flow first-class. These
        # are synthetic kinds the frontend branches on; no ACP agent emits
        # them, but they are deterministic from title/rawInput.
        if title == "Workflow":
            # Claude's multi-agent orchestration tool (ultracode). The script
            # (meta.name/description/phases) is usually empty on this initial
            # tool_call and arrives on a later tool_call_update rawInput; parse
            # whatever is here and let the update branch fill it in.
            tool_kind = "workflow"
            raw_input = _with_workflow(raw_input)
        elif _is_subagent_call(tool_kind, title, raw_input):
            tool_kind = "subagent"
        elif _is_tool_search(title, raw_input):
            tool_kind = "tool_search"
        else:
            mcp = _parse_mcp_title(title)
            if mcp is not None:
                extra["server_name"] = mcp[0]
                title = mcp[1]  # show the clean tool name; server in the badge
        return {
            "event": "tool_call",
            "data": {
                "call_id": update.get("toolCallId", ""),
                "tool": title,
                "arguments": raw_input,
                # ACP tool kind (execute|read|edit|delete|move|search|fetch|
                # think|switch_mode|other) plus our synthetic subagent/
                # tool_search — drives first-class rendering.
                "kind": tool_kind,
                "status": update.get("status"),
                "locations": update.get("locations") or [],
                **extra,
                # Set for tool calls made by a background/sub agent — the UI
                # nests these under the spawning Task tool call.
                **({"parent_id": parent_id} if parent_id else {}),
            },
        }
    if kind == "tool_call_update":
        status = update.get("status")
        # Display-only live command output (codex exec deltas / claude bash).
        # The agent ran the command in its own sandbox and streams output bytes
        # via _meta.terminal_output (per-chunk) and _meta.terminal_exit (at end).
        # These APPEND to the call's output instead of replacing it — and we
        # must NOT fall through to the rawOutput fallback below, which would
        # overwrite the streamed terminal with a JSON dump at completion.
        meta = update.get("_meta") or {}
        term_out = meta.get("terminal_output") or {}
        term_exit = meta.get("terminal_exit") or {}
        output_delta = term_out.get("data") if isinstance(term_out, dict) else None
        exit_code = term_exit.get("exit_code") if isinstance(term_exit, dict) else None
        if output_delta is not None or exit_code is not None:
            data: dict = {
                "call_id": update.get("toolCallId", ""),
                "append": True,
                "status": status,
            }
            if output_delta:
                data["output_delta"] = output_delta
            if exit_code is not None:
                data["exit_code"] = exit_code
            return {"event": "tool_result", "data": data}

        content = update.get("content") or []
        result_text = "\n".join(
            _content_block_text(c.get("content") or {})
            for c in content
            if isinstance(c, dict) and c.get("type") == "content"
        )
        # Structured diff content (file edits) gets first-class rendering.
        diff = next(
            (
                {
                    "path": c.get("path"),
                    "oldText": c.get("oldText"),
                    "newText": c.get("newText"),
                }
                for c in content
                if isinstance(c, dict) and c.get("type") == "diff"
            ),
            None,
        )
        raw_output = update.get("rawOutput")
        # Only terminal updates may fabricate a result from rawOutput: a
        # truthy result marks the call finished in the UI, and ACP allows
        # status-only progress updates carrying no content at all.
        fallback = (
            json.dumps(raw_output)[:4000]
            if raw_output and status in ("completed", "failed")
            else ""
        )
        # The initial tool_call often streams with empty/partial rawInput
        # (content_block_start); the COMPLETE input arrives here on the
        # refining tool_call_update. Forward it so the UI can fill in args it
        # didn't have yet — notably the Workflow tool's script (meta.phases),
        # which we parse into a structured `workflow` field here.
        refined_input = update.get("rawInput")
        if isinstance(refined_input, dict) and refined_input.get("script"):
            refined_input = _with_workflow(refined_input)
        # A content-bearing update with no explicit status IS a completion —
        # mark it so the UI stops showing it as "running" (notably execute
        # calls, which the frontend won't treat truthy-result alone as done
        # because their output also streams via the append path).
        effective_status = status or ("completed" if (result_text or fallback) else None)
        return {
            "event": "tool_result",
            "data": {
                "call_id": update.get("toolCallId", ""),
                "status": effective_status,
                "result": result_text or fallback,
                **({"diff": diff} if diff else {}),
                **(
                    {"arguments": refined_input}
                    if isinstance(refined_input, dict) and refined_input
                    else {}
                ),
            },
        }
    if kind == "config_option_update":
        return {
            "event": "config_update",
            "data": {"options": update.get("configOptions") or []},
        }
    if kind == "usage_update":
        # Context window + cost, billed to the user's own agent account.
        cost = update.get("cost") or {}
        return {
            "event": "agent_usage",
            "data": {
                "used": update.get("used"),
                "size": update.get("size"),
                "cost": cost.get("amount"),
                "currency": cost.get("currency", "USD"),
            },
        }
    if kind == "plan":
        return {"event": "plan", "data": {"entries": update.get("entries") or []}}
    if kind == "available_commands_update":
        return {
            "event": "commands_update",
            "data": {"commands": update.get("availableCommands") or []},
        }
    if kind == "current_mode_update":
        return {"event": "mode_update", "data": {"mode_id": update.get("currentModeId")}}
    # user_message_chunk and unknown kinds: nothing to surface.
    return None


# claude-agent-acp re-emits raw Claude Agent SDK messages as a `_claude/sdkMessage`
# notification when session/new opts in via `_meta.claudeCode.emitRawSDKMessages`.
# `type` is a plain string in the filter schema, so listing both the documented
# top-level shape (`type: "task_*"`) and the older system+subtype shape costs
# nothing — whichever the running SDK uses matches, the other matches nothing.
SDK_TASK_MESSAGE_FILTERS = [
    {"type": "task_started"},
    {"type": "task_progress"},
    {"type": "task_updated"},
    {"type": "task_notification"},
    {"type": "system", "subtype": "task_started"},
    {"type": "system", "subtype": "task_progress"},
    {"type": "system", "subtype": "task_updated"},
    {"type": "system", "subtype": "task_notification"},
    # Context compaction. Verified live on claude-agent-acp@0.44.0: the
    # `compact_boundary` system message carries the metadata (trigger,
    # pre/post tokens) but NOT the summary; the summary prose arrives as a
    # synthetic `type:"user"` message (string content) that the adapter
    # normally drops from session/update but DOES forward raw here. We filter
    # to the actual compaction summary in normalize on the receiving side.
    {"type": "system", "subtype": "compact_boundary"},
    {"type": "compact_boundary"},
    {"type": "user"},
    # The SDK result message (terminal message of a turn) carries the
    # authoritative total_cost_usd + full token usage (incl. cache), which the
    # thin ACP usage_update lacks. We record agent usage from it for claude-code.
    {"type": "result"},
    {"type": "system", "subtype": "result"},
]

_TASK_PHASES = {"task_started", "task_progress", "task_updated", "task_notification"}
_TASK_TERMINAL = {"completed", "failed", "killed", "cancelled"}


def _first_str(message: dict, *keys: str) -> str | None:
    """First present, non-empty string value among `keys` (defensive: the SDK
    task-message schema varies across versions / camel vs snake case)."""
    for key in keys:
        value = message.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def normalize_sdk_task_message(message: dict) -> list[dict]:
    """Map a Claude Agent SDK task-lifecycle message into Harness SSE events.

    Claude's Workflow tool (multi-agent orchestration) and Task subagents run
    *inside* the agent; claude-agent-acp drops their ``task_started/progress/
    updated/notification`` SDK messages, so their activity is otherwise
    invisible. With emitRawSDKMessages on we receive them here and reuse the
    existing subagent ``tool_call``/``tool_result`` vocabulary so each workflow
    agent renders in the timeline and the Agents panel with live status.

    Every field is read permissively — the exact schema is external and
    version-dependent — and anything unrecognized degrades to ``[]``.
    """
    if not isinstance(message, dict):
        return []
    mtype = message.get("type")
    phase = message.get("subtype") if mtype == "system" else mtype
    if phase not in _TASK_PHASES:
        return []
    task_id = _first_str(message, "task_id", "taskId", "uuid")
    if not task_id:
        return []
    # Namespaced so it can never collide with an ACP toolCallId from the normal
    # session/update path (these are a parallel id space).
    call_id = f"wf-task:{task_id}"
    # If the spawning tool-use id is known, nest under it; the frontend falls
    # back to top-level when the parent isn't present in the turn.
    parent = _first_str(
        message, "tool_use_id", "toolUseId", "parent_tool_use_id", "parentToolUseId"
    )
    parent_field = {"parent_id": parent} if parent else {}

    if phase == "task_started":
        subagent_type = _first_str(message, "subagent_type", "subagentType", "task_type")
        desc = _first_str(message, "description", "prompt")
        # Lead the row title with the agent type so "what each agent is" is
        # visible at a glance (e.g. "reviewer: audit the diff").
        if subagent_type and desc and subagent_type not in desc:
            description = f"{subagent_type}: {desc}"
        else:
            description = desc or subagent_type or "Subagent"
        args = {
            k: v
            for k, v in {
                "subagent_type": subagent_type,
                "description": _first_str(message, "description"),
                "prompt": _first_str(message, "prompt"),
            }.items()
            if v
        }
        return [
            {
                "event": "tool_call",
                "data": {
                    "call_id": call_id,
                    "tool": description,
                    "arguments": args,
                    "kind": "subagent",
                    "status": "in_progress",
                    "locations": [],
                    **parent_field,
                },
            }
        ]

    # task_updated / task_notification can be terminal; task_progress never is.
    status = message.get("status")
    if isinstance(status, dict):  # tolerate a {status: {status: ...}} patch shape
        status = status.get("status")
    if not isinstance(status, str):
        status = None
    summary = _first_str(
        message, "summary", "result", "description", "last_tool_name", "output"
    )
    output_file = _first_str(message, "output_file", "outputFile")

    if phase != "task_progress" and status in _TASK_TERMINAL:
        # The terminal `status` already marks the call done in the UI, so leave
        # the result empty (rather than echoing the bare status word) when the
        # message carries no real summary.
        result = summary or ""
        if output_file:
            result = f"{result}\n\n→ {output_file}".strip()
        return [
            {
                "event": "tool_result",
                "data": {
                    "call_id": call_id,
                    "status": "failed" if status in {"failed", "killed"} else "completed",
                    "result": result,
                },
            }
        ]

    # Non-terminal progress: append a live activity line, keep the call running.
    # `append` never blanks an existing result and won't mark the call finished.
    data: dict = {"call_id": call_id, "append": True, "status": "in_progress"}
    if summary:
        data["output_delta"] = summary.rstrip("\n") + "\n"
    return [{"event": "tool_result", "data": data}]


# Claude Code injects the post-compaction summary as a synthetic user message
# whose content begins with this exact preamble (verified live on
# claude-agent-acp@0.44.0). It's the reliable, version-stable signature that
# distinguishes the compaction summary from an ordinary user-message echo.
COMPACTION_SUMMARY_PREAMBLE = (
    "This session is being continued from a previous conversation"
)
# Generous cap so a pathological summary can't bloat an event / Convex doc.
_MAX_COMPACTION_SUMMARY_CHARS = 100_000


def _sdk_user_message_text(message: dict) -> str:
    """Extract the text of a raw SDK `type:"user"` message. Content is a string
    for the compaction-summary message and a list of blocks for normal echoes."""
    inner = message.get("message")
    content = inner.get("content") if isinstance(inner, dict) else None
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            b.get("text") or ""
            for b in content
            if isinstance(b, dict) and b.get("type") == "text"
        )
    return ""


def parse_sdk_compaction(message: dict) -> dict | None:
    """Classify a raw SDK message as a compaction `boundary` (metadata) or
    `summary` (the prose), or None. Defensive — degrades to None on any
    unexpected shape (the notification handler swallows exceptions anyway)."""
    if not isinstance(message, dict):
        return None
    mtype = message.get("type")
    subtype = message.get("subtype")
    if subtype == "compact_boundary" or mtype == "compact_boundary":
        cm = message.get("compact_metadata")
        cm = cm if isinstance(cm, dict) else {}
        trigger = cm.get("trigger")
        return {
            "kind": "boundary",
            "trigger": trigger if trigger in ("manual", "auto") else None,
            "pre_tokens": cm.get("pre_tokens"),
            "post_tokens": cm.get("post_tokens"),
        }
    if mtype == "user":
        text = _sdk_user_message_text(message)
        if text.lstrip().startswith(COMPACTION_SUMMARY_PREAMBLE):
            return {"kind": "summary", "summary": text[:_MAX_COMPACTION_SUMMARY_CHARS]}
    return None


def parse_elicitation_fields(requested_schema: dict) -> list[dict]:
    """Flatten an ACP form-elicitation JSON schema into UI-friendly fields.

    claude-agent-acp encodes AskUserQuestion as one property per question
    (string+oneOf for single-select, array+items.anyOf for multi-select)
    plus an optional free-text "customAnswer" property. Generic MCP
    elicitations may also use plain string/number/boolean properties.
    """
    fields: list[dict] = []
    for key, prop in (requested_schema.get("properties") or {}).items():
        if not isinstance(prop, dict):
            continue
        base = {
            "key": key,
            "title": prop.get("title"),
            "description": prop.get("description"),
        }
        one_of = prop.get("oneOf")
        any_of = (prop.get("items") or {}).get("anyOf") if prop.get("type") == "array" else None
        choices = one_of if isinstance(one_of, list) else any_of
        if isinstance(choices, list) and choices:
            fields.append(
                {
                    **base,
                    "kind": "multiselect" if any_of else "select",
                    "options": [
                        {
                            "value": c.get("const"),
                            "label": c.get("title") or str(c.get("const")),
                        }
                        for c in choices
                        if isinstance(c, dict) and c.get("const") is not None
                    ],
                }
            )
        elif prop.get("type") == "boolean":
            fields.append({**base, "kind": "boolean"})
        else:
            # Plain string/number inputs (incl. the customAnswer free-text).
            fields.append({**base, "kind": "text"})
    return fields
