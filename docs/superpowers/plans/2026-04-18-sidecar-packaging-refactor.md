# Sidecar Packaging Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Python sidecar build to `uv` for reproducibility, and lay down a dormant Apple notarization scaffold that activates automatically when credentials appear.

**Architecture:** Two independent deliverables.
§1 (active) — `sidecar/build.sh` switches from manual venv activation + ad-hoc `pip install` to `uv sync --extra dev` + `uv run pyinstaller`. PyInstaller becomes a declared dev dependency in `pyproject.toml`.
§2 (inert) — An `afterSign` hook (`build/notarize.js`) is registered in `electron-builder.yml`. The hook checks for three environment variables and silently no-ops if any are missing, so today's `npm run dist` output is unchanged. When a future Apple Developer account lands, exporting the env vars turns notarization on with zero code changes.

**Tech Stack:** uv (Python package manager), PyInstaller 6.x (standalone-binary builder), electron-builder 25.x, `@electron/notarize` (Apple notarization SDK), Node.js afterSign hook.

**Spec:** `docs/superpowers/specs/2026-04-18-sidecar-packaging-refactor-design.md`

---

## File Map

| Path | Change | Responsibility |
|------|--------|----------------|
| `sidecar/pyproject.toml` | Modify | Declare `pyinstaller>=6.0` alongside existing dev extras |
| `sidecar/build.sh` | Modify | Use `uv sync --extra dev` + `uv run pyinstaller`; drop manual venv activation and ad-hoc `pip install` |
| `package.json` | Modify | Add `@electron/notarize` to devDependencies |
| `package-lock.json` | Modify (auto) | npm lockfile update |
| `build/notarize.js` | Create | afterSign hook; inert when env vars missing |
| `electron-builder.yml` | Modify | Register `afterSign`; enable `hardenedRuntime`; disable built-in notarize |
| `docs/notarization-setup.md` | Create | Step-by-step activation guide for when Apple Developer account is purchased |
| `CHANGELOG.md` | Modify (each task) | One entry per commit under today's `[0.2.0]` section |

---

### Task 1: Declare PyInstaller as a uv-managed dev dependency

**Files:**
- Modify: `sidecar/pyproject.toml` (lines 10-11, `[project.optional-dependencies]` block)

- [ ] **Step 1: Edit `sidecar/pyproject.toml`**

Change the existing:
```toml
[project.optional-dependencies]
dev = ["pytest", "pytest-asyncio", "httpx"]
```
to:
```toml
[project.optional-dependencies]
dev = ["pytest", "pytest-asyncio", "httpx", "pyinstaller>=6.0"]
```

- [ ] **Step 2: Resolve the new dependency with uv**

Run (from repo root):
```bash
cd sidecar && uv sync --extra dev
```
Expected: uv downloads PyInstaller and its transitive deps, exits 0. `sidecar/uv.lock` is updated.

- [ ] **Step 3: Verify the PyInstaller binary is available through uv**

Run (still in `sidecar/`):
```bash
uv run pyinstaller --version
```
Expected: version `6.x.y` printed, exit 0.

- [ ] **Step 4: Update CHANGELOG**

In `CHANGELOG.md`, under the existing `## [0.2.0] - 2026-04-18` section, add (if a `### Changed` subsection already exists, append there; otherwise create it immediately below the `### Docs` block added earlier):
```markdown
- Sidecar: declare `pyinstaller>=6.0` in `sidecar/pyproject.toml` dev extra so `uv sync --extra dev` installs it reproducibly (previously installed ad-hoc via `pip install pyinstaller` on every build).
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangjie/Documents/Jeason的创作/code/personal/capty
git add sidecar/pyproject.toml sidecar/uv.lock CHANGELOG.md
git commit -m "build(sidecar): declare pyinstaller as uv-managed dev dep"
```

---

### Task 2: Rewrite `sidecar/build.sh` to use uv

**Files:**
- Modify: `sidecar/build.sh` (whole file)

- [ ] **Step 1: Replace `sidecar/build.sh` contents**

