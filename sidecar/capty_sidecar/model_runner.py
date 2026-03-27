"""Model runner: loads and runs ASR inference using mlx-audio (GPU-accelerated).

IMPORTANT: MLX is NOT thread-safe.  All MLX operations (model loading and
inference) MUST run on the same single thread.  This module uses a dedicated
``ThreadPoolExecutor(max_workers=1)`` for that purpose — never call MLX
functions from arbitrary threads or via the default executor.
"""

from __future__ import annotations

import asyncio
import gc
import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

import mlx.core as mx
import numpy as np

logger = logging.getLogger(__name__)

# Audio constants
DEFAULT_SAMPLE_RATE = 16000
PCM_DTYPE = np.int16
PCM_MAX = 32768.0

# Single-thread executor dedicated to MLX operations.  MLX's native C++
# layer segfaults when accessed concurrently from multiple threads.
_mlx_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mlx")

# Limit the MLX metal buffer cache to 2 GB.  On Apple Silicon the GPU shares
# system RAM (unified memory).  Without a limit the cache grows unbounded —
# every inference allocates buffers that are kept for reuse, and over many
# transcriptions this can consume 30+ GB of RAM.
_MLX_CACHE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB
mx.set_cache_limit(_MLX_CACHE_LIMIT_BYTES)


def _pcm_bytes_to_float32(pcm_bytes: bytes) -> np.ndarray:
    """Convert raw 16-bit signed-LE PCM bytes to float32 numpy array in [-1, 1]."""
    samples = np.frombuffer(pcm_bytes, dtype=PCM_DTYPE)
    return samples.astype(np.float32) / PCM_MAX


class ModelRunner:
    """Manages ASR model loading and inference via mlx-audio unified API."""

    def __init__(self) -> None:
        self._model = None  # mlx_audio model object
        self._model_id: Optional[str] = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def load(self, model_id: str, models_dir: Path | str) -> None:
        """Load model from a local directory using mlx_audio.stt.load.

        Parameters
        ----------
        model_id:
            Identifier for the model (maps to a subdirectory under *models_dir*).
        models_dir:
            Parent directory containing model subdirectories.

        Raises ``FileNotFoundError`` if the model directory does not exist.
        """
        from mlx_audio.stt import load

        model_path = Path(models_dir) / model_id
        if not model_path.is_dir():
            raise FileNotFoundError(f"Model directory not found: {model_path}")

        logger.info("Loading model %s from %s", model_id, model_path)
        self._model = load(str(model_path))
        self._model_id = model_id
        logger.info("Model %s loaded successfully", model_id)

    def is_loaded(self) -> bool:
        """Return ``True`` if a model is currently loaded."""
        return self._model is not None

    def unload(self) -> None:
        """Free model from memory."""
        self._model = None
        self._model_id = None
        logger.info("Model unloaded")

    @property
    def current_model_id(self) -> Optional[str]:
        return self._model_id

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

        audio_float = _pcm_bytes_to_float32(audio_pcm)
        model = self._model
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            _mlx_executor,
            lambda: _run_and_cleanup(lambda: model.generate(audio_float)),
        )
        return result.text if result else ""

    async def transcribe_array(self, audio_np: np.ndarray) -> str:
        """Transcribe a float32 numpy array and return text.

        Unlike ``transcribe`` which accepts raw PCM bytes, this method
        accepts a pre-processed float32 array (e.g. from ``load_audio``).
        """
        if not self.is_loaded():
            raise RuntimeError("No model loaded")

        model = self._model
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            _mlx_executor,
            lambda: _run_and_cleanup(lambda: model.generate(audio_np)),
        )
        return result.text if result else ""


def _run_and_cleanup(fn):
    """Run *fn*, then release MLX cache and collect garbage."""
    try:
        return fn()
    finally:
        mx.clear_cache()
        gc.collect()
