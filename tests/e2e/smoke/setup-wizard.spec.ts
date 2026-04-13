import { test, expect } from "../fixtures";

test("SetupWizard is shown when no dataDir is configured", async ({ freshApp }) => {
  const { window } = freshApp;

  // Wait for React to mount
  await window.waitForLoadState("networkidle");

  // SetupWizard presence via data-testid
  const wizard = window.locator('[data-testid="setup-wizard"]');
  await expect(wizard).toBeVisible({ timeout: 10_000 });
});
