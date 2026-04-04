# Changelog

All notable changes to Capty are documented in this file.

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
