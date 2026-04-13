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
