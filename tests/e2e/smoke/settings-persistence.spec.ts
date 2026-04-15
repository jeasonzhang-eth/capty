import { test, expect } from "../fixtures";

test.describe("settings persistence", () => {
  test("settings modal tabs all render without errors", async ({
    seededApp,
  }) => {
    const { window } = seededApp;
    await window.waitForLoadState("networkidle");

    // Open settings
    await window.locator('[data-testid="open-settings"]').click();
    await expect(
      window.locator('[data-testid="settings-modal"]'),
    ).toBeVisible();

    // The five settings tabs: general, default-models, asr, tts, llm
    const tabIds = ["general", "default-models", "asr", "tts", "llm"];

    for (const tabId of tabIds) {
      const tab = window.locator(`[data-testid="settings-tab-${tabId}"]`);
      await expect(tab).toBeVisible();
      await tab.click();

      // After clicking, the tab should remain visible (no crash / blank render)
      await expect(tab).toBeVisible();

      // The settings modal should still be open
      await expect(
        window.locator('[data-testid="settings-modal"]'),
      ).toBeVisible();
    }
  });

  test("settings modal can be closed and reopened", async ({ seededApp }) => {
    const { window } = seededApp;
    await window.waitForLoadState("networkidle");

    // Open settings
    await window.locator('[data-testid="open-settings"]').click();
    await expect(
      window.locator('[data-testid="settings-modal"]'),
    ).toBeVisible();

    // Close via Escape key
    await window.keyboard.press("Escape");
    await expect(
      window.locator('[data-testid="settings-modal"]'),
    ).toHaveCount(0);

    // Reopen settings
    await window.locator('[data-testid="open-settings"]').click();
    await expect(
      window.locator('[data-testid="settings-modal"]'),
    ).toBeVisible();
  });

  test("switching tabs preserves modal state across tab changes", async ({
    seededApp,
  }) => {
    const { window } = seededApp;
    await window.waitForLoadState("networkidle");

    // Open settings
    await window.locator('[data-testid="open-settings"]').click();
    await expect(
      window.locator('[data-testid="settings-modal"]'),
    ).toBeVisible();

    // Navigate to LLM tab
    await window.locator('[data-testid="settings-tab-llm"]').click();

    // Switch to General tab
    await window.locator('[data-testid="settings-tab-general"]').click();

    // Switch back to LLM tab
    await window.locator('[data-testid="settings-tab-llm"]').click();

    // Modal is still open and functional after round-trip tab switching
    await expect(
      window.locator('[data-testid="settings-modal"]'),
    ).toBeVisible();
    await expect(
      window.locator('[data-testid="settings-tab-llm"]'),
    ).toBeVisible();
  });
});
