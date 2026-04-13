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

    // Click the ASR tab
    await window.locator('[data-testid="settings-tab-asr"]').click();
    await expect(window.locator('[data-testid="settings-tab-asr"]')).toBeVisible();

    // Click the LLM tab
    await window.locator('[data-testid="settings-tab-llm"]').click();
    await expect(window.locator('[data-testid="settings-tab-llm"]')).toBeVisible();
  });
});