Overwrite the file with:
```bash
#!/bin/bash
# Build capty-sidecar into a standalone binary (onedir) using PyInstaller.
# Managed via uv — no manual venv activation needed.
# Output: dist/capty-sidecar/capty-sidecar

set -euo pipefail
cd "$(dirname "$0")"

echo "==> Syncing dev dependencies with uv..."
uv sync --extra dev

echo "==> Building capty-sidecar..."
uv run pyinstaller capty-sidecar.spec --clean --noconfirm

BINARY="dist/capty-sidecar/capty-sidecar"
if [ -f "$BINARY" ]; then
    SIZE=$(du -sh "$BINARY" | cut -f1)
    echo "==> Build complete: $BINARY ($SIZE)"
    echo "==> Test with: $BINARY --port 8766"
else
    echo "ERROR: Binary not found at $BINARY"
    exit 1
fi
```

- [ ] **Step 2: Verify executable bit is preserved**

```bash
ls -l sidecar/build.sh
```
Expected: `-rwxr-xr-x` (or similar; user+group execute bits set). If not, run `chmod +x sidecar/build.sh`.

- [ ] **Step 3: Run the build**

```bash
cd /Users/zhangjie/Documents/Jeason的创作/code/personal/capty
npm run build:sidecar
```
Expected: build finishes with `==> Build complete: dist/capty-sidecar/capty-sidecar (<size>)`. Exit 0.

- [ ] **Step 4: Smoke-test the produced binary**

```bash
./sidecar/dist/capty-sidecar/capty-sidecar --port 8766 &
SIDECAR_PID=$!
sleep 3
curl -fsS http://127.0.0.1:8766/health || echo "no /health endpoint — check with a known route"
kill $SIDECAR_PID
```
Expected: process stays up for 3 seconds, responds on 8766 or logs sensible startup output. If `/health` 404s, that's fine — we only need the server to boot without crashing. Any import error or missing-module traceback = FAIL; revisit `capty-sidecar.spec` `hiddenimports` list.

- [ ] **Step 5: Update CHANGELOG**

Append to the `### Changed` subsection under `## [0.2.0] - 2026-04-18`:
```markdown
- Sidecar: rewrite `sidecar/build.sh` to use `uv sync --extra dev` + `uv run pyinstaller`. Removes manual `source .venv/bin/activate` and per-build `pip install pyinstaller`; builds are now reproducible from `uv.lock`.
```

- [ ] **Step 6: Commit**

```bash
git add sidecar/build.sh CHANGELOG.md
git commit -m "build(sidecar): run pyinstaller via uv run, drop manual venv activation"
```

---

### Task 3: Add `@electron/notarize` dev dependency

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install the package**

```bash
cd /Users/zhangjie/Documents/Jeason的创作/code/personal/capty
npm install --save-dev @electron/notarize
```
Expected: installs cleanly, no peer-dep warnings that block.

- [ ] **Step 2: Verify the entry**

```bash
grep '"@electron/notarize"' package.json
```
Expected: a line like `"@electron/notarize": "^2.x.y"` under `devDependencies`.

- [ ] **Step 3: Update CHANGELOG**

Add under `### Added` (create the subsection if it doesn't exist under today's `[0.2.0]`):
```markdown
- Add `@electron/notarize` dev dependency as the engine for a future macOS notarization workflow (currently inert — see `docs/notarization-setup.md`).
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "build: add @electron/notarize devDependency for notarization scaffold"
```

---

### Task 4: Create the inert `build/notarize.js` afterSign hook

**Files:**
- Create: `build/notarize.js`

- [ ] **Step 1: Write `build/notarize.js`**

Create the file with:
```js
// afterSign hook: notarize the macOS .app when Apple credentials are set.
// Inert by design — returns silently unless APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD,
// and APPLE_TEAM_ID are all present in the environment.
// See docs/notarization-setup.md for activation steps.

const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log('[notarize] Apple credentials not set — skipping notarization.');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  const appBundleId = context.packager.appInfo.id; // com.capty.app

  console.log(`[notarize] Submitting ${appPath} for notarization (team ${APPLE_TEAM_ID})…`);
  await notarize({
    tool: 'notarytool',
    appBundleId,
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
  console.log('[notarize] Notarization complete.');
};
```

- [ ] **Step 2: Syntax-check the hook**

