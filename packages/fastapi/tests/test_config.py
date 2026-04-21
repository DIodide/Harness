"""Config module — model maps and startup validation."""
import pytest

from app.config import AVAILABLE_MODELS, MODEL_MAP, THINKING_MODELS, Settings


def test_model_map_covers_thinking_models():
    # Every thinking model must be resolvable via MODEL_MAP.
    for m in THINKING_MODELS:
        assert m in MODEL_MAP


def test_thinking_variants_alias_base():
    # -thinking variants map to the same provider ID as their base.
    assert MODEL_MAP["claude-sonnet-4"] == MODEL_MAP["claude-sonnet-4-thinking"]
    assert MODEL_MAP["claude-opus-4"] == MODEL_MAP["claude-opus-4-thinking"]


def test_available_models_have_required_fields():
    for m in AVAILABLE_MODELS:
        assert "id" in m and "name" in m
        assert m["id"]  # non-empty


def test_validate_startup_requires_openrouter_key():
    # min_length=1 on the field rejects empty at construction, so skip field
    # validation to exercise the validate_startup branch directly.
    s = Settings.model_construct(
        openrouter_api_key="", clerk_secret_key="sk", clerk_issuer="i"
    )
    with pytest.raises(RuntimeError, match="OPENROUTER_API_KEY"):
        s.validate_startup()


def test_validate_startup_requires_clerk_secret():
    s = Settings(openrouter_api_key="k", clerk_secret_key="", clerk_issuer="i")
    with pytest.raises(RuntimeError, match="CLERK_SECRET_KEY"):
        s.validate_startup()


def test_validate_startup_requires_clerk_issuer():
    s = Settings(openrouter_api_key="k", clerk_secret_key="sk", clerk_issuer="")
    with pytest.raises(RuntimeError, match="CLERK_ISSUER"):
        s.validate_startup()


def test_validate_startup_passes_with_minimum_config():
    s = Settings(openrouter_api_key="k", clerk_secret_key="sk", clerk_issuer="i")
    s.validate_startup()  # should not raise
