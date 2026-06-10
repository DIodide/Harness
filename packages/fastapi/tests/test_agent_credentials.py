"""Tests for per-user agent credential crypto and validation."""

import pytest

from app.config import settings
from app.services.agents.credentials import (
    CredentialCryptoError,
    decrypt_secret,
    encrypt_secret,
    validate_secret,
)


@pytest.fixture(autouse=True)
def _credentials_key(monkeypatch):
    monkeypatch.setattr(settings, "agent_credentials_key", "unit-test-key")


class TestCrypto:
    def test_roundtrip(self):
        assert decrypt_secret(encrypt_secret("s3cret")) == "s3cret"

    def test_fresh_nonce_per_encryption(self):
        assert encrypt_secret("same") != encrypt_secret("same")

    def test_unicode_roundtrip(self):
        value = '{"tokens": {"id": "ümläut-🔑"}}'
        assert decrypt_secret(encrypt_secret(value)) == value

    def test_tampered_ciphertext_rejected(self):
        ciphertext = encrypt_secret("s3cret")
        tampered = ciphertext[:-4] + ("AAAA" if ciphertext[-4:] != "AAAA" else "BBBB")
        with pytest.raises(CredentialCryptoError):
            decrypt_secret(tampered)

    def test_wrong_key_rejected(self, monkeypatch):
        ciphertext = encrypt_secret("s3cret")
        monkeypatch.setattr(settings, "agent_credentials_key", "other-key")
        with pytest.raises(CredentialCryptoError):
            decrypt_secret(ciphertext)

    def test_missing_key_raises(self, monkeypatch):
        monkeypatch.setattr(settings, "agent_credentials_key", "")
        with pytest.raises(CredentialCryptoError, match="AGENT_CREDENTIALS_KEY"):
            encrypt_secret("s3cret")


class TestValidateSecret:
    def test_codex_auth_json_valid(self):
        assert validate_secret("codex", "auth_json", '{"tokens": {}}') is None

    def test_codex_auth_json_with_api_key_field(self):
        assert (
            validate_secret("codex", "auth_json", '{"OPENAI_API_KEY": "sk-x"}')
            is None
        )

    def test_codex_auth_json_invalid_json(self):
        assert "valid JSON" in validate_secret("codex", "auth_json", "not json")

    def test_codex_auth_json_wrong_shape(self):
        assert "does not look like" in validate_secret(
            "codex", "auth_json", '{"foo": 1}'
        )

    def test_kind_not_allowed_for_agent(self):
        assert "not a valid credential type" in validate_secret(
            "codex", "oauth_token", "x"
        )
        assert "not a valid credential type" in validate_secret(
            "claude-code", "auth_json", "{}"
        )

    def test_claude_kinds_allowed(self):
        assert validate_secret("claude-code", "oauth_token", "tok") is None
        assert validate_secret("claude-code", "api_key", "sk-ant") is None

    def test_cursor_auth_json_valid(self):
        assert (
            validate_secret(
                "cursor", "auth_json",
                '{"accessToken": "a", "refreshToken": "b"}',
            )
            is None
        )

    def test_cursor_auth_json_wrong_shape(self):
        # A codex auth.json must not validate as a cursor one.
        assert "cursor auth.json" in validate_secret(
            "cursor", "auth_json", '{"tokens": {}}'
        )

    def test_cursor_api_key_allowed(self):
        assert validate_secret("cursor", "api_key", "key_abc") is None

    def test_cursor_oauth_rejected(self):
        assert "not a valid credential type" in validate_secret(
            "cursor", "oauth_token", "x"
        )

    def test_cursor_materialization(self):
        from app.services.agents.credentials import _to_agent_credentials

        creds = _to_agent_credentials(
            "cursor", "auth_json", '{"accessToken": "a"}'
        )
        assert "/home/daytona/.config/cursor/auth.json" in creds.files
        assert creds.env == {}

        key = _to_agent_credentials("cursor", "api_key", "key_abc")
        assert key.env == {"CURSOR_API_KEY": "key_abc"}
        assert key.files == {}

    def test_empty_value_rejected(self):
        assert "empty" in validate_secret("claude-code", "api_key", "   ")

    def test_oversized_value_rejected(self):
        assert "too large" in validate_secret(
            "claude-code", "api_key", "x" * 40_000
        )


class _FakeConvex:
    """Patchable stand-ins for the Convex query/mutation helpers."""

    def __init__(self, rows=None):
        self.rows = rows or {}
        self.mutations: list[tuple[str, dict]] = []

    async def query(self, _http, path, args):
        if path == "agentCredentials:getById":
            row = self.rows.get(args["credentialId"])
            if row and row.get("_userId") == args["userId"]:
                return {k: v for k, v in row.items() if not k.startswith("_")}
            return None
        if path == "agentCredentials:getForAgent":
            for cid, row in self.rows.items():
                if row.get("_userId") == args["userId"] and row["agent"] == args["agent"]:
                    return {"credentialId": cid, **{k: v for k, v in row.items() if not k.startswith("_")}}
            return None
        if path == "agentCredentials:listForUser":
            return [
                {"credentialId": cid, "agent": r["agent"], "kind": r["kind"],
                 "label": r.get("label"), "createdAt": r.get("createdAt", 0)}
                for cid, r in self.rows.items() if r.get("_userId") == args["userId"]
            ]
        return None

    async def mutate(self, _http, path, args):
        self.mutations.append((path, args))
        return "new-credential-id"


