# Sidecar Speaker Diarization — Design

**Date:** 2026-04-19
**Status:** Approved
**Author:** Jeason + Codex

## Context

Capty's Python sidecar currently supports:

- ASR via `mlx-audio` models loaded on the dedicated MLX thread
- TTS via `mlx-audio`
- File transcription via `/v1/audio/transcribe-file`

What it does **not** support today:

- speaker diarization
- word-level timestamps in a normalized response shape
- reconciliation between ASR words and speaker turns

The selected direction is:

- `ASR (Qwen / Whisper / Parakeet)` produces text
- `pyannote` produces speaker turns
- a reconciliation layer assigns each word to a speaker
- the sidecar returns `segments[{start,end,speaker,text}]`

## Current State Audit

| Area | Current State | Gap |
|------|---------------|-----|
| `ASREngine` | Returns only `result.text` in [engine.py](/Users/zhangjie/Documents/Jeason的创作/code/personal/capty/sidecar/capty_sidecar/engine.py) | Drops timestamps, segments, speaker info |
| `/v1/audio/transcriptions` | Multipart upload, returns only `{"text": ...}` | No structured output |
| `/v1/audio/transcribe-file` | Returns coarse fixed-window segments | Segments are chunk boundaries, not speaker turns |
| MLX execution | Single dedicated thread via `run_on_mlx` | Correct for ASR/TTS, but diarization needs a non-MLX runtime |
| Packaging | PyInstaller bundle excludes `torch`, `torchvision`, `torchaudio` | pyannote cannot be bundled as-is |

## Approaches Considered

### A. Use `VibeVoice-ASR` native diarization

Pros:

- Lowest implementation cost
- Speaker labels may already be emitted by one model

Cons:

- Ties diarization to one ASR backend
- Does not satisfy the selected architecture of `Qwen / Whisper / Parakeet + pyannote`
- Harder to keep one normalized response model across ASR families

Rejected.

### B. Use `ASR + word timestamps + pyannote + reconciliation`

Pros:

- Matches the selected product direction
- Keeps ASR model choice independent from diarization backend
- Lets us reuse the strongest timestamp path for each ASR family
- Produces a stable canonical output shape

Cons:

- More moving parts
- Requires `torch` and `pyannote.audio`
- Qwen needs a separate aligner stage

Selected.

### C. Use `mlx-audio` Sortformer instead of pyannote

Pros:

- Stays inside the MLX ecosystem
- Potentially simpler Apple Silicon story

Cons:

- User explicitly chose pyannote
- pyannote is the more mature default diarization backend today
- We would still need a reconciliation layer

Deferred.

## Decision

1. Add a **new file-based annotated endpoint** rather than changing the existing routes in-place.
2. Keep the current `/v1/audio/transcriptions` and `/v1/audio/transcribe-file` behavior backward compatible.
3. Add a **canonical intermediate representation**:
   - `WordSpan`
   - `SpeakerTurn`
   - `TranscriptSegment`
4. Keep all MLX work on the existing MLX thread.
5. Run pyannote on a separate Torch executor, not on the event loop and not on the MLX thread.
6. Use **model-specific timestamp extraction**:
   - Whisper: native word timestamps
   - Parakeet: native aligned tokens/sentences
   - Qwen: `Qwen3-ASR` transcription plus `Qwen3-ForcedAligner`
7. Reconcile words to speakers using pyannote's diarization turns, preferring `exclusive_speaker_diarization` when available.

## Scope

### §1 HTTP API

#### Existing endpoints

- `/v1/audio/transcriptions`: unchanged
- `/v1/audio/transcribe-file`: unchanged externally, still returns legacy shape

#### New endpoint

`POST /v1/audio/transcribe-file-annotated`

Request body:

```json
{
  "file_path": "/abs/path/to/audio.wav",
  "model": "Qwen--Qwen3-ASR-0.6B",
  "diarize": true,
  "include_words": true,
  "num_speakers": null,
  "min_speakers": null,
  "max_speakers": null,
  "aligner_model": "",
  "diarization_model": ""
}
```

