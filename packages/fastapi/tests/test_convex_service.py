"""Convex HTTP helper functions."""
import json

import httpx
import pytest
import respx

from app.services.convex import (
    create_sandbox_record,
    patch_message_usage,
    query_convex,
    save_assistant_message,
    verify_sandbox_owner,
)

CONVEX_URL = "https://test.convex.cloud"


@pytest.fixture
def convex_settings(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "convex_url", CONVEX_URL)
    monkeypatch.setattr(settings, "convex_deploy_key", "deploy-test")


@pytest.fixture
def no_convex_settings(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "convex_url", "")
    monkeypatch.setattr(settings, "convex_deploy_key", "")


class TestQueryConvex:
    async def test_returns_none_when_not_configured(self, no_convex_settings):
        async with httpx.AsyncClient() as client:
            result = await query_convex(client, "x:y", {})
        assert result is None

    @respx.mock
    async def test_returns_value_from_response(self, convex_settings):
        respx.post(f"{CONVEX_URL}/api/query").mock(
            return_value=httpx.Response(200, json={"value": {"ok": 1}})
        )
        async with httpx.AsyncClient() as client:
            result = await query_convex(client, "x:y", {"a": 1})
        assert result == {"ok": 1}

    @respx.mock
    async def test_returns_none_on_error(self, convex_settings):
        respx.post(f"{CONVEX_URL}/api/query").mock(
            return_value=httpx.Response(500, text="boom")
        )
        async with httpx.AsyncClient() as client:
            result = await query_convex(client, "x:y", {})
        assert result is None


class TestSaveAssistantMessage:
    async def test_noop_when_not_configured(self, no_convex_settings):
        async with httpx.AsyncClient() as client:
            await save_assistant_message(client, "c1", "hi")

    @respx.mock
    async def test_posts_minimal_payload(self, convex_settings):
        route = respx.post(f"{CONVEX_URL}/api/mutation").mock(
            return_value=httpx.Response(200, json={"value": None})
        )
        async with httpx.AsyncClient() as client:
            await save_assistant_message(client, "c1", "hello")
        body = json.loads(route.calls.last.request.content)
        assert body["path"] == "messages:saveAssistantMessage"
        assert body["args"]["conversationId"] == "c1"
        assert body["args"]["content"] == "hello"
        # Optional fields only set when provided.
        assert "reasoning" not in body["args"]
        assert "toolCalls" not in body["args"]

    @respx.mock
    async def test_includes_optional_fields_when_provided(self, convex_settings):
        route = respx.post(f"{CONVEX_URL}/api/mutation").mock(
            return_value=httpx.Response(200, json={"value": None})
        )
        async with httpx.AsyncClient() as client:
            await save_assistant_message(
                client, "c1", "x",
                reasoning="thinking",
                tool_calls=[{"name": "t"}],
                parts=[{"type": "text"}],
                usage={"cost": 0.01},
                model="gpt-4o",
            )
        body = json.loads(route.calls.last.request.content)
        assert body["args"]["reasoning"] == "thinking"
        assert body["args"]["toolCalls"] == [{"name": "t"}]
        assert body["args"]["model"] == "gpt-4o"

    @respx.mock
    async def test_swallows_http_status_errors(self, convex_settings):
        respx.post(f"{CONVEX_URL}/api/mutation").mock(
            return_value=httpx.Response(400, text="bad")
        )
        async with httpx.AsyncClient() as client:
            await save_assistant_message(client, "c1", "x")

    @respx.mock
    async def test_swallows_network_errors(self, convex_settings):
        respx.post(f"{CONVEX_URL}/api/mutation").mock(
            side_effect=httpx.ConnectError("down")
        )
        async with httpx.AsyncClient() as client:
            await save_assistant_message(client, "c1", "x")


class TestPatchMessageUsage:
    async def test_noop_when_not_configured(self, no_convex_settings):
        async with httpx.AsyncClient() as client:
            await patch_message_usage(client, "c1", {"cost": 0.01})

    @respx.mock
    async def test_posts_usage(self, convex_settings):
        route = respx.post(f"{CONVEX_URL}/api/mutation").mock(
            return_value=httpx.Response(200, json={"value": None})
        )
        async with httpx.AsyncClient() as client:
            await patch_message_usage(client, "c1", {"cost": 0.01}, model="gpt-4o")
        body = json.loads(route.calls.last.request.content)
        assert body["path"] == "messages:patchMessageUsage"
        assert body["args"]["conversationId"] == "c1"
        assert body["args"]["usage"] == {"cost": 0.01}
        assert body["args"]["model"] == "gpt-4o"

    @respx.mock
    async def test_swallows_errors(self, convex_settings):
        respx.post(f"{CONVEX_URL}/api/mutation").mock(
            return_value=httpx.Response(500, text="boom")
        )
        async with httpx.AsyncClient() as client:
            await patch_message_usage(client, "c1", {"cost": 0.01})


