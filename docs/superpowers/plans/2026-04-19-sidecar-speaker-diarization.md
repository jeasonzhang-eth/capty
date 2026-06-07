# Sidecar Speaker Diarization Implementation Plan

> **For agentic workers:** implement this plan task-by-task. Track progress with checkbox updates.

**Goal:** Add an annotated file-transcription pipeline to the Capty sidecar that combines ASR, word-level timestamps, pyannote diarization, and word-to-speaker reconciliation.

**Architecture:** `ASR (MLX)` stays on the existing MLX thread. `pyannote` runs on a separate Torch executor. The implementation adds a new annotated endpoint and keeps existing routes backward compatible.

**Spec:** [2026-04-19-sidecar-speaker-diarization-design.md](/Users/zhangjie/Documents/Jeason的创作/code/personal/capty/docs/superpowers/specs/2026-04-19-sidecar-speaker-diarization-design.md)

---

## File Map

| Path | Change | Responsibility |
|------|--------|----------------|
| `sidecar/capty_sidecar/engine.py` | Modify | Add structured ASR output and MLX aligner support |
| `sidecar/capty_sidecar/engine_pool.py` | Modify | Add `aligner` engine slot |
| `sidecar/capty_sidecar/torch_executor.py` | Create | Dedicated Torch executor for pyannote |
| `sidecar/capty_sidecar/diarization.py` | Create | pyannote load/inference wrapper |
| `sidecar/capty_sidecar/reconcile.py` | Create | Normalize words/turns and merge speaker-attributed segments |
| `sidecar/capty_sidecar/server.py` | Modify | Add annotated route and orchestrate ASR + aligner + diarization |
| `sidecar/capty_sidecar/main.py` | Modify | Add optional env/path resolution for alignment and diarization models |
| `sidecar/pyproject.toml` | Modify | Add `torch`, `torchaudio`, `pyannote.audio` |
| `sidecar/capty-sidecar.spec` | Modify | Include torch/pyannote packages and remove torch excludes |
| `sidecar/tests/*` | Create/Modify | Unit + integration coverage for reconciliation and annotated transcription |
| `CHANGELOG.md` | Modify | Record the feature work |

---

## Task 1: Add canonical transcript and speaker reconciliation types

**Files:**

- Create: `sidecar/capty_sidecar/reconcile.py`

- [ ] Define canonical dataclasses:
  - `WordSpan`
  - `SpeakerTurn`
  - `TranscriptSegment`
- [ ] Implement normalization helpers:
  - `words_from_whisper_result(...)`
  - `words_from_parakeet_result(...)`
  - `words_from_qwen_alignment(...)`
- [ ] Implement speaker assignment by maximum overlap.
- [ ] Implement segment merge from adjacent words.
- [ ] Add unit tests for:
  - exact overlap
  - no-overlap nearest-turn fallback
  - merge/split behavior around silence and speaker switches

---

## Task 2: Extend the MLX layer for structured ASR

**Files:**

- Modify: `sidecar/capty_sidecar/engine.py`
- Modify: `sidecar/capty_sidecar/engine_pool.py`

- [ ] Add an internal structured result type for ASR output.
- [ ] Add `ASREngine.transcribe_structured_sync(audio_np)`:
  - Whisper path with `word_timestamps=True`
  - Parakeet path using aligned tokens
  - Qwen path returning transcript text and coarse metadata
- [ ] Add `AlignerEngine` for Qwen forced alignment.
- [ ] Extend `EnginePool` with an `aligner` slot and property.
- [ ] Keep existing `transcribe_sync` and `transcribe_array_sync` unchanged for compatibility.

---

## Task 3: Add pyannote runtime support

**Files:**

- Create: `sidecar/capty_sidecar/torch_executor.py`
- Create: `sidecar/capty_sidecar/diarization.py`

- [ ] Add `run_on_torch(...)` backed by `ThreadPoolExecutor(max_workers=1)`.
- [ ] Implement `PyannoteDiarizer.load_sync(...)`.
- [ ] Implement `PyannoteDiarizer.diarize_sync(...)`.
- [ ] Resolve model path from:
  1. explicit local path
  2. `data/models/diarization`
  3. Hugging Face model ID