Rules:

- `diarize=false` is allowed and returns words/segments without speaker labels.
- `include_words=true` returns canonical word spans.
- `num_speakers`, `min_speakers`, `max_speakers` map directly to pyannote hints.
- `aligner_model` is optional and only used for Qwen.
- `diarization_model` defaults to `pyannote/speaker-diarization-community-1`.

Response body:

```json
{
  "text": "Hello there. Hi.",
  "duration": 12.4,
  "language": "en",
  "speakers": ["SPEAKER_00", "SPEAKER_01"],
  "words": [
    {"text": "Hello", "start": 0.42, "end": 0.81, "speaker": "SPEAKER_00"},
    {"text": "there", "start": 0.82, "end": 1.13, "speaker": "SPEAKER_00"},
    {"text": "Hi", "start": 2.05, "end": 2.31, "speaker": "SPEAKER_01"}
  ],
  "speaker_turns": [
    {"speaker": "SPEAKER_00", "start": 0.31, "end": 1.40},
    {"speaker": "SPEAKER_01", "start": 1.98, "end": 2.60}
  ],
  "segments": [
    {"speaker": "SPEAKER_00", "start": 0.42, "end": 1.13, "text": "Hello there"},
    {"speaker": "SPEAKER_01", "start": 2.05, "end": 2.31, "text": "Hi"}
  ]
}
```

### §2 Canonical Internal Types

These types are the contract between ASR, diarization, and response serialization.

```python
@dataclass
class WordSpan:
    text: str
    start: float
    end: float
    speaker: str | None = None

@dataclass
class SpeakerTurn:
    speaker: str
    start: float
    end: float

@dataclass
class TranscriptSegment:
    speaker: str | None
    start: float
    end: float
    text: str
    words: list[WordSpan]
```

## Architecture

### File Structure

```text
capty_sidecar/
├── main.py                # derive alignment/diarization model dirs from data_dir
├── engine.py              # extend ASREngine, add AlignerEngine
├── engine_pool.py         # add aligner slot
├── mlx_executor.py        # unchanged
├── torch_executor.py      # NEW - dedicated executor for pyannote
├── diarization.py         # NEW - pyannote pipeline wrapper
├── reconcile.py           # NEW - word/speaker assignment + segment merge
├── model_registry.py      # unchanged for ASR listing
└── server.py              # add annotated route and orchestration
```

### MLX Layer

#### `ASREngine`

Keep the existing text-only methods for backward compatibility, and add a new structured path:

```python
def transcribe_structured_sync(self, audio_np: np.ndarray) -> AsrStructuredResult:
    ...
```

This method normalizes model-specific outputs into:

- full transcript text
- language
- canonical `WordSpan` list if available natively
- coarse fallback spans if the model cannot emit words directly

#### `AlignerEngine`

Add a third MLX slot in `EnginePool`:

- `asr`
- `tts`
- `aligner`

`AlignerEngine` is only used when the selected ASR model is Qwen and canonical word spans are requested.

Default aligner model:

- `Qwen/Qwen3-ForcedAligner-0.6B`

Storage:

- `data/models/alignment/`

### Torch Layer

#### `torch_executor.py`

Add a dedicated executor:

```python
_torch_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="torch")

async def run_on_torch(fn: Callable[[], T]) -> T:
    ...
```

Why single-threaded:

- pyannote runs are memory-heavy
- this avoids concurrent diarization jobs fighting each other
- it keeps behavior deterministic

#### `diarization.py`

`PyannoteDiarizer` owns:

- pipeline loading
- caching the loaded pipeline
- model path / Hugging Face token resolution
- invocation with speaker-count hints

Core API:

```python
class PyannoteDiarizer:
    def load_sync(self, model_id: str, model_path: Path | None = None) -> None
    def diarize_sync(
        self,
        file_path: str,
        *,
        num_speakers: int | None = None,
        min_speakers: int | None = None,
        max_speakers: int | None = None,
    ) -> list[SpeakerTurn]
```

Defaults:

