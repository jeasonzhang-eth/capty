"""FastAPI server: HTTP endpoints and OpenAI-compatible REST API.

Uses EnginePool for ASR/TTS engine lifecycle and run_on_mlx() for all
MLX inference operations. TTS streaming uses cooperative scheduling
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
from typing import Literal, Optional

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from capty_sidecar import __version__
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


class ErrorResponse(BaseModel):
    detail: str = Field(description="Human-readable error message.")


class EngineStatus(BaseModel):
    loaded: bool = Field(description="Whether the engine currently has a model loaded.")
    model: str = Field(default="", description="Loaded model identifier, or empty string.")


class HealthResponse(BaseModel):
    status: Literal["ok"] = Field(default="ok", description="Health status.")
    model_loaded: bool = Field(description="Whether an ASR model is loaded.")
    current_model: str = Field(
        default="",
        description="Current ASR model identifier, or empty string if no model is loaded.",
    )
    tts_loaded: bool = Field(description="Whether a TTS model is loaded.")
    engines: dict[str, EngineStatus] = Field(
        default_factory=dict,
        description="Per-engine load status for ASR and TTS.",
    )


class AsrModelInfo(BaseModel):
    id: str = Field(description="Local model identifier.")
    name: str = Field(description="Human-readable model name.")
    type: str = Field(description="Model family or inferred type.")
    repo: str = Field(description="Original HuggingFace-style repository identifier.")
    size_gb: float = Field(description="Approximate model size in gigabytes.")
    languages: list[str] = Field(
        default_factory=list,
        description="Languages supported by the model.",
    )
    description: str = Field(default="", description="Free-form model description.")
    downloaded: bool = Field(
        default=True,
        description="Whether the model is present locally.",
    )


class OpenAIModelInfo(BaseModel):
    id: str = Field(description="Model identifier.")
    object: Literal["model"] = Field(default="model", description="OpenAI object type.")
    created: int = Field(default=0, description="Unix timestamp placeholder.")
    owned_by: str = Field(
        default="capty-sidecar",
        description="Owning service identifier.",
    )


class OpenAIModelListResponse(BaseModel):
    object: Literal["list"] = Field(default="list", description="OpenAI list wrapper type.")
    data: list[OpenAIModelInfo] = Field(
        default_factory=list,
        description="Available models exposed in OpenAI-compatible format.",
    )


class SwitchAsrModelRequest(BaseModel):
    model: str = Field(description="ASR model ID under the local models directory.")


class SwitchTtsModelRequest(BaseModel):
    model: str = Field(
        description="TTS model path or repo ID to load into the TTS engine.",
    )


class SwitchModelResponse(BaseModel):
    status: Literal["ok"] = Field(default="ok", description="Switch result.")
    model: str = Field(description="Model ID or path that was loaded.")


class TranscribeFileRequest(BaseModel):
    file_path: str = Field(description="Absolute path to a local audio file.")
    model: str = Field(
        default="",
        description="Optional ASR model ID to load before transcription.",
    )


class DecodeAudioRequest(BaseModel):
    file_path: str = Field(description="Absolute path to a local audio file.")


class TranscriptionResponse(BaseModel):
    text: str = Field(description="Transcribed plain text.")


class TranscriptSegment(BaseModel):
    start: int = Field(description="Segment start time in whole seconds.")
    end: int = Field(description="Segment end time in whole seconds.")
    text: str = Field(description="Transcribed text for this segment.")


class FileTranscriptionResponse(BaseModel):
    segments: list[TranscriptSegment] = Field(
        default_factory=list,
        description="Time-aligned transcript segments.",
    )
    text: str = Field(description="Full transcript text.")
    duration: int = Field(description="Approximate audio duration in whole seconds.")


class VoiceInfo(BaseModel):
    id: str = Field(description="Voice identifier.")
    name: str = Field(description="Human-readable voice name.")


class VoiceListResponse(BaseModel):
    items: list[VoiceInfo] = Field(default_factory=list, description="Available voices.")
    total: int = Field(description="Total number of voices.")
    page: int = Field(description="Current page number.")
    page_size: int = Field(description="Number of items returned in this page.")
    total_pages: int = Field(description="Total number of pages.")


class TtsStatusResponse(BaseModel):
    loaded: bool = Field(description="Whether a TTS model is currently loaded.")
    model: str = Field(default="", description="Loaded TTS model identifier, or empty string.")


class SpeechRequest(BaseModel):
    input: str = Field(description="Input text to synthesize.")
    model: str = Field(
        default="",
        description="Optional TTS model path or repo ID to load before synthesis.",
    )
    voice: str = Field(default="", description="Preferred voice ID.")
    speed: float = Field(default=1.0, description="Playback speed multiplier.")
    lang_code: str = Field(
        default="auto",
        description="Language code hint. Use 'auto' to detect automatically.",
    )


DEFAULT_ERROR_RESPONSES = {
    400: {"model": ErrorResponse, "description": "Bad request."},
    403: {"model": ErrorResponse, "description": "Forbidden path access."},
    404: {"model": ErrorResponse, "description": "Requested resource not found."},
    500: {"model": ErrorResponse, "description": "Internal sidecar error."},
}

WAV_BINARY_RESPONSE = {
    200: {
        "description": "Binary WAV audio payload.",
        "content": {
            "audio/wav": {
                "schema": {"type": "string", "format": "binary"},
            }
        },
    }
}

NDJSON_STREAM_RESPONSE = {
    200: {
        "description": "NDJSON stream. Each line is a JSON object representing a stream event.",
        "content": {
            "application/x-ndjson": {
                "schema": {
                    "type": "string",
                    "description": "Newline-delimited JSON event stream.",
                },
                "example": (
                    '{"type":"header","sample_rate":24000}\n'
                    '{"type":"audio","data":"<base64-pcm>","sample_rate":24000,"is_final":false}\n'
                    '{"type":"audio","data":"","sample_rate":0,"is_final":true}\n'
                ),
            }
        },
    }
}


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
    try:
        resolved.relative_to(allowed)
    except ValueError:
        raise HTTPException(
            status_code=403,
            detail="Access denied: path outside allowed directory",
        )
    return resolved


def _to_openai_model_list(models: list[dict]) -> OpenAIModelListResponse:
    """Convert disk-driven model entries into OpenAI-compatible list format."""
    return OpenAIModelListResponse(
        data=[OpenAIModelInfo(id=model["id"]) for model in models if "id" in model]
    )


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------


def create_app(models_dir: str, data_dir: str = "") -> FastAPI:
    """Create and return the FastAPI application."""
    app = FastAPI(
        title="Capty Sidecar API",
        version=__version__,
        summary="Local ASR/TTS service for Capty.",
        description=(
            "Capty sidecar exposes local ASR and TTS capabilities over HTTP. "
            "It provides Capty-specific management routes plus OpenAI-style "
            "audio endpoints for transcription and speech synthesis."
        ),
        openapi_tags=[
            {"name": "system", "description": "Health and runtime status."},
            {"name": "models", "description": "ASR model discovery and switching."},
            {"name": "asr", "description": "Speech-to-text endpoints."},
            {"name": "audio", "description": "Audio decode utilities."},
            {"name": "tts", "description": "Text-to-speech endpoints."},
        ],
        servers=[
            {
                "url": "http://127.0.0.1:{port}",
                "description": "Local sidecar instance.",
                "variables": {
                    "port": {
                        "default": "8765",
                        "description": "Configurable sidecar HTTP port.",
                    }
                },
            }
        ],
    )
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

    @app.get(
        "/health",
        tags=["system"],
        response_model=HealthResponse,
        summary="Get sidecar health",
        operation_id="getHealth",
        responses={500: DEFAULT_ERROR_RESPONSES[500]},
    )
    async def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            model_loaded=pool.asr.is_loaded(),
            current_model=pool.asr.model_id or "",
            tts_loaded=pool.tts.is_loaded(),
            engines={name: EngineStatus(**status) for name, status in pool.status().items()},
        )

    @app.get(
        "/models",
        tags=["models"],
        response_model=list[AsrModelInfo],
        summary="List downloaded ASR models",
        operation_id="listAsrModels",
        responses={500: DEFAULT_ERROR_RESPONSES[500]},
    )
    async def list_models() -> list[AsrModelInfo]:
        return [AsrModelInfo(**model) for model in registry.list_models()]

    @app.get(
        "/v1/models",
        tags=["models"],
        response_model=OpenAIModelListResponse,
        summary="List models in OpenAI-compatible format",
        operation_id="listOpenAIModels",
        responses={500: DEFAULT_ERROR_RESPONSES[500]},
    )
    async def list_models_openai() -> OpenAIModelListResponse:
        return _to_openai_model_list(registry.list_models())

    @app.post(
        "/models/switch",
        tags=["models"],
        response_model=SwitchModelResponse,
        summary="Switch active ASR model",
        operation_id="switchAsrModel",
        responses={
            400: DEFAULT_ERROR_RESPONSES[400],
            404: DEFAULT_ERROR_RESPONSES[404],
            500: DEFAULT_ERROR_RESPONSES[500],
        },
    )
    async def switch_model(body: SwitchAsrModelRequest) -> SwitchModelResponse:
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
        return SwitchModelResponse(status="ok", model=target)

    # ------------------------------------------------------------------
    # ASR transcription
    # ------------------------------------------------------------------

    @app.post(
        "/v1/audio/transcriptions",
        tags=["asr"],
        response_model=TranscriptionResponse,
        summary="Transcribe uploaded audio",
        operation_id="createAudioTranscription",
        responses={
            400: DEFAULT_ERROR_RESPONSES[400],
            500: DEFAULT_ERROR_RESPONSES[500],
        },
    )
    async def transcriptions(
        file: UploadFile = File(
            ...,
            description="Uploaded audio file. WAV is preferred, but any format accepted by the caller is allowed.",
        ),
        model: str = Form(
            "",
            description="Optional ASR model ID to load before transcription.",
        ),
        language: Optional[str] = Form(
            None,
            description="OpenAI-compatible language hint. Currently accepted for compatibility but ignored.",
        ),
    ) -> TranscriptionResponse:
        _ = language
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
            return TranscriptionResponse(text="")

        all_texts: list[str] = []
        offset = 0
        while offset < len(pcm_data):
            chunk = pcm_data[offset: offset + MAX_CHUNK_BYTES]
            offset += MAX_CHUNK_BYTES
            text = await run_on_mlx(lambda c=chunk: engine.transcribe_sync(c))
            if text and text.strip():
                all_texts.append(text.strip())

        return TranscriptionResponse(text=" ".join(all_texts))

    # ------------------------------------------------------------------
    # File-based transcription
    # ------------------------------------------------------------------

    @app.post(
        "/v1/audio/transcribe-file",
        tags=["asr"],
        response_model=FileTranscriptionResponse,
        summary="Transcribe a local audio file",
        operation_id="transcribeLocalFile",
        responses={
            400: DEFAULT_ERROR_RESPONSES[400],
            403: DEFAULT_ERROR_RESPONSES[403],
            500: DEFAULT_ERROR_RESPONSES[500],
        },
    )
    async def transcribe_file(body: TranscribeFileRequest) -> FileTranscriptionResponse:
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
            return FileTranscriptionResponse(segments=[], text="", duration=0)

        segment_seconds = 15
        max_chunk_samples = segment_seconds * SAMPLE_RATE
        total_duration = round(audio_np.size / SAMPLE_RATE)
        segments: list[TranscriptSegment] = []
        offset = 0
        while offset < audio_np.size:
            chunk = audio_np[offset: offset + max_chunk_samples]
            start_time = round(offset / SAMPLE_RATE)
            end_time = round(min(offset + max_chunk_samples, audio_np.size) / SAMPLE_RATE)
            offset += max_chunk_samples
            text = await run_on_mlx(lambda c=chunk: engine.transcribe_array_sync(c))
            if text and text.strip():
                segments.append(
                    TranscriptSegment(start=start_time, end=end_time, text=text.strip())
                )

        return FileTranscriptionResponse(
            segments=segments,
            text=" ".join(segment.text for segment in segments),
            duration=total_duration,
        )

    # ------------------------------------------------------------------
    # Audio decode
    # ------------------------------------------------------------------

    @app.post(
        "/v1/audio/decode",
        tags=["audio"],
        summary="Decode a local audio file to WAV",
        operation_id="decodeAudioFile",
        response_class=Response,
        responses={
            **WAV_BINARY_RESPONSE,
            400: DEFAULT_ERROR_RESPONSES[400],
            403: DEFAULT_ERROR_RESPONSES[403],
            500: DEFAULT_ERROR_RESPONSES[500],
        },
    )
    async def decode_audio(body: DecodeAudioRequest) -> Response:
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

    @app.get(
        "/v1/audio/voices",
        tags=["tts"],
        response_model=VoiceListResponse,
        summary="List available TTS voices",
        operation_id="listVoices",
        responses={500: DEFAULT_ERROR_RESPONSES[500]},
    )
    async def list_voices_standard() -> VoiceListResponse:
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
            VoiceInfo(id=v["id"], name=v.get("name", v["id"]))
            for v in voices_data
            if isinstance(v, dict) and "id" in v
        ]
        return VoiceListResponse(
            items=items,
            total=len(items),
            page=1,
            page_size=len(items),
            total_pages=1,
        )

    # ------------------------------------------------------------------
    # TTS model management
    # ------------------------------------------------------------------

    @app.post(
        "/tts/switch",
        tags=["tts"],
        response_model=SwitchModelResponse,
        summary="Switch active TTS model",
        operation_id="switchTtsModel",
        responses={500: DEFAULT_ERROR_RESPONSES[500]},
    )
    async def switch_tts_model(body: SwitchTtsModelRequest) -> SwitchModelResponse:
        try:
            await pool.load_engine("tts", body.model, Path(body.model))
        except Exception as exc:
            logger.exception("Failed to load TTS model %s", body.model)
            raise HTTPException(status_code=500, detail=f"Failed to load TTS model: {exc}") from exc
        return SwitchModelResponse(status="ok", model=body.model)

    @app.get(
        "/tts/status",
        tags=["tts"],
        response_model=TtsStatusResponse,
        summary="Get TTS engine status",
        operation_id="getTtsStatus",
        responses={500: DEFAULT_ERROR_RESPONSES[500]},
    )
    async def tts_status() -> TtsStatusResponse:
        tts_engine = pool.tts
        return TtsStatusResponse(
            loaded=tts_engine.is_loaded(),
            model=tts_engine.model_id or "",
        )

    # ------------------------------------------------------------------
    # TTS synthesis (non-streaming, cooperative)
    # ------------------------------------------------------------------

    @app.post(
        "/v1/audio/speech",
        tags=["tts"],
        summary="Synthesize speech as WAV",
        operation_id="createSpeech",
        response_class=Response,
        responses={
            **WAV_BINARY_RESPONSE,
            400: DEFAULT_ERROR_RESPONSES[400],
            500: DEFAULT_ERROR_RESPONSES[500],
        },
    )
    async def text_to_speech(req: SpeechRequest) -> Response:
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

        combined_pcm = b"".join(all_pcm)
        combined_np = np.frombuffer(combined_pcm, dtype=np.int16).astype(np.float32) / 32767.0
        wav_bytes = audio_to_wav_bytes(combined_np, sample_rate)

        return Response(content=wav_bytes, media_type="audio/wav")

    # ------------------------------------------------------------------
    # TTS streaming (cooperative -- per-sentence executor submission)
    # ------------------------------------------------------------------

    @app.post(
        "/v1/audio/speech/stream",
        tags=["tts"],
        summary="Stream synthesized speech as NDJSON events",
        operation_id="streamSpeech",
        response_class=StreamingResponse,
        responses={
            **NDJSON_STREAM_RESPONSE,
            400: DEFAULT_ERROR_RESPONSES[400],
            500: DEFAULT_ERROR_RESPONSES[500],
        },
    )
    async def text_to_speech_stream(req: SpeechRequest) -> StreamingResponse:
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

                    is_final = i == len(sentences) - 1
                    b64_data = base64.b64encode(pcm_bytes).decode("ascii")
                    yield json.dumps(
                        {
                            "type": "audio",
                            "data": b64_data,
                            "sample_rate": sample_rate,
                            "is_final": is_final,
                        }
                    ) + "\n"

                if header_sent:
                    yield json.dumps(
                        {
                            "type": "audio",
                            "data": "",
                            "sample_rate": 0,
                            "is_final": True,
                        }
                    ) + "\n"

            except asyncio.CancelledError:
                logger.info("TTS stream cancelled by client disconnect")
                cancel_event.set()
            except Exception as exc:
                logger.exception("TTS streaming error")
                yield json.dumps({"type": "error", "message": str(exc)}) + "\n"

        return StreamingResponse(generate(), media_type="application/x-ndjson")

    return app
