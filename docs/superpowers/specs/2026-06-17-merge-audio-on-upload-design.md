# Merge multiple audio files into one session on upload — design

**Date:** 2026-06-17
**Status:** Approved

## Problem

A DJI voice recorder auto-splits a long recording every 30 minutes. A 2-hour
recording therefore arrives as 4 separate files. Today the user merges them by
hand before importing into Capty. We want Capty to do it: at upload time, select
several files, order them, and merge them into a single session that is then
transcribed as one continuous recording.

## Scope

In scope:

- Merging happens **only at upload time**. When the user selects/drops two or
  more audio files, they may choose to merge them into one session.
- Files are ordered by natural filename sort by default; the user can drag to
  reorder before merging.
- Merging produces **one** new session. The original source files on disk are
  never modified or deleted (they live wherever the user keeps them; import
  already copies/transcodes, it does not move sources).

Explicitly out of scope (YAGNI):

- Merging sessions that are already imported. Merge is an upload-time action only.
- Cross-fade / silence padding between segments.
- Time-line alignment across sessions.

## Current upload flow (baseline)

- The **Upload** button calls `window.capty.importAudio()` → main `audio:import`,
  which **opens the OS file picker and imports immediately**.
- Drag-and-drop resolves file paths in the renderer (`getPathForFile`) and calls
  `window.capty.importAudioPaths(paths)` → main `audio:import-paths`, which also
  imports immediately.
- Both routes run `importAudioBatch` → `importOneAudioFile` per file: each file
  becomes its **own** session, transcoded to canonical 16 kHz / mono / 16-bit
  WAV via `convertToWav` (ffmpeg). Per-file progress is streamed on
  `audio:import-progress` and shown in `ImportManagerDialog`.

To merge, we insert a **staging/ordering step** between file selection and import.

## Approach (chosen)

### Audio merge mechanism — single ffmpeg concat-filter pass

One ffmpeg invocation concatenates and normalizes in a single pass:

```
ffmpeg -hide_banner -y \
  -i seg1 -i seg2 ... -i segN \
  -filter_complex "[0:a][1:a]...[N-1:a]concat=n=N:v=0:a=1[out]" \
  -map "[out]" -ar 16000 -ac 1 -sample_fmt s16 \
  dest.wav
```

- Handles arbitrary input formats/sample rates/channel counts; everything is
  resampled to the canonical format the rest of Capty expects.
- Output order is exactly the `-i` input order — the renderer sends paths
  already in the user's chosen order.
- No temporary files, no second pass.

Rejected alternatives: (B) transcode-each-then-concat-demuxer — gives per-segment
progress but adds temp files and steps; (C) raw PCM concat in Node — avoids a
second ffmpeg but is error-prone byte work. A single 4-file / 2-hour merge is
cheap, so A wins on simplicity.

### UI — extend `ImportManagerDialog` with a staging view

Reuse the existing import dialog rather than adding a new modal.

1. **Upload** click → new IPC `audio:pick-files` that **only returns paths**
   (does not import), replacing the pick-and-import behavior of `audio:import`
   for the dialog's button. (The legacy `audio:import` handler stays for any
   other caller / backward compatibility.)
2. Drag-and-drop already yields paths in the renderer.
3. **1 file selected** → behave exactly as today: import immediately, no staging
   (don't make the common single-file case slower).
4. **≥2 files selected** → the dialog enters a **staging view**:
   - A reorderable list of the selected files. Default order is a natural
     filename sort (`localeCompare(..., { numeric: true })`), so DJI's
     `..._163715` / `..._182020` suffixes order correctly.
   - An editable **merged-title** field, defaulting to the first file's base name.
   - Two actions: **「合并为一个 session」** and **「分别导入」**.
5. **合并** → `window.capty.importMerged(orderedPaths, title)` →
   `audio:import-merged`. **分别导入** → existing `audio:import-paths`.

## Components

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `src/main/audio/merge.ts` (new) | `mergeAudioFiles(orderedPaths, destPath): Promise<void>` — the single ffmpeg concat command. Pure, testable. | `spawn` |
| `src/main/audio/session-from-wav.ts` (new) | Shared helper extracted from `importOneAudioFile`: given a finished WAV in a session dir, dedup dir name, create the session row, compute duration, roll back on failure. Used by both single-file import and merge. | `database`, `audio-files`, `session-name` |
| `audio-handlers.ts` (modified) | Add `audio:pick-files` (pick only) and `audio:import-merged` (concat → build session). Refactor `importOneAudioFile` to use the shared helper. | above |
| `src/preload/index.ts` (modified) | Expose `pickFiles()` and `importMerged(paths, title)`. | — |
| `ImportManagerDialog.tsx` (modified) | Staging view: reorderable list + title field + merge/separate actions. | — |
| `useSessionManagement.ts` (modified) | Branch on file count; drive staging vs direct import; call the right IPC. | — |

## Data flow

```
N source files (read-only, untouched on disk)
  → [renderer] order them (default natural sort; user may drag)
  → [main] audio:import-merged(orderedPaths, title)
  → mergeAudioFiles → <dataDir>/audio/<sanitized title>/<sanitized title>.wav
  → session-from-wav: create 1 session
       category: "recording", modelName: "imported",
       startedAt: earliest source-file birthtime,
       title: user title, audioPath: sanitized dir name, durationSeconds
  → existing transcription pipeline
```

Folder naming reuses `sanitizeSessionDirName` (shared helper added in the prior
bugfix), so the on-disk folder matches the displayed title — consistent with the
rest of the app.

## Error handling

- ffmpeg concat failure (any segment unreadable/corrupt) → delete the session row
  and the session directory, then surface the error in the dialog. Same rollback
  pattern as `importOneAudioFile`.
- In the staging view, a source file that no longer exists or has an unsupported
  extension is flagged before merge; merge is disabled until the list is valid.
- Empty title → fall back to the first file's base name; if that sanitizes to
  nothing, fall back to a timestamp (same fallback as the download handler).

## Testing

- `merge.ts`: unit test concatenating two short generated WAVs → assert the
  output exists, is valid 16 kHz/mono/16-bit WAV, and its duration ≈ the sum of
  the inputs; assert order is honored (two distinguishable tones come out in the
  requested order). Requires ffmpeg (already a dev/runtime dependency, used by
  existing import tests).
- `session-from-wav.ts`: unit test session creation + duration calc + rollback on
  a thrown error (mirrors the existing `audio:import` rollback test).
- Handler: `audio:import-merged` builds exactly one session for N inputs and rolls
  back on ffmpeg failure (mock spawn).
- Renderer: staging list orders by natural sort by default and reorders on drag
  (reuse the drag pattern already in `HistoryPanel`).

## Success criteria

- Selecting ≥2 files on upload shows the staging view; reordering works; merging
  produces a single session whose audio is the segments back-to-back in order and
  whose duration ≈ the sum of segment durations.
- Selecting 1 file imports immediately, exactly as before.
- Choosing 「分别导入」 reproduces today's behavior (one session per file).
- Original source files on disk are unchanged.
