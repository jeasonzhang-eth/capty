"""Model registry: tracks available ASR models and their download status."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

BUILTIN_MODELS: list[dict] = [
    {
        "id": "qwen3-asr-0.6b",
        "name": "Qwen3-ASR-0.6B",
        "type": "qwen-asr",
        "repo": "Qwen/Qwen3-ASR-0.6B",
        "size_gb": 1.2,
        "languages": ["zh", "en"],
        "streaming": True,
        "description": "Lightweight, bilingual Chinese-English, suitable for daily use",
    },
    {
        "id": "whisper-tiny",
        "name": "Whisper Tiny",
        "type": "whisper",
        "repo": "openai/whisper-tiny",
        "mlx_repo": "mlx-community/whisper-tiny",
        "size_gb": 0.04,
        "languages": ["multilingual"],
        "streaming": False,
        "description": "Tiny model, fast speed, ideal for low-spec devices",
    },
    {
        "id": "whisper-base",
        "name": "Whisper Base",
        "type": "whisper",
        "repo": "openai/whisper-base",
        "mlx_repo": "mlx-community/whisper-base-mlx",
        "size_gb": 0.07,
        "languages": ["multilingual"],
        "streaming": False,
        "description": "Base model, balanced speed and quality",
    },
    {
        "id": "whisper-small",
        "name": "Whisper Small",
        "type": "whisper",
        "repo": "openai/whisper-small",
        "mlx_repo": "mlx-community/whisper-small-mlx",
        "size_gb": 0.24,
        "languages": ["multilingual"],
        "streaming": False,
        "description": "Small model, 99 languages, good quality",
    },
    {
        "id": "whisper-medium",
        "name": "Whisper Medium",
        "type": "whisper",
        "repo": "openai/whisper-medium",
        "mlx_repo": "mlx-community/whisper-medium-mlx",
        "size_gb": 0.77,
        "languages": ["multilingual"],
        "streaming": False,
        "description": "Medium model, 99 languages, higher quality",
    },
    {
        "id": "whisper-large-v3-turbo",
        "name": "Whisper Large V3 Turbo",
        "type": "whisper",
        "repo": "openai/whisper-large-v3-turbo",
        "mlx_repo": "mlx-community/whisper-large-v3-turbo",
        "size_gb": 1.6,
        "languages": ["multilingual"],
        "streaming": False,
        "description": "Large turbo model, 99 languages, best quality",
    },
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
        """Return the config dict for *model_id*, or ``None`` if unknown.

        For non-builtin models that exist on disk, infer metadata from
        the directory name so that sidecar can load them dynamically.
        """
        for model in BUILTIN_MODELS:
            if model["id"] == model_id:
                return dict(model)  # return a copy

        # Fallback: if model directory exists on disk, infer metadata
        if self.is_downloaded(model_id):
            lower = model_id.lower()
            model_type = (
                "qwen-asr"
                if "qwen" in lower
                else "whisper"
            )
            repo = model_id.replace("--", "/")
            return {
                "id": model_id,
                "name": model_id.split("--")[-1] if "--" in model_id else model_id,
                "type": model_type,
                "repo": repo,
                "size_gb": 0,
                "languages": ["multilingual"],
                "description": repo,
            }

        return None
