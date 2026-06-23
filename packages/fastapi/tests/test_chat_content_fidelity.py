"""Tests for the assistant-message content fidelity invariant on the default
OpenRouter path (app/routes/chat.py).

The invariant: a persisted assistant message's flat `content` MUST equal the
join of its text parts — content == content_from_parts(parts) ==
"".join(p["content"] for p in parts if p["type"] == "text"). This mirrors the TS
contentFromParts (convex/messageParts.ts) and the ACP gateway
"".join(text_parts) (session_manager.py), and is what mid-message rewind relies
on. These tests pin both the helper and the self-reconciling _save_interrupted
path so the persistence sites cannot drift.
"""

import pytest

from app.routes import chat as chat_module
from app.routes.chat import _save_interrupted, content_from_parts


# ---------------------------------------------------------------------------
# content_from_parts — the canonical join helper
# ---------------------------------------------------------------------------


def test_content_from_parts_none_and_empty():
    assert content_from_parts(None) == ""
    assert content_from_parts([]) == ""


def test_content_from_parts_single_text_part():
    assert content_from_parts([{"type": "text", "content": "hello"}]) == "hello"


def test_content_from_parts_concatenates_multiple_text_parts():
    parts = [
        {"type": "text", "content": "first "},
        {"type": "text", "content": "second "},
        {"type": "text", "content": "third"},
    ]
    assert content_from_parts(parts) == "first second third"


def test_content_from_parts_ignores_reasoning_and_tool_parts():
    parts = [
        {"type": "reasoning", "content": "thinking..."},
        {"type": "text", "content": "answer A"},
        {"type": "tool_call", "tool": "x", "arguments": {}, "result": "r"},
        {"type": "text", "content": " answer B"},
    ]
    assert content_from_parts(parts) == "answer A answer B"


def test_content_from_parts_preserves_order():
    parts = [
        {"type": "text", "content": "1"},
        {"type": "tool_call", "tool": "x"},
        {"type": "text", "content": "2"},
        {"type": "reasoning", "content": "ignored"},
        {"type": "text", "content": "3"},
    ]
    assert content_from_parts(parts) == "123"


def test_content_from_parts_tool_only_no_text():
    parts = [
        {"type": "tool_call", "tool": "x", "arguments": {}, "result": "r"},
        {"type": "reasoning", "content": "ignored"},
    ]
    assert content_from_parts(parts) == ""


def test_content_from_parts_missing_content_key_treated_as_empty():
    # Defensive: a text part without a content key contributes "" (mirrors
    # the TS `p.content ?? ""`), never raising.
    parts = [{"type": "text"}, {"type": "text", "content": "x"}]
    assert content_from_parts(parts) == "x"


# ---------------------------------------------------------------------------
# _save_interrupted — self-reconciling persistence invariant
# ---------------------------------------------------------------------------


class _StubHarness:
    harness_id = "h1"
    name = "harness"
    model = "test/model"
    token = None


class _StubBody:
    conversation_id = "conv1"
    harness = _StubHarness()
    token = None


@pytest.fixture
def captured_save(monkeypatch):
    """Capture the (content, parts) actually persisted by save_assistant_message."""
    captured: dict = {}

    async def _fake_save(http_client, conversation_id, content, **kwargs):
        captured["content"] = content
        captured["parts"] = kwargs.get("parts")
        captured["kwargs"] = kwargs

    monkeypatch.setattr(chat_module, "save_assistant_message", _fake_save)
    return captured


async def _run_save_interrupted(content, parts):
    await _save_interrupted(
        http_client=None,
        body=_StubBody(),
        user_id="u1",
        content=content,
        reasoning="",
        tool_calls_history=[],
        parts=parts,
        collected_usage=None,  # avoids record_usage path entirely
        collected_model=None,
        reason="test",
    )


@pytest.mark.asyncio
async def test_save_interrupted_appends_in_progress_text_not_in_parts(captured_save):
    # Mid-stream exception: the in-flight text was NOT yet appended to parts.
    # It must be appended exactly once, and content must be the full join.
    parts = [
        {"type": "text", "content": "para 1"},
        {"type": "tool_call", "tool": "x", "result": "r"},
    ]
    await _run_save_interrupted("in progress", parts)

    persisted_parts = captured_save["parts"]
    text_parts = [p for p in persisted_parts if p["type"] == "text"]
    assert text_parts == [
        {"type": "text", "content": "para 1"},
        {"type": "text", "content": "in progress"},
    ]
    assert captured_save["content"] == "para 1in progress"
    assert captured_save["content"] == content_from_parts(persisted_parts)


@pytest.mark.asyncio
async def test_save_interrupted_does_not_duplicate_text_already_last_part(captured_save):
    # Consecutive-truncation abort: the iteration's text is ALREADY the last
    # text part. content==that text must NOT be appended again.
    parts = [
        {"type": "text", "content": "earlier"},
        {"type": "text", "content": "latest"},
    ]
    await _run_save_interrupted("latest", parts)

    persisted_parts = captured_save["parts"]
    assert persisted_parts == [
        {"type": "text", "content": "earlier"},
        {"type": "text", "content": "latest"},
    ]
    assert captured_save["content"] == "earlierlatest"
    assert captured_save["content"] == content_from_parts(persisted_parts)


@pytest.mark.asyncio
async def test_save_interrupted_empty_content_yields_join_of_parts(captured_save):
    # Max-iterations: content="" while parts hold all the real text. The old
    # behavior persisted "" (the worst divergence); now content == join(parts).
    parts = [
        {"type": "text", "content": "alpha"},
        {"type": "tool_call", "tool": "x", "result": "r"},
        {"type": "text", "content": "beta"},
    ]
    await _run_save_interrupted("", parts)

    persisted_parts = captured_save["parts"]
    # Nothing appended.
    assert persisted_parts == parts
    assert captured_save["content"] == "alphabeta"
    assert captured_save["content"] == content_from_parts(persisted_parts)


@pytest.mark.asyncio
async def test_save_interrupted_invariant_holds_with_no_parts(captured_save):
    await _run_save_interrupted("", None)
    assert captured_save["content"] == ""
    assert captured_save["parts"] is None  # `reconciled or None`
