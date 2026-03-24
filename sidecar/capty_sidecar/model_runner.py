"""Model runner: loads and runs ASR inference using qwen-asr or whisper."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import AsyncGenerator, Optional

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
    """Manages ASR model loading, inference, and unloading."""

    def __init__(self) -> None:
        self._model = None
        self._processor = None  # Used by Whisper
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
            self._load_whisper(model_path)
        else:
            self._load_qwen_asr(model_path)

        self._model_id = model_id
        self._model_type = model_type
        logger.info("Model %s loaded successfully", model_id)

    def _load_qwen_asr(self, model_path: Path) -> None:
        import torch
        from qwen_asr import Qwen3ASRModel

        self._model = Qwen3ASRModel.from_pretrained(
            str(model_path),
            dtype=torch.float32,
            device_map="cpu",
            max_new_tokens=4096,
        )
        self._processor = None

    def _load_whisper(self, model_path: Path) -> None:
        import torch
        from transformers import WhisperForConditionalGeneration, WhisperProcessor

        self._processor = WhisperProcessor.from_pretrained(str(model_path))
        self._model = WhisperForConditionalGeneration.from_pretrained(
            str(model_path),
            torch_dtype=torch.float32,
        )
        self._model.to("cpu")

    def is_loaded(self) -> bool:
        """Return ``True`` if a model is currently loaded."""
        return self._model is not None

    def unload(self) -> None:
        """Free model from memory."""
        self._model = None
        self._processor = None
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

    async def transcribe_stream(
        self,
        audio_pcm: bytes,
        sample_rate: int = DEFAULT_SAMPLE_RATE,
    ) -> AsyncGenerator[dict, None]:
        """Async generator that yields partial and final transcription dicts.

        Each yielded dict has the shape:
            ``{"type": "partial" | "final", "text": str}``

        Raises ``RuntimeError`` if no model is loaded.
        """
        if not self.is_loaded():
            raise RuntimeError("No model loaded")

        if self._model_type == "whisper":
            async for message in self._run_whisper_inference(audio_pcm, sample_rate):
                yield message
        else:
            async for message in self._run_qwen_inference(audio_pcm, sample_rate):
                yield message

    async def _run_qwen_inference(
        self,
        audio_pcm: bytes,
        sample_rate: int,
    ) -> AsyncGenerator[dict, None]:
        """Run model inference using qwen-asr, yielding results."""
        audio_float = _pcm_bytes_to_float32(audio_pcm)

        # Run inference in a thread pool to avoid blocking the event loop
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(
            None,
            lambda: self._model.transcribe(
                audio=(audio_float, sample_rate),
            ),
        )

        text = results[0].text if results else ""
        if text:
            yield {"type": "partial", "text": text}
        yield {"type": "final", "text": text}

    async def _run_whisper_inference(
        self,
        audio_pcm: bytes,
        sample_rate: int,
    ) -> AsyncGenerator[dict, None]:
        """Run model inference using Whisper (transformers), yielding results."""
        import torch

        audio_float = _pcm_bytes_to_float32(audio_pcm)

        loop = asyncio.get_event_loop()

        def _infer() -> str:
            input_features = self._processor(
                audio_float,
                sampling_rate=sample_rate,
                return_tensors="pt",
            ).input_features

            with torch.no_grad():
                predicted_ids = self._model.generate(input_features)

            transcription = self._processor.batch_decode(
                predicted_ids, skip_special_tokens=True
            )
            return transcription[0] if transcription else ""

        text = await loop.run_in_executor(None, _infer)

        if text:
            yield {"type": "partial", "text": text}
        yield {"type": "final", "text": text}
