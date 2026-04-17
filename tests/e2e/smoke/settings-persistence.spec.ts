import fs from "fs";
import path from "path";
import { _electron, expect } from "@playwright/test";
import { test } from "../fixtures";
import { mainEntry } from "../helpers";

test.describe("settings persistence", () => {
  test("General tab saves HuggingFace mirror URL across relaunch", async ({
    seededApp,
  }) => {
    const { app, window, userDataDir } = seededApp;
    const configPath = path.join(userDataDir, "config.json");
    const mirrorUrl = "https://hf-mirror.com/custom";

    await window.waitForLoadState("networkidle");
    await window.locator('[data-testid="open-settings"]').click();
    await expect(window.locator('[data-testid="settings-modal"]')).toBeVisible();

    const hfInput = window
      .locator('[data-testid="settings-modal"] input[type="text"]')
      .first();
    await expect(hfInput).toBeVisible();
    await hfInput.fill(mirrorUrl);
    await window.getByRole("button", { name: "Save" }).click();

    await expect
      .poll(() => {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
          hfMirrorUrl?: string | null;
        };
        return config.hfMirrorUrl;
      })
      .toBe(mirrorUrl);

    await app.close();

    const relaunched = await _electron.launch({
      args: [mainEntry()],
      env: {
        ...process.env,
        ELECTRON_USER_DATA_DIR_OVERRIDE: userDataDir,
      },
      timeout: 20_000,
    });

    try {
      const relaunchedWindow = await relaunched.firstWindow();
      await relaunchedWindow.waitForLoadState("networkidle");
      await relaunchedWindow.locator('[data-testid="open-settings"]').click();
      await expect(
        relaunchedWindow.locator('[data-testid="settings-modal"]'),
      ).toBeVisible();

      const relaunchedInput = relaunchedWindow
        .locator('[data-testid="settings-modal"] input[type="text"]')
        .first();
      await expect(relaunchedInput).toHaveValue(mirrorUrl);
    } finally {
      await relaunched.close().catch(() => undefined);
    }
  });
});
