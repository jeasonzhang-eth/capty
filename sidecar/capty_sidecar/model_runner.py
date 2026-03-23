"""Model runner: loads and runs ASR inference with streaming output."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import AsyncGenerator, Optional

import numpy as np

# Imports used at runtime; tests may mock these at module level.
from transformers import AutoModelForCausalLM, AutoProcessor

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
        self._processor = None
        self._model_id: Optional[str] = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def load(self, model_id: str, models_dir: Path | str) -> None:
        """Load model and processor from a local directory.

        Raises ``FileNotFoundError`` if the model directory does not exist.
        """
        model_path = Path(models_dir) / model_id
        if not model_path.is_dir():
            raise FileNotFoundError(
                f"Model directory not found: {model_path}"
            )

        logger.info("Loading model %s from %s", model_id, model_path)
        self._processor = AutoProcessor.from_pretrained(
            str(model_path), trust_remote_code=True
        )
        import torch
        self._model = AutoModelForCausalLM.from_pretrained(
            str(model_path), trust_remote_code=True, torch_dtype=torch.float32
        ).to("cpu")
        self._model_id = model_id
        logger.info("Model %s loaded successfully", model_id)

    def is_loaded(self) -> bool:
        """Return ``True`` if a model is currently loaded."""
        return self._model is not None and self._processor is not None

    def unload(self) -> None:
        """Free model and processor from memory."""
        self._model = None
        self._processor = None
        self._model_id = None
        logger.info("Model unloaded")

    @property
    def current_model_id(self) -> Optional[str]:
        return self._model_id

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

        async for message in self._run_inference(audio_pcm, sample_rate):
            yield message

    async def _run_inference(
        self,
        audio_pcm: bytes,
        sample_rate: int,
    ) -> AsyncGenerator[dict, None]:
        """Run model inference, yielding streaming results.

        This default implementation uses transformers generate + TextIteratorStreamer.
        Tests can replace this method with a mock async generator.
        """
        import torch
        from transformers import TextIteratorStreamer
        from threading import Thread

        audio_float = _pcm_bytes_to_float32(audio_pcm)

        # Build the conversation structure expected by Qwen ASR
        conversation = [
            {"role": "user", "content": [
                {"type": "audio", "audio": audio_float, "sampling_rate": sample_rate},
            ]},
        ]

        # Process inputs
        text_prompt = self._processor.apply_chat_template(
            conversation, add_generation_prompt=True, tokenize=False
        )
        inputs = self._processor(
            text=text_prompt,
            audios=[audio_float],
            sampling_rate=sample_rate,
            return_tensors="pt",
            padding=True,
        )

        # Set up streamer
        streamer = TextIteratorStreamer(
            self._processor.tokenizer,
            skip_prompt=True,
            skip_special_tokens=True,
        )

        # Ensure inputs are on CPU
        inputs = {k: v.to("cpu") if hasattr(v, "to") else v for k, v in inputs.items()}

        generation_kwargs = {
            **inputs,
            "max_new_tokens": 4096,
            "streamer": streamer,
        }

        # Run generation in a background thread so we can async-iterate
        thread = Thread(
            target=self._model.generate,
            kwargs=generation_kwargs,
            daemon=True,
        )
        thread.start()

        accumulated_text = ""

        for text_chunk in streamer:
            if text_chunk:
                accumulated_text += text_chunk
                yield {"type": "partial", "text": text_chunk}
            # Yield control to the event loop between chunks
            await asyncio.sleep(0)

        thread.join(timeout=30)

        yield {"type": "final", "text": accumulated_text}
