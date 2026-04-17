import { test, expect, _electron } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import {
  cleanupTempDir,
  createTempUserData,
  mainEntry,
} from "../helpers";

test("setup wizard persists config and is skipped after relaunch", async () => {
  test.slow();

  const { userDataDir } = createTempUserData();
  const tempDocumentsDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "capty-e2e-docs-"),
  );
  const expectedDataDir = path.join(tempDocumentsDir, "Capty");
  const launchEnv = {
    ...process.env,
    ELECTRON_USER_DATA_DIR_OVERRIDE: userDataDir,
    ELECTRON_DOCUMENTS_DIR_OVERRIDE: tempDocumentsDir,
  };

  let app = await _electron.launch({
    args: [mainEntry()],
    env: launchEnv,
    timeout: 20_000,
  });

  try {
    let window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    await expect(window.locator('[data-testid="setup-wizard"]')).toBeVisible();
    await window.locator('input[type="checkbox"]').check();
    await window.getByRole("button", { name: "Get Started" }).click();

    await expect(
      window.getByRole("heading", { name: "System Dependencies" }),
    ).toBeVisible();
    await window.getByRole("button", { name: "Continue" }).click();

    await expect(
      window.getByRole("heading", { name: "Configure AI Providers" }),
    ).toBeVisible();
    await window.getByRole("button", { name: "Skip" }).click();

    await expect(window.locator('[data-testid="control-bar"]')).toBeVisible({
      timeout: 10_000,
    });

    const configPath = path.join(userDataDir, "config.json");
    await expect
      .poll(() => fs.existsSync(configPath), { timeout: 5_000 })
      .toBe(true);

    let config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
      dataDir?: string | null;
      hfMirrorUrl?: string | null;
    };
    expect(config.dataDir).toBe(expectedDataDir);
    expect(config.hfMirrorUrl).toBe("https://hf-mirror.com");
    expect(fs.existsSync(path.join(expectedDataDir, "capty.db"))).toBe(true);

    await app.close();

    app = await _electron.launch({
      args: [mainEntry()],
      env: launchEnv,
      timeout: 20_000,
    });
    window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    await expect(window.locator('[data-testid="setup-wizard"]')).toHaveCount(0);
    await expect(window.locator('[data-testid="control-bar"]')).toBeVisible({
      timeout: 10_000,
    });

    config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
      dataDir?: string | null;
      hfMirrorUrl?: string | null;
    };
    expect(config.dataDir).toBe(expectedDataDir);
    expect(config.hfMirrorUrl).toBe("https://hf-mirror.com");
  } finally {
    await app.close().catch(() => undefined);
    cleanupTempDir(userDataDir);
    cleanupTempDir(expectedDataDir);
    cleanupTempDir(tempDocumentsDir);
  }
});
