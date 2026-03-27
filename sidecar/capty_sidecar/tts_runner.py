"""TTS runner: loads and runs text-to-speech using mlx-audio Kokoro model.

Shares the single-thread MLX executor from model_runner to ensure
thread safety — MLX is NOT thread-safe.
"""

from __future__ import annotations

import asyncio
import gc
import io
import logging
import re
import struct
import wave
from typing import Optional

import mlx.core as mx
import numpy as np

from capty_sidecar.model_runner import _mlx_executor, _run_and_cleanup

logger = logging.getLogger(__name__)

DEFAULT_TTS_MODEL = "prince-canuma/Kokoro-82M"
TTS_SAMPLE_RATE = 24000
MAX_CHUNK_CHARS = 300


def _strip_markdown(text: str) -> str:
    """Remove Markdown formatting, keeping only plain text."""
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)  # headings
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)  # bold
    text = re.sub(r"\*(.+?)\*", r"\1", text)  # italic
    text = re.sub(r"`{1,3}[^`]*`{1,3}", "", text)  # code
    text = re.sub(r"^[-*+]\s+", "", text, flags=re.MULTILINE)  # list markers
    text = re.sub(r"^>\s+", "", text, flags=re.MULTILINE)  # blockquotes
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)  # links
    text = re.sub(r"\n{3,}", "\n\n", text)  # collapse newlines
    return text.strip()


def _split_text(text: str) -> list[str]:
    """Split text into chunks suitable for Kokoro (< MAX_CHUNK_CHARS each)."""
    # Split on sentence boundaries and newlines
    segments = re.split(r"(?<=[。！？.!?\n])\s*", text)
    chunks: list[str] = []
    current = ""
    for seg in segments:
        seg = seg.strip()
        if not seg:
            continue
        if len(current) + len(seg) > MAX_CHUNK_CHARS and current:
            chunks.append(current)
            current = seg
        else:
            current = f"{current} {seg}".strip() if current else seg
    if current:
        chunks.append(current)
    return chunks if chunks else [text]


def _audio_to_wav_bytes(audio_np: np.ndarray, sample_rate: int) -> bytes:
    """Convert float32 numpy audio array to WAV bytes."""
    # Clip and convert to int16
    audio_np = np.clip(audio_np, -1.0, 1.0)
    pcm = (audio_np * 32767).astype(np.int16)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


class TTSRunner:
    """Manages TTS model loading and speech synthesis via mlx-audio."""

    def __init__(self) -> None:
        self._model = None
        self._model_id: Optional[str] = None

    def load(self, model_id: str = DEFAULT_TTS_MODEL) -> None:
        """Load TTS model. Called on the MLX executor thread."""
        from mlx_audio.tts import load

        logger.info("Loading TTS model %s", model_id)
        self._model = load(model_id)
        self._model_id = model_id
        logger.info("TTS model %s loaded successfully", model_id)

    def is_loaded(self) -> bool:
        return self._model is not None

    def unload(self) -> None:
        self._model = None
        self._model_id = None
        logger.info("TTS model unloaded")

    async def synthesize(
        self,
        text: str,
        voice: str = "af_heart",
        speed: float = 1.0,
        lang_code: str = "a",
    ) -> bytes:
        """Generate speech from text, return WAV bytes."""
        if not self.is_loaded():
            raise RuntimeError("TTS model not loaded")

        # Strip markdown and split into chunks
        plain = _strip_markdown(text)
        if not plain:
            raise ValueError("Empty text after stripping markdown")

        chunks = _split_text(plain)
        model = self._model
        loop = asyncio.get_event_loop()

        def _generate_all() -> bytes:
            all_audio: list[np.ndarray] = []
            for chunk in chunks:
                try:
                    results = model.generate(
                        text=chunk,
                        voice=voice,
                        speed=speed,
                        lang_code=lang_code,
                    )
                    for result in results:
                        audio_np = np.array(result.audio)
                        all_audio.append(audio_np)
                except Exception:
                    logger.exception("TTS generation failed for chunk: %s", chunk[:50])

            if not all_audio:
                raise RuntimeError("TTS produced no audio")

            combined = np.concatenate(all_audio)
            wav_bytes = _audio_to_wav_bytes(combined, TTS_SAMPLE_RATE)

            mx.clear_cache()
            gc.collect()
            return wav_bytes

        return await loop.run_in_executor(_mlx_executor, _generate_all)
