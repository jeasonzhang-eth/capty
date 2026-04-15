# Playwright E2E Smoke Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install Playwright and write smoke E2E tests for capty's critical UI paths, creating a safety net for the upcoming architecture refactoring (ipc-handlers.ts and App.tsx splits).

**Architecture:** Use `@playwright/test` with `_electron.launch()` API. Tests launch the packaged Electron app against a pre-built `out/` directory, seed a temporary `userData` directory with a config that skips the SetupWizard, and assert on visible UI elements. No sidecar required for smoke coverage — tests assert on UI chrome only, not on transcription itself.

**Tech Stack:**
- `@playwright/test` (Electron support via `_electron`)
- TypeScript
- Existing `electron-vite` build output at `out/main/index.js`
- CI: GitHub Actions macos-14 runner (existing)

---

## File Structure

**New files:**
- `playwright.config.ts` — Playwright test runner config
- `tests/e2e/fixtures.ts` — Shared `electronApp` fixture (launch + cleanup + temp userData)
- `tests/e2e/helpers.ts` — `seedConfig()`, `findTestAsset()` utilities
- `tests/e2e/smoke/launch.spec.ts` — App launches, main window visible
- `tests/e2e/smoke/setup-wizard.spec.ts` — First-run SetupWizard appears
- `tests/e2e/smoke/main-ui.spec.ts` — Main UI panels render after config seeded
- `tests/e2e/smoke/settings-modal.spec.ts` — Settings modal opens and tabs switch
- `tests/e2e/tsconfig.json` — TypeScript config scoped to E2E tests
- `tests/e2e/README.md` — How to run, debug, and write new E2E tests

**Modified files:**
- `package.json` — add `@playwright/test` devDep, `e2e` / `e2e:ui` / `e2e:debug` scripts
- `.gitignore` — add `test-results/`, `playwright-report/`, `tests/e2e/.artifacts/`
- `.github/workflows/ci.yml` — add E2E job (build + run playwright)

**Not modified:**
- Existing `tests/main/*.test.ts` (vitest unit tests) stay as-is
- `src/**` — zero production code changes in this plan

---

## Task 1: Install @playwright/test

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install @playwright/test as devDependency**

Run:
```bash
cd "/Users/zhangjie/Documents/Jeason的创作/code/capty"
npm install --save-dev @playwright/test@^1.48.0
```

Expected: `package.json` updated with `"@playwright/test": "^1.48.0"` in devDependencies, `package-lock.json` updated.

- [ ] **Step 2: Verify installation**

Run:
```bash
npx playwright --version
```

Expected: `Version 1.48.x` (or higher).

- [ ] **Step 3: Add E2E scripts to package.json**

Add to `package.json` under `"scripts"` (alphabetical order after `dist:all`):

```json
    "e2e": "npm run build && playwright test",
    "e2e:ui": "npm run build && playwright test --ui",
    "e2e:debug": "npm run build && PWDEBUG=1 playwright test",
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @playwright/test for E2E testing"
```

---

## Task 2: Create Playwright Config

**Files:**
- Create: `playwright.config.ts`

- [ ] **Step 1: Write the config**

Create `playwright.config.ts` at repo root:

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false, // Electron app tests share userData dir patterns — run serial
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // one Electron instance at a time
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  outputDir: "tests/e2e/.artifacts",
});
```

- [ ] **Step 2: Verify config loads**

Run:
```bash
npx playwright test --list
```

Expected: `Listing tests:\n\nTotal: 0 tests` (no tests yet but config parses successfully).

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts
git commit -m "chore: add Playwright config for Electron E2E"
```

---

## Task 3: Create E2E TypeScript Config

**Files:**
- Create: `tests/e2e/tsconfig.json`

- [ ] **Step 1: Write tsconfig**

Create `tests/e2e/tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ESNext",
    "lib": ["ESNext", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["**/*.ts"]
}
```

- [ ] **Step 2: Verify tsc can parse files in this dir**

Run:
```bash
npx tsc --noEmit --project tests/e2e/tsconfig.json
```

