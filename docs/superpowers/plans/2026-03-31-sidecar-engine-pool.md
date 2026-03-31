# Sidecar EnginePool Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor sidecar so ASR and TTS can run concurrently via EnginePool pattern with cooperative scheduling on a single MLX thread.

**Architecture:** Extract global MLX executor into `mlx_executor.py`. Merge `model_runner.py` + `tts_runner.py` into `engine.py` with BaseEngine/ASREngine/TTSEngine. Add `engine_pool.py` for lifecycle management. Rewrite `server.py` routes to use EnginePool. TTS streaming becomes cooperative (per-sentence executor submission).

**Tech Stack:** Python 3.13, FastAPI, mlx-audio, mlx.core, numpy, asyncio

---

## File Map

| # | File | Action | Responsibility |
|---|------|--------|----------------|
| 1 | `sidecar/capty_sidecar/mlx_executor.py` | CREATE | Global single-thread MLX executor + `run_on_mlx()` helper |
| 2 | `sidecar/capty_sidecar/engine.py` | CREATE | BaseEngine / ASREngine / TTSEngine + `split_sentences()` |
| 3 | `sidecar/capty_sidecar/engine_pool.py` | CREATE | EnginePool lifecycle management |
| 4 | `sidecar/capty_sidecar/server.py` | REWRITE | Routes use EnginePool instead of runner/tts_runner |
| 5 | `sidecar/capty_sidecar/model_runner.py` | DELETE | Merged into engine.py |
| 6 | `sidecar/capty_sidecar/tts_runner.py` | DELETE | Merged into engine.py |
| 7 | `sidecar/tests/test_split_sentences.py` | CREATE | Unit tests for split_sentences |
| 8 | `sidecar/tests/test_engine_pool.py` | CREATE | Unit tests for EnginePool |

---

### Task 1: Create `mlx_executor.py`

**Files:**
- Create: `sidecar/capty_sidecar/mlx_executor.py`

- [ ] **Step 1: Create the module**

```python
"""Global single-thread MLX executor.

MLX is NOT thread-safe (GitHub Issues #2133, #3078).  ALL MLX GPU
operations — model loading, inference, cache management — MUST run on
this single dedicated thread.
"""

from __future__ import annotations

import asyncio
import gc
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, TypeVar

import mlx.core as mx

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Single-thread executor dedicated to MLX operations.
_mlx_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mlx")

# Limit the MLX metal buffer cache to 2 GB.
_MLX_CACHE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB
mx.set_cache_limit(_MLX_CACHE_LIMIT_BYTES)


def mlx_cleanup() -> None:
    """Release MLX cache and collect garbage.  Call from the MLX thread."""
    mx.clear_cache()
    gc.collect()


async def run_on_mlx(fn: Callable[[], T]) -> T:
    """Run *fn* on the MLX thread, cleanup after.

    This is the ONLY way to execute MLX operations safely.
    """
    loop = asyncio.get_running_loop()

    def _wrapped() -> T:
        try:
            return fn()
        finally:
            mlx_cleanup()

    return await loop.run_in_executor(_mlx_executor, _wrapped)
```

- [ ] **Step 2: Verify import works**

Run: `cd /Users/zhangjie/Documents/Jeason的创作/code/capty/sidecar && .venv/bin/python -c "from capty_sidecar.mlx_executor import run_on_mlx; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add sidecar/capty_sidecar/mlx_executor.py
git commit -m "feat(sidecar): add mlx_executor module with run_on_mlx helper"
```

---

### Task 2: Create `engine.py` — BaseEngine + ASREngine + TTSEngine

**Files:**
- Create: `sidecar/capty_sidecar/engine.py`
- Reference: `sidecar/capty_sidecar/model_runner.py` (migrate ASR logic)
- Reference: `sidecar/capty_sidecar/tts_runner.py` (migrate TTS logic)

- [ ] **Step 1: Create the full engine.py**

```python
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
```

- [ ] **Step 2: Verify import works**

Run: `cd /Users/zhangjie/Documents/Jeason的创作/code/capty/sidecar && .venv/bin/python -c "from capty_sidecar.engine import ASREngine, TTSEngine, split_sentences; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add sidecar/capty_sidecar/engine.py
git commit -m "feat(sidecar): add engine.py with BaseEngine/ASREngine/TTSEngine"
```

