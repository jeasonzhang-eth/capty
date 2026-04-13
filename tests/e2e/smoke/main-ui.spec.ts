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
