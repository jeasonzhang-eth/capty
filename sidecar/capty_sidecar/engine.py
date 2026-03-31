"""Engine abstractions for ASR and TTS inference.

Each engine manages its own model lifecycle (load/unload) and provides
synchronous inference methods that run on the MLX thread via run_on_mlx().
"""

from __future__ import annotations

import gc
import io
import logging
import re
import wave
from pathlib import Path
from typing import Optional

import mlx.core as mx
import numpy as np

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Audio constants
# ---------------------------------------------------------------------------

DEFAULT_SAMPLE_RATE = 16000
PCM_DTYPE = np.int16
PCM_MAX = 32768.0

# ---------------------------------------------------------------------------
# Text utilities (migrated from tts_runner.py)
# ---------------------------------------------------------------------------

# CJK Unicode ranges for language auto-detection
_CJK_RE = re.compile(
    r"[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff"
    r"\U00020000-\U0002a6df\U0002a700-\U0002ebef]"
)

# Sentence-ending punctuation for cooperative TTS streaming
_SENTENCE_END_RE = re.compile(r"(?<=[。！？；.!?;])\s*")


def detect_lang(text: str) -> str:
    """Auto-detect language from text content."""
    cjk_count = len(_CJK_RE.findall(text))
    total = len(text.strip())
    if total > 0 and cjk_count / total > 0.15:
        return "chinese"
    return "english"


