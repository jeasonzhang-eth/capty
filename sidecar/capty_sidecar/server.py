"""FastAPI server: HTTP endpoints, OpenAI-compatible REST API, and WebSocket for real-time ASR."""

from __future__ import annotations

import asyncio
import io
import json
import logging
import wave
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from capty_sidecar.model_registry import ModelRegistry
from capty_sidecar.model_runner import ModelRunner, _mlx_executor

logger = logging.getLogger(__name__)

# Audio constants
SAMPLE_RATE = 16000
BYTES_PER_SECOND = SAMPLE_RATE * 2  # 16-bit PCM = 2 bytes/sample
MAX_CHUNK_SECONDS = 30  # Max audio duration per transcription call
MAX_CHUNK_BYTES = MAX_CHUNK_SECONDS * BYTES_PER_SECOND

# Concurrency control — MLX is NOT thread-safe; concurrent GPU calls cause
# segfaults in the native C++ layer, crashing the entire process.  All MLX
# inference MUST be serialized to a single thread.
MAX_CONCURRENT = 1  # Must stay 1: MLX segfaults with concurrent GPU access


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

    # ------------------------------------------------------------------
    # HTTP routes
    # ------------------------------------------------------------------

    @app.get("/health")
    async def health():
        return {
            "status": "ok",
            "model_loaded": runner.is_loaded(),
            "current_model": runner.current_model_id,
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
                lambda: runner.load(
                    body.model,
                    models_dir=Path(models_dir),
                    model_type=model_info.get("type", "qwen-asr"),
                    mlx_repo=model_info.get("mlx_repo"),
                ),
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
                                model_type=model_info.get("type", "qwen-asr"),
                                mlx_repo=model_info.get("mlx_repo"),
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
    # WebSocket route
    # ------------------------------------------------------------------

    @app.websocket("/ws/transcribe")
    async def ws_transcribe(ws: WebSocket):
        await ws.accept()
        audio_buffer = bytearray()
        session_model: Optional[str] = None
        segment_counter: int = 0

        # Concurrency state
        semaphore = asyncio.Semaphore(MAX_CONCURRENT)
        pending_results: dict[int, str | None] = {}  # seg_id → text (None = pending)
        next_to_send: int = 1  # next segment_id to send
        result_event = asyncio.Event()
        active_tasks: set[asyncio.Task] = set()
        sender_task: Optional[asyncio.Task] = None

        async def result_sender():
            """Send results in segment order: 1, 2, 3..."""
            nonlocal next_to_send
            try:
                while True:
                    # Send all ready results in order
                    while next_to_send in pending_results and pending_results[next_to_send] is not None:
                        text = pending_results.pop(next_to_send)
                        await ws.send_json({
                            "type": "final",
                            "text": text,
                            "segment_id": next_to_send,
                        })
                        next_to_send += 1

                    result_event.clear()
                    await result_event.wait()
            except asyncio.CancelledError:
                # Drain any remaining results before exiting
                while next_to_send in pending_results and pending_results[next_to_send] is not None:
                    text = pending_results.pop(next_to_send)
                    try:
                        await ws.send_json({
                            "type": "final",
                            "text": text,
                            "segment_id": next_to_send,
                        })
                    except Exception:
                        break
                    next_to_send += 1

        async def transcribe_segment(seg_id: int, pcm_data: bytes):
            """Transcribe a single segment with concurrency limiting."""
            try:
                async with semaphore:
                    # Split long audio into manageable chunks (max 30s each)
                    chunks: list[bytes] = []
                    if len(pcm_data) > MAX_CHUNK_BYTES:
                        offset = 0
                        while offset < len(pcm_data):
                            end = min(offset + MAX_CHUNK_BYTES, len(pcm_data))
                            chunks.append(pcm_data[offset:end])
                            offset = end
                        logger.info(
                            "Split %d bytes into %d chunks for segment %d",
                            len(pcm_data),
                            len(chunks),
                            seg_id,
                        )
                    else:
                        chunks.append(pcm_data)

                    all_texts: list[str] = []
                    for chunk in chunks:
                        text = await runner.transcribe(chunk)
                        if text:
                            all_texts.append(text)

                    combined = " ".join(all_texts)
                    pending_results[seg_id] = combined
                    result_event.set()
            except Exception as exc:
                logger.exception("Transcription error for segment %d", seg_id)
                pending_results[seg_id] = ""
                result_event.set()
                try:
                    await ws.send_json({
                        "type": "error",
                        "message": f"Transcription error (segment {seg_id}): {exc}",
                    })
                except Exception:
                    pass

        try:
            while True:
                raw = await ws.receive()

                # Binary frame -> audio data
                if "bytes" in raw and raw["bytes"] is not None:
                    audio_buffer.extend(raw["bytes"])
                    continue

                # Text frame -> JSON command
                if "text" in raw and raw["text"] is not None:
                    try:
                        msg = json.loads(raw["text"])
                    except json.JSONDecodeError:
                        await ws.send_json(
                            {"type": "error", "message": "Invalid JSON"}
                        )
                        continue

                    msg_type = msg.get("type")

                    if msg_type == "start":
                        session_model = msg.get("model")
                        language = msg.get("language", "auto")
                        audio_buffer.clear()

                        # Reset concurrency state
                        segment_counter = 0
                        next_to_send = 1
                        pending_results.clear()
                        for t in active_tasks:
                            t.cancel()
                        active_tasks.clear()
                        if sender_task and not sender_task.done():
                            sender_task.cancel()

                        # Load model if needed
                        if session_model and (
                            not runner.is_loaded()
                            or runner.current_model_id != session_model
                        ):
                            if not registry.is_downloaded(session_model):
                                await ws.send_json({
                                    "type": "error",
                                    "message": f"Model '{session_model}' is not downloaded",
                                })
                                continue
                            model_info = registry.get_model_info(session_model)
                            model_type = (
                                model_info.get("type", "qwen-asr")
                                if model_info
                                else "qwen-asr"
                            )
                            mlx_repo = (
                                model_info.get("mlx_repo")
                                if model_info
                                else None
                            )
                            try:
                                runner.unload()
                                loop = asyncio.get_event_loop()
                                await loop.run_in_executor(
                                    None,
                                    lambda: runner.load(
                                        session_model,
                                        models_dir=Path(models_dir),
                                        model_type=model_type,
                                        mlx_repo=mlx_repo,
                                    ),
                                )
                            except Exception as exc:
                                await ws.send_json({
                                    "type": "error",
                                    "message": f"Failed to load model: {exc}",
                                })
                                continue

                        if not runner.is_loaded():
                            await ws.send_json({
                                "type": "error",
                                "message": "No model loaded",
                            })
                            continue

                        # Start the result sender coroutine
                        sender_task = asyncio.create_task(result_sender())

                        await ws.send_json({
                            "type": "ready",
                            "model": runner.current_model_id,
                            "language": language,
                        })

                    elif msg_type == "segment_end":
                        if not runner.is_loaded():
                            await ws.send_json({
                                "type": "error",
                                "message": "No model loaded",
                            })
                            continue

                        if not audio_buffer:
                            await ws.send_json({
                                "type": "error",
                                "message": "No audio data received",
                            })
                            continue

                        pcm_data = bytes(audio_buffer)
                        audio_buffer.clear()
                        segment_counter += 1
                        seg_id = segment_counter

                        # Mark as pending
                        pending_results[seg_id] = None

                        # Launch concurrent transcription task
                        task = asyncio.create_task(
                            transcribe_segment(seg_id, pcm_data)
                        )
                        active_tasks.add(task)
                        task.add_done_callback(active_tasks.discard)

                    elif msg_type == "stop":
                        audio_buffer.clear()
                        # Wait for all active transcriptions to finish
                        if active_tasks:
                            await asyncio.gather(*active_tasks, return_exceptions=True)
                        # Give sender a moment to drain remaining results
                        if sender_task and not sender_task.done():
                            sender_task.cancel()
                            try:
                                await sender_task
                            except asyncio.CancelledError:
                                pass
                        await ws.close()
                        break

                    else:
                        await ws.send_json({
                            "type": "error",
                            "message": f"Unknown message type: {msg_type}",
                        })

        except WebSocketDisconnect:
            logger.info("WebSocket client disconnected")
        except Exception as exc:
            logger.exception("WebSocket error")
            try:
                await ws.send_json({
                    "type": "error",
                    "message": f"Server error: {exc}",
                })
            except Exception:
                pass
        finally:
            # Cleanup
            for t in active_tasks:
                t.cancel()
            if sender_task and not sender_task.done():
                sender_task.cancel()

    return app
