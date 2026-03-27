"""TTS runner: loads and runs text-to-speech using mlx-audio.

Shares the single-thread MLX executor from model_runner to ensure
thread safety — MLX is NOT thread-safe.
"""

from __future__ import annotations

import asyncio
import gc
import io
import logging
import re
import wave
from pathlib import Path
from typing import Optional

import mlx.core as mx
import numpy as np

from capty_sidecar.model_runner import _mlx_executor

logger = logging.getLogger(__name__)

DEFAULT_TTS_MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit"

# CJK Unicode ranges for language auto-detection
_CJK_RE = re.compile(
    r"[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff"
    r"\U00020000-\U0002a6df\U0002a700-\U0002ebef]"
)

def _detect_lang(text: str) -> str:
    """Auto-detect language from text content.

    Returns language strings compatible with mlx-audio models
    (e.g. Qwen3-TTS uses "chinese", "english").
    """
    cjk_count = len(_CJK_RE.findall(text))
    total = len(text.strip())
    if total > 0 and cjk_count / total > 0.15:
        return "chinese"
    return "english"


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


def _audio_to_wav_bytes(audio_np: np.ndarray, sample_rate: int) -> bytes:
    """Convert float32 numpy audio array to WAV bytes."""
    # Replace NaN/Inf from model output before conversion
    audio_np = np.nan_to_num(audio_np, nan=0.0, posinf=1.0, neginf=-1.0)
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
        """Load TTS model. Called on the MLX executor thread.

        model_id can be a HuggingFace repo ID or a local directory path.
        """
        from mlx_audio.tts.utils import load_model

        logger.info("Loading TTS model %s", model_id)
        self._model = load_model(model_id)
        self._model_id = model_id
        sr = getattr(self._model, "sample_rate", "unknown")
        logger.info("TTS model loaded: %s (sample_rate=%s)", model_id, sr)

    def is_loaded(self) -> bool:
        return self._model is not None

    def unload(self) -> None:
        self._model = None
        self._model_id = None
        logger.info("TTS model unloaded")

    async def synthesize(
        self,
        text: str,
        voice: str = "auto",
        speed: float = 1.0,
        lang_code: str = "auto",
    ) -> bytes:
        """Generate speech from text, return WAV bytes.

        Parameters are forwarded to the model's generate() method.
        The model handles its own text splitting and audio generation.
        """
        if not self.is_loaded():
            raise RuntimeError("TTS model not loaded")

        plain = _strip_markdown(text)
        if not plain:
            raise ValueError("Empty text after stripping markdown")

        # Auto-detect language
        effective_lang = _detect_lang(plain) if lang_code == "auto" else lang_code
        # voice "auto" → None (let model use its default)
        effective_voice = None if voice == "auto" else voice

        logger.info(
            "TTS synthesize: lang=%s, voice=%s, text_len=%d",
            effective_lang,
            effective_voice,
            len(plain),
        )

        model = self._model
        loop = asyncio.get_event_loop()

        def _generate_all() -> bytes:
            all_audio: list[np.ndarray] = []
            # Use model's native sample rate, fallback to 24000
            sample_rate = getattr(model, "sample_rate", 24000)

            try:
                results = model.generate(
                    text=plain,
                    voice=effective_voice,
                    speed=speed,
                    lang_code=effective_lang,
                )
                for i, result in enumerate(results):
                    audio_np = np.array(result.audio)
                    has_nan = bool(np.any(np.isnan(audio_np)))
                    has_inf = bool(np.any(np.isinf(audio_np)))
                    logger.info(
                        "TTS segment %d: %d samples (%.1fs), dtype=%s, "
                        "min=%.6f, max=%.6f, nan=%s, inf=%s",
                        i,
                        audio_np.shape[0],
                        audio_np.shape[0] / sample_rate,
                        audio_np.dtype,
                        float(np.nanmin(audio_np)),
                        float(np.nanmax(audio_np)),
                        has_nan,
                        has_inf,
                    )
                    all_audio.append(audio_np)
                    # Use sample rate from result if available
                    if hasattr(result, "sample_rate") and result.sample_rate:
                        sample_rate = result.sample_rate
            except Exception:
                logger.exception("TTS generation failed")

            if not all_audio:
                raise RuntimeError("TTS produced no audio")

            combined = np.concatenate(all_audio)
            logger.info(
                "TTS complete: %d segments, %d total samples (%.1fs), sr=%d",
                len(all_audio),
                combined.shape[0],
                combined.shape[0] / sample_rate,
                sample_rate,
            )
            wav_bytes = _audio_to_wav_bytes(combined, sample_rate)

            mx.clear_cache()
            gc.collect()
            return wav_bytes

        return await loop.run_in_executor(_mlx_executor, _generate_all)
