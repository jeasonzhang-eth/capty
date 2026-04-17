import { test, expect } from "../fixtures";

test.describe("download manager dialog", () => {
  test("opens from history panel and supports basic dialog interactions", async ({
    seededApp,
  }) => {
    const { window } = seededApp;
    await window.waitForLoadState("networkidle");

    await window.locator("[data-testid='history-download-audio']").click();
    await expect(
      window.locator("[data-testid='download-manager-dialog']"),
    ).toBeVisible();

    const input = window.locator("[data-testid='download-manager-url-input']");
    const submit = window.locator("[data-testid='download-manager-submit']");

    await expect(input).toBeVisible();
    await expect(submit).toBeDisabled();

    await input.fill("https://example.com/audio");
    await expect(submit).toBeEnabled();

    await window.locator("[data-testid='download-manager-close']").click();
    await expect(
      window.locator("[data-testid='download-manager-dialog']"),
    ).toHaveCount(0);

    await window.locator("[data-testid='history-download-audio']").click();
    await expect(
      window.locator("[data-testid='download-manager-dialog']"),
    ).toBeVisible();

    await window.locator("[data-testid='download-manager-overlay']").click({
      position: { x: 10, y: 10 },
    });
    await expect(
      window.locator("[data-testid='download-manager-dialog']"),
    ).toHaveCount(0);
  });
});
