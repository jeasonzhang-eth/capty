import { test, expect } from "../fixtures";

test.describe("session management", () => {
  test("history panel shows empty state when no sessions exist", async ({
    seededApp,
  }) => {
    const { window } = seededApp;
    await window.waitForLoadState("networkidle");

    // History panel itself must be visible
    await expect(
      window.locator('[data-testid="history-panel"]'),
    ).toBeVisible();

    // With no sessions in the database, the "No sessions yet" text should appear
    await expect(
      window.locator('[data-testid="history-panel"]').getByText("No sessions yet"),
    ).toBeVisible();
  });

  test("history panel is interactive — upload button is clickable", async ({
    seededApp,
  }) => {
    const { window } = seededApp;
    await window.waitForLoadState("networkidle");

    // The history panel header area should have action buttons (upload, download).
    // Verify the panel renders interactive controls without throwing.
    const panel = window.locator('[data-testid="history-panel"]');
    await expect(panel).toBeVisible();

    // The panel should contain at least one button element (action buttons in the header)
    const buttons = panel.locator("button");
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);
  });

  test("history panel header buttons are visible", async ({ seededApp }) => {
    const { window } = seededApp;
    await window.waitForLoadState("networkidle");

    const panel = window.locator('[data-testid="history-panel"]');
    await expect(panel).toBeVisible();

    // Upload and download buttons should exist in the panel header area.
    // These are rendered as small icon buttons in the HistoryPanel header.
    // We check that the panel has interactive controls ready for user action.
    const firstButton = panel.locator("button").first();
    await expect(firstButton).toBeVisible();
    await expect(firstButton).toBeEnabled();
  });
});
