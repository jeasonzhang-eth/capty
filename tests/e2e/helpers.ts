import fs from "fs";
import path from "path";
import os from "os";
import type { Page } from "@playwright/test";

export interface LlmProviderConfig {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly models: string[];
}

export interface SeededConfig {
  dataDir: string;
  sidecar?: {
    port: number;
    host: string;
  };
  llmProviders?: LlmProviderConfig[];
  selectedLlmProviderId?: string;
  selectedSummaryModel?: { providerId: string; model: string };
}

/**
 * Create a temporary userData directory with a pre-populated config.json.
 * When `seedConfig` is provided, SetupWizard is skipped because `dataDir`
 * is already set. When omitted, SetupWizard will appear.
 */
export function createTempUserData(seedConfig?: SeededConfig): {
  userDataDir: string;
  dataDir: string;
} {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "capty-e2e-"));
  const dataDir =
    seedConfig?.dataDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), "capty-e2e-data-"));

  if (seedConfig) {
    const configPath = path.join(userDataDir, "config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ ...seedConfig, dataDir }, null, 2),
    );
  }

  return { userDataDir, dataDir };
}

/** Recursively delete a directory; no-op if missing. */
export function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors in tests
  }
}

/** Absolute path to the built Electron main entry. */
export function mainEntry(): string {
  return path.resolve(__dirname, "../../out/main/index.js");
}

export interface SeededSessions {
  readonly sessionAId: number;
  readonly sessionBId: number;
}

/**
 * Seed two sessions with segments via the app's renderer-exposed IPC API.
 * Uses `window.capty.createSession` + `window.capty.addSegment` so the
 * database is written inside the Electron process (avoiding Node/Electron
 * native-module ABI mismatches in test workers).
 */
export async function seedSessionsViaApp(
  window: Page,
): Promise<SeededSessions> {
  return await window.evaluate(async () => {
    const api = (window as unknown as { capty: any }).capty;
    const sessionAId = (await api.createSession("test")) as number;
    await api.addSegment({
      sessionId: sessionAId,
      startTime: 0,
      endTime: 5,
      text: "This is session A, the first test session.",
      audioPath: "",
      isFinal: true,
    });
    const sessionBId = (await api.createSession("test")) as number;
    await api.addSegment({
      sessionId: sessionBId,
      startTime: 0,
      endTime: 5,
      text: "This is session B, the second test session.",
      audioPath: "",
      isFinal: true,
    });
    return { sessionAId, sessionBId };
  });
}