```bash
node -e "require('./build/notarize.js')"
```
Expected: exits 0 with no output. Any `SyntaxError` or `MODULE_NOT_FOUND` for `@electron/notarize` = FAIL.

- [ ] **Step 3: Dry-invoke the hook's skip path**

```bash
node -e "
const hook = require('./build/notarize.js').default;
hook({
  electronPlatformName: 'darwin',
  appOutDir: '/tmp',
  packager: { appInfo: { productFilename: 'Capty', id: 'com.capty.app' } },
}).then(() => console.log('OK: skip path returned cleanly'));
"
```
Expected: prints `[notarize] Apple credentials not set — skipping notarization.` then `OK: skip path returned cleanly`. Exit 0.

- [ ] **Step 4: Update CHANGELOG**

Append under `### Added`:
```markdown
- Add `build/notarize.js` afterSign hook. Inert today (no-op unless `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` env vars are set); activates automatically once an Apple Developer account is provisioned.
```

- [ ] **Step 5: Commit**

```bash
git add build/notarize.js CHANGELOG.md
git commit -m "build: add inert afterSign hook for future notarization"
```

---

### Task 5: Wire the afterSign hook into `electron-builder.yml`

**Files:**
- Modify: `electron-builder.yml`

- [ ] **Step 1: Edit `electron-builder.yml`**

Add an `afterSign` line at the top level (above or below `appId` — top level is fine). Then, under the existing `mac:` block, add `hardenedRuntime: true`, `gatekeeperAssess: false`, and `notarize: false`. The resulting file should look like:

```yaml
appId: com.capty.app
productName: Capty
afterSign: build/notarize.js
directories:
  buildResources: build
  output: dist
files:
  - out/**/*
extraResources:
  - from: sidecar/dist/
    to: sidecar/
    filter:
      - "**/*"
  - from: resources/
    to: resources/
    filter:
      - "**/*"
mac:
  category: public.app-category.productivity
  hardenedRuntime: true
  gatekeeperAssess: false
  notarize: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  extendInfo:
    NSMicrophoneUsageDescription: "Capty needs microphone access for real-time speech transcription."
  target:
    - target: dmg
      arch:
        - arm64
```

Rationale for each added key:
- `afterSign: build/notarize.js` — electron-builder runs our hook after code-signing.
- `hardenedRuntime: true` — required by Apple for notarization; harmless when not notarizing.
- `gatekeeperAssess: false` — skip electron-builder's built-in Gatekeeper check (which would fail without valid signing).
- `notarize: false` — tell electron-builder NOT to run its built-in notarization; our `afterSign` hook owns that flow.

- [ ] **Step 2: Run a `pack` build to exercise the hook (no signing required)**

```bash
npm run pack
```
Expected: completes successfully. In the log, look for `[notarize] Apple credentials not set — skipping notarization.` (proves the hook fired and the skip path worked). Exit 0.

Note: `pack` produces `dist/mac-arm64/Capty.app` without a DMG, which is faster than `dist`. If `pack` fails because the hook requires a signed app, fall back to `npm run dist` — the hook runs after signing in either case.

- [ ] **Step 3: Update CHANGELOG**

Append under `### Changed`:
```markdown
- `electron-builder.yml`: register `build/notarize.js` as `afterSign` hook; set `hardenedRuntime: true`, `gatekeeperAssess: false`, and `notarize: false` on the `mac` target. Behavior is unchanged today (hook is a no-op without Apple credentials); ready for notarization the day those env vars are set.
```

- [ ] **Step 4: Commit**

```bash
git add electron-builder.yml CHANGELOG.md
git commit -m "build: wire afterSign notarize hook into electron-builder.yml"
```

---

### Task 6: Write the activation guide

**Files:**
- Create: `docs/notarization-setup.md`

- [ ] **Step 1: Write `docs/notarization-setup.md`**

```markdown
# macOS Notarization Setup

Capty ships a dormant notarization pipeline: `build/notarize.js` is registered as an `afterSign` hook in `electron-builder.yml` but no-ops unless three environment variables are present. This document explains how to activate it.

## Prerequisites

1. **Apple Developer account** — $99/year at <https://developer.apple.com/programs/enroll/>.
2. **Developer ID Application certificate** — create in Xcode (Settings → Accounts → Manage Certificates → `+` → Developer ID Application) or via the developer portal. Installs into the login Keychain.
3. **App-Specific Password** — create at <https://appleid.apple.com> → Sign-In and Security → App-Specific Passwords. Store it safely; it is shown only once.
4. **Team ID** — 10-character string, visible at <https://developer.apple.com/account> → Membership Details.

## Activation

Export three environment variables before running the build:

```bash
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABCDE12345"