---

### Task 3: Create `engine_pool.py`

**Files:**
- Create: `sidecar/capty_sidecar/engine_pool.py`

- [ ] **Step 1: Create the module**

```python
"""EnginePool: manages ASR and TTS engine instances.

Both engines can coexist in memory simultaneously.  Load/unload operations
are serialized via an asyncio.Lock to prevent concurrent model loading
that could exhaust memory.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from capty_sidecar.engine import ASREngine, BaseEngine, TTSEngine
from capty_sidecar.mlx_executor import run_on_mlx

logger = logging.getLogger(__name__)


class EnginePool:
    """Manages fixed ASR + TTS engine slots."""

    def __init__(self) -> None:
        self._engines: dict[str, BaseEngine] = {
            "asr": ASREngine(),
            "tts": TTSEngine(),
        }
        self._lock = asyncio.Lock()

    def get_engine(self, engine_type: str) -> BaseEngine:
        """Get engine by type. Raises KeyError if unknown type."""
        if engine_type not in self._engines:
            raise KeyError(f"Unknown engine type: {engine_type}")
        return self._engines[engine_type]

    @property
    def asr(self) -> ASREngine:
        return self._engines["asr"]  # type: ignore[return-value]

    @property
    def tts(self) -> TTSEngine:
        return self._engines["tts"]  # type: ignore[return-value]

    async def load_engine(
        self,
        engine_type: str,
        model_id: str,
        model_path: Path,
    ) -> None:
        """Load a model into the specified engine slot.

        Serialized via lock to prevent concurrent loads.
        The engine's load_sync handles unloading any previous model.
        """
        engine = self.get_engine(engine_type)
        async with self._lock:
            await run_on_mlx(lambda: engine.load_sync(model_id, model_path))
        logger.info("Engine '%s' loaded model '%s'", engine_type, model_id)

    async def unload_engine(self, engine_type: str) -> None:
        """Unload the model from the specified engine slot."""
        engine = self.get_engine(engine_type)
        async with self._lock:
            await run_on_mlx(engine.unload_sync)
        logger.info("Engine '%s' unloaded", engine_type)

    def status(self) -> dict:
        """Return status of all engines."""
        return {
            etype: {
                "loaded": engine.is_loaded(),
                "model": engine.model_id,
            }
            for etype, engine in self._engines.items()
        }
```

- [ ] **Step 2: Verify import works**

Run: `cd /Users/zhangjie/Documents/Jeason的创作/code/capty/sidecar && .venv/bin/python -c "from capty_sidecar.engine_pool import EnginePool; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add sidecar/capty_sidecar/engine_pool.py
git commit -m "feat(sidecar): add EnginePool for ASR+TTS lifecycle management"
```

---

### Task 4: Rewrite `server.py` to use EnginePool

**Files:**
- Modify: `sidecar/capty_sidecar/server.py`

- [ ] **Step 1: Rewrite server.py**

Replace the entire contents of `server.py` with:

