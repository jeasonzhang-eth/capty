import { test, expect } from "../fixtures";

test.describe("no console errors", () => {
  test("seeded app has no console.error during startup", async ({
    seededApp,
  }) => {
    const { window } = seededApp;
    const errors: string[] = [];

    window.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    await window.waitForLoadState("networkidle");

    // Give the app a few seconds to settle — async operations, IPC calls, etc.
    await window.waitForTimeout(3000);

    // Filter out known benign errors (e.g. network requests to localhost sidecar
    // that isn't running in test environment)
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes("net::ERR_CONNECTION_REFUSED") &&
        !e.includes("ERR_CONNECTION_REFUSED") &&
        !e.includes("Failed to load resource") &&
        !e.includes("favicon"),
    );

    expect(criticalErrors).toEqual([]);
  });

  test("fresh app (setup wizard) has no console.error", async ({
    freshApp,
  }) => {
    const { window } = freshApp;
    const errors: string[] = [];

    window.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    await window.waitForLoadState("networkidle");

    // Wizard should be visible
    await expect(
      window.locator('[data-testid="setup-wizard"]'),
    ).toBeVisible({ timeout: 10_000 });

    // Wait a bit for any async initialization
    await window.waitForTimeout(2000);

    const criticalErrors = errors.filter(
      (e) =>
        !e.includes("net::ERR_CONNECTION_REFUSED") &&
        !e.includes("ERR_CONNECTION_REFUSED") &&
        !e.includes("Failed to load resource") &&
        !e.includes("favicon"),
    );

    expect(criticalErrors).toEqual([]);
  });

  test("navigating to settings produces no console.error", async ({
    seededApp,
  }) => {
    const { window } = seededApp;
    const errors: string[] = [];

    window.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    await window.waitForLoadState("networkidle");

    // Open settings
    await window.locator('[data-testid="open-settings"]').click();
    await expect(
      window.locator('[data-testid="settings-modal"]'),
    ).toBeVisible();

    // Wait for settings content to load (models, providers, etc.)
    await window.waitForTimeout(2000);

    const criticalErrors = errors.filter(
      (e) =>
        !e.includes("net::ERR_CONNECTION_REFUSED") &&
        !e.includes("ERR_CONNECTION_REFUSED") &&
        !e.includes("Failed to load resource") &&
        !e.includes("favicon"),
    );

    expect(criticalErrors).toEqual([]);
  });
});
