import {
  test as base,
  _electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import os from "os";
import fs from "fs";
import path from "path";
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
    const { userDataDir } = createTempUserData(); // no seed, just get a temp dir
    // Create a separate real dataDir and write config manually
    const realDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "capty-e2e-data-"),
    );
    fs.writeFileSync(
      path.join(userDataDir, "config.json"),
      JSON.stringify({ dataDir: realDataDir }, null, 2),
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

    await use({ app, window, userDataDir, dataDir: realDataDir });

    await app.close().catch(() => undefined);
    cleanupTempDir(userDataDir);
    cleanupTempDir(realDataDir);
  },

  freshApp: async ({}, use) => {
    const { userDataDir } = createTempUserData(); // no seed → SetupWizard shown

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

// Re-export SeededConfig so test files can import it from fixtures
export type { SeededConfig };
