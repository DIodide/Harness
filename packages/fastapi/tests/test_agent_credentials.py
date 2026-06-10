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
