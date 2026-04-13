# Changelog

All notable changes to Capty are documented in this file.

## 2026-04-13

### Changed

- Refactor: extract session-handlers module (14 handlers)
- Refactor: extract sidecar-handlers module (4 handlers + lifecycle state)
- Refactor: extract model-handlers module (14 handlers + model management helpers)
- Refactor: extract llm-handlers module (11 handlers: llm:fetch-models, llm:test, llm:summarize, llm:translate, llm:generate-title, summary:list, summary:delete, translation:list, translation:save, prompt-types:list, prompt-types:save)
- Refactor: introducing handler module structure (work in progress)
- Refactor: extract `assertPathWithin` to `src/main/shared/path.ts` with prefix-bypass security fix (S5)
- Refactor: extract `spawn` and `getExtendedEnv` to `src/main/shared/spawn.ts` (TDD, 2 unit tests)
- Refactor: extract asr-handlers module (4 handlers: `asr:transcribe`, `asr:fetch-models`, `asr:test`, `audio:transcribe-file`)

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
