"""FastAPI server: HTTP endpoints and OpenAI-compatible REST API for ASR."""

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

from capty_sidecar.model_registry import ModelRegistry
from capty_sidecar.model_runner import ModelRunner, _mlx_executor as _mlx_executor
from capty_sidecar.tts_runner import TTSRunner, _build_voice_list

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
    """Extract raw 16-bit PCM data from a WAV file, or return as-is if not WAV."""
    if raw_bytes[:4] == b"RIFF" and raw_bytes[8:12] == b"WAVE":
        try:
            with wave.open(io.BytesIO(raw_bytes), "rb") as wf:
                return wf.readframes(wf.getnframes())
        except Exception:
            # Malformed WAV — skip 44-byte header as fallback
            return raw_bytes[44:] if len(raw_bytes) > 44 else raw_bytes
    return raw_bytes


async def _ensure_model_loaded(
    runner: ModelRunner,
    registry: ModelRegistry,
    target_model: str,
    models_dir: str,
) -> None:
    """Ensure the requested ASR model is loaded, switching if needed.

    Uses ``runner.load()`` which internally unloads any previously loaded
    model, avoiding the race condition of a separate unload-then-load sequence.

    Raises ``HTTPException`` if the model is not found or fails to load.
    """
    if runner.current_model_id == target_model:
        return
    info = registry.get_model_info(target_model)
    if info is None:
        raise HTTPException(
            status_code=404, detail=f"Model '{target_model}' not found"
        )
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(
        _mlx_executor,
        lambda m=target_model, d=models_dir: runner.load(m, models_dir=Path(d)),
    )


