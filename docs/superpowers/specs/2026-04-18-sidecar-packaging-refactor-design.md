# Sidecar Packaging Refactor — Design

**Date:** 2026-04-18
**Status:** Approved
**Author:** Jeason + Claude

## Context

Capty ships an Electron app (TS/React) bundled with a Python sidecar (`capty-sidecar`, FastAPI + mlx-audio). The sidecar is built as a PyInstaller `onedir` bundle and embedded into the macOS `.app` via `electron-builder` `extraResources`.

The current Python toolchain already uses `uv` for development (`sidecar/uv.lock` present), but the **build script does not**. It activates a venv manually and `pip install`s PyInstaller on every run. macOS distribution also lacks notarization — there is no Apple Developer account today.

## Current State Audit

| Aspect | Assessment |
|--------|------------|
| PyInstaller onedir + electron-builder `extraResources` | ✅ Industry standard |
| `uv` adoption | ⚠️ Dev only; build still uses `source .venv/bin/activate` + `pip install pyinstaller` |
| PyInstaller as declared dep | ⚠️ Not in `pyproject.toml`, installed ad-hoc by `build.sh` |
| Architecture targets | N/A — mlx is Apple Silicon only, arm64-only DMG is correct |
| Code signing / notarization | ⚠️ entitlements.plist exists; no notarize hook; no Apple Developer account yet |
| Orchestration | npm scripts + one bash script — adequate at current scale |

## Approaches Considered

**A. Minimal — keep `build.sh`, swap to uv** (selected)
Lowest churn. `pyproject.toml` declares PyInstaller in a dev group; `build.sh` becomes `uv sync --group dev && uv run pyinstaller …`.

**B. Drop `build.sh`, single npm-script entry**
Cleaner long-term; one less file and language. Rejected for this iteration to keep diff small and preserve bash-level error reporting.

**C. Introduce `justfile` orchestrator**
Premature for current task count (3-4). Reconsider when scope grows.

## Decision

- **Approach A** for the build refactor.
- **Notarization scaffold-only**: write the configuration, hook, and docs, but the hook stays inert until Apple Developer credentials are provided via env vars. No code changes required to "turn it on" later.

## Scope

### §1 Sidecar build refactor (active)

**Files changed:**

- `sidecar/pyproject.toml` — extend the existing dev extra:
  ```toml
  [project.optional-dependencies]
  dev = ["pytest", "pytest-asyncio", "httpx", "pyinstaller>=6.0"]
  ```
  (We use `[project.optional-dependencies]` rather than PEP 735 `[dependency-groups]` to minimize churn — the existing dev extra already holds test deps and `uv` resolves both forms.)
- `sidecar/build.sh` — replace venv activation + ad-hoc pip install with:
  ```bash
  uv sync --extra dev
  uv run pyinstaller capty-sidecar.spec --clean --noconfirm
  ```
- `.gitignore` — verify `sidecar/.venv/` and `sidecar/dist/` are ignored.

**Verification:** `npm run build:sidecar` produces `sidecar/dist/capty-sidecar/capty-sidecar`, and running `./sidecar/dist/capty-sidecar/capty-sidecar --port 8766` starts the server.

### §2 Notarization scaffold (inert)

**Files changed:**

- `package.json` devDependencies — add `@electron/notarize`.
- `build/notarize.js` (new) — afterSign hook. Returns early when any of `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` is missing. When all are set, calls `@electron/notarize` against the signed `.app`.
- `electron-builder.yml` — add:
  ```yaml
  afterSign: build/notarize.js
  mac:
    hardenedRuntime: true
    gatekeeperAssess: false
    notarize: false  # afterSign hook owns notarization
  ```
- `docs/notarization-setup.md` (new) — activation steps:
  1. Buy Apple Developer account ($99/year)
  2. Create App-Specific Password at appleid.apple.com
  3. Install Developer ID Application certificate in Keychain
  4. Export `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
  5. Run `npm run dist` — notarization runs automatically

**Key invariant:** Without env vars, `npm run dist` behavior is unchanged from today. No `if NOTARIZE_ENABLED` flag to flip — credential presence is the switch.

### §3 Documentation

- This design doc.
- `docs/superpowers/specs/2026-04-18-sidecar-packaging-conversation.md` — verbatim brainstorming transcript.

## Execution Order (handoff to writing-plans)

1. `sidecar/pyproject.toml` — add dev group
2. Rewrite `sidecar/build.sh`
3. Run `npm run build:sidecar` — verify binary
4. `npm i -D @electron/notarize`
5. Create `build/notarize.js`
6. Update `electron-builder.yml`
7. Write `docs/notarization-setup.md`
8. Run `npm run dist` (no env vars) — verify unchanged behavior

## Future TODOs

- Buy Apple Developer account → activate notarization
- Reconsider Approach B (drop `build.sh`) once everything is stable
- Consider `justfile` if task count grows beyond ~6
