"""FastAPI server: HTTP endpoints and WebSocket for real-time ASR."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from capty_sidecar.model_registry import ModelRegistry
from capty_sidecar.model_runner import ModelRunner

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class SwitchModelRequest(BaseModel):
    model: str


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
            runner.load(body.model, models_dir=Path(models_dir))
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
    # WebSocket route
    # ------------------------------------------------------------------

    @app.websocket("/ws/transcribe")
    async def ws_transcribe(ws: WebSocket):
        await ws.accept()
        audio_buffer = bytearray()
        session_model: Optional[str] = None
        segment_counter: int = 0

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
                            try:
                                runner.unload()
                                runner.load(
                                    session_model,
                                    models_dir=Path(models_dir),
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

                        try:
                            async for result in runner.transcribe_stream(pcm_data):
                                if result.get("type") == "final":
                                    result = {**result, "segment_id": segment_counter}
                                await ws.send_json(result)
                        except Exception as exc:
                            logger.exception("Transcription error")
                            await ws.send_json({
                                "type": "error",
                                "message": f"Transcription error: {exc}",
                            })

                    elif msg_type == "stop":
                        audio_buffer.clear()
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

    return app
