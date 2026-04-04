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

    def _find_local_tts_model() -> Optional[Path]:
        """Find first downloaded TTS model in local models/tts directory."""
        tts_dir = Path(models_dir).parent / "tts"
        if not tts_dir.is_dir():
            return None
        for d in sorted(tts_dir.iterdir()):
            if d.is_dir() and (d / "config.json").is_file():
                logger.info("Found local TTS model: %s", d.name)
                return d
        return None

    async def _ensure_tts_loaded(model: str = "") -> None:
        """Ensure the TTS model is loaded.

        Resolution order when no model is specified:
        1. Check local models/tts directory for downloaded models
        2. Fall back to DEFAULT_TTS_MODEL (downloads from HuggingFace)
        """
        engine = pool.tts
        target_model = model.strip() if model else None
        if target_model:
            if not engine.is_loaded() or engine.model_id != target_model:
                await pool.load_engine("tts", target_model, Path(target_model))
        elif not engine.is_loaded():
            local = _find_local_tts_model()
            if local:
                await pool.load_engine("tts", local.name, local)
            else:
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
    # TTS streaming (cooperative -- per-sentence executor submission)
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
