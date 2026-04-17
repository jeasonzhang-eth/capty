"""Tests for the disk-driven model registry."""

from __future__ import annotations

import json

import pytest

import capty_sidecar.model_registry as model_registry_module
from capty_sidecar.model_registry import ModelRegistry


def _write_json(path, data) -> None:
    path.write_text(json.dumps(data), encoding="utf-8")


@pytest.fixture(autouse=True)
def stub_mlx_remapping(monkeypatch):
    monkeypatch.setattr(model_registry_module, "_get_stt_remapping", lambda: {})
    monkeypatch.setattr(model_registry_module, "_get_tts_remapping", lambda: {})


def test_list_models_returns_empty_for_missing_directory(tmp_path):
    registry = ModelRegistry(tmp_path / "missing")
    assert registry.list_models() == []


def test_list_models_skips_directories_without_weight_files(tmp_path):
    model_dir = tmp_path / "mlx-community--whisper-small"
    model_dir.mkdir()
    _write_json(model_dir / "config.json", {"model_type": "whisper"})

    registry = ModelRegistry(tmp_path)
    assert registry.list_models() == []
    assert registry.get_model_info("mlx-community--whisper-small") is None


def test_list_models_prefers_model_meta_when_present(tmp_path):
    model_dir = tmp_path / "mlx-community--whisper-small"
    model_dir.mkdir()
    (model_dir / "weights.safetensors").write_bytes(b"ok")
    _write_json(
        model_dir / "model-meta.json",
        {
            "name": "Whisper Small",
            "type": "whisper",
            "repo": "mlx-community/whisper-small",
            "size_gb": 1.23,
            "languages": ["en", "zh"],
            "description": "Small ASR model",
        },
    )

    registry = ModelRegistry(tmp_path)
    models = registry.list_models()

    assert len(models) == 1
    assert models[0]["id"] == "mlx-community--whisper-small"
    assert models[0]["name"] == "Whisper Small"
    assert models[0]["repo"] == "mlx-community/whisper-small"
    assert models[0]["downloaded"] is True


def test_list_models_infers_metadata_from_directory_and_config(tmp_path):
    model_dir = tmp_path / "mlx-community--whisper-small"
    model_dir.mkdir()
    (model_dir / "weights.safetensors").write_bytes(b"ok")
    _write_json(
        model_dir / "config.json",
        {
            "model_type": "unknown",
            "architectures": ["WhisperForConditionalGeneration"],
        },
    )

    registry = ModelRegistry(tmp_path)
    models = registry.list_models()

    assert len(models) == 1
    assert models[0]["name"] == "whisper-small"
    assert models[0]["repo"] == "mlx-community/whisper-small"
    assert models[0]["type"] == "whisper"
    assert models[0]["description"] == "mlx-community/whisper-small"


def test_is_downloaded_requires_local_weight_files(tmp_path):
    model_dir = tmp_path / "mlx-community--whisper-small"
    model_dir.mkdir()

    registry = ModelRegistry(tmp_path)
    assert registry.is_downloaded("mlx-community--whisper-small") is False

    (model_dir / "weights.safetensors").write_bytes(b"ok")
    assert registry.is_downloaded("mlx-community--whisper-small") is True


def test_get_model_info_falls_back_when_meta_is_missing(tmp_path):
    model_dir = tmp_path / "mlx-community--parakeet"
    model_dir.mkdir()
    (model_dir / "weights.safetensors").write_bytes(b"ok")
    _write_json(model_dir / "config.json", {"architectures": ["ParakeetModel"]})

    registry = ModelRegistry(tmp_path)
    info = registry.get_model_info("mlx-community--parakeet")

    assert info is not None
    assert info["repo"] == "mlx-community/parakeet"
    assert info["type"] == "parakeet"