npm run dist
```

`electron-builder` signs the app with the Developer ID certificate from Keychain, then `build/notarize.js` submits the signed `.app` to Apple via `notarytool`. Notarization typically takes 2-10 minutes. On success the binary is stapled automatically by electron-builder's default `afterAllArtifactBuild` step, and the DMG Gatekeeper-opens on any Mac without a right-click workaround.

## Verification

After a notarized build:

```bash
spctl -a -vv --type execute dist/mac-arm64/Capty.app
# Expected: "accepted" + "source=Notarized Developer ID"

stapler validate dist/mac-arm64/Capty.app
# Expected: "The validate action worked!"
```

## Troubleshooting

- **"errSecInternalComponent" during signing** — Keychain locked, or Developer ID cert missing. `security find-identity -v -p codesigning` should list at least one `Developer ID Application:` identity.
- **Notarization rejected** — read the log URL printed by `notarytool`. Most common issue is an unsigned helper binary; check `hardenedRuntime`-required entitlements in `build/entitlements.mac.plist`.
- **Hook is silently skipping when credentials are set** — double-check spelling of the env var names. The hook requires ALL three to be non-empty.

## Deactivation

Unset any one of `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` and the hook reverts to its no-op skip path. No code changes needed.
```

- [ ] **Step 2: Spell-check by eye**

```bash
wc -l docs/notarization-setup.md
```
Expected: ~50 lines. Open and skim for typos.

- [ ] **Step 3: Update CHANGELOG**

Append under `### Docs`:
```markdown
- Add `docs/notarization-setup.md` — activation guide for the dormant macOS notarization hook.
```

- [ ] **Step 4: Commit**

```bash
git add docs/notarization-setup.md CHANGELOG.md
git commit -m "docs: add macOS notarization activation guide"
```

---

### Task 7: Final end-to-end sanity pass

**Files:** none modified; verification only.

- [ ] **Step 1: Clean build from scratch**

```bash
rm -rf sidecar/dist sidecar/build
npm run build:sidecar
```
Expected: full uv sync → pyinstaller → `sidecar/dist/capty-sidecar/capty-sidecar` produced, no errors.

- [ ] **Step 2: Full dist build (still without Apple creds)**

```bash
npm run dist
```
Expected:
- electron-builder packages the app.
- `[notarize] Apple credentials not set — skipping notarization.` appears in logs.
- A DMG lands in `dist/` for arm64.
- Exit 0.

- [ ] **Step 3: Verify DMG contents contain the uv-built sidecar**

```bash
hdiutil attach dist/Capty-*.dmg -nobrowse -quiet -mountpoint /tmp/capty-verify
test -f "/tmp/capty-verify/Capty.app/Contents/Resources/sidecar/capty-sidecar" && echo OK
hdiutil detach /tmp/capty-verify -quiet
```
Expected: `OK` printed. DMG unmounts cleanly.

- [ ] **Step 4: No commit — this task is verification only**

If all three steps pass, the refactor is done. If any fail, reopen the corresponding task.

---

## Self-Review Notes

- **Spec coverage:** §1 (build refactor) → Tasks 1-2. §2 (notarization scaffold) → Tasks 3-6. §3 (docs) → already committed during brainstorming. Final verification → Task 7.
- **Placeholder scan:** No TBD/TODO/"similar to" references. Each code block is complete.
- **Type consistency:** Env var names (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) match across `build/notarize.js`, the setup doc, and the CHANGELOG entries.
- **Known caveat:** Task 2 Step 4's `/health` endpoint may not exist — the step explicitly accepts that and looks for the absence of tracebacks instead. Task 7 Step 2 assumes `npm run dist` succeeds without signing on an unsigned developer machine; this matches current behavior. If a future change requires signing even for local builds, revisit Task 5's note.
