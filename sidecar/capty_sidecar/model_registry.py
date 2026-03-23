"""Model registry: tracks available ASR models and their download status."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

BUILTIN_MODELS: list[dict] = [
    {
        "id": "qwen3-asr-0.6b",
        "name": "Qwen3-ASR-0.6B",
        "repo": "Qwen/Qwen3-ASR-0.6B",
        "size_gb": 1.2,
        "languages": ["zh", "en"],
        "streaming": True,
        "description": "Lightweight, bilingual Chinese-English, suitable for daily use",
    }
]


class ModelRegistry:
    """Tracks available ASR models and whether they are downloaded locally."""

    def __init__(self, models_dir: Path | str) -> None:
        self._models_dir = Path(models_dir)

    def list_models(self) -> list[dict]:
        """Return all known models with a ``downloaded`` boolean field."""
        return [
            {**model, "downloaded": self.is_downloaded(model["id"])}
            for model in BUILTIN_MODELS
        ]

    def is_downloaded(self, model_id: str) -> bool:
        """Check whether *model_id* has a local directory in models_dir."""
        return (self._models_dir / model_id).is_dir()

    def get_model_path(self, model_id: str) -> Path:
        """Return the local filesystem path for *model_id*."""
        return self._models_dir / model_id

    def get_model_info(self, model_id: str) -> Optional[dict]:
        """Return the config dict for *model_id*, or ``None`` if unknown."""
        for model in BUILTIN_MODELS:
            if model["id"] == model_id:
                return dict(model)  # return a copy
        return None