class TestVerifySandboxOwner:
    async def test_unconfigured_grants_dev_access(self, no_convex_settings):
        result = await verify_sandbox_owner("sbx_1", "u1")
        assert result is True

    async def test_partial_config_denies(self, monkeypatch):
        from app.config import settings
        monkeypatch.setattr(settings, "convex_url", CONVEX_URL)
        monkeypatch.setattr(settings, "convex_deploy_key", "")
        result = await verify_sandbox_owner("sbx_1", "u1")
        assert result is False

    @respx.mock
    async def test_match_returns_true(self, convex_settings):
        respx.post(f"{CONVEX_URL}/api/query").mock(
            return_value=httpx.Response(200, json={"value": "u1"})
        )
        assert await verify_sandbox_owner("sbx_1", "u1") is True

    @respx.mock
    async def test_mismatch_returns_false(self, convex_settings):
        respx.post(f"{CONVEX_URL}/api/query").mock(
            return_value=httpx.Response(200, json={"value": "u2"})
        )
        assert await verify_sandbox_owner("sbx_1", "u1") is False

    @respx.mock
    async def test_missing_record_returns_false(self, convex_settings):
        respx.post(f"{CONVEX_URL}/api/query").mock(
            return_value=httpx.Response(200, json={"value": None})
        )
        assert await verify_sandbox_owner("sbx_1", "u1") is False

    @respx.mock
    async def test_network_error_returns_false(self, convex_settings):
        respx.post(f"{CONVEX_URL}/api/query").mock(
            side_effect=httpx.ConnectError("down")
        )
        assert await verify_sandbox_owner("sbx_1", "u1") is False


class TestCreateSandboxRecord:
    async def test_returns_none_when_unconfigured(self, no_convex_settings):
        async with httpx.AsyncClient() as client:
            result = await create_sandbox_record(
                client, "u1", None, "dsbx_1", "sandbox", "python", True, {}
            )
        assert result is None

    @respx.mock
    async def test_returns_created_id(self, convex_settings):
        respx.post(f"{CONVEX_URL}/api/mutation").mock(
            return_value=httpx.Response(200, json={"value": "sbx_doc_abc"})
        )
        async with httpx.AsyncClient() as client:
            result = await create_sandbox_record(
                client, "u1", "h1", "dsbx_1", "sandbox", "python", True, {"cpu": 1}
            )
        assert result == "sbx_doc_abc"

    @respx.mock
    async def test_includes_harness_when_provided(self, convex_settings):
        route = respx.post(f"{CONVEX_URL}/api/mutation").mock(
            return_value=httpx.Response(200, json={"value": "x"})
        )
        async with httpx.AsyncClient() as client:
            await create_sandbox_record(
                client, "u1", "h1", "dsbx_1", "sandbox", "python", True, {}
            )
        body = json.loads(route.calls.last.request.content)
        assert body["args"]["harnessId"] == "h1"
        assert body["args"]["userId"] == "u1"
        assert body["args"]["status"] == "running"

    @respx.mock
    async def test_omits_harness_when_none(self, convex_settings):
        route = respx.post(f"{CONVEX_URL}/api/mutation").mock(
            return_value=httpx.Response(200, json={"value": "x"})
        )
        async with httpx.AsyncClient() as client:
            await create_sandbox_record(
                client, "u1", None, "dsbx_1", "sandbox", "python", True, {}
            )
        body = json.loads(route.calls.last.request.content)
        assert "harnessId" not in body["args"]

    @respx.mock
    async def test_returns_none_on_error(self, convex_settings):
        respx.post(f"{CONVEX_URL}/api/mutation").mock(
            return_value=httpx.Response(500, text="boom")
        )
        async with httpx.AsyncClient() as client:
            result = await create_sandbox_record(
                client, "u1", None, "dsbx_1", "sandbox", "python", True, {}
            )
        assert result is None