def strip_markdown(text: str) -> str:
    """Remove Markdown formatting, keeping only plain text."""
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"\*(.+?)\*", r"\1", text)
    text = re.sub(r"`{1,3}[^`]*`{1,3}", "", text)
    text = re.sub(r"^[-*+]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^>\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def split_sentences(text: str) -> list[str]:
    """Split text into sentences for cooperative TTS streaming.

    Rules:
    - Split on Chinese punctuation: 。！？；
    - Split on English punctuation: . ! ? ;
    - Merge segments shorter than 10 chars into previous
    - Cap each segment at 200 chars (hard break at space or mid-word)
    """
    raw = _SENTENCE_END_RE.split(text.strip())
    raw = [s.strip() for s in raw if s.strip()]

    if not raw:
        return []

    # Merge short segments into previous
    merged: list[str] = []
    for seg in raw:
        if merged and len(merged[-1]) < 10:
            merged[-1] = merged[-1] + " " + seg
        else:
            merged.append(seg)

    # Cap at 200 chars
    result: list[str] = []
    for seg in merged:
        while len(seg) > 200:
            # Try to break at a space
            idx = seg.rfind(" ", 0, 200)
            if idx <= 0:
                idx = 200
            result.append(seg[:idx].strip())
            seg = seg[idx:].strip()
        if seg:
            result.append(seg)

    return result


# ---------------------------------------------------------------------------
# Voice utilities (migrated from tts_runner.py)
# ---------------------------------------------------------------------------

_KNOWN_SPEAKERS: dict[str, dict[str, str]] = {
    "vivian":   {"name": "Vivian",   "lang": "Chinese",  "gender": "Female"},
    "serena":   {"name": "Serena",   "lang": "Chinese",  "gender": "Female"},
    "uncle_fu": {"name": "Uncle Fu", "lang": "Chinese",  "gender": "Male"},
    "dylan":    {"name": "Dylan",    "lang": "Chinese (Beijing Dialect)", "gender": "Male"},
    "eric":     {"name": "Eric",     "lang": "Chinese (Sichuan Dialect)", "gender": "Male"},
    "chelsie":  {"name": "Chelsie",  "lang": "English",  "gender": "Female"},
    "ryan":     {"name": "Ryan",     "lang": "English",  "gender": "Male"},
    "aiden":    {"name": "Aiden",    "lang": "English",  "gender": "Male"},
    "ethan":    {"name": "Ethan",    "lang": "English",  "gender": "Male"},
}


def build_voice_list(spk_id: dict) -> list[dict]:
    """Build a structured voice list from a model's spk_id dict."""
    lang_order = ["Chinese", "English"]

    def sort_key(name: str) -> tuple:
        meta = _KNOWN_SPEAKERS.get(name, {})
        lang = meta.get("lang", "")
        base_lang = lang.split("(")[0].strip() if lang else "ZZZ"
        idx = lang_order.index(base_lang) if base_lang in lang_order else 99
        return (idx, name)

    voices: list[dict] = []
    for name in sorted(spk_id.keys(), key=sort_key):
        meta = _KNOWN_SPEAKERS.get(name, {})
        voices.append({
            "id": name,
            "name": meta.get("name", name.capitalize()),
            "lang": meta.get("lang", ""),
            "gender": meta.get("gender", ""),
        })
    return voices


def audio_to_wav_bytes(audio_np: np.ndarray, sample_rate: int) -> bytes:
    """Convert float32 numpy audio array to WAV bytes."""
    audio_np = np.nan_to_num(audio_np, nan=0.0, posinf=1.0, neginf=-1.0)
    audio_np = np.clip(audio_np, -1.0, 1.0)
    pcm = (audio_np * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


def pcm_bytes_to_float32(pcm_bytes: bytes) -> np.ndarray:
    """Convert raw 16-bit signed-LE PCM bytes to float32 in [-1, 1]."""
    samples = np.frombuffer(pcm_bytes, dtype=PCM_DTYPE)
    return samples.astype(np.float32) / PCM_MAX


# ---------------------------------------------------------------------------
# BaseEngine
# ---------------------------------------------------------------------------

class BaseEngine:
    """Abstract base for MLX inference engines."""

    engine_type: str = ""

    def __init__(self) -> None:
        self._model = None
        self._model_id: Optional[str] = None

    @property
    def model_id(self) -> Optional[str]:
        return self._model_id

    def is_loaded(self) -> bool:
        return self._model is not None

    def load_sync(self, model_id: str, model_path: Path) -> None:
        """Load model. MUST run on MLX thread."""
        raise NotImplementedError

    def unload_sync(self) -> None:
        """Unload model and free memory. MUST run on MLX thread."""
        self._model = None
        self._model_id = None
        mx.clear_cache()
        gc.collect()
        logger.info("%s engine unloaded", self.engine_type.upper())


# ---------------------------------------------------------------------------
# ASREngine
# ---------------------------------------------------------------------------

class ASREngine(BaseEngine):
    """ASR inference engine using mlx-audio STT."""

    engine_type = "asr"

    def load_sync(self, model_id: str, model_path: Path) -> None:
        """Load ASR model from local directory."""
        from mlx_audio.stt import load

        if not model_path.is_dir():
            raise FileNotFoundError(f"Model directory not found: {model_path}")

        if self._model is not None:
            self.unload_sync()

        logger.info("Loading ASR model %s from %s", model_id, model_path)
        self._model = load(str(model_path))
        self._model_id = model_id
        logger.info("ASR model %s loaded successfully", model_id)

    def transcribe_sync(self, audio_pcm: bytes, sample_rate: int = DEFAULT_SAMPLE_RATE) -> str:
        """Transcribe PCM audio. MUST run on MLX thread."""
        if not self.is_loaded():
            raise RuntimeError("ASR model not loaded")
        audio_float = pcm_bytes_to_float32(audio_pcm)
        result = self._model.generate(audio_float)
        return result.text if result else ""

    def transcribe_array_sync(self, audio_np: np.ndarray) -> str:
        """Transcribe float32 numpy array. MUST run on MLX thread."""
        if not self.is_loaded():
            raise RuntimeError("ASR model not loaded")
        result = self._model.generate(audio_np)
        return result.text if result else ""


# ---------------------------------------------------------------------------
# TTSEngine
# ---------------------------------------------------------------------------

DEFAULT_TTS_MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit"


class TTSEngine(BaseEngine):
    """TTS inference engine using mlx-audio."""

    engine_type = "tts"

    def load_sync(self, model_id: str, model_path: Path) -> None:
        """Load TTS model. model_path can be a local dir or HF repo ID."""
        from mlx_audio.tts.utils import load_model

        if self._model is not None:
            self.unload_sync()

        logger.info("Loading TTS model %s", model_id)
        # model_path may be a HF repo ID string or a local path
        self._model = load_model(str(model_path))
        self._model_id = model_id
        sr = getattr(self._model, "sample_rate", "unknown")
        logger.info("TTS model loaded: %s (sample_rate=%s)", model_id, sr)

    def get_voices(self) -> list[dict]:
        """Return available voices from the loaded model's config."""
        if not self.is_loaded():
            return []

        spk_id = self._extract_spk_id()
        if not spk_id:
            return []
        return build_voice_list(spk_id)

    def resolve_voice(self, voice: str) -> str | None:
        """Resolve voice parameter for the loaded model."""
        if voice and voice != "auto":
            return voice

        if not self.is_loaded():
            return None

        spk_id = self._extract_spk_id()
        if spk_id:
            for preferred in ("vivian", "chelsie", "ethan"):
                if preferred in spk_id:
                    logger.info("Auto-selected voice '%s'", preferred)
                    return preferred
            first = next(iter(spk_id))
            logger.info("Auto-selected first voice '%s'", first)
            return first

        return None

    def generate_one_segment_sync(
        self,
        text: str,
        voice: str | None,
        speed: float,
        lang_code: str,
    ) -> tuple[bytes, int]:
        """Generate audio for one text segment. MUST run on MLX thread.

        Returns (pcm_int16_bytes, sample_rate).
        """
        if not self.is_loaded():
            raise RuntimeError("TTS model not loaded")

        model = self._model
        sample_rate = getattr(model, "sample_rate", 24000)
        all_audio: list[np.ndarray] = []

        try:
            results = model.generate(
                text=text,
                voice=voice,
                speed=speed,
                lang_code=lang_code,
            )
            for result in results:
                audio_np = np.array(result.audio)
                all_audio.append(audio_np)
                if hasattr(result, "sample_rate") and result.sample_rate:
                    sample_rate = result.sample_rate
        except Exception as exc:
            logger.exception("TTS generation failed for segment")
            raise RuntimeError(f"TTS generation failed: {exc}") from exc

        if not all_audio:
            raise RuntimeError("TTS produced no audio")

        combined = np.concatenate(all_audio)
        # Clean and convert to int16 PCM
        combined = np.nan_to_num(combined, nan=0.0, posinf=1.0, neginf=-1.0)
        combined = np.clip(combined, -1.0, 1.0)
        pcm_int16 = (combined * 32767).astype(np.int16)

        logger.info(
            "TTS segment: %d samples (%.1fs), sr=%d",
            pcm_int16.shape[0],
            pcm_int16.shape[0] / sample_rate,
            sample_rate,
        )

        return pcm_int16.tobytes(), sample_rate

    def synthesize_full_sync(
        self,
        text: str,
        voice: str = "",
        speed: float = 1.0,
        lang_code: str = "auto",
    ) -> bytes:
        """Generate speech for full text, return WAV bytes. MUST run on MLX thread.

        Used for non-cooperative full synthesis (e.g. single short text).
        """
        if not self.is_loaded():
            raise RuntimeError("TTS model not loaded")

        plain = strip_markdown(text)
        if not plain:
            raise ValueError("Empty text after stripping markdown")

        effective_lang = detect_lang(plain) if lang_code == "auto" else lang_code
        effective_voice = self.resolve_voice(voice)

        model = self._model
        sample_rate = getattr(model, "sample_rate", 24000)
        all_audio: list[np.ndarray] = []

        try:
            results = model.generate(
                text=plain,
                voice=effective_voice,
                speed=speed,
                lang_code=effective_lang,
            )
            for result in results:
                audio_np = np.array(result.audio)
                all_audio.append(audio_np)
                if hasattr(result, "sample_rate") and result.sample_rate:
                    sample_rate = result.sample_rate
        except Exception as exc:
            logger.exception("TTS generation failed")
            raise RuntimeError(f"TTS generation failed: {exc}") from exc

        if not all_audio:
            raise RuntimeError("TTS produced no audio")

        combined = np.concatenate(all_audio)
        return audio_to_wav_bytes(combined, sample_rate)

    def _extract_spk_id(self) -> dict:
        """Extract spk_id from loaded model config."""
        cfg = getattr(self._model, "config", None)
        if cfg is None:
            return {}
        talker_cfg = getattr(cfg, "talker_config", None)
        if talker_cfg is not None:
            spk_id = getattr(talker_cfg, "spk_id", None) or {}
            if spk_id:
                return spk_id
        return getattr(cfg, "spk_id", None) or {}
