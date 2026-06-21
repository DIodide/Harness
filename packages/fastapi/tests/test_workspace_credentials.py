"""Tests for workspace (env-var) credential crypto, validation, and resolution."""

import pytest

from app.config import settings
from app.services.secrets_crypto import (
    CredentialCryptoError,
    decrypt_secret,
    encrypt_secret,
)
from app.services.workspace_credentials import (
    resolve_workspace_env,
    store_workspace_credential,
    validate_env_credential,
)


@pytest.fixture(autouse=True)
def _credentials_key(monkeypatch):
    monkeypatch.setattr(settings, "agent_credentials_key", "unit-test-key")


class TestSharedCrypto:
    """secrets_crypto is the single source of truth for both credential kinds."""

    def test_roundtrip(self):
        assert decrypt_secret(encrypt_secret("ghp_abc123")) == "ghp_abc123"

    def test_fresh_nonce_per_encryption(self):
        assert encrypt_secret("same") != encrypt_secret("same")

    def test_missing_key_raises(self, monkeypatch):
        monkeypatch.setattr(settings, "agent_credentials_key", "")
        with pytest.raises(CredentialCryptoError, match="AGENT_CREDENTIALS_KEY"):
            encrypt_secret("x")

    def test_interop_with_agent_credentials_module(self):
        # The re-export in agents.credentials must be the SAME implementation,
        # so ciphertext is interchangeable (one key, one rotation story).
        from app.services.agents.credentials import (
            decrypt_secret as ac_decrypt,
        )

        assert ac_decrypt(encrypt_secret("shared")) == "shared"


class TestValidateEnvCredential:
    def test_typical_names_valid(self):
        assert validate_env_credential("GITHUB_TOKEN", "ghp_x") is None
        assert validate_env_credential("LINEAR_API_KEY", "lin_x") is None
        assert validate_env_credential("_private", "v") is None
        assert validate_env_credential("my_var2", "v") is None

    def test_bad_name_shape_rejected(self):
        assert "Name must start" in validate_env_credential("1BAD", "v")
        assert "Name must start" in validate_env_credential("has-dash", "v")
        assert "Name must start" in validate_env_credential("has space", "v")
        assert "Name must start" in validate_env_credential("", "v")

    def test_reserved_exact_names_rejected(self):
        for name in ("PATH", "HOME", "NODE_OPTIONS", "IFS", "BASH_ENV"):
            assert "reserved" in validate_env_credential(name, "v"), name

    def test_reserved_case_insensitive(self):
        # Lowercase variants are still rejected (defense-in-depth / clarity).
        assert "reserved" in validate_env_credential("path", "v")
        assert "reserved" in validate_env_credential("Node_Options", "v")

    def test_loader_injection_prefixes_rejected(self):
        for name in ("LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES",
                     "BASH_FUNC_x", "ld_audit"):
            assert "reserved" in validate_env_credential(name, "v"), name

    def test_agent_auth_keys_rejected(self):
        # These are managed by agent credentials — never settable here.
        for name in ("CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY",
                     "OPENAI_API_KEY", "CURSOR_API_KEY"):
            assert "reserved" in validate_env_credential(name, "v"), name

    def test_server_secrets_rejected(self):
        for name in ("AGENT_CREDENTIALS_KEY", "CONVEX_DEPLOY_KEY", "CONVEX_URL",
                     "SHIM_TOKEN", "SHIM_PORT", "AGENT_CMD"):
            assert "reserved" in validate_env_credential(name, "v"), name

    def test_empty_value_rejected(self):
        assert "empty" in validate_env_credential("GITHUB_TOKEN", "   ")

    def test_oversized_value_rejected(self):
        assert "too large" in validate_env_credential("GITHUB_TOKEN", "x" * 40_000)

    def test_overlong_name_rejected(self):
        assert validate_env_credential("A" * 200, "v") is not None


