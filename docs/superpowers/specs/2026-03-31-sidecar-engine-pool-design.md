# Sidecar EnginePool Refactor Design

## Goal

Refactor Capty sidecar to allow ASR and TTS to run concurrently without blocking each other, by introducing an EnginePool pattern with cooperative scheduling on a single MLX thread.

## Current Problems

1. **Single shared executor**: ASR and TTS share one `ThreadPoolExecutor(max_workers=1)`. TTS synthesis (30s+) completely blocks ASR.
2. **Single model in memory**: Only one model at a time. Switching between ASR↔TTS requires full unload/reload (5-30s).
3. **No cooperative scheduling**: TTS streaming holds the executor for the entire generation, no way for ASR to interleave.

## Architecture

### File Structure

```
capty_sidecar/
├── main.py              # unchanged - entry point
├── model_registry.py    # unchanged - disk model discovery
├── engine.py            # NEW - BaseEngine / ASREngine / TTSEngine
├── engine_pool.py       # NEW - EnginePool manages engine instances
├── mlx_executor.py      # NEW - global MLX executor + run_on_mlx helper
├── server.py            # MODIFIED - routes call EnginePool instead of runners
├── model_runner.py      # DELETED - merged into engine.py (ASREngine)
├── tts_runner.py        # DELETED - merged into engine.py (TTSEngine)
```

### Module Responsibilities

#### `mlx_executor.py` — Global MLX Thread

