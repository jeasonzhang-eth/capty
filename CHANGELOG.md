# Changelog

All notable changes to Capty are documented in this file.

## [Unreleased]

### Fixed

- CI e2e (`history-session-management`) was failing because the inline session-rename control became a multi-line `<textarea>` while the test still targeted an `<input>`. Updated the selector and added a `session-rename-input-<id>` test id.

## [0.4.0] - 2026-06-17

### Changed

- VAD now uses the Silero v5 neural model (onnxruntime-web, bundled & offline) instead of a fixed energy threshold, eliminating steady-noise (e.g. fan) false positives. Falls back to the energy VAD with a notice banner if the model fails to load.
- Forced segment break during continuous speech lowered from ~30s to ~8s, so transcripts appear several times sooner when speaking without pauses (transcription remains segment-based: a chunk is sent to ASR on a ~1s silence pause or this ~8s cap).
- The recording meter is now driven by the VAD speech probability (0..1) instead of raw input volume, with a live numeric readout (`VAD 0.xx ● speech / ○ silence`) below it, so you can see what the VAD is actually detecting.
- yt-dlp download format relaxed from `ba` (audio-only) to `ba/b`, so videos that expose no audio-only format fall back to the best combined stream (audio is extracted downstream by ffmpeg anyway).

### Added

- yt-dlp / YouTube downloads now ask whether to keep the video. When you choose "保留视频" Capty downloads a merged mp4 (`bv*+ba/b`, `--merge-output-format mp4`) and saves it alongside the transcribed audio in the session folder; "仅音频" keeps the previous audio-only behavior. Mirrors the existing 视频号 keep-video prompt.
- Session list shows a source badge for downloaded sessions (YouTube / Bilibili / 视频号 / 小宇宙 / …), matching the Download manager's platform badges, so you can see at a glance where each audio came from. Sessions now persist a `source_url` (new nullable column + migration); the platform-detection helper was extracted to a shared `src/renderer/shared/platform.ts` reused by both the Download manager and the session list.
- Embedded YouTube login for downloads. Settings → General → "YouTube 登录" lets you sign into YouTube once in an in-app window (dedicated `persist:youtube` session partition); Capty then exports that partition's cookies to a Netscape `cookies.txt` at download time and passes `--cookies <file>` to yt-dlp — preferred over the browser-cookie source, more reliable than reading the system Chrome (unaffected by Chrome's app-bound cookie encryption) and works without Chrome installed. New `src/main/youtube/yt-auth.ts` (`openYoutubeLogin` / `hasYoutubeLogin` / `clearYoutubeLogin` / `exportYoutubeCookies` + a pure `cookiesToNetscape` serializer with unit tests) and `youtube:login` / `youtube:status` / `youtube:logout` IPC. Cookies stay local; nothing is uploaded.
- Optional yt-dlp JS-challenge solver for YouTube. YouTube now gates video formats behind a JS ("n") challenge — without solving it yt-dlp returns "Requested format is not available" (only storyboard images). Settings → General → "解 JS 挑战（YouTube）" toggle (default off) makes yt-dlp pass `--remote-components ejs:github`, fetching its official solver script and running it via a local JS runtime (deno). New `ytdlpSolveJsChallenges` config field; pure `ytdlpSolverArgs()` helper covered by unit tests. Opt-in because it executes a remote script.
- YouTube downloads can now authenticate via browser cookies. YouTube blocks anonymous yt-dlp requests with a "confirm you're not a bot" check; Settings → General now has a "YouTube 下载 Cookie" section to pick a browser (Chrome / Safari / Firefox / Edge / Brave) you're logged into YouTube with. When set, both the title fetch and the download pass `--cookies-from-browser <browser>` to yt-dlp. Defaults to off (anonymous, unchanged behavior). New `ytdlpCookiesFromBrowser` config field; pure `ytdlpCookieArgs()` helper covered by unit tests.
- Silero VAD implementation: bundled onnxruntime-web + Silero v5 model (ORT wasm copied into the renderer build, fully offline); a stateful model wrapper (`src/renderer/vad/silero.ts`, `process(window)` → speech probability, `reset()` clears recurrent state); a pure frame-count speech debouncer parameterized by frame thresholds so it works at any frame rate (`src/renderer/vad/debounce.ts`); `useVAD` rewritten to drive detection from the Silero model (512-sample windows via an ordered async inference queue) with an automatic energy-VAD fallback (`degraded` flag); recurrent VAD state reset at the start of each recording; and a dismissible banner when Silero fails to load. Covered by unit and hook tests.
- WeChat Channels (视频号) support — core modules for the upcoming "paste a 视频号 share link → download → transcribe" feature (`src/main/wechat/`):
  - `isaac.ts`: ISAAC64 stream cipher that decrypts the encrypted prefix (first 128 KiB) of a 视频号 video given its `decodeKey`. Verified against the Go reference (wx_channels_download) with golden keystream vectors.
  - `resolver.ts`: resolves a `/sph/<code>` share link into a downloadable `videoUrl` + `decodeKey` via Tencent Yuanbao's parse API (using the user's own yuanbao login) followed by 视频号 `get_feed_info`.
  - `downloader.ts`: downloads the video and decrypts its prefix, producing a playable MP4.
  - `yuanbao-auth.ts`: one-time Tencent Yuanbao login in an embedded window (dedicated `persist:yuanbao` session partition); resolver requests reuse that cookie jar, so no other app's credentials are touched. Yuanbao's device/fingerprint request headers (`x-hy*`, `x-device-id`, `t-userid`, `sec-ch-ua*`) are sniffed live from the user's own yuanbao traffic via `webRequest` and replayed — never hardcoded — to make resolve requests look like a normal browser (not required, but lowers rate-limit risk); falls back to cookie-only when none are captured.