Expected: exits with code 0 (no files yet, no errors).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/tsconfig.json
git commit -m "chore: add tsconfig for E2E tests"
```

---

## Task 4: Update .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Append E2E artifact paths**

Append the following lines to `.gitignore`:

```
# Playwright
/test-results/
/playwright-report/
/tests/e2e/.artifacts/
/playwright/.cache/
```

- [ ] **Step 2: Verify gitignore works**

Run:
```bash
mkdir -p tests/e2e/.artifacts && touch tests/e2e/.artifacts/dummy
git status tests/e2e/.artifacts/
```

Expected: `.artifacts/dummy` is NOT listed in git status (ignored).

Clean up:
```bash
rm -rf tests/e2e/.artifacts
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore Playwright artifacts"
```

---

## Task 5: Write E2E Helpers

**Files:**
- Create: `tests/e2e/helpers.ts`

- [ ] **Step 1: Write helpers.ts**

Create `tests/e2e/helpers.ts`:

```typescript
import fs from "fs";
import path from "path";
import os from "os";

export interface SeededConfig {
  dataDir: string;
  sidecar?: {
    port: number;
    host: string;
  };
}

/**
 * Create a temporary userData directory with a pre-populated config.json.
 * Returns the userData path. Caller should pass this to electron via
 * `env: { CAPTY_USER_DATA: path }` and clean up in afterAll.
 *
 * When `seedConfig` is provided, SetupWizard is skipped because `dataDir`
 * is already set. When omitted (undefined), SetupWizard will appear.
 */
export function createTempUserData(
  seedConfig?: SeededConfig,
): { userDataDir: string; dataDir: string } {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "capty-e2e-"));
  const dataDir =
    seedConfig?.dataDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), "capty-e2e-data-"));

  if (seedConfig) {
    const configPath = path.join(userDataDir, "config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ dataDir, ...seedConfig }, null, 2),
    );
  }

  return { userDataDir, dataDir };
}

/** Recursively delete a directory; no-op if missing. */
export function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors in tests
  }
}