Single-thread executor shared by all engines. MLX is NOT thread-safe (confirmed by maintainer, GitHub Issues #2133, #3078).

```python
_mlx_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mlx")

_MLX_CACHE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB
mx.set_cache_limit(_MLX_CACHE_LIMIT_BYTES)

async def run_on_mlx(fn: Callable[[], T]) -> T:
    """Run sync function on MLX thread, cleanup after."""
    loop = asyncio.get_running_loop()
    def _wrapped():
        try:
            return fn()
        finally:
            mx.clear_cache()
            gc.collect()
    return await loop.run_in_executor(_mlx_executor, _wrapped)
```

#### `engine.py` — Engine Abstractions

**BaseEngine:**

```python
class BaseEngine:
    engine_type: str          # "asr" or "tts"
    model_id: str | None

    def load_sync(self, model_id: str, model_path: Path) -> None
    def unload_sync(self) -> None
    def is_loaded(self) -> bool
```

`load_sync` and `unload_sync` are synchronous methods that run on the MLX thread (called via `run_on_mlx`).

**ASREngine (extends BaseEngine):**

Migrated from `model_runner.py`. Same inference logic:

- `transcribe_sync(pcm_bytes, sample_rate) -> str` — sync, runs on MLX thread
- `transcribe_array_sync(audio_np) -> str` — sync, runs on MLX thread

**TTSEngine (extends BaseEngine):**

Migrated from `tts_runner.py`. Key change: cooperative streaming.

- `synthesize_sync(text, voice, speed, lang_code) -> bytes` — non-streaming, returns WAV
- `generate_one_segment_sync(text, voice, speed, lang_code) -> tuple[bytes, int]` — generate one sentence, returns (pcm_int16_bytes, sample_rate)
- `get_voices() -> list[dict]` — read from loaded model or scan disk
- `resolve_voice(voice) -> str | None`

Text splitting helper for cooperative streaming:

```python
def split_sentences(text: str) -> list[str]:
    """Split text into sentences for cooperative TTS streaming.

    Rules:
    - Split on Chinese punctuation: 。！？；
    - Split on English punctuation: . ! ? ;
    - Merge segments shorter than 10 chars into previous
    - Cap each segment at 200 chars
    """
```

#### `engine_pool.py` — Engine Lifecycle Management

```python
class EnginePool:
    _engines: dict[str, BaseEngine]  # {"asr": ASREngine(), "tts": TTSEngine()}
    _lock: asyncio.Lock              # serializes load/unload operations

    async def get_engine(self, engine_type: str) -> BaseEngine
    async def load_engine(self, engine_type: str, model_id: str, model_path: Path) -> None
    async def unload_engine(self, engine_type: str) -> None
    def status(self) -> dict
```

- Fixed 2 slots: `asr` and `tts`. No dynamic expansion.
- `_lock` protects load/unload only (prevents concurrent model loading that could OOM).
- Inference serialization is handled by `run_on_mlx`.
- Both ASR and TTS models can coexist in memory simultaneously.

#### `server.py` — Route Layer Changes

Routes change from:

```python
runner = ModelRunner()
tts_runner = TTSRunner()
```

To:

```python
pool = EnginePool()
```

All routes call `pool.get_engine("asr")` or `pool.get_engine("tts")` then use `run_on_mlx()` for inference.

### Cooperative TTS Streaming (Core Mechanism)

**Problem**: Current TTS streaming submits one long-running task to executor, blocking everything.

**Solution**: Split TTS text into sentences, submit each sentence as a separate `run_on_mlx` call:

```python
# In server.py, /v1/audio/speech/stream handler:
async def tts_stream_handler(req: SpeechRequest):
    engine = await pool.get_engine("tts")
    sentences = split_sentences(strip_markdown(req.input))

    async def generate():
        for i, sentence in enumerate(sentences):
            if cancel_event.is_set():
                break
            # Each sentence is a separate executor submission
            # Between sentences, ASR requests can execute
            pcm_bytes, sample_rate = await run_on_mlx(
                lambda s=sentence: engine.generate_one_segment_sync(
                    s, req.voice, req.speed, req.lang_code
                )
            )
            yield ndjson_chunk(pcm_bytes, sample_rate, is_final=(i == len(sentences) - 1))

    return StreamingResponse(generate(), media_type="application/x-ndjson")
```

**Effect**: TTS generating 5 sentences = 5 executor submissions. Between each, waiting ASR requests can grab the executor. Worst-case ASR latency = time to generate 1 sentence (~2-5s) instead of entire text (~30s+).

### Non-streaming TTS

Non-streaming `/v1/audio/speech` also benefits from cooperative approach — submit all sentences, concatenate results:

```python
async def tts_handler(req: SpeechRequest):
    engine = await pool.get_engine("tts")
    sentences = split_sentences(strip_markdown(req.input))
    all_pcm = []
    for sentence in sentences:
        pcm, sr = await run_on_mlx(
            lambda s=sentence: engine.generate_one_segment_sync(s, ...)
        )
        all_pcm.append(pcm)
    combined_wav = concat_and_wrap_wav(all_pcm, sr)
    return Response(content=combined_wav, media_type="audio/wav")
```

## API Compatibility

ALL HTTP endpoints remain 100% compatible. No URL, request format, or response format changes:

| Endpoint | Method | Change |
|----------|--------|--------|
| `/health` | GET | Response adds `engines` field (backward compatible) |
| `/models` | GET | No change |
| `/models/switch` | POST | Internally calls `pool.load_engine("asr", ...)` |
| `/v1/audio/transcriptions` | POST | Internally calls `pool.get_engine("asr")` |
| `/v1/audio/speech` | POST | Cooperative sentence-by-sentence generation |
| `/v1/audio/speech/stream` | POST | Cooperative streaming |
| `/v1/audio/voices` | GET | No change (disk scan fallback preserved) |
| `/tts/switch` | POST | Internally calls `pool.load_engine("tts", ...)` |
| `/tts/status` | GET | No change |
| `/v1/audio/transcribe-file` | POST | No change |
| `/v1/audio/decode` | POST | No change |

**Frontend (ipc-handlers.ts) requires ZERO changes.**

## Memory Management

- Keep existing `mx.set_cache_limit(2GB)` for Metal buffer cache
- `run_on_mlx` wrapper does `mx.clear_cache()` + `gc.collect()` after every call
- ASR + TTS models coexist: ~2-4 GB total depending on model sizes
- No OMLX-style ProcessMemoryEnforcer (YAGNI for 2 engines)

## Error Handling

- Engine load failure → HTTP 500, other engine unaffected
- Inference failure → cleanup MLX cache, return error, don't crash
- Model switch: if new model fails to load after old is unloaded → engine enters unloaded state
- `run_on_mlx` unified try/finally ensures cache cleanup even on exceptions
- TTS cancel: existing `cancel_event` mechanism preserved

## Race Condition Protection

- `EnginePool._lock` (asyncio.Lock) serializes load/unload to prevent concurrent model loading
- Inference requests serialized by single-thread executor — no race conditions
- Model switch during inference: load waits for executor (previous inference completes first)

## What We Are NOT Building (YAGNI)

- LRU eviction (only 2 fixed engine slots)
- ProcessMemoryEnforcer / memory polling
- Model pinning or TTL
- Request priority queue (FIFO through executor is sufficient)
- Dynamic engine creation
- Multi-model per engine type

## Testing Strategy

- Unit test: `split_sentences` with Chinese, English, mixed text
- Unit test: `ASREngine.load_sync` / `unload_sync` / `transcribe_sync`
- Unit test: `TTSEngine.generate_one_segment_sync`
- Integration test: concurrent ASR + TTS requests via httpx
- Integration test: TTS streaming with cancellation
- Integration test: model switching while other engine is loaded