- local model path under `data/models/diarization/` if present
- otherwise `Pipeline.from_pretrained(...)` with `HF_TOKEN` or `HUGGINGFACE_HUB_TOKEN`

### Reconciliation Layer

`reconcile.py` converts:

- ASR words
- pyannote turns

into speaker-attributed words and merged transcript segments.

#### Algorithm

1. Normalize diarization output to `SpeakerTurn`.
2. Normalize ASR output to `WordSpan`.
3. For each word, compute overlap with all speaker turns.
4. Assign the speaker with the maximum overlap.
5. If no overlap exists:
   - use the closest turn within a small tolerance window
   - otherwise inherit the previous speaker only when the time gap is tiny
   - otherwise leave `speaker=None`
6. Merge adjacent words into `TranscriptSegment` when:
   - speaker matches
   - inter-word gap is below threshold
   - punctuation boundary does not force a split

#### Canonical thresholds

- `speaker_overlap_epsilon = 0.05s`
- `same_segment_gap = 0.6s`
- split immediately on large silence

### Model-Specific Timestamp Strategies

#### Whisper

Use native word timestamps:

```python
result = model.generate(audio_np, word_timestamps=True)
```

Normalization source:

- `result.segments[*]`
- nested word spans when present

#### Parakeet

Use native aligned output:

- `AlignedResult.sentences`
- `AlignedSentence.tokens`

Normalize each token into `WordSpan`.

#### Qwen

Two-stage flow:

1. `Qwen3-ASR` generates transcript text
2. `Qwen3-ForcedAligner` aligns transcript text back to audio

Normalization source:

- `ForcedAlignResult.items`

This avoids pretending that bare Qwen transcription already has word timestamps.

## Route Orchestration

`/v1/audio/transcribe-file-annotated` runs this pipeline:

1. Validate `file_path`
2. Ensure ASR model is loaded
3. Decode audio to `audio_np` at 16kHz
4. Run ASR structured transcription on MLX thread
5. If Qwen and words are requested, run aligner on MLX thread
6. If `diarize=true`, run pyannote on Torch executor
7. Reconcile words with speaker turns
8. Serialize annotated response

The legacy `/v1/audio/transcribe-file` route can internally call the same pipeline with:

- `diarize=false`
- `include_words=false`

and down-convert to today's response shape.

## Configuration

### Environment Variables

- `HF_TOKEN` or `HUGGINGFACE_HUB_TOKEN`
  - used for first download of gated Hugging Face models, especially pyannote
- `CAPTY_ALIGNMENT_MODELS_DIR`
  - optional override for alignment models
- `CAPTY_DIARIZATION_MODELS_DIR`
  - optional override for diarization models

### Derived Default Paths

Under the existing Capty data directory:

```text
data/
└── models/
    ├── asr/
    ├── tts/
    ├── alignment/
    └── diarization/
```

## Packaging Impact

### Python dependencies

`sidecar/pyproject.toml` must add:

- `torch`
- `torchaudio`
- `pyannote.audio`

### PyInstaller

`sidecar/capty-sidecar.spec` must change in two ways:

1. Remove `torch` and `torchaudio` from the explicit `excludes`
2. Add package collection for pyannote and its runtime dependencies

Expected impact:

- larger bundle size
- longer build times
- more hidden-import tuning than the current MLX-only bundle

This is acceptable for this feature.

## Non-Goals

- streaming diarization in v1
- speaker identification by person name
- cloud-only pyannoteAI integration
- UI changes in Electron for this design pass

## Risks

1. **Bundle size**: Torch + pyannote will materially enlarge the sidecar.
2. **Mac runtime variance**: pyannote is much less Apple-Silicon-native than MLX.
3. **Qwen memory pressure**: ASR + aligner + TTS may require careful load order.
4. **Gated model setup**: pyannote first-run UX depends on Hugging Face token/configuration.

## Future Extensions

- Add `/v1/audio/transcriptions/annotated` for multipart upload parity
- Add speaker-aware subtitle export
- Add cloud `pyannoteAI precision-2` as an optional backend
- Add fallback to `mlx-audio` Sortformer when pyannote is unavailable