@pytest.fixture()
def fake_convex(monkeypatch):
    from app.services.agents import credentials as mod

    fake = _FakeConvex()
    monkeypatch.setattr(mod, "query_convex", fake.query)
    monkeypatch.setattr(mod, "run_convex_mutation", fake.mutate)
    return fake


class TestResolveAgentCredentials:
    async def test_resolves_by_credential_id(self, fake_convex):
        from app.services.agents.credentials import (
            encrypt_secret,
            resolve_agent_credentials,
        )

        fake_convex.rows["cred-1"] = {
            "_userId": "u1", "agent": "claude-code", "kind": "oauth_token",
            "ciphertext": encrypt_secret("tok-123"),
        }
        creds = await resolve_agent_credentials(None, "claude-code", "u1", "cred-1")
        assert creds.env == {"CLAUDE_CODE_OAUTH_TOKEN": "tok-123"}
        # lastUsedAt touch targeted the exact credential
        assert ("agentCredentials:touch", {"credentialId": "cred-1"}) in fake_convex.mutations

    async def test_rejects_other_users_credential(self, fake_convex):
        from app.services.agents.credentials import (
            AgentCredentialsError,
            encrypt_secret,
            resolve_agent_credentials,
        )

        fake_convex.rows["cred-1"] = {
            "_userId": "owner", "agent": "claude-code", "kind": "oauth_token",
            "ciphertext": encrypt_secret("tok"),
        }
        with pytest.raises(AgentCredentialsError, match="No credential"):
            await resolve_agent_credentials(None, "claude-code", "intruder", "cred-1")

    async def test_rejects_agent_mismatch(self, fake_convex):
        from app.services.agents.credentials import (
            AgentCredentialsError,
            encrypt_secret,
            resolve_agent_credentials,
        )

        fake_convex.rows["cred-1"] = {
            "_userId": "u1", "agent": "codex", "kind": "api_key",
            "ciphertext": encrypt_secret("sk"),
        }
        with pytest.raises(AgentCredentialsError, match="belongs to 'codex'"):
            await resolve_agent_credentials(None, "claude-code", "u1", "cred-1")

    async def test_falls_back_to_newest_for_agent(self, fake_convex):
        from app.services.agents.credentials import (
            encrypt_secret,
            resolve_agent_credentials,
        )

        fake_convex.rows["cred-9"] = {
            "_userId": "u1", "agent": "cursor", "kind": "api_key",
            "ciphertext": encrypt_secret("key_abc"),
        }
        creds = await resolve_agent_credentials(None, "cursor", "u1", None)
        assert creds.env == {"CURSOR_API_KEY": "key_abc"}

    async def test_unreadable_ciphertext_raises(self, fake_convex):
        from app.services.agents.credentials import (
            AgentCredentialsError,
            resolve_agent_credentials,
        )

        fake_convex.rows["cred-1"] = {
            "_userId": "u1", "agent": "claude-code", "kind": "oauth_token",
            "ciphertext": "not-valid-ciphertext",
        }
        with pytest.raises(AgentCredentialsError, match="could not be decrypted"):
            await resolve_agent_credentials(None, "claude-code", "u1", "cred-1")


class TestStoreUserCredential:
    async def test_creates_new_credential(self, fake_convex):
        from app.services.agents.credentials import store_user_credential

        plaintext = "THE-PLAINTEXT-SECRET-MARKER"
        cid = await store_user_credential(
            None, "u1", "claude-code", "oauth_token", plaintext, label="work",
        )
        assert cid == "new-credential-id"
        path, args = fake_convex.mutations[0]
        assert path == "agentCredentials:create"
        assert args["label"] == "work"
        assert plaintext not in str(args)  # only ciphertext leaves the process

    async def test_replaces_in_place_with_credential_id(self, fake_convex):
        from app.services.agents.credentials import store_user_credential

        await store_user_credential(
            None, "u1", "codex", "api_key", "sk-x", credential_id="cred-7",
        )
        path, args = fake_convex.mutations[0]
        assert path == "agentCredentials:updateSecret"
        assert args["credentialId"] == "cred-7"


class TestCredentialSources:
    async def test_groups_per_agent_newest_first(self, fake_convex):
        from app.services.agents.credentials import credential_sources

        fake_convex.rows["old"] = {
            "_userId": "u1", "agent": "codex", "kind": "api_key",
            "ciphertext": "x", "createdAt": 1,
        }
        fake_convex.rows["new"] = {
            "_userId": "u1", "agent": "codex", "kind": "auth_json",
            "ciphertext": "y", "createdAt": 2, "label": "personal",
        }
        sources = await credential_sources(None, "u1")
        codex = sources["codex"]
        assert codex["available"] is True
        assert [c["credential_id"] for c in codex["credentials"]] == ["new", "old"]
        assert codex["kind"] == "auth_json"  # newest summarized
        assert sources["claude-code"]["available"] is False
        assert sources["claude-code"]["credentials"] == []


class TestRegistry:
    def test_unknown_agent_raises(self):
        from app.services.agents.registry import get_agent

        with pytest.raises(KeyError):
            get_agent("not-an-agent")

    def test_known_agents_have_models(self):
        from app.services.agents.registry import AGENT_REGISTRY, get_agent

        for agent_id in ("codex", "claude-code", "cursor"):
            agent = get_agent(agent_id)
            assert agent.id == agent_id
            assert len(agent.models) > 0
        assert set(AGENT_REGISTRY) == {"codex", "claude-code", "cursor"}
