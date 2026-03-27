/**
 * Persistent download state management.
 *
 * Stores download progress as JSON files under `<models-dir>/.downloads/`.
 * Allows crash recovery by scanning this directory on startup.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import type { DownloadState } from "./types";

function downloadsDir(modelsDir: string): string {
  return join(modelsDir, ".downloads");
}

function stateFilePath(modelsDir: string, modelId: string): string {
  return join(downloadsDir(modelsDir), `${modelId}.json`);
}

/** Ensure the `.downloads` directory exists. */
function ensureDir(modelsDir: string): void {
  const dir = downloadsDir(modelsDir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/** Save download state to disk. */
export function saveState(modelsDir: string, state: DownloadState): void {
  ensureDir(modelsDir);
  const filePath = stateFilePath(modelsDir, state.modelId);
  writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
}

/** Load download state for a specific model. Returns null if not found. */
export function loadState(
  modelsDir: string,
  modelId: string,
): DownloadState | null {
  const filePath = stateFilePath(modelsDir, modelId);
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as DownloadState;
  } catch {
    return null;
  }
}

/** Remove persisted state (after completion or cancellation). */
export function removeState(modelsDir: string, modelId: string): void {
  const filePath = stateFilePath(modelsDir, modelId);
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true });
  }
}

/** List all incomplete downloads (status = downloading | paused | failed). */
export function listIncompleteDownloads(modelsDir: string): DownloadState[] {
  const dir = downloadsDir(modelsDir);
  if (!existsSync(dir)) return [];

  const results: DownloadState[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = readFileSync(join(dir, file), "utf-8");
      const state = JSON.parse(raw) as DownloadState;
      if (
        state.status === "downloading" ||
        state.status === "paused" ||
        state.status === "failed"
      ) {
        // Mark as paused if it was mid-download (crash recovery)
        if (state.status === "downloading") {
          results.push({ ...state, status: "paused" });
        } else {
          results.push(state);
        }
      }
    } catch {
      // Skip malformed state files
    }
  }
  return results;
}
