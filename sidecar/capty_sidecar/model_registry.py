"""Model registry: disk-driven, no static registry.

A model directory exists = model is available.
Each model directory may contain a ``model-meta.json`` for rich metadata;
otherwise metadata is inferred from the directory name.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional


# Weight file extensions that indicate a valid downloaded model.
_WEIGHT_EXTS = (".safetensors", ".bin", ".gguf")


def _has_weight_files(model_dir: Path) -> bool:
    """Return True if *model_dir* contains at least one weight file."""
    try:
        return any(f.suffix in _WEIGHT_EXTS for f in model_dir.iterdir() if f.is_file())
    except OSError:
        return False


def _read_model_meta(model_dir: Path) -> Optional[dict]:
    """Read ``model-meta.json`` from *model_dir*, or return None."""
    meta_path = model_dir / "model-meta.json"
    if not meta_path.is_file():
        return None
    try:
        with meta_path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _infer_model_type(model_dir: Path) -> str:
    """Infer model type from ``config.json`` inside *model_dir*."""
    config_path = model_dir / "config.json"
    if not config_path.is_file():
        return "auto"
    try:
        with config_path.open("r", encoding="utf-8") as f:
            cfg = json.load(f)
        model_type = cfg.get("model_type", "")
        architectures = cfg.get("architectures", [])
        combined = (model_type + " " + " ".join(architectures)).lower()
        if "whisper" in combined:
            return "whisper"
        if "qwen" in combined:
            return "qwen-asr"
        if "parakeet" in combined:
            return "parakeet"
    except (OSError, json.JSONDecodeError):
        pass
    return "auto"


class ModelRegistry:
    """Tracks available ASR models by scanning the models directory on disk."""

    def __init__(self, models_dir: Path | str) -> None:
        self._models_dir = Path(models_dir)

    def list_models(self) -> list[dict]:
        """Return all downloaded models found in *models_dir*.

        Each entry has ``downloaded: True`` since only on-disk models are returned.
        """
        if not self._models_dir.is_dir():
            return []

        results: list[dict] = []
        try:
            for entry in sorted(self._models_dir.iterdir()):
                if not entry.is_dir():
                    continue
                if not _has_weight_files(entry):
                    continue

                dir_name = entry.name
                meta = _read_model_meta(entry)

                if meta:
                    results.append({
                        "id": dir_name,
                        "name": meta.get("name", dir_name),
                        "type": meta.get("type", _infer_model_type(entry)),
                        "repo": meta.get("repo", dir_name.replace("--", "/")),
                        "size_gb": meta.get("size_gb", 0),
                        "languages": meta.get("languages", ["multilingual"]),
                        "description": meta.get("description", ""),
                        "downloaded": True,
                    })
                else:
                    # Infer metadata from directory name and config.json
                    repo = dir_name.replace("--", "/")
                    name = dir_name.split("--")[-1] if "--" in dir_name else dir_name
                    results.append({
                        "id": dir_name,
                        "name": name,
                        "type": _infer_model_type(entry),
                        "repo": repo,
                        "size_gb": 0,
                        "languages": ["multilingual"],
                        "description": repo,
                        "downloaded": True,
                    })
        except OSError:
            pass

        return results

    def is_downloaded(self, model_id: str) -> bool:
        """Check whether *model_id* has a local directory with weight files."""
        model_dir = self._models_dir / model_id
        return model_dir.is_dir() and _has_weight_files(model_dir)

    def get_model_path(self, model_id: str) -> Path:
        """Return the local filesystem path for *model_id*."""
        return self._models_dir / model_id

    def get_model_info(self, model_id: str) -> Optional[dict]:
        """Return the metadata dict for *model_id*, or ``None`` if not found on disk."""
        model_dir = self._models_dir / model_id
        if not model_dir.is_dir() or not _has_weight_files(model_dir):
            return None

        meta = _read_model_meta(model_dir)
        if meta:
            return {
                "id": model_id,
                "name": meta.get("name", model_id),
                "type": meta.get("type", _infer_model_type(model_dir)),
                "repo": meta.get("repo", model_id.replace("--", "/")),
                "size_gb": meta.get("size_gb", 0),
                "languages": meta.get("languages", ["multilingual"]),
                "description": meta.get("description", ""),
            }

        # Fallback: infer from directory name
        repo = model_id.replace("--", "/")
        return {
            "id": model_id,
            "name": model_id.split("--")[-1] if "--" in model_id else model_id,
            "type": _infer_model_type(model_dir),
            "repo": repo,
            "size_gb": 0,
            "languages": ["multilingual"],
            "description": repo,
        }
