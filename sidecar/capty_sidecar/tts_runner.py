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
import wave
from pathlib import Path
from typing import Optional

import mlx.core as mx
import numpy as np

from capty_sidecar.model_runner import _mlx_executor

logger = logging.getLogger(__name__)

DEFAULT_TTS_MODEL = "mlx-community/Kokoro-82M-bf16"
TTS_SAMPLE_RATE = 24000
MAX_CHUNK_CHARS_EN = 300
MAX_CHUNK_CHARS_CJK = 120  # CJK chars generate ~3 phonemes each; 120 * 3 = 360 < 510 limit

# CJK Unicode ranges for language auto-detection
_CJK_RE = re.compile(
    r"[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff"
    r"\U00020000-\U0002a6df\U0002a700-\U0002ebef]"
)

# Voice defaults per language
_DEFAULT_VOICES = {
    "z": "zf_xiaobei",
    "a": "af_heart",
    "b": "bf_emma",
    "j": "jf_alpha",
}


LANG_MAP = {
    "a": "English (US)",
    "b": "English (UK)",
    "z": "Chinese",
    "j": "Japanese",
    "k": "Korean",
    "e": "Spanish",
    "f": "French",
    "h": "Hindi",
    "i": "Italian",
    "p": "Portuguese",
}
GENDER_MAP = {"f": "Female", "m": "Male"}


def list_voices(model_dir: str) -> list[dict]:
    """Scan voices/*.safetensors in model_dir, parse metadata from filename."""
    voices_dir = Path(model_dir) / "voices"
    if not voices_dir.is_dir():
        return []
    result: list[dict] = [{"id": "auto", "name": "Auto", "lang": "Auto", "gender": ""}]
    for f in sorted(voices_dir.glob("*.safetensors")):
        voice_id = f.stem  # e.g. "af_heart"
        if len(voice_id) >= 3 and voice_id[2] == "_":
            lang = LANG_MAP.get(voice_id[0], voice_id[0])
            gender = GENDER_MAP.get(voice_id[1], voice_id[1])
            name = voice_id[3:].replace("_", " ").title()
        else:
            lang, gender, name = "Unknown", "", voice_id
        result.append({"id": voice_id, "name": name, "lang": lang, "gender": gender})
    return result


def _detect_lang(text: str) -> str:
    """Auto-detect language code from text content.

    Returns 'z' for Chinese, 'a' for English (default).
    """
    cjk_count = len(_CJK_RE.findall(text))
    total = len(text.strip())
    if total > 0 and cjk_count / total > 0.15:
        return "z"
    return "a"


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


def _split_text(text: str, lang: str = "a") -> list[str]:
    """Split text into chunks suitable for Kokoro.

    Uses a smaller chunk limit for CJK languages since each character
    generates ~3 phonemes, easily exceeding Kokoro's 510 phoneme limit.
    """
    max_chars = MAX_CHUNK_CHARS_CJK if lang == "z" else MAX_CHUNK_CHARS_EN
    # Split on sentence boundaries and newlines
    segments = re.split(r"(?<=[。！？.!?\n])\s*", text)
    chunks: list[str] = []
    current = ""
    for seg in segments:
        seg = seg.strip()
        if not seg:
            continue
        if len(current) + len(seg) > max_chars and current:
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
        """Load TTS model. Called on the MLX executor thread.

        model_id can be a HuggingFace repo ID (e.g. "mlx-community/Kokoro-82M-bf16")
        or a local directory path (e.g. "/path/to/models/tts/mlx-community--Kokoro-82M-bf16").
        """
        from mlx_audio.tts.utils import load_model

        logger.info("Loading TTS model %s", model_id)
        self._model = load_model(model_id)
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
        voice: str = "auto",
        speed: float = 1.0,
        lang_code: str = "auto",
    ) -> bytes:
        """Generate speech from text, return WAV bytes.

        When lang_code is "auto", detects language from text content.
        When voice is "auto", picks a default voice for the detected language.
        """
        if not self.is_loaded():
            raise RuntimeError("TTS model not loaded")

        # Strip markdown and split into chunks
        plain = _strip_markdown(text)
        if not plain:
            raise ValueError("Empty text after stripping markdown")

        # Auto-detect language and voice
        effective_lang = _detect_lang(plain) if lang_code == "auto" else lang_code
        effective_voice = _DEFAULT_VOICES.get(effective_lang, "af_heart") if voice == "auto" else voice
        logger.info("TTS: lang=%s, voice=%s, text_len=%d", effective_lang, effective_voice, len(plain))

        chunks = _split_text(plain, lang=effective_lang)
        model = self._model
        loop = asyncio.get_event_loop()

        def _generate_all() -> bytes:
            all_audio: list[np.ndarray] = []
            for chunk in chunks:
                try:
                    results = model.generate(
                        text=chunk,
                        voice=effective_voice,
                        speed=speed,
                        lang_code=effective_lang,
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