```python
"""FastAPI server: HTTP endpoints and OpenAI-compatible REST API.

Uses EnginePool for ASR/TTS engine lifecycle and run_on_mlx() for all
MLX inference operations.  TTS streaming uses cooperative scheduling
(per-sentence executor submission) so ASR requests can interleave.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import threading
import wave
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from capty_sidecar.engine import (
    DEFAULT_TTS_MODEL,
    audio_to_wav_bytes,
    build_voice_list,
    detect_lang,
    split_sentences,
    strip_markdown,
)
from capty_sidecar.engine_pool import EnginePool
from capty_sidecar.mlx_executor import run_on_mlx
from capty_sidecar.model_registry import ModelRegistry

logger = logging.getLogger(__name__)

# Audio constants
SAMPLE_RATE = 16000
BYTES_PER_SECOND = SAMPLE_RATE * 2
MAX_CHUNK_SECONDS = 30
MAX_CHUNK_BYTES = MAX_CHUNK_SECONDS * BYTES_PER_SECOND


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class SwitchModelRequest(BaseModel):
    model: str


class TranscribeFileRequest(BaseModel):
    file_path: str
    model: str = ""


class DecodeAudioRequest(BaseModel):
    file_path: str


class SpeechRequest(BaseModel):
    input: str
    model: str = ""
    voice: str = ""
    speed: float = 1.0
    lang_code: str = "auto"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_pcm(raw_bytes: bytes) -> bytes:
    """Extract raw 16-bit PCM data from a WAV file, or return as-is."""
    if raw_bytes[:4] == b"RIFF" and raw_bytes[8:12] == b"WAVE":
        try:
            with wave.open(io.BytesIO(raw_bytes), "rb") as wf:
                return wf.readframes(wf.getnframes())
        except Exception:
            return raw_bytes[44:] if len(raw_bytes) > 44 else raw_bytes
    return raw_bytes


def _validate_file_path(file_path: str, data_dir: str) -> Path:
    """Validate that file_path is under the allowed data_dir."""
    resolved = Path(file_path).resolve()
    allowed = Path(data_dir).resolve()
    if not str(resolved).startswith(str(allowed)):
        raise HTTPException(
            status_code=403,
            detail="Access denied: path outside allowed directory",
        )
    return resolved


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------

def create_app(models_dir: str, data_dir: str = "") -> FastAPI:
    """Create and return the FastAPI application."""
    app = FastAPI(title="Capty ASR Sidecar")
    registry = ModelRegistry(models_dir=Path(models_dir))
    pool = EnginePool()

    effective_data_dir = data_dir if data_dir else str(Path(models_dir).resolve().parent)

    # ------------------------------------------------------------------
    # ASR helpers
    # ------------------------------------------------------------------

    async def _ensure_asr_loaded(target_model: str) -> None:
        """Ensure the requested ASR model is loaded."""
        engine = pool.asr
        if engine.model_id == target_model:
            return
        info = registry.get_model_info(target_model)
        if info is None:
            raise HTTPException(status_code=404, detail=f"Model '{target_model}' not found")
        model_path = Path(models_dir) / target_model
        await pool.load_engine("asr", target_model, model_path)

    async def _ensure_tts_loaded(model: str = "") -> None:
        """Ensure the TTS model is loaded."""
        engine = pool.tts
        target_model = model.strip() if model else None
        if target_model:
            if not engine.is_loaded() or engine.model_id != target_model:
                await pool.load_engine("tts", target_model, Path(target_model))
        elif not engine.is_loaded():
            await pool.load_engine("tts", DEFAULT_TTS_MODEL, Path(DEFAULT_TTS_MODEL))

    # ------------------------------------------------------------------
    # Health & models
    # ------------------------------------------------------------------

    @app.get("/health")
    async def health():
        return {
            "status": "ok",
            "model_loaded": pool.asr.is_loaded(),
            "current_model": pool.asr.model_id,
            "tts_loaded": pool.tts.is_loaded(),
            "engines": pool.status(),
        }

    @app.get("/models")
    async def list_models():
        return registry.list_models()

    @app.post("/models/switch")
    async def switch_model(body: SwitchModelRequest):
        target = body.model
        model_info = registry.get_model_info(target)
        if model_info is None:
            raise HTTPException(status_code=404, detail="Unknown model ID")
        if not registry.is_downloaded(target):
            raise HTTPException(status_code=400, detail=f"Model '{target}' is not downloaded")
        try:
            await _ensure_asr_loaded(target)
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Failed to load model %s", target)
            raise HTTPException(status_code=500, detail=f"Failed to load model: {exc}") from exc
        return {"status": "ok", "model": target}

    # ------------------------------------------------------------------
    # ASR transcription
    # ------------------------------------------------------------------

    @app.post("/v1/audio/transcriptions")
    async def transcriptions(
        file: UploadFile = File(...),
        model: str = Form(""),
        language: Optional[str] = Form(None),
    ):
        target_model = model.strip() if model else None
        if target_model:
            if not registry.is_downloaded(target_model):
                raise HTTPException(
                    status_code=400,
                    detail=f"Model '{target_model}' not found in models directory ({models_dir}).",
                )
            try:
                await _ensure_asr_loaded(target_model)
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(status_code=500, detail=f"Failed to load model: {exc}") from exc

        engine = pool.asr
        if not engine.is_loaded():
            raise HTTPException(status_code=400, detail="No ASR model loaded.")

        raw_bytes = await file.read()
        pcm_data = _extract_pcm(raw_bytes)
        if len(pcm_data) == 0:
            return {"text": ""}

        all_texts: list[str] = []
        offset = 0
        while offset < len(pcm_data):
            chunk = pcm_data[offset: offset + MAX_CHUNK_BYTES]
            offset += MAX_CHUNK_BYTES
            text = await run_on_mlx(lambda c=chunk: engine.transcribe_sync(c))
            if text and text.strip():
                all_texts.append(text.strip())

        return {"text": " ".join(all_texts)}

    # ------------------------------------------------------------------
    # File-based transcription
    # ------------------------------------------------------------------

    @app.post("/v1/audio/transcribe-file")
    async def transcribe_file(body: TranscribeFileRequest):
        file_path = body.file_path.strip()
        if not file_path or not Path(file_path).is_file():
            raise HTTPException(status_code=400, detail="File not found")
        _validate_file_path(file_path, effective_data_dir)

        target_model = body.model.strip() if body.model else None
        if target_model:
            if not registry.is_downloaded(target_model):
                raise HTTPException(
                    status_code=400,
                    detail=f"Model '{target_model}' not found in models directory ({models_dir}).",
                )
            try:
                await _ensure_asr_loaded(target_model)
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(status_code=500, detail=f"Failed to load model: {exc}") from exc

        engine = pool.asr
        if not engine.is_loaded():
            raise HTTPException(status_code=400, detail="No ASR model loaded.")

        try:
            from mlx_audio.stt.utils import load_audio
            fp = file_path
            audio_np = await run_on_mlx(
                lambda p=fp: np.array(load_audio(p, sr=SAMPLE_RATE), dtype=np.float32)
            )
        except Exception as exc:
            logger.exception("Failed to load audio file: %s", file_path)
            raise HTTPException(status_code=500, detail=f"Failed to load audio: {exc}") from exc

        if audio_np.size == 0:
            return {"segments": [], "text": "", "duration": 0}

        segment_seconds = 15
        max_chunk_samples = segment_seconds * SAMPLE_RATE
        total_duration = round(audio_np.size / SAMPLE_RATE)
        segments: list[dict] = []
        offset = 0
        while offset < audio_np.size:
            chunk = audio_np[offset: offset + max_chunk_samples]
            start_time = round(offset / SAMPLE_RATE)
            end_time = round(min(offset + max_chunk_samples, audio_np.size) / SAMPLE_RATE)
            offset += max_chunk_samples
            text = await run_on_mlx(lambda c=chunk: engine.transcribe_array_sync(c))
            if text and text.strip():
                segments.append({"start": start_time, "end": end_time, "text": text.strip()})

        return {
            "segments": segments,
            "text": " ".join(s["text"] for s in segments),
            "duration": total_duration,
        }

    # ------------------------------------------------------------------
    # Audio decode
    # ------------------------------------------------------------------

    @app.post("/v1/audio/decode")
    async def decode_audio(body: DecodeAudioRequest):
        file_path = body.file_path.strip()
        if not file_path or not Path(file_path).is_file():
            raise HTTPException(status_code=400, detail="File not found")
        _validate_file_path(file_path, effective_data_dir)

        try:
            from mlx_audio.stt.utils import load_audio
            fp = file_path
            audio_np = await run_on_mlx(
                lambda p=fp: np.array(load_audio(p, sr=SAMPLE_RATE), dtype=np.float32)
            )
        except Exception as exc:
            logger.exception("Failed to decode audio file: %s", file_path)
            raise HTTPException(status_code=500, detail=f"Failed to decode audio: {exc}") from exc

        pcm_int16 = (audio_np * 32767).clip(-32768, 32767).astype(np.int16)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(pcm_int16.tobytes())
        return Response(content=buf.getvalue(), media_type="audio/wav")

    # ------------------------------------------------------------------
    # TTS voice listing
    # ------------------------------------------------------------------

    @app.get("/v1/audio/voices")
    async def list_voices_standard():
        voices_data: list[dict] = []
        tts_engine = pool.tts
        if tts_engine.is_loaded():
            voices_data = tts_engine.get_voices()
        else:
            tts_dir = Path(models_dir).parent / "tts"
            if tts_dir.is_dir():
                for model_path in sorted(tts_dir.iterdir()):
                    cfg_path = model_path / "config.json"
                    if not cfg_path.is_file():
                        continue
                    try:
                        import json as _json
                        cfg = _json.loads(cfg_path.read_text())
                        spk_id = {}
                        tc = cfg.get("talker_config", {})
                        if isinstance(tc, dict):
                            spk_id = tc.get("spk_id", {}) or {}
                        if not spk_id:
                            spk_id = cfg.get("spk_id", {}) or {}
                        if spk_id:
                            voices_data = build_voice_list(spk_id)
                            break
                    except Exception:
                        continue

        items = [
            {"id": v["id"], "name": v.get("name", v["id"])}
            for v in voices_data
            if isinstance(v, dict) and "id" in v
        ]
        return {
            "items": items,
            "total": len(items),
            "page": 1,
            "page_size": len(items),
            "total_pages": 1,
        }

    # ------------------------------------------------------------------
    # TTS model management
    # ------------------------------------------------------------------

    @app.post("/tts/switch")
    async def switch_tts_model(body: SwitchModelRequest):
        try:
            await pool.load_engine("tts", body.model, Path(body.model))
        except Exception as exc:
            logger.exception("Failed to load TTS model %s", body.model)
            raise HTTPException(status_code=500, detail=f"Failed to load TTS model: {exc}") from exc
        return {"status": "ok", "model": body.model}

    @app.get("/tts/status")
    async def tts_status():
        tts_engine = pool.tts
        return {"loaded": tts_engine.is_loaded(), "model": tts_engine.model_id}

    # ------------------------------------------------------------------
    # TTS synthesis (non-streaming, cooperative)
    # ------------------------------------------------------------------

    @app.post("/v1/audio/speech")
    async def text_to_speech(req: SpeechRequest):
        if not req.input.strip():
            raise HTTPException(status_code=400, detail="Empty input text")

        await _ensure_tts_loaded(req.model)
        tts_engine = pool.tts

        plain = strip_markdown(req.input)
        if not plain:
            raise HTTPException(status_code=400, detail="Empty text after stripping markdown")

        effective_lang = detect_lang(plain) if req.lang_code == "auto" else req.lang_code
        effective_voice = tts_engine.resolve_voice(req.voice)

        sentences = split_sentences(plain)
        if not sentences:
            raise HTTPException(status_code=400, detail="No sentences to synthesize")

        all_pcm: list[bytes] = []
        sample_rate = 24000

        try:
            for sentence in sentences:
                pcm_bytes, sr = await run_on_mlx(
                    lambda s=sentence, v=effective_voice, sp=req.speed, l=effective_lang: (
                        tts_engine.generate_one_segment_sync(s, v, sp, l)
                    )
                )
                all_pcm.append(pcm_bytes)
                sample_rate = sr
        except Exception as exc:
            logger.exception("TTS synthesis failed")
            raise HTTPException(status_code=500, detail=f"TTS synthesis failed: {exc}") from exc

        # Concatenate all PCM and wrap in WAV
        combined_pcm = b"".join(all_pcm)
        combined_np = np.frombuffer(combined_pcm, dtype=np.int16).astype(np.float32) / 32767.0
        wav_bytes = audio_to_wav_bytes(combined_np, sample_rate)

        return Response(content=wav_bytes, media_type="audio/wav")

    # ------------------------------------------------------------------
    # TTS streaming (cooperative — per-sentence executor submission)
    # ------------------------------------------------------------------

    @app.post("/v1/audio/speech/stream")
    async def text_to_speech_stream(req: SpeechRequest):
        if not req.input.strip():
            raise HTTPException(status_code=400, detail="Empty input text")

        await _ensure_tts_loaded(req.model)
        tts_engine = pool.tts

        plain = strip_markdown(req.input)
        if not plain:
            raise HTTPException(status_code=400, detail="Empty text after stripping markdown")

        effective_lang = detect_lang(plain) if req.lang_code == "auto" else req.lang_code
        effective_voice = tts_engine.resolve_voice(req.voice)

        sentences = split_sentences(plain)
        if not sentences:
            raise HTTPException(status_code=400, detail="No sentences to synthesize")

        cancel_event = threading.Event()

        async def generate():
            header_sent = False
            try:
                for i, sentence in enumerate(sentences):
                    if cancel_event.is_set():
                        logger.info("TTS stream cancelled at sentence %d", i)
                        break

                    # Each sentence is a separate executor submission.
                    # Between sentences, waiting ASR requests can execute.
                    pcm_bytes, sample_rate = await run_on_mlx(
                        lambda s=sentence, v=effective_voice, sp=req.speed, l=effective_lang: (
                            tts_engine.generate_one_segment_sync(s, v, sp, l)
                        )
                    )

                    if not header_sent:
                        yield json.dumps({"type": "header", "sample_rate": sample_rate}) + "\n"
                        header_sent = True

                    is_final = (i == len(sentences) - 1)
                    b64_data = base64.b64encode(pcm_bytes).decode("ascii")
                    yield json.dumps({
                        "type": "audio",
                        "data": b64_data,
                        "sample_rate": sample_rate,
                        "is_final": is_final,
                    }) + "\n"

                # Send final marker
                if header_sent:
                    yield json.dumps({
                        "type": "audio",
                        "data": "",
                        "sample_rate": 0,
                        "is_final": True,
                    }) + "\n"

            except asyncio.CancelledError:
                logger.info("TTS stream cancelled by client disconnect")
                cancel_event.set()
            except Exception as exc:
                logger.exception("TTS streaming error")
                yield json.dumps({"type": "error", "message": str(exc)}) + "\n"

        return StreamingResponse(generate(), media_type="application/x-ndjson")

    return app
```

