import fs from "fs";
import path from "path";
import os from "os";

export interface SeededConfig {
  dataDir: string;
  sidecar?: {
    port: number;
    host: string;
  };
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
