import path from "path";
import { execFileSync } from "node:child_process";
import { test, expect } from "../fixtures";

function insertDownload(
  dbPath: string,
  fields: {
    url: string;
    source: string;
    status: string;
    progress?: number;
    speed?: string | null;
    eta?: string | null;
    session_id?: number | null;
    error?: string | null;
    created_at: string;
    completed_at?: string | null;
  },
): number {
  const script = `
import json
import sqlite3
import sys

db_path = sys.argv[1]
fields = json.loads(sys.argv[2])
conn = sqlite3.connect(db_path)
try:
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO downloads (
          url, source, status, progress, speed, eta, session_id, error, created_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            fields["url"],
            fields["source"],
            fields["status"],
            fields.get("progress", 0),
            fields.get("speed"),
            fields.get("eta"),
            fields.get("session_id"),
            fields.get("error"),
            fields["created_at"],
            fields.get("completed_at"),
        ),
    )
    conn.commit()
    print(cur.lastrowid)
finally:
    conn.close()
`.trim();

  const output = execFileSync(
    "python3",
    ["-c", script, dbPath, JSON.stringify(fields)],
    {
      encoding: "utf-8",
    },
  );
  return Number(output.trim());
}

test.describe("download manager flow", () => {
  test("auto-opens for interrupted downloads and can cancel them", async ({
    seededApp,
  }) => {
    const { window, dataDir } = seededApp;
    const dbPath = path.join(dataDir, "capty.db");

    const downloadingId = insertDownload(dbPath, {
      url: "https://example.com/audio",
      source: "example.com",
      status: "downloading",
      progress: 42,
      speed: "1.0MiB/s",
      eta: "00:10",
      created_at: "2026-04-17 10:00:00",
    });

    await window.reload();
    await window.waitForLoadState("domcontentloaded");
    await window.waitForLoadState("networkidle");

    await expect(
      window.locator("[data-testid='download-manager-dialog']"),
    ).toBeVisible({ timeout: 10_000 });
    const row = window.locator(`[data-testid='download-item-${downloadingId}']`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("42.0%");

    await window
      .locator(`[data-testid='download-item-cancel-${downloadingId}']`)
      .click();

    await expect(row).toContainText("Cancelled");
    await expect(
      window.locator(`[data-testid='download-item-retry-${downloadingId}']`),
    ).toBeVisible();
    await expect(
      window.locator(`[data-testid='download-item-remove-${downloadingId}']`),
    ).toBeVisible();
  });

  test("can remove failed downloads and select completed downloads", async ({
    seededApp,
  }) => {
    const { window, dataDir } = seededApp;
    const dbPath = path.join(dataDir, "capty.db");

    const session = await window.evaluate(async () => {
      const api = (window as unknown as { capty: any }).capty;
      const sessionId = (await api.createSession("test-model")) as number;
      await api.addSegment({
        sessionId,
        startTime: 0,
        endTime: 2,
        text: "Completed download transcript",
        audioPath: "",
        isFinal: true,
      });
      return { sessionId };
    });

    const failedId = insertDownload(dbPath, {
      url: "https://example.com/failed",
      source: "example.com",
      status: "failed",
      error: "network error",
      created_at: "2026-04-17 10:01:00",
    });
    const completedId = insertDownload(dbPath, {
      url: "https://example.com/completed",
      source: "example.com",
      status: "completed",
      session_id: session.sessionId,
      created_at: "2026-04-17 10:02:00",
      completed_at: "2026-04-17 10:03:00",
    });

    await window.reload();
    await window.waitForLoadState("domcontentloaded");
    await window.waitForLoadState("networkidle");

    await window.locator("[data-testid='history-download-audio']").click();
    await expect(
      window.locator("[data-testid='download-manager-dialog']"),
    ).toBeVisible();

    await window
      .locator(`[data-testid='download-item-remove-${failedId}']`)
      .click();
    await expect(
      window.locator(`[data-testid='download-item-${failedId}']`),
    ).toHaveCount(0);

    await window.locator(`[data-testid='download-item-${completedId}']`).click();
    await expect(
      window.locator("[data-testid='download-manager-dialog']"),
    ).toHaveCount(0);
    await expect(
      window.getByText("Completed download transcript"),
    ).toBeVisible({ timeout: 10_000 });
  });
});
