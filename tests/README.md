# Capty Test Suite

## Overview

| Type | Framework | Files | Tests | Command |
|------|-----------|-------|-------|---------|
| Unit / Integration | Vitest | 17 | 139 | `npm run test` |
| E2E (Electron) | Playwright | 4 | 7 | `npm run build && npx playwright test` |

---

## Unit / Integration Tests

### tests/main/shared/path.test.ts — Path Security (5 tests)

| Test | Description |
|------|-------------|
| allows path inside base | Valid subpath does not throw |
| allows the base path itself | Exact base path does not throw |
| rejects path outside base | Path outside base throws error |
| rejects path that uses prefix bypass | `baseDir-evil/file` is rejected (security fix S5) |
| rejects path with .. traversal | `../../etc/passwd` style traversal is rejected |

### tests/main/shared/spawn.test.ts — Spawn Helpers (2 tests)

| Test | Description |
|------|-------------|
| returns object with PATH including standard binary dirs | Extended env includes `/usr/local/bin` etc. |
| preserves existing PATH from process.env | Original PATH segments are all preserved |

### tests/main/audio-files.test.ts — Audio File Operations (5 tests)

| Test | Description |
|------|-------------|
| getSessionDir returns correct path | Session directory path is constructed correctly |
| saveSegmentAudio writes WAV file to segments directory | Segment audio saved to correct location |
| saveFullAudio writes WAV file as full.wav | Full recording saved as `full.wav` |
| deleteSessionAudio removes entire session directory | Session audio directory is cleaned up |
| pcmToWav wraps PCM in valid WAV header | Raw PCM data gets a valid WAV header |

### tests/main/config.test.ts — Configuration (3 tests)

| Test | Description |
|------|-------------|
| returns default config when no file exists | Missing config file returns defaults |
| writes and reads config | Config round-trip works |
| getDataDir returns configured path | Data directory path is read correctly |

### tests/main/database.test.ts — SQLite Database (5 tests)

| Test | Description |
|------|-------------|
| creates tables on init | All tables exist after `createDatabase()` |
| creates and retrieves a session | Session CRUD works |
| adds segments to a session | Segment insert + query works |
| lists sessions ordered by most recent | Sessions sorted by `updated_at` desc |
| updates session status | Status field update persists |

### tests/main/export.test.ts — Export Formatting (6 tests)

| Test | Description |
|------|-------------|
| formats seconds to SRT timecode | `90.5` → `00:01:30,500` |
| formats seconds to simple timecode | `90.5` → `00:01:30` |
| exports plain text without timestamps | TXT export, no timestamps |
| exports plain text with timestamps | TXT export with `[HH:MM:SS]` prefixes |
| exports valid SRT format | Standard SRT subtitle format |
| exports markdown with title and timestamps | Markdown with `##` heading and timestamps |

### tests/main/ipc-handlers.test.ts — Integration Smoke Test (13 tests)

| Test | Description |
|------|-------------|
| registers all expected IPC channels | All 84 channels are registered |
| session:create | Creates session, returns id |
| session:list | Lists all sessions |
| session:get | Gets session by id |
| session:update | Updates session fields |
| segment:add | Adds segment, returns id |
| config:get | Returns app config |
| config:set | Writes config |
| sidecar:get-url | Returns sidecar URL |
| models:list | Reads models from local registry |
| app:get-data-dir | Returns data directory |
| app:select-directory | Returns selected directory / null on cancel |

---

## Handler Module Tests (Phase 2 Refactor)

### tests/main/handlers/session-handlers.test.ts — Session CRUD (6 tests)

| Test | Description |
|------|-------------|
| registers all 14 session channels | All session/segment/category channels registered |
| session:create creates a session | Insert returns valid id |
| session:list returns created session | Query after insert works |
| session:get returns a session by id | Single-row query works |
| session:delete removes the session | Delete + verify gone |
| segment:add then segment:list round-trip | Insert segment then query it back |

### tests/main/handlers/sidecar-handlers.test.ts — Sidecar Lifecycle (14 tests)

| Test | Description |
|------|-------------|
| registers sidecar:get-url | Channel registered |
| registers sidecar:health-check | Channel registered |
| registers sidecar:start | Channel registered |
| registers sidecar:stop | Channel registered |
| registers all 4 channels | All 4 present |
| returns a URL string | `sidecar:get-url` returns `http://...` |
| returns URL using configured port | Uses port from config |
| returns { online: false } when fetch fails | Network error → offline |
| returns { online: false } when response is not ok | HTTP error → offline |
| returns { online: false } when status is not ok | Bad status field → offline |
| returns { online: true } when healthy | Good response → online |
| sidecar:stop returns { ok: true } | Stop always succeeds |
| killSidecar is exported as a function | Export exists |
| killSidecar can be called without error | No-op when no process |

### tests/main/handlers/asr-handlers.test.ts — ASR / Transcription (17 tests)

| Test | Description |
|------|-------------|
| registers asr:fetch-models | Channel registered |
| registers asr:test | Channel registered |
| registers asr:transcribe | Channel registered |
| registers audio:transcribe-file | Channel registered |
| calls sidecar URL correctly | Fetches `/models` endpoint |
| falls back to /v1/models | Fallback when `/models` fails |
| returns empty array when all endpoints fail | Graceful degradation |
| filters out models with downloaded=false | Only downloaded models returned |
| strips /v1 suffix from baseUrl | URL normalization |
| includes Authorization header when apiKey provided | Auth header sent |
| posts WAV audio to transcription endpoint | Audio upload works |
| throws on non-ok response (transcribe) | Error propagation |
| returns success when transcription succeeds | Happy path |
| returns failure on HTTP error | Error object returned |
| returns failure when no model selected | Missing model handled |
| posts file path to sidecar (transcribe-file) | File path sent |
| throws on non-ok response (transcribe-file) | Error propagation |

