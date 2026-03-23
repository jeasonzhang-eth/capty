import pytest
from pathlib import Path
from capty_sidecar.model_registry import ModelRegistry, BUILTIN_MODELS


def test_list_models(tmp_path: Path):
    """list_models returns all built-in models with download status."""
    registry = ModelRegistry(models_dir=tmp_path)
    models = registry.list_models()
    assert isinstance(models, list)
    assert len(models) > 0  # built-in models always present
    # Every model dict must have required fields
    for model in models:
        assert "id" in model
        assert "name" in model
        assert "downloaded" in model
        assert isinstance(model["downloaded"], bool)


def test_list_models_marks_not_downloaded(tmp_path: Path):
    """When no model dirs exist, all models are marked as not downloaded."""
    registry = ModelRegistry(models_dir=tmp_path)
    models = registry.list_models()
    for model in models:
        assert model["downloaded"] is False


def test_list_models_marks_downloaded(tmp_path: Path):
    """When a model directory exists, that model is marked as downloaded."""
    model_id = BUILTIN_MODELS[0]["id"]
    (tmp_path / model_id).mkdir()
    registry = ModelRegistry(models_dir=tmp_path)
    models = registry.list_models()
    matched = [m for m in models if m["id"] == model_id]
    assert len(matched) == 1
    assert matched[0]["downloaded"] is True


def test_is_downloaded_false(tmp_path: Path):
    """is_downloaded returns False when model directory does not exist."""
    registry = ModelRegistry(models_dir=tmp_path)
    assert registry.is_downloaded("qwen3-asr-0.6b") is False


def test_is_downloaded_true(tmp_path: Path):
    """is_downloaded returns True when model directory exists."""
    (tmp_path / "qwen3-asr-0.6b").mkdir()
    registry = ModelRegistry(models_dir=tmp_path)
    assert registry.is_downloaded("qwen3-asr-0.6b") is True


def test_get_model_path(tmp_path: Path):
    """get_model_path returns the expected path for a model."""
    registry = ModelRegistry(models_dir=tmp_path)
    path = registry.get_model_path("qwen3-asr-0.6b")
    assert path == tmp_path / "qwen3-asr-0.6b"


def test_get_model_info_existing(tmp_path: Path):
    """get_model_info returns model config for a known model."""
    registry = ModelRegistry(models_dir=tmp_path)
    info = registry.get_model_info("qwen3-asr-0.6b")
    assert info is not None
    assert info["id"] == "qwen3-asr-0.6b"
    assert info["repo"] == "Qwen/Qwen3-ASR-0.6B"


def test_get_model_info_unknown(tmp_path: Path):
    """get_model_info returns None for an unknown model."""
    registry = ModelRegistry(models_dir=tmp_path)
    info = registry.get_model_info("nonexistent-model")
    assert info is None