- [ ] **Step 2: Verify server can be created**

Run: `cd /Users/zhangjie/Documents/Jeason的创作/code/capty/sidecar && .venv/bin/python -c "from capty_sidecar.server import create_app; app = create_app('/tmp/models'); print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add sidecar/capty_sidecar/server.py
git commit -m "refactor(sidecar): rewrite server.py to use EnginePool with cooperative TTS"
```

---

### Task 5: Delete old `model_runner.py` and `tts_runner.py`

**Files:**
- Delete: `sidecar/capty_sidecar/model_runner.py`
- Delete: `sidecar/capty_sidecar/tts_runner.py`

- [ ] **Step 1: Delete both files**

```bash
rm sidecar/capty_sidecar/model_runner.py sidecar/capty_sidecar/tts_runner.py
```

- [ ] **Step 2: Verify no broken imports**

Run: `cd /Users/zhangjie/Documents/Jeason的创作/code/capty/sidecar && .venv/bin/python -c "from capty_sidecar.server import create_app; app = create_app('/tmp/models'); print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add -u sidecar/capty_sidecar/model_runner.py sidecar/capty_sidecar/tts_runner.py
git commit -m "refactor(sidecar): remove model_runner.py and tts_runner.py (merged into engine.py)"
```

---

### Task 6: Add unit tests for `split_sentences`

