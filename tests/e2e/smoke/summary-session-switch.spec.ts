/**
 * E2E test: summary streaming must NOT leak across sessions.
 *
 * Steps:
 *   1. Launch app with LLM provider pointing to mock SSE server
 *   2. Seed DB with two sessions via the app's IPC API
 *   3. Select Session A → click Generate → wait for streaming
 *   4. Switch to Session B while streaming is in progress
 *   5. Assert: streaming card is NOT visible on Session B
 */
import {
  test as base,
  _electron,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import fs from "fs";
import path from "path";
import os from "os";
import { cleanupTempDir, mainEntry, seedSessionsViaApp } from "../helpers";
import { MockLlmServer } from "../mock-llm-server";

let mockServer: MockLlmServer;
let mockPort: number;

const test = base.extend({});

test.describe("summary session-switch isolation", () => {
  let app: ElectronApplication;
  let window: Page;
  let userDataDir: string;
  let dataDir: string;

  test.beforeAll(async () => {
    // Start mock LLM server with slow chunks (300ms apart, 8 words)
    // Slow enough that the stream is still in-flight during our assertion window
    mockServer = new MockLlmServer({
      words: [
        "LEAK",
        "LEAK",
        "LEAK",
        "LEAK",
        "LEAK",
        "LEAK",
        "LEAK",
        "LEAK",
        "LEAK",
        "LEAK",
      ],
      chunkDelayMs: 800,
    });
    mockPort = await mockServer.start();
  });

  test.afterAll(async () => {
    await mockServer.stop();
  });

  test.beforeEach(async () => {
    // Create temp dirs
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "capty-e2e-"));
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "capty-e2e-data-"));

    // Write config with mock LLM provider
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
    };
    fs.writeFileSync(
      path.join(userDataDir, "config.json"),
      JSON.stringify(config, null, 2),
    );

    // Launch Electron
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

    // Seed 2 sessions with segments via the app's IPC (avoids native module ABI issue)
    await seedSessionsViaApp(window);

    // Reload to pick up new sessions in the sidebar
    await window.reload();
    await window.waitForLoadState("domcontentloaded");
  });

  test.afterEach(async () => {
    await app.close().catch(() => undefined);
    cleanupTempDir(userDataDir);
    cleanupTempDir(dataDir);
  });

  test("session-scoped streaming: no leak to B, resumes on A when switching back", async () => {
    await window.waitForLoadState("networkidle");

    // Categories start collapsed — expand the "recording" category first
    const categoryHeader = window.locator(
      "[data-testid='category-header-recording']",
    );
    await expect(categoryHeader).toBeVisible({ timeout: 10_000 });
    await categoryHeader.click();

    // Wait for session rows to appear
    const sessionRows = window.locator("[data-testid^='session-row-']");
    await expect(sessionRows.first()).toBeVisible({ timeout: 10_000 });
    const rowCount = await sessionRows.count();
    expect(rowCount).toBeGreaterThanOrEqual(2);

    // Select Session A (first row) and start generation
    await sessionRows.first().click();
    await window.waitForTimeout(500);

    const generateBtn = window.locator("[data-testid='summary-generate-btn']");
    await expect(generateBtn).toBeVisible({ timeout: 5_000 });
    await expect(generateBtn).toBeEnabled({ timeout: 5_000 });
    await generateBtn.click();

    // Wait for streaming to start on A — card visible with LEAK text
    const streamingCard = window.locator("[data-testid='streaming-card']");
    await expect(streamingCard).toBeVisible({ timeout: 10_000 });
    await expect(streamingCard).toContainText("LEAK", { timeout: 5_000 });

    // Switch to Session B mid-stream
    await sessionRows.nth(1).click();

    // Assertion 1: Session B shows NO streaming card (no leak)
    await expect(streamingCard).toHaveCount(0, { timeout: 3_000 });

    // Let the stream keep running in the background while on B
    await window.waitForTimeout(2000);

    // Still no streaming card on B (no late-arriving leak)
    await expect(streamingCard).toHaveCount(0);

    // Switch BACK to Session A
    await sessionRows.first().click();

    // Assertion 2: On A we either see the streaming card with accumulated
    // content (still in progress), OR the saved summary card (completed).
    // In both cases the LEAK text must be present somewhere in the summary area.
    // Wait for either the streaming card or a saved summary to appear.
    const summaryArea = window.locator(".summary-md");
    await expect(summaryArea.first()).toBeVisible({ timeout: 15_000 });
    await expect(summaryArea.first()).toContainText("LEAK", {
      timeout: 15_000,
    });
  });
});