- 视频号 links in the Download Audio manager: paste a `weixin.qq.com/sph/...` share link and Capty resolves → downloads → (optionally keeps the video) → transcribes it as a new session, reusing the existing download/convert/session pipeline. On first use it opens a window to log into Tencent Yuanbao. The download manager shows a "视频号" badge for these links.
- Settings → General: a "视频号下载（腾讯元宝登录）" section showing the yuanbao login status with a "清除登录" button to sign out / switch accounts (clears the `persist:yuanbao` session).
- Merge multiple audio files into one session at upload time. Selecting or dropping two or more files opens a staging view in the upload dialog where you can reorder the segments (default natural filename sort; drag or ↑/↓ to adjust), remove unwanted ones (✕), and then either "合并为一个 session" (ffmpeg concatenates them in order into one transcribed session) or "分别导入" (the previous one-session-per-file behavior). Single-file uploads import immediately as before. Useful for recorders that auto-split long recordings (e.g. DJI's 30-minute segments). Implemented as `src/main/audio/merge.ts` (single-pass ffmpeg concat) + a shared `createSessionFromWav` helper, with `audio:pick-files` / `audio:import-merged` IPC; covered by unit tests for the merge command, the session helper, and the handler.

### Fixed

- Silero VAD detected no speech at all (every window scored ~0, so segments only ever flushed on the forced cap / recording stop). Root cause: the Silero v5 ONNX model requires the previous chunk's last 64 samples to be prepended as context (576-sample input), which we weren't doing — so the model saw a discontinuity and returned ~0 for everything, including clear speech. `silero.ts` now maintains and prepends the 64-sample context. Added a regression test that runs a real speech clip through the wrapper and asserts it scores high (the prior tests only covered silence).
- Silero VAD failed to load (degraded banner shown, fell back to energy VAD) due to two onnxruntime-web + Vite issues: (1) Vite's dependency pre-bundling rewrote ORT's runtime wasm/.mjs glue paths into `.vite/deps` — fixed by excluding `onnxruntime-web` from the renderer's `optimizeDeps`; (2) a relative `wasmPaths` ("./ort/") resolved against the ORT module dir (`node_modules/.../dist/`) and 404'd — fixed by resolving the wasm dir to an absolute URL via `document.baseURI`, which works in both dev and the packaged app.
- Downloaded sessions (视频号 / 小宇宙 / yt-dlp) now name their on-disk audio folder after the (sanitized) session title instead of a bare timestamp, so the folder on disk matches the name shown in the app — the same convention recordings get after rename. Extracted the shared `sanitizeSessionDirName` helper (`src/main/shared/session-name.ts`) used by both the rename and download paths; covered by `tests/main/shared/session-name.test.ts`.
- Session inline rename: the title field is now a multi-line `<textarea>` (Enter confirms, Shift+Enter inserts a newline) and the row is no longer `draggable` while renaming, so you can drag-select text in the title instead of accidentally starting a session move.
- Audio import (upload) dialog now closes on the ESC key.
- Session right-click context menu now opens at a consistent anchored position — just to the right of the sidebar, aligned with the clicked row's top — instead of following the mouse cursor and covering the list, and no longer gets clipped by the window edge: it measures itself and flips/clamps into the viewport (and scrolls if taller than the window), so items like the "MOVE TO" categories stay reachable near the bottom.
- Starting a recording while another session is open now resets the right-hand Summary/Questions panel (and translations) to the new recording session instead of leaving the previous session's summary on screen. The transcript pane was already cleared; the summary state is now cleared alongside it. (Note: live transcript lines still appear per segment — i.e. after each speech pause — since transcription is segment-based, not streaming.)

## [0.3.1] - 2026-06-07

### Changed

- Sidecar API: every endpoint now declares typed Pydantic response models (HealthResponse, TranscriptionResponse, VoiceListResponse, …) with OpenAPI metadata — tags, summaries, operation IDs, declared error responses, and documented binary/NDJSON payloads. New `--openapi-out <file|->` CLI flag dumps the OpenAPI 3.1 schema and exits.

### Fixed

- Sidecar `/health` and `/tts/status` returned 500 when no model was loaded: `model_id` is `None` while the new strict response models declare `model: str`. Both now coerce to the empty-string convention; covered by `test_health` and `test_tts_status_unloaded`.

### Removed

- Stale root `pyproject.toml` (empty placeholder from an earlier scaffold; the real one lives in `sidecar/pyproject.toml`).

### Docs

- Add speaker-diarization design + plan (`docs/superpowers/specs/2026-04-19-sidecar-speaker-diarization-design.md`, approved): ASR (Qwen/Whisper/Parakeet) + pyannote speaker turns + word-to-speaker reconciliation returning `segments[{start,end,speaker,text}]`. Not implemented yet.

## [0.3.0] - 2026-06-07

### Added

- Transcript export menu (middle column): new "Copy Markdown to Clipboard" item that copies the Markdown export of the current session directly to the clipboard, alongside the existing TXT/SRT/Markdown file exports.
- Keyboard shortcut: Cmd/Ctrl+, opens the Settings modal (standard macOS preferences shortcut).
- Audio import now supports selecting multiple files at once. Files are imported sequentially (one ffmpeg conversion at a time), each into its own session; per-file failures are collected without aborting the rest, and the first imported session is selected afterwards.
- Session context menu: new "Edit Created Time" item opening a single-field dialog to change a session's recorded-at time (keeps the title untouched; reuses the existing edit-session IPC which also shifts ended_at by the session duration).
- Upload manager panel (mirrors the Download Audio dialog): clicking Upload Audio now opens a panel with a NotebookLM-style dashed drop zone on top and the upload history below. Audio files can be dragged into the zone (paths resolved via `webUtils.getPathForFile`, validated against audio extensions in the main process) or picked by clicking the zone. Each record shows per-file status (waiting/converting/imported/failed) with inline error messages; completed records are clickable to jump to their session. Records accumulate across batches within the app session. Driven by new `audio:import-progress` IPC events.

### Fixed

- Imported audio sessions are now named after the source file instead of its creation time. Creation-time naming produced identical names when files shared a birthtime, and discarded the original, meaningful filenames. The session directory uses a sanitized form (illegal path characters replaced, `-N` suffix on collision), the session title keeps the original name (`(N)` suffix on collision), and the file birthtime is still recorded as the session start time.
- Settings → Default Models: model dropdowns (Summary/Rapid/Translate) were occluded by the cards below them — `backdrop-filter` on each card creates a stacking context, so the menu's z-index could not escape and later sibling cards painted on top. The dropdown is now rendered through a portal to `document.body` with fixed positioning, flips upward when there is not enough space below, and closes on outer scroll/resize to stay anchored to its trigger.

### Changed

- Imported local audio files now default to the "个人录音" (recording) category instead of "下载内容" (download). The startup migration that re-categorizes download sessions no longer matches `model_name = 'imported'` — it previously ran on every launch and would have flipped imported sessions back to download.

### Docs

- README: embed product screenshots (recording, transcript, summary, questions, translation, replay, import, download, sessions, microphone, export, settings) under `assets/` for both English and Chinese READMEs.
- README: fix broken banner reference (`docs/assets/banner.png` → `assets/banner.png`).

## [0.2.0] - 2026-04-18

### Docs

- Add design doc and brainstorming transcript for sidecar packaging refactor (uv-based build + notarization scaffold) under `docs/superpowers/specs/`.
- `.gitignore`: ignore `sidecar/build/` — PyInstaller's intermediate `build/` directory produced alongside `dist/` during `npm run build:sidecar`.
- Add `docs/notarization-setup.md` — activation guide for the dormant macOS notarization hook.

### Security

- Restore `BLOCKED_KEYS` in `config:set` IPC after the 04-16 hooks refactor silently dropped them. Re-blocks `dataDir`, `hfMirrorUrl`, `sidecar`, `modelRegistryUrl` from renderer-initiated writes (would have enabled SSRF via `hfMirrorUrl` and arbitrary directory writes via `dataDir`).
- Add dedicated `config:set-hf-mirror` IPC taking a boolean toggle, so the renderer cannot inject arbitrary URLs into `hfMirrorUrl` (prevents SSRF in model-download `fetch()` calls).
- Replace `execSync` with `execFileSync` in `findSidecarPidsOnPort` and validate `port` is an integer in `[1, 65535]`. Prevents shell injection via a malicious `config.sidecar.port` string.
- Add path-containment guard to `app:change-data-dir` and `app:init-data-dir`: reject non-absolute paths and anything outside `os.homedir()`. Prevents renderer-driven arbitrary directory writes (e.g. `/`, `/etc/capty`).
- Sidecar `_validate_file_path`: switch `startswith()` prefix check to `Path.relative_to()`. The prior string-prefix check was bypassable via sibling directories sharing a common prefix (e.g. `/data/...` vs `/data-evil/outside.wav`). Covered by `tests/test_server.py::test_decode_audio_rejects_sibling_prefix_path`.

### Changed

- `electron-builder.yml`: register `build/notarize.js` as `afterSign` hook; set `hardenedRuntime: true`, `gatekeeperAssess: false`, and `notarize: false` on the `mac` target. Behavior is unchanged today (hook is a no-op without Apple credentials); ready for notarization the day those env vars are set.
- Sidecar: declare `pyinstaller>=6.0` in `sidecar/pyproject.toml` dev extra so `uv sync --extra dev` installs it reproducibly (previously installed ad-hoc via `pip install pyinstaller` on every build).
- Sidecar: rewrite `sidecar/build.sh` to use `uv sync --extra dev` + `uv run pyinstaller`. Removes manual `source .venv/bin/activate` and per-build `pip install pyinstaller`; builds are now reproducible from `uv.lock`.
- Sidecar: move `import mlx.core` out of module scope into lazy helpers (`_clear_mlx_cache`, `_get_mlx_core`, `_ensure_mlx_initialized`). Keeps import-time side-effects off CI / non-Apple environments; MLX cache limit still applied on first real use.
- Renderer: centralize `window.capty` typing in `src/renderer/global.d.ts` by inferring from `typeof api` in `preload/index.ts`. Drops the 160-line hand-written interface that lived inline at the top of `useSession.ts`, eliminating drift between preload and renderer.
- Store (`appStore.ts`): accept `readonly` array inputs for setters and defensively copy with spread before storing. Prevents callers from retaining aliases to mutable internal state.

### Added

- Add `build/notarize.js` afterSign hook. Inert today (no-op unless `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` env vars are set); activates automatically once an Apple Developer account is provisioned.
- Cancelable HTTP audio downloads: `httpDownload()` now accepts an `AbortSignal` and writes to disk via `fs.write` (streaming, no in-memory chunk buffer). Cancel path aborts the in-flight fetch instead of letting it run to completion.
- Download state/task unit tests under `tests/main/download/`: `download-state.test.ts`, `model-download-task.test.ts`, `download-manager.test.ts` (11 new tests total).
- Add `@electron/notarize` dev dependency as the engine for a future macOS notarization workflow (currently inert — see `docs/notarization-setup.md`).

### Fixed

- Audio import (`audio:import-file`): session row was being created BEFORE the WAV conversion ran, leaving an empty/incomplete session in the DB if ffmpeg failed. Now creates the session only after conversion succeeds; if any step after session creation fails, the partial session is deleted. Paired with new test coverage in `tests/main/handlers/audio-handlers.test.ts`.

### Added

- Settings → Data directory: async change flow with in-progress spinner and explicit success / error message. Now uses the dedicated `app:change-data-dir` IPC (which validates the path and migrates contents) instead of writing `config.dataDir` directly. Error from the main process is surfaced verbatim to the user.
- `ModelCard` now receives its `category` so the Settings model market can render the correct per-category badge.

### Changed

- `useTranscription`: slice the merged `Int16Array` with `view.buffer.slice(byteOffset, byteOffset + byteLength)` before handing it to the ASR IPC. Guards against `SharedArrayBuffer` backing and avoids sending the full allocation when the view is a subrange.
- Various component prop threading so `App.tsx` can expose data-dir change UX state to `SettingsModal`.

### Test

- Expand unit coverage: `database.test.ts` +8 tests (reorder, translations, summaries, delete, migration, download CRUD); `sidecar-handlers.test.ts` +1 test (port change reflected on subsequent calls); new `tests/preload/index.test.ts` covering the preload IPC bridge surface.
- Add 7 E2E smoke specs under `tests/e2e/smoke/`: download-manager-dialog, download-manager-flow, history-session-management, playback-settings-behavior, settings-persistence, setup-persistence, summary-transcript-behavior. Extend `mock-llm-server.ts` to stream richer SSE shapes needed by these specs.
- New sidecar test `sidecar/tests/test_model_registry.py`. Add top-level `pyproject.toml` so `pytest` can run from repo root.
- `database.test.ts` `migrateUtcToLocal` assertion: make TZ-aware. In UTC the local-time path equals the original path, so no filesystem rename is recorded — CI (runs in UTC) used to fail on the stale expectation of a single-entry rename array.

### Security

- `config:set`: replace blanket BLOCKED_KEYS for `hfMirrorUrl` / `sidecar` with per-value sanitizers. `hfMirrorUrl` must parse as an `https:` URL (blocks `javascript:`, `file:`, `http:`, data:, etc.); `sidecar` is shape-checked to `{autoStart?: boolean, port?: int[1,65535]}` and unknown sub-fields are dropped. `dataDir` and `modelRegistryUrl` stay hard-blocked since they have dedicated IPCs / no legitimate writer.
- `app:change-data-dir` / `app:init-data-dir`: replace home-directory containment with a system-directory blacklist (`/etc`, `/usr`, `/bin`, `/sbin`, `/boot`, `/dev`, `/proc`, `/sys`, `/root`, `/System`, `/Library`, and `/`). The home-only check rejected legitimate paths like `/tmp/*` on Linux and `/Volumes/*` on macOS.

## 2026-04-16

### Changed

- Refactor: extract `useAudioDownloads` hook — moves audio download state, handlers, and 3 effect listeners from App.tsx into `src/renderer/hooks/useAudioDownloads.ts` (~180 lines). App.tsx reduced from 2564 → 2413 lines. Part 1 of 7 in the App.tsx hook-extraction refactor.
- Refactor: extract `useSettings` hook — moves needsSetup, sidecar start/stop, device change, layout/zoom/hfMirror state + handlers + 3 effects + init into `src/renderer/hooks/useSettings.ts` (~217 lines). App.tsx: 2413 → 2196 lines. Part 2/7.
- Refactor: extract `useModelDownloads` hook — moves downloads state, ASR derived values, 8 model download handlers, 2 effect listeners + initModels into `src/renderer/hooks/useModelDownloads.ts` (~256 lines). App.tsx: 2196 → 1940 lines. Part 3/7.
- Refactor: extract `useTtsSettings` hook — moves TTS provider/model/voice state, 7 handlers, 2 effects + initTts into `src/renderer/hooks/useTtsSettings.ts` (~373 lines). App.tsx: 1940 → 1599 lines. Part 4/7.
- Refactor: extract `useSummary` hook — moves LLM providers, summary generation/streaming state, prompt types, AI rename, 9 handlers, 2 effects + initFromConfig into `src/renderer/hooks/useSummary.ts` (~383 lines). App.tsx: 1599 → 1352 lines. Part 5/7.
- Refactor: extract `useTranslation` hook — moves translation state, 5 handlers, model validation effect + initFromConfig into `src/renderer/hooks/useTranslation.ts` (~299 lines). App.tsx: 1352 → 1151 lines (-201). Part 6/7.
- Refactor: extract `useSessionManagement` hook — moves recording flow, session CRUD, category management, regeneration, 18 handlers + initFromConfig into `src/renderer/hooks/useSessionManagement.ts` (~740 lines). Init effect slimmed from 271 to 15 lines. App.tsx: 1151 → 608 lines (-543). Part 7/7 — **refactoring complete**. Total: 2564 → 608 lines (-76%).

## 2026-04-15

### Security

- S1: add column name whitelist to `updateDownload` in database.ts to prevent SQL injection
- S2: add `assertPathWithin` validation to `audio:get-duration` handler
- S3: restrict `shell.openExternal` to http/https URLs only (block javascript:/file:// schemes)
- S4: block `dataDir`, `hfMirrorUrl`, `modelRegistryUrl` from being set via `config:set` IPC

### Fixed

- Fix summary streaming leaking across sessions: switching session during LLM generation no longer shows the old session's streaming content in the new session's SummaryPanel. Covered by E2E test `tests/e2e/smoke/summary-session-switch.spec.ts` which uses a local mock SSE server to exercise the full flow

- B1: fix stop-recording segment loss — use ref-captured sessionId so late ASR callbacks save to the correct session
- B2: `gracefulDisconnect` now drains ALL in-flight transcription requests before resolving (not just its own)
- B3: add null-safety (`?.`) for yt-dlp `stdout`/`stderr` access to prevent TypeError crashes

## 2026-04-14

### Changed

- fix: run vitest via Electron's Node runtime (`ELECTRON_RUN_AS_NODE`) to eliminate native module rebuild cycle

## 2026-04-13

### Changed

- Refactor: extract session-handlers module (14 handlers)
- Refactor: extract sidecar-handlers module (4 handlers + lifecycle state)
- Refactor: extract model-handlers module (14 handlers + model management helpers)
- Refactor: extract llm-handlers module (11 handlers: llm:fetch-models, llm:test, llm:summarize, llm:translate, llm:generate-title, summary:list, summary:delete, translation:list, translation:save, prompt-types:list, prompt-types:save)
- Refactor: extract audio-download-handlers module (5 handlers: audio:download-start, audio:download-list, audio:download-remove, audio:download-cancel, audio:download-retry) with TDD (8 unit tests)
- Refactor: extract config-handlers module (9 handlers)
- Refactor: introducing handler module structure (work in progress)
- Refactor: extract `assertPathWithin` to `src/main/shared/path.ts` with prefix-bypass security fix (S5)
- Refactor: extract `spawn` and `getExtendedEnv` to `src/main/shared/spawn.ts` (TDD, 2 unit tests)
- Refactor: extract asr-handlers module (4 handlers: `asr:transcribe`, `asr:fetch-models`, `asr:test`, `audio:transcribe-file`)
- Refactor: extract tts-handlers module (7 handlers)
- Refactor: extract audio-handlers module (12 handlers) to `src/main/handlers/audio-handlers.ts` (TDD, 8 unit tests)
- Refactor: extract export-handlers module (5 handlers)
- Refactor: replace `ipc-handlers.ts` god module (3366 lines) with 49-line delegator that imports from 10 focused handler modules. Net: -3317 lines from one file. All 84 IPC channels preserved, 139 unit tests pass, build verified.

- test: add Playwright fixtures for seeded/fresh Electron launches
- test: add E2E helpers for temp userData seeding
- chore: add Playwright config for Electron E2E
- chore: add tsconfig for E2E tests
- chore: ignore Playwright artifacts

### Added

- E2E smoke test: app launch (window visible, title check)
- E2E test isolation: main process honors `ELECTRON_USER_DATA_DIR_OVERRIDE` env var
- E2E smoke test: SetupWizard visible on first run (no dataDir configured)
- Add `data-testid="setup-wizard"` to SetupWizard root element for stable E2E selector
- E2E smoke test: main UI panels (ControlBar, HistoryPanel, RecordingControls)
- Stable `data-testid` attributes on main UI components
- E2E smoke test: settings modal open and tab switching
- E2E testing guide (`tests/e2e/README.md`) — architecture, fixture docs, writing new tests
- CI job `e2e` runs Playwright suite on every PR (after `check` job passes)
- `vitest.config.ts` excludes `tests/e2e/**` so E2E specs don't bleed into unit test run

## 2026-04-12

- fix: certifi.where() crash in packaged sidecar — add certifi to PyInstaller collect list and runtime hook for SSL_CERT_FILE
- chore: bump version to 0.1.1

## 2026-04-11

- docs: add missing features to README — playback, session management, TTS read-aloud (EN + ZH)

## 2026-04-10

- docs: rewrite README in English with link to Chinese version (README.zh-CN.md)
- docs: add README.zh-CN.md (Chinese README)
- chore: add MIT License

## 2026-04-08

- ci: add GitHub Actions CI/CD — PR checks (build + test) and tag-triggered release (sidecar + DMG packaging)
- fix: remove obsolete sidecar test, fix brittle IPC channel count assertion and stale sidecar URL expectation

## 2026-04-07

- feat: add session metadata editor — right-click "Edit Info" on completed sessions to edit title and recorded time (started_at), auto-computes ended_at

## 2026-04-06

- feat: add dependency check step to SetupWizard — detect Homebrew, ffmpeg, yt-dlp with version info, show install commands for missing tools
- fix: improve yt-dlp not found error message — show step-by-step Homebrew + yt-dlp install instructions, strip internal IPC method names from user-facing errors

## 2026-04-05

- fix: remove default models from DeepSeek preset provider — empty models list avoids misleading users into thinking no API key is needed
- chore: remove unused Kokoro-only deps from sidecar build (misaki, spacy, thinc, jieba, pypinyin, cn2an, num2words) — eliminates SyntaxWarnings and reduces binary size
- fix: yt-dlp/ffmpeg not found in packaged DMG — extend PATH with Homebrew dirs (`/opt/homebrew/bin`, `/usr/local/bin`) for all spawned child processes
- fix: sidecar ASR test resolves local model path from config (was sending empty model → 400 "No ASR model loaded")
- fix: ASR/TTS test handlers return `{ success, error }` instead of throwing — no more Electron console spam
- fix: early-return "No model selected" when no ASR/TTS model is configured instead of sending request
- fix: remove browser focus outline globally — covers ESC-to-close and all keyboard/mouse interactions (Electron desktop app, no Tab-navigation needed)
- fix: prevent duplicate sidecar spawns from concurrent start calls (React StrictMode double-invoke)
- fix: sidecar start recovers from port conflict by reusing existing instance instead of failing
- fix: sidecar start errors no longer spam Electron console — return `{ ok, error }` instead of throwing from IPC handler
- fix: all modals/dialogs/popovers now close on ESC key (Settings, Downloads, FetchModels, SidecarPopover, TranslateMenu, ExportMenus, delete confirmations)
- fix: remember last active Settings tab across open/close (no longer resets to General every time)
- refactor: rename Settings tab IDs to match labels (`speech` → `asr`, `language-models` → `llm`)
- feat: click ASR/TTS row in SidecarPopover to jump to corresponding Settings tab
- fix: hide "Click to manage sidecar" tooltip when popover is already open
- fix: SidecarPopover shows "No model" instead of "Ready" when no ASR/TTS model is selected
- refactor: move HuggingFace Mirror URL config from ASR/TTS model markets to General tab (single source of truth)
- fix: suppress noisy transformers warnings (tokenizer model_type mismatch, Mistral regex) during TTS model loading
- fix: allow deleting the last/active model in ASR/TTS provider (delete button no longer hidden for selected model)
- fix: sidecar TTS uses local models directory before falling back to HuggingFace download (no more re-fetching already-downloaded models)
- fix: increase sidecar TTS test timeout from 30s to 120s (model lazy-load on first request can take 60s+)
- refactor: extract shared useProviderManagement hook and ProviderCard component from ASR/TTS tabs (~170 fewer lines)
- style: unify ASR/TTS provider UI — delete button in header (x), inline test results, secondary+accent Use button
- fix: remove hardcoded ASR fallback file list in model download — retry HF API 3 times with exponential backoff instead
- fix: skip retry for deterministic HTTP 4xx errors (404/403/401/410) during file download
- fix: resolve AbortSignal MaxListenersExceededWarning by using per-file AbortController instead of per-retry listener registration
- fix: add StrictMode race protection to sidecar health polling useEffect
- refactor: inline Model Market into ASR/TTS sidecar provider expand area (no more separate modal popup)
- fix: TTS search results incorrectly showing "ASR" badge — add category-aware TypeTag with TTS-specific type inference
- feat: add model type badges for Qwen TTS, Spark TTS, OuteTTS, Chatterbox, Voxtral
- fix: update recommended TTS models list (6 models: Qwen3-TTS 0.6B/1.7B variants + Spark-TTS)
- refactor: LLM Provider uses expand/collapse mode with chevron (matches ASR/TTS pattern), remove Edit button
- fix: LLM Test button always visible, disabled when no API key or no models (with tooltip hints)
- fix: LLM Test uses first model from models list instead of legacy `provider.model`
- style: unify Test button styles across ASR/TTS/LLM tabs (color: text-secondary, disabled opacity: 0.4)

## 2026-04-04

- refactor: unify ASR/TTS test logic — sidecar and external providers use the same real test (sine wave for ASR, "Hello" for TTS) instead of health-check shortcut
- fix: disable Test button when no model is loaded for sidecar ASR/TTS providers
- refactor: remove redundant "Engine URL / Port" display from sidecar ASR provider settings
- feat: auto-start sidecar engine on app launch (configurable via Settings → General)
- refactor: decouple sidecar auto-start from ASR provider list — sidecar is an independent engine
- refactor: remove sidecar toggle from SetupWizard to simplify onboarding
- refactor: replace ControlBar ASR/TTS status indicators with unified Sidecar popover (toggle, ASR/TTS status, port)
- fix: sidecar popover hidden behind content panels (z-index)
- style: redesign sidecar popover to compact macOS-style panel (180px, smaller toggle, tighter rows)
- fix: popover left edge now aligns with indicator dot; click indicator to toggle open/close
- fix: keep sidecar popover open during engine startup with spinner animation
- fix: clicking inside sidecar popover no longer closes it (stop event propagation)
- fix: TTS status updates immediately after sidecar startup instead of waiting for 10s poll
- refactor: extract `SidecarConfig { port, autoStart }` as independent config block — single source of truth for sidecar process management
- refactor: decouple all IPC handlers (sidecar lifecycle + TTS) from provider list for URL resolution — use `getSidecarBaseUrl()` helper with config cache
- refactor: move `sidecarPort` and `sidecarStarting` state from App component to appStore for shared access
- refactor: unconditional sidecar health polling (no longer gated by ASR provider list)
- refactor: replace sidecar ASR provider Base URL input with read-only port display in Settings → Speech tab
- refactor: simplify `audio:decode-file` IPC signature — remove redundant `sidecarBaseUrl` parameter
- feat: auto-migrate old `autoStartSidecar` config to new `sidecar` config block
- fix: sidecar process not killed on Cmd+Q — add `process.on('exit')` SIGKILL fallback to prevent orphan processes
- fix: stopping sidecar now kills orphan sidecar processes on the port (verified by process name, won't kill other services)
- fix: sidecar health-check and start now verify `status: "ok"` in response to avoid mistaking other services for sidecar
- fix: sidecar start reports clear error when port is occupied by another service

## 2026-04-03

- feat: add local sidecar engine toggle to SetupWizard with description
- chore: remove "Start command" hint from SettingsModal sidecar section
- fix: defer DB initialization until dataDir is configured via lazy proxy; guard mount effects
- fix: increase default window size from 900×670 to 1200×800 for better content display
- feat: redesign SetupWizard as 2-step flow (Welcome + LLM API Key config)
- feat: add default data directory (~/Documents/Capty) with change option
- feat: add HuggingFace China mirror toggle in setup wizard
- feat: add LLM API Key configuration step (DeepSeek, OpenRouter, OpenAI) in setup wizard
- fix: re-run init after SetupWizard completes so providers load on fresh install
- chore: trim PyInstaller spec — exclude torch, pillow, phonemizer, sounddevice and other unused deps
- fix: config:set now merges instead of replacing, preserving default providers on fresh install
- feat: add default preset LLM providers (DeepSeek, OpenAI, OpenRouter) for fresh installs
- fix: improve sidecar spawn error handling with early-exit detection and descriptive messages
- fix: use __dirname-based project root for dev mode sidecar path resolution
- feat: add macOS DMG packaging with electron-builder (arm64 only)
- feat: add PyInstaller spec and build script for standalone sidecar binary
- feat: add npm scripts for build:sidecar, pack, dist, dist:all
- feat: support packaged sidecar path resolution in production builds
- feat: add macOS entitlements for microphone access

## 2026-04-02

- fix: category reorder not persisting across app restarts
- fix: sidecar process auto-stopping due to unconsumed stdout pipe buffer
- fix: default all session categories to collapsed on app open
- feat: add drag-and-drop reordering for session categories
- feat: add sidecar process start/stop control from ControlBar
- feat: add session category folders for sidebar grouping (download / recording / meeting / phone)
- feat: add drag-and-drop for session reordering and cross-category move
- feat: add custom session categories (create/delete) with persistent config
- fix: session deletion failing with FOREIGN KEY constraint error

## 2026-04-01

- refactor(sidecar): implement EnginePool for concurrent ASR+TTS

## 2026-03-31

- feat: add audio download manager (yt-dlp + Xiaoyuzhou native support)
- feat: per-tab independent summary generation
- feat: enable chunked WAV streaming for external TTS providers
- feat: adopt Mistral format for /v1/audio/voices
- fix: unify TTS API to JSON format and fix double /v1/ URL issue
- fix: show TTS provider, model, and voice info in SummaryCard footer

## 2026-03-30

- feat: per-session concurrent translation with independent progress
- feat: add floating scroll-to-top/bottom buttons in TranscriptArea
- feat: add translate model selector in Translate dropdown menu
- feat: add LLM multi-model support (models[] per provider, FetchModelsDialog, UnifiedModelSelector)
- perf: use 3-way concurrent translation for faster segment processing
- fix: persist translation language and show/hide preference across restarts

## 2026-03-29

- feat: add transcript translation with LLM provider (per-segment, persistent)
- feat: add SummaryCard export menu with 6 export options
- feat: crossfade transition between recording controls and playback bar
- feat: redesign PlaybackBar with two-row layout
- feat: double-click session to toggle playback
- feat: replace hand-drawn icons with lucide-react library
- fix: prevent scroll jumping during simultaneous recording and playback

## 2026-03-28

- feat: add AI rename session title with customizable prompt
- feat: add Default Models settings tab for centralized model management
- feat: add streaming TTS playback for sidecar provider
- feat: detect and flag unsupported ASR model types
- feat: show compatibility badges in HuggingFace search results
- refactor: decouple audio import from transcription
- fix: security improvements (path validation, sandbox, XSS sanitization)
- fix: resolve stale closure bugs in audio capture, player, VAD, and resize

## 2026-03-27

- feat: refactor download manager with concurrent downloads, pause/resume/cancel
- feat: add TTS provider health check and status indicator in ControlBar
- feat: split models directory (asr/tts) and add TTS provider management
- feat: merge Models and Download Models into unified Model Market (Obsidian-style)
- feat: add TTS read-aloud for summary cards
- refactor: migrate sidecar ASR backend to unified mlx-audio library
- refactor: disk-driven model management, remove static registries
- fix: session time stored as UTC, duplicate segment timestamps

## 2026-03-26

- feat: redesign full UI with "Studio Noir" theme
- feat: redesign Settings Modal with macOS System Settings style
- feat: stream audio to disk during recording for crash safety
- feat: add streaming LLM output to SummaryPanel
- feat: decouple sidecar + add external ASR server support
- feat: add OpenAI-compatible /v1/audio/transcriptions to sidecar
- refactor: unify ASR backend into provider list architecture
- refactor: remove WebSocket, unify transcription to HTTP-only
- fix: use local time instead of UTC for all timestamps (with migration)

## 2026-03-25

- feat: add LLM summarization with markdown rendering and SummaryPanel tabs
- feat: integrate wavesurfer.js waveform player in PlaybackBar
- feat: integrate react-lrc for professional lyrics-style subtitle sync
- feat: group history sessions by date with collapsible sections
- feat: add session rename and enhanced playback controls
- feat: persist zoom level and panel widths across restarts
- fix: improve transcription latency with better VAD and audio chunking

## 2026-03-24

- feat: initial release — Electron + React + TypeScript + Python ASR sidecar
- feat: real-time recording transcription with VAD
- feat: SQLite session/segment storage, audio file management
- feat: export to TXT / SRT / Markdown
- feat: model marketplace with HuggingFace search and download
- feat: regenerate subtitles from saved audio
- feat: persist microphone selection across restarts
- feat: Settings modal with data dir and model management
