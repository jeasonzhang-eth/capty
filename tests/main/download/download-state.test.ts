import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  saveState,
  loadState,
  removeState,
  listIncompleteDownloads,
} from "../../../src/main/download/download-state";

describe("download-state", () => {
  let modelsDir: string;

  beforeEach(() => {
    modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), "capty-download-state-"));
  });

  afterEach(() => {
    fs.rmSync(modelsDir, { recursive: true, force: true });
  });

  it("saves and loads a persisted download state", () => {
    const state = {
      modelId: "model-a",
      repo: "mlx-community/model-a",
      destDir: "/tmp/model-a",
      category: "asr" as const,
      files: [
        {
          name: "weights.safetensors",
          totalBytes: 100,
          downloadedBytes: 25,
          completed: false,
        },
      ],
      status: "paused" as const,
      updatedAt: "2026-04-17T10:00:00Z",
    };

    saveState(modelsDir, state);

    expect(loadState(modelsDir, "model-a")).toEqual(state);
  });

  it("removes persisted state files", () => {
    saveState(modelsDir, {
      modelId: "model-a",
      repo: "mlx-community/model-a",
      destDir: "/tmp/model-a",
      category: "asr",
      files: [],
      status: "failed",
      updatedAt: "2026-04-17T10:00:00Z",
    });

    removeState(modelsDir, "model-a");

    expect(loadState(modelsDir, "model-a")).toBeNull();
  });

  it("lists only incomplete states and converts downloading to paused", () => {
    saveState(modelsDir, {
      modelId: "downloading-model",
      repo: "mlx-community/downloading-model",
      destDir: "/tmp/downloading-model",
      category: "asr",
      files: [],
      status: "downloading",
      updatedAt: "2026-04-17T10:00:00Z",
    });
    saveState(modelsDir, {
      modelId: "paused-model",
      repo: "mlx-community/paused-model",
      destDir: "/tmp/paused-model",
      category: "tts",
      files: [],
      status: "paused",
      updatedAt: "2026-04-17T10:00:00Z",
    });
    saveState(modelsDir, {
      modelId: "completed-model",
      repo: "mlx-community/completed-model",
      destDir: "/tmp/completed-model",
      category: "asr",
      files: [],
      status: "completed",
      updatedAt: "2026-04-17T10:00:00Z",
    });

    const incompletes = listIncompleteDownloads(modelsDir);

    expect(incompletes).toHaveLength(2);
    expect(
      incompletes.find((s) => s.modelId === "downloading-model")?.status,
    ).toBe("paused");
    expect(
      incompletes.find((s) => s.modelId === "paused-model")?.status,
    ).toBe("paused");
    expect(incompletes.find((s) => s.modelId === "completed-model")).toBe(
      undefined,
    );
  });

  it("ignores malformed state files when listing incomplete downloads", () => {
    const stateDir = path.join(modelsDir, ".downloads");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "broken.json"), "{not-json");

    expect(listIncompleteDownloads(modelsDir)).toEqual([]);
  });
});