### tests/main/handlers/model-handlers.test.ts — Model Management (11 tests)

| Test | Description |
|------|-------------|
| registers all 14 model/download channels | All channels present |
| each channel registered exactly once | No duplicate registrations |
| models:list returns empty array | No models on disk → `[]` |
| models:list returns downloaded models | Model dirs detected |
| migrateModelsDir is exported | Export exists |
| migrateModelsDir creates asr/ and tts/ | Directory structure created |
| migrateModelsDir is idempotent | Safe to call twice |
| migrateModelsDir moves flat dirs into asr/ | Legacy layout migrated |
| download:list-incomplete returns empty array | No downloads → `[]` |
| download:pause calls pause on manager | Pause delegated |
| download:cancel calls cancel on manager | Cancel delegated |

### tests/main/handlers/llm-handlers.test.ts — LLM / Summarize / Translate (5 tests)

| Test | Description |
|------|-------------|
| registers all 11 channels | All LLM channels present |
| summary:list returns array | Empty array for unknown session |
| prompt-types:list returns array | Default prompt types loaded |
| llm:fetch-models calls net.fetch | API call made correctly |
| llm:fetch-models returns empty on failure | Graceful degradation |

### tests/main/handlers/tts-handlers.test.ts — Text-to-Speech (13 tests)

| Test | Description |
|------|-------------|
| registers all 7 TTS channels | All channels present |
| tts:check-provider — no provider | Returns not-ready |
| tts:check-provider — reachable | Returns ready |
| tts:check-provider — unreachable | Returns not-ready |
| tts:list-voices — success | Returns voice list from API |
| tts:list-voices — failure | Returns empty on fetch error |
| tts:speak — no provider | Throws error |
| tts:speak — success | Returns audio buffer |
| tts:cancel-stream — non-existent | No-op, does not throw |
| tts:test — no model selected | Returns `success: false` |
| tts:test — success | Returns `success: true` |
| config:save-tts-settings — saves | Settings persisted |
| config:save-tts-settings — preserves other fields | Existing config not clobbered |

### tests/main/handlers/audio-handlers.test.ts — Audio Streaming & Files (8 tests)

| Test | Description |
|------|-------------|
| registers all 12 audio channels | All channels present |
| registers exactly audio channels | No extra channels |
| audio:get-dir — session missing | Returns null |
| audio:get-dir — no audio_path | Returns null |
| audio:get-dir — valid session | Returns path string |
| audio:stream-open + close lifecycle | Open then close succeeds |
| audio:stream-open — path traversal rejected | Security: outside-base path blocked |
| audio:stream-write — appends PCM data | Data written to open stream |

### tests/main/handlers/audio-download-handlers.test.ts — Audio Download (8 tests)

| Test | Description |
|------|-------------|
| registers all 5 download channels | All channels present |
| audio:download-list — empty | No downloads → `[]` |
| audio:download-list — with record | Inserted record returned |
| audio:download-remove — deletes record | Record removed from DB |
| audio:download-cancel — marks cancelled | Status set to `cancelled` |
| audio:download-retry — missing id | Throws on invalid id |
| extractSource — hostname extraction | `https://www.example.com/path` → `example.com` |
| isXiaoyuzhouUrl — pattern match | Recognizes `xiaoyuzhoufm.com` URLs |

### tests/main/handlers/config-handlers.test.ts — App Configuration (11 tests)

| Test | Description |
|------|-------------|
| registers all 9 channels | All config/app channels present |
| config:get returns object | Config loaded |
| config:set updates without throwing | Write succeeds |
| config:set persists values | Read-after-write works |
| config:get-default-data-dir returns path | Default path contains "Capty" |
| app:get-config-dir returns configDir | Returns deps.configDir |
| app:get-data-dir returns string | Data dir resolved |
| app:open-config-dir calls shell.openPath | Finder/explorer opened |
| app:select-directory — no window | Returns null |
| layout:save — saves widths | Layout persisted |
| deps:check — returns array | Dependency check results |

### tests/main/handlers/export-handlers.test.ts — Export Formats (7 tests)

| Test | Description |
|------|-------------|
| registers all 5 export channels | All channels present |
| export:txt — plain text | Session segments as plain text |
| export:txt — with timestamps | Text with `[HH:MM:SS]` prefixes |
| export:srt — SRT format | Standard subtitle format |
| export:markdown — markdown format | Markdown with heading + timestamps |
| export:save-file — no window | Returns null |
| export:save-buffer — no window | Returns null |

---

## E2E Tests (Playwright + Electron)

### tests/e2e/smoke/launch.spec.ts — App Launch (2 tests)

| Test | Description |
|------|-------------|
| main window is created and visible | Electron window opens |
| window title is set | Title bar reads "Capty" |

### tests/e2e/smoke/main-ui.spec.ts — Main UI Panels (1 test)

| Test | Description |
|------|-------------|
| main panels are visible after config is seeded | ControlBar, HistoryPanel, RecordingControls all rendered |

### tests/e2e/smoke/settings-modal.spec.ts — Settings Modal (2 tests)

| Test | Description |
|------|-------------|
| opens when settings button is clicked | Click settings → modal appears |
| can switch between tabs | Tab navigation works |

### tests/e2e/smoke/setup-wizard.spec.ts — Setup Wizard (1 test)

| Test | Description |
|------|-------------|
| SetupWizard shown when no dataDir configured | First-run wizard displayed |

### tests/e2e/smoke/user-data-override.spec.ts — Test Isolation (1 test)

| Test | Description |
|------|-------------|
| seeded userData dir is used instead of default | `ELECTRON_USER_DATA_DIR_OVERRIDE` env var works |
