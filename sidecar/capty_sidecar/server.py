"""FastAPI server: HTTP endpoints and OpenAI-compatible REST API for ASR."""

from __future__ import annotations

import asyncio
import io
import logging
import wave
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from capty_sidecar.model_registry import ModelRegistry
from capty_sidecar.model_runner import ModelRunner, _mlx_executor as _mlx_executor
from capty_sidecar.tts_runner import TTSRunner

logger = logging.getLogger(__name__)

# Audio constants
SAMPLE_RATE = 16000
BYTES_PER_SECOND = SAMPLE_RATE * 2  # 16-bit PCM = 2 bytes/sample
MAX_CHUNK_SECONDS = 30  # Max audio duration per transcription call
MAX_CHUNK_BYTES = MAX_CHUNK_SECONDS * BYTES_PER_SECOND


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class SwitchModelRequest(BaseModel):
    model: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_pcm(raw_bytes: bytes) -> bytes:
    """Extract raw 16-bit PCM data from a WAV file, or return as-is if not WAV."""
    if raw_bytes[:4] == b"RIFF" and raw_bytes[8:12] == b"WAVE":
        try:
            with wave.open(io.BytesIO(raw_bytes), "rb") as wf:
                return wf.readframes(wf.getnframes())
        except Exception:
            # Malformed WAV — skip 44-byte header as fallback
            return raw_bytes[44:] if len(raw_bytes) > 44 else raw_bytes
    return raw_bytes


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------

def create_app(models_dir: str) -> FastAPI:
    """Create and return the FastAPI application.

    Parameters
    ----------
    models_dir:
        Filesystem path where downloaded model directories live.
    """
    app = FastAPI(title="Capty ASR Sidecar")
    registry = ModelRegistry(models_dir=Path(models_dir))
    runner = ModelRunner()
    tts_runner = TTSRunner()

    # ------------------------------------------------------------------
    # HTTP routes
    # ------------------------------------------------------------------

    @app.get("/health")
    async def health():
        return {
            "status": "ok",
            "model_loaded": runner.is_loaded(),
            "current_model": runner.current_model_id,
            "tts_loaded": tts_runner.is_loaded(),
        }

    @app.get("/models")
    async def list_models():
        return registry.list_models()

    @app.post("/models/switch")
    async def switch_model(body: SwitchModelRequest):
        model_info = registry.get_model_info(body.model)
        if model_info is None:
            raise HTTPException(status_code=404, detail="Unknown model ID")
        if not registry.is_downloaded(body.model):
            raise HTTPException(
                status_code=400,
                detail=f"Model '{body.model}' is not downloaded",
            )
        # Unload current model (if any) and load the new one
        runner.unload()
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                _mlx_executor,
                lambda: runner.load(body.model, models_dir=Path(models_dir)),
            )
        except Exception as exc:
            logger.exception("Failed to load model %s", body.model)
            raise HTTPException(
                status_code=500,
                detail=f"Failed to load model: {exc}",
            ) from exc
        return {
            "status": "ok",
            "model": body.model,
        }

    # ------------------------------------------------------------------
    # OpenAI-compatible REST API
    # ------------------------------------------------------------------

    @app.post("/v1/audio/transcriptions")
    async def transcriptions(
        file: UploadFile = File(...),
        model: str = Form(""),
        language: Optional[str] = Form(None),
    ):
        """OpenAI Whisper-compatible transcription endpoint.

        Accepts multipart/form-data with a WAV audio file and returns
        ``{"text": "..."}`` — same schema as OpenAI's API.
        """
        # Load / switch model if requested and different from current
        target_model = model.strip() if model else None
        if target_model:
            model_info = registry.get_model_info(target_model)
            if model_info and registry.is_downloaded(target_model):
                if not runner.is_loaded() or runner.current_model_id != target_model:
                    runner.unload()
                    try:
                        loop = asyncio.get_event_loop()
                        await loop.run_in_executor(
                            _mlx_executor,
                            lambda: runner.load(
                                target_model,
                                models_dir=Path(models_dir),
                            ),
                        )
                    except Exception as exc:
                        raise HTTPException(
                            status_code=500,
                            detail=f"Failed to load model: {exc}",
                        ) from exc

        if not runner.is_loaded():
            raise HTTPException(
                status_code=400,
                detail="No model loaded. Send a model ID in the 'model' field or pre-load via /models/switch.",
            )

        # Read uploaded audio file
        raw_bytes = await file.read()

        # Extract PCM from WAV (skip header), or treat as raw PCM
        pcm_data = _extract_pcm(raw_bytes)

        if len(pcm_data) == 0:
            return {"text": ""}

        # Split long audio into chunks and transcribe
        all_texts: list[str] = []
        offset = 0
        while offset < len(pcm_data):
            chunk = pcm_data[offset : offset + MAX_CHUNK_BYTES]
            offset += MAX_CHUNK_BYTES
            text = await runner.transcribe(chunk)
            if text and text.strip():
                all_texts.append(text.strip())

        return {"text": " ".join(all_texts)}

    # ------------------------------------------------------------------
    # OpenAI-compatible TTS API
    # ------------------------------------------------------------------

    @app.post("/v1/audio/speech")
    async def text_to_speech(
        input: str = Form(...),
        voice: str = Form("af_heart"),
        speed: float = Form(1.0),
        lang_code: str = Form("a"),
    ):
        """OpenAI-compatible TTS endpoint.

        Accepts multipart/form-data and returns WAV audio bytes.
        The TTS model is lazily loaded on first request.
        """
        if not input.strip():
            raise HTTPException(status_code=400, detail="Empty input text")

        # Lazy-load TTS model on first request
        if not tts_runner.is_loaded():
            try:
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(_mlx_executor, tts_runner.load)
            except Exception as exc:
                logger.exception("Failed to load TTS model")
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to load TTS model: {exc}",
                ) from exc

        try:
            wav_bytes = await tts_runner.synthesize(
                text=input,
                voice=voice,
                speed=speed,
                lang_code=lang_code,
            )
        except Exception as exc:
            logger.exception("TTS synthesis failed")
            raise HTTPException(
                status_code=500,
                detail=f"TTS synthesis failed: {exc}",
            ) from exc

        return Response(content=wav_bytes, media_type="audio/wav")

    return app
