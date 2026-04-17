import {
  test as base,
  _electron,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { cleanupTempDir, mainEntry, seedSessionsViaApp } from "../helpers";
import { MockLlmServer } from "../mock-llm-server";

const test = base.extend({});

test.describe("summary and transcript behavior", () => {
  let mockServer: MockLlmServer;
  let mockPort: number;
  let app: ElectronApplication;
  let window: Page;
  let userDataDir: string;
  let dataDir: string;

  test.beforeAll(async () => {
    mockServer = new MockLlmServer({
      words: ["QUESTION", "TAB"],
      chunkDelayMs: 150,
      nonStreamingContent: "Translated text",
      nonStreamingDelayMs: 400,
    });
    mockPort = await mockServer.start();
  });

  test.afterAll(async () => {
    await mockServer.stop();
  });

  test.beforeEach(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "capty-e2e-"));
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "capty-e2e-data-"));

    const config = {
      dataDir,
      llmProviders: [
        {
          id: "mock-llm",
          name: "Mock LLM",
          baseUrl: `http://127.0.0.1:${mockPort}/v1`,
          apiKey: "test-key",
          models: ["mock-model"],
        },
      ],
      selectedLlmProviderId: "mock-llm",
      selectedSummaryModel: { providerId: "mock-llm", model: "mock-model" },
      selectedTranslateModel: { providerId: "mock-llm", model: "mock-model" },
    };
    fs.writeFileSync(
      path.join(userDataDir, "config.json"),
      JSON.stringify(config, null, 2),
    );

    app = await _electron.launch({
      args: [mainEntry()],
      env: {
        ...process.env,
        ELECTRON_USER_DATA_DIR_OVERRIDE: userDataDir,
      },
      timeout: 20_000,
    });
    window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    await seedSessionsViaApp(window);

    await window.reload();
    await window.waitForLoadState("domcontentloaded");
    await window.waitForLoadState("networkidle");

    const categoryHeader = window.locator(
      "[data-testid='category-header-recording']",
    );
    await expect(categoryHeader).toBeVisible({ timeout: 10_000 });
    await categoryHeader.click();

    const firstSession = window.locator("[data-testid^='session-row-']").first();
    await expect(firstSession).toBeVisible({ timeout: 10_000 });
    await firstSession.click();
  });

  test.afterEach(async () => {
    await app.close().catch(() => undefined);
    cleanupTempDir(userDataDir);
    cleanupTempDir(dataDir);
  });

  test("SummaryPanel keeps content isolated by prompt tab", async () => {
    await window.getByRole("button", { name: "Questions" }).click();

    const generateBtn = window.locator("[data-testid='summary-generate-btn']");
    await expect(generateBtn).toBeVisible({ timeout: 5_000 });
    await generateBtn.click();

    await expect(window.locator(".summary-md").first()).toContainText(
      "QUESTION TAB",
      { timeout: 10_000 },
    );

    await window.getByRole("button", { name: "Summary" }).click();
    await expect(window.getByText("QUESTION TAB")).toHaveCount(0);
    await expect(
      window.getByText("Click Generate to create summary"),
    ).toBeVisible();

    await window.getByRole("button", { name: "Questions" }).click();
    await expect(window.locator(".summary-md").first()).toContainText(
      "QUESTION TAB",
    );
  });

  test("TranscriptArea can translate and toggle translation visibility", async () => {
    const translateButton = window.locator(
      "[data-testid='transcript-translate-trigger']",
    );
    await expect(translateButton).toBeVisible({ timeout: 5_000 });

    await translateButton.click();
    await window
      .locator("[data-testid='transcript-translate-action']")
      .click();

    await expect(window.getByText("Translated text").first()).toBeVisible({
      timeout: 10_000,
    });

    await translateButton.click();
    await window
      .locator("[data-testid='transcript-toggle-translation']")
      .click();
    await expect(window.getByText("Translated text")).toHaveCount(0);

    await translateButton.click();
    await window
      .locator("[data-testid='transcript-toggle-translation']")
      .click();
    await expect(window.getByText("Translated text").first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("TranscriptArea persists selected target language across reload", async () => {
    const translateButton = window.locator(
      "[data-testid='transcript-translate-trigger']",
    );
    await expect(translateButton).toBeVisible({ timeout: 5_000 });

    await translateButton.click();
    await window.locator("[data-testid='transcript-target-language']").hover();
    await window.getByRole("button", { name: "English" }).click();

    await expect(
      window.locator("[data-testid='transcript-target-language']"),
    ).toContainText("English");

    await window.reload();
    await window.waitForLoadState("domcontentloaded");
    await window.waitForLoadState("networkidle");

    const categoryHeader = window.locator(
      "[data-testid='category-header-recording']",
    );
    await expect(categoryHeader).toBeVisible({ timeout: 10_000 });
    await categoryHeader.click();

    const firstSession = window.locator("[data-testid^='session-row-']").first();
    await expect(firstSession).toBeVisible({ timeout: 10_000 });
    await firstSession.click();

    await window.locator("[data-testid='transcript-translate-trigger']").click();
    await expect(
      window.locator("[data-testid='transcript-target-language']"),
    ).toContainText("English");
  });

  test("TranscriptArea can stop and restart translation", async () => {
    const sessionId = await window.evaluate(async () => {
      const api = (window as unknown as { capty: any }).capty;
      const sessionId = (await api.createSession("test-model")) as number;
      await api.updateSession(sessionId, {
        title: "Translation Stress Session",
        status: "completed",
      });

      for (let i = 0; i < 6; i++) {
        await api.addSegment({
          sessionId,
          startTime: i * 2,
          endTime: i * 2 + 1,
          text: `Segment ${i + 1}`,
          audioPath: "",
          isFinal: true,
        });
      }
      return sessionId;
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
    await sessionRow.click();

    const translateButton = window.locator(
      "[data-testid='transcript-translate-trigger']",
    );
    await expect(translateButton).toBeVisible({ timeout: 5_000 });

    await translateButton.click();
    await window
      .locator("[data-testid='transcript-translate-action']")
      .click();

    await expect(translateButton).toContainText("Translating", {
      timeout: 5_000,
    });

    await translateButton.click();
    await window
      .locator("[data-testid='transcript-translate-action']")
      .click();

    await expect(translateButton).toContainText("Translate", { timeout: 5_000 });
    await expect(window.getByText("Translated text")).toHaveCount(0);

    await translateButton.click();
    await window
      .locator("[data-testid='transcript-translate-action']")
      .click();

    await expect(window.getByText("Translated text").first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
