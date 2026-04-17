import { test, expect } from "../fixtures";

test.describe("history session management", () => {
  test("can rename and delete sessions from the history panel", async ({
    seededApp,
  }) => {
    const { window } = seededApp;

    const sessionIds = await window.evaluate(async () => {
      const api = (window as unknown as { capty: any }).capty;
      const alphaId = (await api.createSession("test-model")) as number;
      await api.updateSession(alphaId, { title: "Alpha Session" });

      const betaId = (await api.createSession("test-model")) as number;
      await api.updateSession(betaId, { title: "Beta Session" });

      return { alphaId, betaId };
    });

    await window.reload();
    await window.waitForLoadState("networkidle");

    const categoryHeader = window.locator(
      "[data-testid='category-header-recording']",
    );
    await expect(categoryHeader).toBeVisible({ timeout: 10_000 });
    await categoryHeader.click();

    const alphaRow = window.locator(
      `[data-testid='session-row-${sessionIds.alphaId}']`,
    );
    const betaRow = window.locator(
      `[data-testid='session-row-${sessionIds.betaId}']`,
    );

    await expect(alphaRow).toBeVisible({ timeout: 10_000 });
    await expect(betaRow).toBeVisible({ timeout: 10_000 });

    await alphaRow.click({ button: "right" });
    await window.getByText("Rename").click();

    const renameInput = alphaRow.locator("input");
    await expect(renameInput).toBeVisible({ timeout: 5_000 });
    await renameInput.fill("Renamed Session");
    await renameInput.press("Enter");

    await expect(alphaRow).toContainText("Renamed Session");

    await betaRow.click({ button: "right" });
    await window.getByText("Delete").click();

    await expect(window.getByText("确认删除")).toBeVisible({ timeout: 5_000 });
    await window.getByRole("button", { name: "删除" }).click();

    await expect(betaRow).toHaveCount(0, { timeout: 10_000 });
    await expect(alphaRow).toContainText("Renamed Session");
  });
});
