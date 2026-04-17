import fs from "fs";
import path from "path";
import { _electron, expect } from "@playwright/test";
import { test } from "../fixtures";
import { mainEntry } from "../helpers";

test.describe("playback and settings behavior", () => {
  test("Auto-start engine persists across relaunch", async ({ seededApp }) => {
    const { app, window, userDataDir } = seededApp;
    const configPath = path.join(userDataDir, "config.json");

    await window.waitForLoadState("networkidle");
    await window.locator("[data-testid='open-settings']").click();
    await expect(window.locator("[data-testid='settings-modal']")).toBeVisible();

    const toggle = window.locator("[data-testid='settings-auto-start-toggle']");
    await expect(toggle).toBeVisible();
    await toggle.click();

    await expect
      .poll(() => {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
          sidecar?: { autoStart?: boolean };
        };
        return config.sidecar?.autoStart;
      })
      .toBe(false);

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
      await relaunchedWindow.locator("[data-testid='open-settings']").click();
      await expect(
        relaunchedWindow.locator("[data-testid='settings-modal']"),
      ).toBeVisible();

      await expect
        .poll(() =>
          JSON.parse(fs.readFileSync(configPath, "utf-8")).sidecar.autoStart,
        )
        .toBe(false);
    } finally {
      await relaunched.close().catch(() => undefined);
    }
  });

  test("playback saves session position when stopped", async ({ seededApp }) => {
    const { window } = seededApp;

    const sessionId = await window.evaluate(async () => {
      const api = (window as unknown as { capty: any }).capty;
      const id = (await api.createSession("test-model")) as number;
      const dataDir = (await api.getDataDir()) as string;
      const timestamp = "2026-04-17T10-00-00";
      const sessionDir = `${dataDir}/audio/${timestamp}`;
      const seconds = 2;
      const pcm = new Int16Array(16000 * seconds);

      await api.updateSession(id, {
        title: "Playback Session",
        audioPath: timestamp,
        status: "completed",
        durationSeconds: seconds,
      });
      await api.saveFullAudio(sessionDir, pcm.buffer, `${timestamp}.wav`);
      return id;
    });

    await window.reload();
    await window.waitForLoadState("domcontentloaded");
    await window.waitForLoadState("networkidle");

    const categoryHeader = window.locator(
      "[data-testid='category-header-recording']",
    );
    await expect(categoryHeader).toBeVisible({ timeout: 10_000 });
    await categoryHeader.click();

    const sessionRow = window.locator(`[data-testid='session-row-${sessionId}']`);
    await expect(sessionRow).toBeVisible({ timeout: 10_000 });

    await window.locator(`[data-testid='session-play-toggle-${sessionId}']`).click();
    await expect(window.locator("[data-testid='playback-stop']")).toBeVisible({
      timeout: 10_000,
    });

    await window.waitForTimeout(1200);
    await window.locator("[data-testid='playback-rate-toggle']").click();
    await expect(window.locator("[data-testid='playback-rate-toggle']")).toHaveText(
      "1.25x",
    );

    await window.locator("[data-testid='playback-stop']").click({
      force: true,
    });

    await expect
      .poll(async () => {
        return await window.evaluate(async (id) => {
          const api = (window as unknown as { capty: any }).capty;
          const session = await api.getSession(id);
          return session?.playback_position ?? 0;
        }, sessionId);
      })
      .toBeGreaterThan(0);
  });

  test("playback responds to keyboard pause/resume controls", async ({
    seededApp,
  }) => {
    const { window } = seededApp;

    const sessionId = await window.evaluate(async () => {
      const api = (window as unknown as { capty: any }).capty;
      const id = (await api.createSession("test-model")) as number;
      const dataDir = (await api.getDataDir()) as string;
      const timestamp = "2026-04-17T10-00-20";
      const sessionDir = `${dataDir}/audio/${timestamp}`;
      const seconds = 20;
      const pcm = new Int16Array(16000 * seconds);

      await api.updateSession(id, {
        title: "Keyboard Playback Session",
        audioPath: timestamp,
        status: "completed",
        durationSeconds: seconds,
      });
      await api.saveFullAudio(sessionDir, pcm.buffer, `${timestamp}.wav`);
      return id;
    });

    await window.reload();
    await window.waitForLoadState("domcontentloaded");
    await window.waitForLoadState("networkidle");

    const categoryHeader = window.locator(
      "[data-testid='category-header-recording']",
    );
    await expect(categoryHeader).toBeVisible({ timeout: 10_000 });
    await categoryHeader.click();

    await window.locator(`[data-testid='session-play-toggle-${sessionId}']`).click();
    const playPause = window.locator("[data-testid='playback-play-pause']");
    await expect(playPause).toHaveAttribute("title", "Pause (Space)", {
      timeout: 10_000,
    });

    await window.keyboard.press("Space");
    await expect(playPause).toHaveAttribute("title", "Resume (Space)");

    await window.keyboard.press("Space");
    await expect(playPause).toHaveAttribute("title", "Pause (Space)");

    await window.locator("[data-testid='playback-stop']").click({
      force: true,
    });
  });
});