class _FakeConvex:
    """Patchable stand-ins for the Convex query/mutation helpers."""

    def __init__(self):
        # workspace_id -> list[{credentialId, name, ciphertext, _userId, _wsUser}]
        self.workspaces: dict[str, dict] = {}
        self.mutations: list[tuple[str, dict]] = []

    async def query(self, _http, path, args):
        if path == "workspaceCredentials:getForWorkspace":
            ws = self.workspaces.get(args["workspaceId"])
            if not ws or ws["_ownerUserId"] != args["userId"]:
                return []  # ownership re-check (mirrors the Convex query)
            return [
                {"credentialId": r["credentialId"], "name": r["name"],
                 "ciphertext": r["ciphertext"]}
                for r in ws["rows"]
            ]
        return None

    async def mutate(self, _http, path, args):
        self.mutations.append((path, args))
        return "new-workspace-credential-id"


@pytest.fixture()
def fake_convex(monkeypatch):
    from app.services import workspace_credentials as mod

    fake = _FakeConvex()
    monkeypatch.setattr(mod, "query_convex", fake.query)
    monkeypatch.setattr(mod, "run_convex_mutation", fake.mutate)
    return fake


class TestResolveWorkspaceEnv:
    async def test_resolves_assigned_credentials(self, fake_convex):
        fake_convex.workspaces["ws1"] = {
            "_ownerUserId": "u1",
            "rows": [
                {"credentialId": "c1", "name": "GITHUB_TOKEN",
                 "ciphertext": encrypt_secret("ghp_x")},
                {"credentialId": "c2", "name": "LINEAR_API_KEY",
                 "ciphertext": encrypt_secret("lin_y")},
            ],
        }
        env = await resolve_workspace_env(None, "ws1", "u1")
        assert env == {"GITHUB_TOKEN": "ghp_x", "LINEAR_API_KEY": "lin_y"}
        # Both credentials get a best-effort lastUsedAt touch.
        touched = {a["credentialId"] for p, a in fake_convex.mutations
                   if p == "workspaceCredentials:touch"}
        assert touched == {"c1", "c2"}

    async def test_other_users_workspace_returns_empty(self, fake_convex):
        fake_convex.workspaces["ws1"] = {
            "_ownerUserId": "owner",
            "rows": [{"credentialId": "c1", "name": "GITHUB_TOKEN",
                      "ciphertext": encrypt_secret("ghp_x")}],
        }
        assert await resolve_workspace_env(None, "ws1", "intruder") == {}

    async def test_no_workspace_id_returns_empty(self, fake_convex):
        assert await resolve_workspace_env(None, "", "u1") == {}

    async def test_unreadable_credential_skipped_not_fatal(self, fake_convex):
        fake_convex.workspaces["ws1"] = {
            "_ownerUserId": "u1",
            "rows": [
                {"credentialId": "c1", "name": "GOOD",
                 "ciphertext": encrypt_secret("v")},
                {"credentialId": "c2", "name": "BROKEN",
                 "ciphertext": "not-valid-ciphertext"},
            ],
        }
        env = await resolve_workspace_env(None, "ws1", "u1")
        # The broken one is dropped; the good one still resolves.
        assert env == {"GOOD": "v"}


class TestStoreWorkspaceCredential:
    async def test_creates_new_credential(self, fake_convex):
        plaintext = "THE-PLAINTEXT-SECRET-MARKER"
        cid = await store_workspace_credential(
            None, "u1", "GITHUB_TOKEN", plaintext, label="ci",
        )
        assert cid == "new-workspace-credential-id"
        path, args = fake_convex.mutations[0]
        assert path == "workspaceCredentials:create"
        assert args["name"] == "GITHUB_TOKEN"
        assert args["label"] == "ci"
        assert plaintext not in str(args)  # only ciphertext leaves the process

    async def test_rotates_in_place_with_credential_id(self, fake_convex):
        await store_workspace_credential(
            None, "u1", "GITHUB_TOKEN", "ghp_new", credential_id="c7",
        )
        path, args = fake_convex.mutations[0]
        assert path == "workspaceCredentials:updateSecret"
        assert args["credentialId"] == "c7"


class TestEnvFingerprint:
    def test_changes_on_add_remove_rotate(self):
        from app.services.agents.session_manager import (
            _workspace_env_fingerprint as fp,
        )

        base = {"A": "1", "B": "2"}
        assert fp({}) == ""
        assert fp(base) == fp({"B": "2", "A": "1"})  # order-independent
        assert fp(base) != fp({"A": "1"})            # removed
        assert fp(base) != fp({"A": "1", "B": "2", "C": "3"})  # added
        assert fp(base) != fp({"A": "1", "B": "9"})  # rotated value
