"""Model runner: loads and runs ASR inference using MLX (GPU-accelerated)."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# Audio constants
DEFAULT_SAMPLE_RATE = 16000
PCM_DTYPE = np.int16
PCM_MAX = 32768.0


def _pcm_bytes_to_float32(pcm_bytes: bytes) -> np.ndarray:
    """Convert raw 16-bit signed-LE PCM bytes to float32 numpy array in [-1, 1]."""
    samples = np.frombuffer(pcm_bytes, dtype=PCM_DTYPE)
    return samples.astype(np.float32) / PCM_MAX


class ModelRunner:
    """Manages ASR model loading, inference, and unloading (MLX backend)."""

    def __init__(self) -> None:
        self._session = None  # mlx-qwen3-asr Session
        self._whisper_model_path: Optional[str] = None  # mlx-whisper model path or HF repo
        self._model_id: Optional[str] = None
        self._model_type: Optional[str] = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def load(
        self,
        model_id: str,
        models_dir: Path | str,
        model_type: str = "qwen-asr",
        mlx_repo: Optional[str] = None,
    ) -> None:
        """Load model from a local directory.

        Parameters
        ----------
        model_id:
            Identifier for the model (maps to a subdirectory under *models_dir*).
        models_dir:
            Parent directory containing model subdirectories.
        model_type:
            Either ``"qwen-asr"`` or ``"whisper"``.
        mlx_repo:
            For Whisper models, the mlx-community HF repo ID (e.g. ``"mlx-community/whisper-tiny"``).
            If provided and local dir lacks MLX weights, this is used as the model path for mlx-whisper.

        Raises ``FileNotFoundError`` if the model directory does not exist.
        """
        model_path = Path(models_dir) / model_id
        if not model_path.is_dir():
            raise FileNotFoundError(
                f"Model directory not found: {model_path}"
            )

        logger.info(
            "Loading model %s (type=%s) from %s", model_id, model_type, model_path
        )

        if model_type == "whisper":
            self._load_whisper(model_path, mlx_repo)
        else:
            self._load_qwen_asr(model_path)

        self._model_id = model_id
        self._model_type = model_type
        logger.info("Model %s loaded successfully", model_id)

    def _load_qwen_asr(self, model_path: Path) -> None:
        from mlx_qwen3_asr import Session

        self._session = Session(model=str(model_path))
        self._whisper_model_path = None

    def _load_whisper(self, model_path: Path, mlx_repo: Optional[str] = None) -> None:
        # Check if local directory has MLX weights
        has_mlx_weights = any(model_path.glob("*.npz")) or (model_path / "weights.npz").exists()

        if has_mlx_weights:
            self._whisper_model_path = str(model_path)
        elif mlx_repo:
            # Use HF repo identifier; mlx-whisper will auto-download to cache
            self._whisper_model_path = mlx_repo
        else:
            # Fallback to local path (mlx-whisper may attempt conversion)
            self._whisper_model_path = str(model_path)

        self._session = None
        logger.info("Whisper model path: %s", self._whisper_model_path)

    def is_loaded(self) -> bool:
        """Return ``True`` if a model is currently loaded."""
        return self._session is not None or self._whisper_model_path is not None

    def unload(self) -> None:
        """Free model from memory."""
        self._session = None
        self._whisper_model_path = None
        self._model_id = None
        self._model_type = None
        logger.info("Model unloaded")

    @property
    def current_model_id(self) -> Optional[str]:
        return self._model_id

    @property
    def current_model_type(self) -> Optional[str]:
        return self._model_type

    # ------------------------------------------------------------------
    # Inference
    # ------------------------------------------------------------------

    async def transcribe(
        self,
        audio_pcm: bytes,
        sample_rate: int = DEFAULT_SAMPLE_RATE,
    ) -> str:
        """Transcribe audio and return text.

        Runs inference in a thread pool to avoid blocking the event loop.
        Raises ``RuntimeError`` if no model is loaded.
        """
        if not self.is_loaded():
            raise RuntimeError("No model loaded")

        if self._model_type == "whisper":
            return await self._run_whisper_inference(audio_pcm, sample_rate)
        return await self._run_qwen_inference(audio_pcm, sample_rate)

    async def _run_qwen_inference(
        self,
        audio_pcm: bytes,
        sample_rate: int,
    ) -> str:
        """Run inference using mlx-qwen3-asr Session."""
        audio_float = _pcm_bytes_to_float32(audio_pcm)

        session = self._session
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: session.transcribe((audio_float, sample_rate)),
        )

        return result.text if result else ""

    async def _run_whisper_inference(
        self,
        audio_pcm: bytes,
        sample_rate: int,
    ) -> str:
        """Run inference using mlx-whisper."""
        import mlx_whisper

        audio_float = _pcm_bytes_to_float32(audio_pcm)
        model_path = self._whisper_model_path

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: mlx_whisper.transcribe(
                audio_float,
                path_or_hf_repo=model_path,
            ),
        )

        return result.get("text", "") if result else ""