**Files:**
- Create: `sidecar/tests/test_split_sentences.py`

- [ ] **Step 1: Create test file**

```python
"""Tests for engine.split_sentences()."""

from capty_sidecar.engine import split_sentences


def test_chinese_sentences():
    text = "你好世界。这是一个测试。谢谢！"
    result = split_sentences(text)
    assert len(result) == 3
    assert result[0] == "你好世界。"
    assert result[1] == "这是一个测试。"
    assert result[2] == "谢谢！"


def test_english_sentences():
    text = "Hello world. This is a test. Thank you!"
    result = split_sentences(text)
    assert len(result) == 3
    assert result[0] == "Hello world."
    assert result[1] == "This is a test."
    assert result[2] == "Thank you!"


def test_mixed_language():
    text = "你好。Hello world. 再见！"
    result = split_sentences(text)
    assert len(result) == 3


def test_merge_short_segments():
    text = "Hi. OK. This is a longer sentence that should not be merged."
    result = split_sentences(text)
    # "Hi." (3 chars) should be merged with "OK."
    assert result[0] == "Hi. OK."
    assert result[1] == "This is a longer sentence that should not be merged."


def test_cap_long_segment():
    text = "A " * 150  # 300 chars, exceeds 200 cap
    result = split_sentences(text)
    assert all(len(seg) <= 200 for seg in result)
    assert len(result) >= 2


def test_empty_input():
    assert split_sentences("") == []
    assert split_sentences("   ") == []


def test_single_sentence_no_split():
    text = "Just one sentence"
    result = split_sentences(text)
    assert result == ["Just one sentence"]


def test_semicolons():
    text = "Part one; part two; part three."
    result = split_sentences(text)
    assert len(result) >= 2
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/zhangjie/Documents/Jeason的创作/code/capty/sidecar && .venv/bin/python -m pytest tests/test_split_sentences.py -v`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add sidecar/tests/test_split_sentences.py
git commit -m "test(sidecar): add unit tests for split_sentences"
```

---

### Task 7: Add unit tests for EnginePool

**Files:**
- Create: `sidecar/tests/test_engine_pool.py`

- [ ] **Step 1: Create test file**

```python
"""Tests for EnginePool (without real MLX models)."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from capty_sidecar.engine import ASREngine, TTSEngine
from capty_sidecar.engine_pool import EnginePool


def test_pool_has_two_engines():
    pool = EnginePool()
    assert isinstance(pool.asr, ASREngine)
    assert isinstance(pool.tts, TTSEngine)


def test_pool_status_empty():
    pool = EnginePool()
    status = pool.status()
    assert status["asr"]["loaded"] is False
    assert status["asr"]["model"] is None
    assert status["tts"]["loaded"] is False
    assert status["tts"]["model"] is None


def test_get_engine_unknown_type():
    pool = EnginePool()
    with pytest.raises(KeyError, match="Unknown engine type"):
        pool.get_engine("llm")


@pytest.mark.asyncio
async def test_load_engine_calls_run_on_mlx():
    pool = EnginePool()
    with patch("capty_sidecar.engine_pool.run_on_mlx", new_callable=AsyncMock) as mock_run:
        mock_run.return_value = None
        await pool.load_engine("asr", "test-model", "/tmp/test")
        mock_run.assert_called_once()


@pytest.mark.asyncio
async def test_unload_engine_calls_run_on_mlx():
    pool = EnginePool()
    with patch("capty_sidecar.engine_pool.run_on_mlx", new_callable=AsyncMock) as mock_run:
        mock_run.return_value = None
        await pool.unload_engine("tts")
        mock_run.assert_called_once()
```

- [ ] **Step 2: Install pytest-asyncio if needed**

Run: `cd /Users/zhangjie/Documents/Jeason的创作/code/capty/sidecar && .venv/bin/pip install pytest-asyncio 2>/dev/null; echo "OK"`

- [ ] **Step 3: Run tests**

Run: `cd /Users/zhangjie/Documents/Jeason的创作/code/capty/sidecar && .venv/bin/python -m pytest tests/test_engine_pool.py -v`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add sidecar/tests/test_engine_pool.py
git commit -m "test(sidecar): add unit tests for EnginePool"
```

---

### Task 8: Update README and final commit

**Files:**
- Modify: `README.md` (changelog entry already added in spec commit, verify it's current)

- [ ] **Step 1: Verify sidecar starts without errors**

Run: `cd /Users/zhangjie/Documents/Jeason的创作/code/capty/sidecar && timeout 5 .venv/bin/python -m capty_sidecar.main --port 18765 2>&1 || true`
Expected: Server starts (may timeout after 5s, that's OK). No ImportError or crash.

- [ ] **Step 2: Run all tests**

Run: `cd /Users/zhangjie/Documents/Jeason的创作/code/capty/sidecar && .venv/bin/python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A sidecar/
git commit -m "refactor(sidecar): complete EnginePool migration"
```