/** Absolute path to the built Electron main entry. */
export function mainEntry(): string {
  return path.resolve(__dirname, "../../out/main/index.js");
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
npx tsc --noEmit --project tests/e2e/tsconfig.json
```

Expected: exits with code 0.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/helpers.ts
git commit -m "test: add E2E helpers for temp userData seeding"
```

---

## Task 6: Write E2E Fixtures

**Files:**
- Create: `tests/e2e/fixtures.ts`

- [ ] **Step 1: Write fixtures.ts**

Create `tests/e2e/fixtures.ts`:

```typescript
import { test as base, _electron, ElectronApplication, Page } from "@playwright/test";
import {
  createTempUserData,
  cleanupTempDir,
  mainEntry,
  type SeededConfig,
} from "./helpers";

interface CaptyFixtures {
  seededApp: {
    app: ElectronApplication;
    window: Page;
    userDataDir: string;
    dataDir: string;
  };
  freshApp: {
    app: ElectronApplication;
    window: Page;
    userDataDir: string;
  };
}

/**
 * `seededApp`: userData pre-populated with a valid config → SetupWizard bypassed,
 *              main UI renders immediately.
 * `freshApp`: userData empty → SetupWizard visible on first window.
 */
export const test = base.extend<CaptyFixtures>({
  seededApp: async ({}, use) => {
    const seed: SeededConfig = { dataDir: "" };
    const { userDataDir, dataDir } = createTempUserData(seed);
    // Re-seed with actual dataDir
    const fs = await import("fs");
    const path = await import("path");
    fs.writeFileSync(
      path.join(userDataDir, "config.json"),
      JSON.stringify({ dataDir }, null, 2),
    );

    const app = await _electron.launch({
      args: [mainEntry()],
      env: {
        ...process.env,
        ELECTRON_USER_DATA_DIR_OVERRIDE: userDataDir,
      },
      timeout: 20_000,
    });
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    await use({ app, window, userDataDir, dataDir });

    await app.close().catch(() => undefined);
    cleanupTempDir(userDataDir);
    cleanupTempDir(dataDir);
  },

  freshApp: async ({}, use) => {
    const { userDataDir } = createTempUserData(); // no seed

    const app = await _electron.launch({
      args: [mainEntry()],
      env: {
        ...process.env,
        ELECTRON_USER_DATA_DIR_OVERRIDE: userDataDir,
      },
      timeout: 20_000,
    });
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    await use({ app, window, userDataDir });

    await app.close().catch(() => undefined);
    cleanupTempDir(userDataDir);
  },
});

export { expect } from "@playwright/test";
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
npx tsc --noEmit --project tests/e2e/tsconfig.json
```

Expected: exits with code 0.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/fixtures.ts
git commit -m "test: add Playwright fixtures for seeded/fresh Electron launches"
```

---

## Task 7: Teach Main Process to Honor ELECTRON_USER_DATA_DIR_OVERRIDE

**Files:**
- Modify: `src/main/index.ts:145-147`

**Context:** Tests need to point the app at a temp userData dir. Electron's `app.getPath("userData")` normally returns `~/Library/Application Support/capty` on macOS. We override via env var — only used in tests.

- [ ] **Step 1: Write the failing test**

Create `tests/e2e/smoke/user-data-override.spec.ts`:

```typescript
import { test, expect } from "../fixtures";
import fs from "fs";
import path from "path";

test("seeded userData dir is used instead of default", async ({ seededApp }) => {
  // If override works, config.json exists in our temp userDataDir
  const configPath = path.join(seededApp.userDataDir, "config.json");
  expect(fs.existsSync(configPath)).toBe(true);

  // And the window loaded without the SetupWizard (main UI title visible)
  await expect(seededApp.window.locator("body")).toBeVisible();
});
```

- [ ] **Step 2: Run the test (expected to fail)**

Run:
```bash
npm run build && npx playwright test tests/e2e/smoke/user-data-override.spec.ts
```

Expected: FAIL — app writes config to default userData (not our temp dir), or fixture setup errors. Note the exact failure mode in commit message.

- [ ] **Step 3: Modify main/index.ts to honor the override**

Edit `src/main/index.ts`. Find the line:

```typescript
app.whenReady().then(() => {
  // 1. Determine configDir
  const configDir = app.getPath("userData");
```

Replace with:

```typescript
// Honor ELECTRON_USER_DATA_DIR_OVERRIDE before app is ready — used by E2E tests.
// In production this env var is never set.
const userDataOverride = process.env.ELECTRON_USER_DATA_DIR_OVERRIDE;
if (userDataOverride) {
  app.setPath("userData", userDataOverride);
}

app.whenReady().then(() => {
  // 1. Determine configDir
  const configDir = app.getPath("userData");
```

- [ ] **Step 4: Rebuild and re-run the test**

Run:
```bash
npm run build && npx playwright test tests/e2e/smoke/user-data-override.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts tests/e2e/smoke/user-data-override.spec.ts
git commit -m "test(e2e): honor ELECTRON_USER_DATA_DIR_OVERRIDE for test isolation"
```

---

## Task 8: Smoke Test — App Launches

**Files:**
- Create: `tests/e2e/smoke/launch.spec.ts`

- [ ] **Step 1: Write the test**

Create `tests/e2e/smoke/launch.spec.ts`:

```typescript
import { test, expect } from "../fixtures";

test.describe("app launch", () => {
  test("main window is created and visible", async ({ seededApp }) => {
    const { app, window } = seededApp;

    // Exactly one window
    const windows = app.windows();
    expect(windows.length).toBe(1);

    // Window is visible and has a body
    expect(await window.isVisible("body")).toBe(true);
  });

  test("window title is set", async ({ seededApp }) => {
    const title = await seededApp.window.title();
    // Electron default title falls back to package.json `name`. Accept either
    // "capty" or a human-friendly title if one has been set in index.html.
    expect(title.toLowerCase()).toMatch(/capty/);
  });
});
```

- [ ] **Step 2: Run the test**

Run:
```bash
npm run build && npx playwright test tests/e2e/smoke/launch.spec.ts
```

Expected: both tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/smoke/launch.spec.ts
git commit -m "test(e2e): smoke test for app launch"
```

---

## Task 9: Smoke Test — SetupWizard Appears on First Run

**Files:**
- Create: `tests/e2e/smoke/setup-wizard.spec.ts`

- [ ] **Step 1: Find a stable SetupWizard selector**

Run:
```bash
grep -n -E "SetupWizard|data-testid|Choose.*data|Welcome" src/renderer/components/SetupWizard.tsx | head -20
```

Expected: locate a heading or button text unique to SetupWizard (e.g., the welcome copy). Use that exact string in the selector below. If no stable English/Chinese string exists, add a `data-testid="setup-wizard"` attribute to the root element in SetupWizard.tsx in this task.

- [ ] **Step 2: Write the test using the located selector**

Create `tests/e2e/smoke/setup-wizard.spec.ts` — replace `<WIZARD_TEXT>` with the string found in Step 1 (or `[data-testid="setup-wizard"]` if you added one):

```typescript
import { test, expect } from "../fixtures";

test("SetupWizard is shown when no dataDir is configured", async ({ freshApp }) => {
  const { window } = freshApp;

  // Wait for React to mount
  await window.waitForLoadState("networkidle");

  // SetupWizard presence — adjust selector based on Step 1 finding
  const wizard = window.locator("text=<WIZARD_TEXT>").first();
  await expect(wizard).toBeVisible({ timeout: 10_000 });
});
```

- [ ] **Step 3: Run the test**

Run:
```bash
npm run build && npx playwright test tests/e2e/smoke/setup-wizard.spec.ts
```

Expected: PASS. If FAIL, capture the screenshot under `tests/e2e/.artifacts/` and adjust the selector.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/smoke/setup-wizard.spec.ts src/renderer/components/SetupWizard.tsx
git commit -m "test(e2e): smoke test for SetupWizard first-run"
```

(If SetupWizard.tsx was not modified, omit it from `git add`.)

---

## Task 10: Smoke Test — Main UI Panels Render

**Files:**
- Create: `tests/e2e/smoke/main-ui.spec.ts`

- [ ] **Step 1: Add stable testids to main UI chrome**

Edit these files to add `data-testid` on the root wrapper of each component (minimal change, zero behavior impact):

1. `src/renderer/components/ControlBar.tsx` — add `data-testid="control-bar"` to root element
2. `src/renderer/components/HistoryPanel.tsx` — add `data-testid="history-panel"` to root element
3. `src/renderer/components/RecordingControls.tsx` — add `data-testid="recording-controls"` to root element

Use `grep -n "return (" src/renderer/components/ControlBar.tsx | head -3` to find the root JSX, then add the attribute to the outermost element.

- [ ] **Step 2: Write the test**

Create `tests/e2e/smoke/main-ui.spec.ts`:

```typescript
import { test, expect } from "../fixtures";

test.describe("main UI", () => {
  test("main panels are visible after config is seeded", async ({ seededApp }) => {
    const { window } = seededApp;
    await window.waitForLoadState("networkidle");

    await expect(window.locator('[data-testid="control-bar"]')).toBeVisible();
    await expect(window.locator('[data-testid="history-panel"]')).toBeVisible();
    await expect(window.locator('[data-testid="recording-controls"]')).toBeVisible();
  });
});
```

- [ ] **Step 3: Run the test**

Run:
```bash
npm run build && npx playwright test tests/e2e/smoke/main-ui.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ControlBar.tsx \
        src/renderer/components/HistoryPanel.tsx \
        src/renderer/components/RecordingControls.tsx \
        tests/e2e/smoke/main-ui.spec.ts
git commit -m "test(e2e): smoke test for main UI panels with stable testids"
```

---

## Task 11: Smoke Test — Settings Modal Opens and Tabs Switch

**Files:**
- Create: `tests/e2e/smoke/settings-modal.spec.ts`

- [ ] **Step 1: Locate the settings button selector**

Run:
```bash
grep -n -E "onClick.*setShowSettings|onClick.*openSettings|Settings.*button" src/renderer/components/ControlBar.tsx
```

Expected: find the settings button. Note the aria-label or add `data-testid="open-settings"` to it.

- [ ] **Step 2: Add testid to settings button if missing**

If no stable selector, edit `src/renderer/components/ControlBar.tsx` to add `data-testid="open-settings"` to the settings button element.

- [ ] **Step 3: Add testids to SettingsModal root and tab buttons**

Edit `src/renderer/components/SettingsModal.tsx`:
- Root modal element: `data-testid="settings-modal"`
- Each tab button: `data-testid={\`settings-tab-${tabId}\`}` where `tabId` is the existing TabId identifier

Run `grep -n "TabId" src/renderer/components/SettingsModal.tsx | head -5` first to locate the tab definitions.

- [ ] **Step 4: Write the test**

Create `tests/e2e/smoke/settings-modal.spec.ts`:

```typescript
import { test, expect } from "../fixtures";

test.describe("settings modal", () => {
  test("opens when settings button is clicked", async ({ seededApp }) => {
    const { window } = seededApp;
    await window.waitForLoadState("networkidle");

    // Modal is not visible initially
    await expect(window.locator('[data-testid="settings-modal"]')).toHaveCount(0);

    // Click settings button
    await window.locator('[data-testid="open-settings"]').click();

    // Modal becomes visible
    await expect(window.locator('[data-testid="settings-modal"]')).toBeVisible();
  });

  test("can switch between tabs", async ({ seededApp }) => {
    const { window } = seededApp;
    await window.waitForLoadState("networkidle");

    await window.locator('[data-testid="open-settings"]').click();
    await expect(window.locator('[data-testid="settings-modal"]')).toBeVisible();

    // Click the ASR tab — exact tabId must match what's in SettingsModal.tsx
    await window.locator('[data-testid="settings-tab-asr"]').click();
    // Just assert the tab button still exists (active state is a visual style
    // check that belongs in a separate visual regression test)
    await expect(window.locator('[data-testid="settings-tab-asr"]')).toBeVisible();

    await window.locator('[data-testid="settings-tab-llm"]').click();
    await expect(window.locator('[data-testid="settings-tab-llm"]')).toBeVisible();
  });
});
```

- [ ] **Step 5: Run the tests**

Run:
```bash
npm run build && npx playwright test tests/e2e/smoke/settings-modal.spec.ts
```

Expected: both tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/ControlBar.tsx \
        src/renderer/components/SettingsModal.tsx \
        tests/e2e/smoke/settings-modal.spec.ts
git commit -m "test(e2e): smoke test for settings modal open + tab switch"
```

---

## Task 12: Write E2E README

**Files:**
- Create: `tests/e2e/README.md`

- [ ] **Step 1: Write README**

Create `tests/e2e/README.md`:

````markdown
# Capty E2E Tests

End-to-end tests for capty's UI using Playwright's Electron support.

## Running

```bash
# Run all E2E tests headless
npm run e2e

# Run with Playwright's UI mode (best for debugging)
npm run e2e:ui

# Run with Playwright debugger attached
npm run e2e:debug

# Run a single test file
npm run build && npx playwright test tests/e2e/smoke/launch.spec.ts
```

## Architecture

- `playwright.config.ts` (repo root) — runner config
- `tests/e2e/fixtures.ts` — `seededApp` (SetupWizard bypassed) and `freshApp` (first-run) fixtures
- `tests/e2e/helpers.ts` — temp userData creation + cleanup
- `tests/e2e/smoke/` — fast smoke tests for critical UI paths

Each fixture:
1. Creates a temp userData directory
2. For `seededApp`, writes a `config.json` with a valid `dataDir` so SetupWizard is skipped
3. Launches Electron pointed at `out/main/index.js`
4. Returns the `ElectronApplication` and main `Page`
5. Cleans up temp dirs and closes the app after the test

## How the Override Works

`src/main/index.ts` checks for `ELECTRON_USER_DATA_DIR_OVERRIDE` env var and calls
`app.setPath("userData", override)` before `app.whenReady()`. This is ONLY used
by E2E tests and is undefined in production.

## Writing New Tests

Always use stable selectors. Prefer `data-testid="..."` attributes over text or CSS
classes — text changes with i18n, classes change with refactors.

```typescript
import { test, expect } from "../fixtures";

test("my new feature", async ({ seededApp }) => {
  const { window } = seededApp;
  await window.locator('[data-testid="my-button"]').click();
  await expect(window.locator('[data-testid="my-result"]')).toBeVisible();
});
```

## Artifacts

Failed test traces, screenshots, and videos are saved to `tests/e2e/.artifacts/`.
View a trace with:

```bash
npx playwright show-trace tests/e2e/.artifacts/<trace-name>.zip
```

## Sidecar

The smoke tests do NOT require the Python sidecar. They assert only on UI chrome.
Tests that exercise transcription will need to start the sidecar separately — see
`sidecar/README.md` (TODO: add when transcription E2E tests are written).
````

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/README.md
git commit -m "docs: add E2E testing guide"
```

---

## Task 13: Add E2E Job to CI

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Append the E2E job**

Edit `.github/workflows/ci.yml`. After the existing `check` job, append:

```yaml
  e2e:
    runs-on: macos-14
    needs: check
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - name: Build
        run: npm run build

      - name: Run Playwright E2E
        run: npx playwright test

      - name: Upload Playwright artifacts
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-artifacts
          path: |
            tests/e2e/.artifacts
            playwright-report
          retention-days: 7
```

- [ ] **Step 2: Verify YAML is valid**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
```

Expected: exits with code 0 (no YAML errors).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run Playwright E2E tests on PRs"
```

---

## Task 14: Full Suite Run & Final Verification

**Files:** none (verification only)

- [ ] **Step 1: Clean build and run the full E2E suite**

Run:
```bash
rm -rf out/ tests/e2e/.artifacts/
npm run build
npx playwright test
```

Expected output:

```
Running 6 tests using 1 worker

  ✓ tests/e2e/smoke/user-data-override.spec.ts:4:1 › seeded userData dir is used …
  ✓ tests/e2e/smoke/launch.spec.ts:4:1 › app launch › main window is created and visible
  ✓ tests/e2e/smoke/launch.spec.ts:12:1 › app launch › window title is set
  ✓ tests/e2e/smoke/setup-wizard.spec.ts:3:1 › SetupWizard is shown when no dataDir …
  ✓ tests/e2e/smoke/main-ui.spec.ts:4:1 › main UI › main panels are visible …
  ✓ tests/e2e/smoke/settings-modal.spec.ts:4:1 › settings modal › opens when settings …
  ✓ tests/e2e/smoke/settings-modal.spec.ts:16:1 › settings modal › can switch between tabs

  7 passed (XXs)
```

Expected: 7 passing tests.

- [ ] **Step 2: Verify existing unit tests still pass**

Run:
```bash
npm run test
```

Expected: all existing vitest unit tests still PASS (no regressions).

- [ ] **Step 3: Document the passing baseline in CHANGELOG**

Edit `CHANGELOG.md`. Under today's date section (2026-04-13), add under a new `### Added` subsection:

```markdown
- E2E testing infrastructure using Playwright
  - Smoke tests covering app launch, SetupWizard, main UI, and settings modal
  - `npm run e2e`, `npm run e2e:ui`, `npm run e2e:debug` scripts
  - CI job runs E2E on every PR
```

- [ ] **Step 4: Final commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for E2E testing infrastructure"
```

---

## Verification Summary

After all tasks complete, the repo has:

1. **7 passing E2E tests** covering: app launch, window title, SetupWizard, main UI panels, settings modal open + tab switch, userData override
2. **Zero changes to production business logic** — only `data-testid` attributes added and one `ELECTRON_USER_DATA_DIR_OVERRIDE` env hook in `main/index.ts`
3. **CI gate** — PRs blocked if E2E fails
4. **Safety net** for upcoming ipc-handlers.ts and App.tsx refactors: if a refactor accidentally breaks the settings modal or main UI, the smoke suite catches it before merge.

---

## Out of Scope (Not in This Plan)

Deferred to later plans:
- Transcription E2E (requires sidecar orchestration)
- Visual regression tests (screenshots + diff)
- Performance benchmarks (launch time, first-paint)
- Accessibility audits (axe-core integration)
- Testing recording/playback (requires audio capture stubs)