def _validate_file_path(file_path: str, data_dir: str) -> Path:
    """Validate that *file_path* is under the allowed *data_dir*.

    Returns the resolved ``Path`` on success; raises ``HTTPException``
    with status 403 if the path is outside the allowed directory.
    """
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
    """Create and return the FastAPI application.

    Parameters
    ----------
    models_dir:
        Filesystem path where downloaded model directories live.
    data_dir:
        Root data directory.  File-path based endpoints (transcribe-file,
        decode) only allow paths under this directory.  When empty, falls
        back to the parent of *models_dir* (``models_dir/..``).
    """
    app = FastAPI(title="Capty ASR Sidecar")
    registry = ModelRegistry(models_dir=Path(models_dir))
    runner = ModelRunner()
    tts_runner = TTSRunner()

    # Resolve the allowed data directory for path validation.
    effective_data_dir = data_dir if data_dir else str(Path(models_dir).resolve().parent)

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
        target = body.model
        model_info = registry.get_model_info(target)
        if model_info is None:
            raise HTTPException(status_code=404, detail="Unknown model ID")
        if not registry.is_downloaded(target):
            raise HTTPException(
                status_code=400,
                detail=f"Model '{target}' is not downloaded",
            )
        try:
            await _ensure_model_loaded(runner, registry, target, models_dir)
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Failed to load model %s", target)
            raise HTTPException(
                status_code=500,
                detail=f"Failed to load model: {exc}",
            ) from exc
        return {
            "status": "ok",
            "model": target,
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
        ``{"text": "..."}`` -- same schema as OpenAI's API.
        """
        # Load / switch model if requested and different from current
        target_model = model.strip() if model else None
        if target_model:
            if not registry.is_downloaded(target_model):
                raise HTTPException(
                    status_code=400,
                    detail=f"Model '{target_model}' not found in models directory ({models_dir}). "
                    f"Make sure the model is downloaded and the sidecar --models-dir points to the correct ASR models path.",
                )
            try:
                await _ensure_model_loaded(runner, registry, target_model, models_dir)
            except HTTPException:
                raise
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
    # File-based transcription (uses mlx-audio load_audio)
    # ------------------------------------------------------------------

    @app.post("/v1/audio/transcribe-file")
    async def transcribe_file(body: TranscribeFileRequest):
        """Transcribe audio directly from a file path.

        Uses mlx-audio's ``load_audio`` to read WAV/FLAC/MP3/OGG etc.
        without requiring ffmpeg.
        """
        file_path = body.file_path.strip()
        if not file_path or not Path(file_path).is_file():
            raise HTTPException(status_code=400, detail="File not found")

        # Path validation: only allow files under the data directory
        _validate_file_path(file_path, effective_data_dir)

        # Load / switch model if requested
        target_model = body.model.strip() if body.model else None
        if target_model:
            if not registry.is_downloaded(target_model):
                raise HTTPException(
                    status_code=400,
                    detail=f"Model '{target_model}' not found in models directory ({models_dir}). "
                    f"Make sure the model is downloaded and the sidecar --models-dir points to the correct ASR models path.",
                )
            try:
                await _ensure_model_loaded(runner, registry, target_model, models_dir)
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to load model: {exc}",
                ) from exc

        if not runner.is_loaded():
            raise HTTPException(
                status_code=400,
                detail="No model loaded. Send a model ID or pre-load via /models/switch.",
            )

        # Load audio using mlx-audio (supports WAV/FLAC/MP3/OGG etc.)
        try:
            from mlx_audio.stt.utils import load_audio

            loop = asyncio.get_running_loop()
            fp = file_path  # capture for lambda
            audio = await loop.run_in_executor(
                _mlx_executor,
                lambda p=fp: load_audio(p, sr=SAMPLE_RATE),
            )
            audio_np = np.array(audio, dtype=np.float32)
        except Exception as exc:
            logger.exception("Failed to load audio file: %s", file_path)
            raise HTTPException(
                status_code=500,
                detail=f"Failed to load audio: {exc}",
            ) from exc

        if audio_np.size == 0:
            return {"segments": [], "text": "", "duration": 0}

        # Transcribe -- split into 15-second segments with timestamps
        segment_seconds = 15
        max_chunk_samples = segment_seconds * SAMPLE_RATE
        total_duration = round(audio_np.size / SAMPLE_RATE)
        segments: list[dict] = []
        offset = 0
        while offset < audio_np.size:
            chunk = audio_np[offset : offset + max_chunk_samples]
            start_time = round(offset / SAMPLE_RATE)
            end_time = round(min(offset + max_chunk_samples, audio_np.size) / SAMPLE_RATE)
            offset += max_chunk_samples
            text = await runner.transcribe_array(chunk)
            if text and text.strip():
                segments.append({
                    "start": start_time,
                    "end": end_time,
                    "text": text.strip(),
                })

        return {
            "segments": segments,
            "text": " ".join(s["text"] for s in segments),
            "duration": total_duration,
        }

    # ------------------------------------------------------------------
    # Audio decode (any format -> 16kHz mono 16-bit PCM WAV)
    # ------------------------------------------------------------------

    @app.post("/v1/audio/decode")
    async def decode_audio(body: DecodeAudioRequest):
        """Decode any audio file to 16kHz mono 16-bit PCM WAV bytes.

        Returns the raw WAV file (with header) so the frontend can split
        it into chunks using the same flow as live-recording regeneration.
        """
        file_path = body.file_path.strip()
        if not file_path or not Path(file_path).is_file():
            raise HTTPException(status_code=400, detail="File not found")

        # Path validation: only allow files under the data directory
        _validate_file_path(file_path, effective_data_dir)

        try:
            from mlx_audio.stt.utils import load_audio

            loop = asyncio.get_running_loop()
            fp = file_path  # capture for lambda
            audio = await loop.run_in_executor(
                _mlx_executor,
                lambda p=fp: load_audio(p, sr=SAMPLE_RATE),
            )
            audio_np = np.array(audio, dtype=np.float32)
        except Exception as exc:
            logger.exception("Failed to decode audio file: %s", file_path)
            raise HTTPException(
                status_code=500,
                detail=f"Failed to decode audio: {exc}",
            ) from exc

        # Convert float32 -> 16-bit signed PCM
        pcm_int16 = (audio_np * 32767).clip(-32768, 32767).astype(np.int16)

        # Build WAV in memory
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(pcm_int16.tobytes())

        return Response(content=buf.getvalue(), media_type="audio/wav")

    # ------------------------------------------------------------------
    # OpenAI-compatible TTS API
    # ------------------------------------------------------------------

    @app.get("/v1/audio/voices")
    async def list_voices_standard():
        """Mistral-compatible voice listing endpoint.

        Returns paginated voice list from the loaded TTS model.
        Falls back to scanning TTS model directories on disk.
        """
        voices_data: list[dict] = []
        if tts_runner.is_loaded():
            voices_data = tts_runner.get_voices()
        else:
            # Scan TTS model dirs for config with voices
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
                            voices_data = _build_voice_list(spk_id)
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

    @app.post("/tts/switch")
    async def switch_tts_model(body: SwitchModelRequest):
        """Switch the active TTS model."""
        try:
            target = body.model
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(
                _mlx_executor,
                lambda m=target: tts_runner.load(m),
            )
        except Exception as exc:
            logger.exception("Failed to load TTS model %s", body.model)
            raise HTTPException(
                status_code=500,
                detail=f"Failed to load TTS model: {exc}",
            ) from exc
        return {"status": "ok", "model": body.model}

    @app.get("/tts/status")
    async def tts_status():
        return {
            "loaded": tts_runner.is_loaded(),
            "model": tts_runner._model_id,
        }

    async def _ensure_tts_loaded(model: str = "") -> None:
        """Ensure the TTS model is loaded, switching if needed.

        Shared by both /v1/audio/speech and /v1/audio/speech/stream.
        """
        target_model = model.strip() if model else None
        if target_model:
            if not tts_runner.is_loaded() or tts_runner._model_id != target_model:
                try:
                    loop = asyncio.get_running_loop()
                    await loop.run_in_executor(
                        _mlx_executor,
                        lambda m=target_model: tts_runner.load(m),
                    )
                except Exception as exc:
                    logger.exception("Failed to load TTS model %s", target_model)
                    raise HTTPException(
                        status_code=500,
                        detail=f"Failed to load TTS model: {exc}",
                    ) from exc
        elif not tts_runner.is_loaded():
            try:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(_mlx_executor, tts_runner.load)
            except Exception as exc:
                logger.exception("Failed to load TTS model")
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to load TTS model: {exc}",
                ) from exc

    @app.post("/v1/audio/speech")
    async def text_to_speech(req: SpeechRequest):
        """OpenAI-compatible TTS endpoint.

        Accepts JSON body and returns WAV audio bytes.
        If ``model`` is provided and differs from the current model,
        the TTS model is switched automatically.
        """
        if not req.input.strip():
            raise HTTPException(status_code=400, detail="Empty input text")

        await _ensure_tts_loaded(req.model)

        try:
            wav_bytes = await tts_runner.synthesize(
                text=req.input,
                voice=req.voice,
                speed=req.speed,
                lang_code=req.lang_code,
            )
        except Exception as exc:
            logger.exception("TTS synthesis failed")
            raise HTTPException(
                status_code=500,
                detail=f"TTS synthesis failed: {exc}",
            ) from exc

        return Response(content=wav_bytes, media_type="audio/wav")

    @app.post("/v1/audio/speech/stream")
    async def text_to_speech_stream(req: SpeechRequest):
        """Streaming TTS endpoint returning NDJSON.

        Each line is a JSON object:
          - {"type":"header","sample_rate":24000}
          - {"type":"audio","data":"<base64 PCM int16>","sample_rate":24000,"is_final":false}
          - {"type":"audio","data":"...","sample_rate":24000,"is_final":true}
          - {"type":"error","message":"..."}

        Client disconnect triggers cancel_event to stop MLX generation.
        """
        if not req.input.strip():
            raise HTTPException(status_code=400, detail="Empty input text")

        await _ensure_tts_loaded(req.model)

        cancel_event = threading.Event()

        async def generate():
            header_sent = False
            try:
                async for pcm_bytes, sample_rate, is_final in tts_runner.synthesize_stream(
                    text=req.input,
                    voice=req.voice,
                    speed=req.speed,
                    lang_code=req.lang_code,
                    cancel_event=cancel_event,
                ):
                    if not header_sent:
                        yield json.dumps({"type": "header", "sample_rate": sample_rate}) + "\n"
                        header_sent = True

                    b64_data = base64.b64encode(pcm_bytes).decode("ascii")
                    yield json.dumps({
                        "type": "audio",
                        "data": b64_data,
                        "sample_rate": sample_rate,
                        "is_final": is_final,
                    }) + "\n"

                # Send a final marker if not already sent
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

        return StreamingResponse(
            generate(),
            media_type="application/x-ndjson",
        )

    return app