- [ ] Support pyannote speaker hints:
  - `num_speakers`
  - `min_speakers`
  - `max_speakers`
- [ ] Normalize pyannote output into canonical `SpeakerTurn` values.

---

## Task 4: Add the annotated transcription route

**Files:**

- Modify: `sidecar/capty_sidecar/server.py`

- [ ] Add new Pydantic request model:
  - `TranscribeAnnotatedFileRequest`
- [ ] Add `POST /v1/audio/transcribe-file-annotated`.
- [ ] Decode file to `audio_np` once and share it across ASR/alignment.
- [ ] For Qwen:
  - run ASR for transcript text
  - run `AlignerEngine` to get canonical words
- [ ] For Whisper/Parakeet:
  - normalize native word/timestamp output
- [ ] When `diarize=true`, call pyannote on the Torch executor.
- [ ] Reconcile words with speaker turns.
- [ ] Return:
  - `text`
  - `duration`
  - `language`
  - `speakers`
  - `words`
  - `speaker_turns`
  - `segments`

---

## Task 5: Preserve backward compatibility

**Files:**

- Modify: `sidecar/capty_sidecar/server.py`

- [ ] Keep `/v1/audio/transcriptions` response shape unchanged.
- [ ] Keep `/v1/audio/transcribe-file` response shape unchanged.
- [ ] Optionally refactor the legacy file route to call the new internal pipeline and down-convert the result.
- [ ] Verify no frontend IPC contract breaks.

---

## Task 6: Wire configuration and storage paths

**Files:**

- Modify: `sidecar/capty_sidecar/main.py`

- [ ] Add derived default paths for:
  - `models/alignment`
  - `models/diarization`
- [ ] Support optional env overrides:
  - `CAPTY_ALIGNMENT_MODELS_DIR`
  - `CAPTY_DIARIZATION_MODELS_DIR`
- [ ] Keep existing models-dir behavior unchanged for ASR.

---

## Task 7: Add dependencies and update packaging

**Files:**

- Modify: `sidecar/pyproject.toml`
- Modify: `sidecar/capty-sidecar.spec`

- [ ] Add runtime dependencies:
  - `torch`
  - `torchaudio`
  - `pyannote.audio`
- [ ] Remove `torch` and `torchaudio` from PyInstaller `excludes`.
- [ ] Add PyInstaller collection for pyannote and any required transitive modules.
- [ ] Run a sidecar build and confirm the binary boots.
- [ ] Document any new hidden imports required by the bundle.

---

## Task 8: Verification

**Files:**

- Create/Modify tests under `sidecar/tests/`

- [ ] Add reconciliation unit tests with synthetic words and turns.
- [ ] Add an annotated-route integration test using a fixed short audio fixture.
- [ ] Verify Whisper path returns word spans.
- [ ] Verify Parakeet path returns token-derived spans.
- [ ] Verify Qwen path returns aligned spans from the forced aligner.
- [ ] Verify diarization-disabled mode still returns valid `segments`.
- [ ] Smoke-test a built sidecar binary.

---

## Task 9: Documentation and changelog

**Files:**

- Modify: `CHANGELOG.md`

- [ ] Add a changelog entry for annotated speaker diarization support.
- [ ] Mention the new endpoint and the pyannote/Hugging Face token requirement.

---

## Recommended Execution Order

1. Task 1: canonical types and reconciliation
2. Task 2: structured ASR and aligner
3. Task 3: pyannote runtime
4. Task 4: new annotated route
5. Task 5: backward compatibility cleanup
6. Task 6: config paths
7. Task 7: dependencies and packaging
8. Task 8: verification
9. Task 9: changelog

## Open Risks to Watch During Implementation

- PyInstaller may need more hidden-import tuning than expected once `pyannote.audio` lands.
- Qwen ASR plus forced aligner may require explicit load/unload strategy if memory becomes tight.
- pyannote first-run behavior depends on local Hugging Face authentication and model acceptance.
