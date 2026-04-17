import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

function createDeferred() {
  let resolve!: () => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mocks = vi.hoisted(() => {
  const taskInstances: any[] = [];
  const deferredQueue: Array<ReturnType<typeof createDeferred>> = [];
  const listIncompleteDownloadsMock = vi.fn();
  const removeStateMock = vi.fn();

  class MockTask {
    readonly modelId: string;
    readonly repo: string;
    readonly destDir: string;
    readonly category: "asr" | "tts";
    readonly opts: Record<string, unknown>;
    private status:
      | "pending"
      | "downloading"
      | "paused"
      | "completed"
      | "failed" = "pending";
    private readonly deferred:
      | ReturnType<typeof createDeferred>
      | undefined;

    constructor(opts: {
      modelId: string;
      repo: string;
      destDir: string;
      category: "asr" | "tts";
    }) {
      this.modelId = opts.modelId;
      this.repo = opts.repo;
      this.destDir = opts.destDir;
      this.category = opts.category;
      this.opts = opts;
      this.deferred = deferredQueue.shift();
      taskInstances.push(this);
    }

    start = vi.fn(async () => {
      if (this.status !== "paused") {
        this.status = "downloading";
      }
      if (this.deferred) {
        await this.deferred.promise;
      }
      if (this.status !== "failed") {
        this.status = "completed";
      }
    });

    pause = vi.fn(() => {
      this.status = "paused";
    });

    cancel = vi.fn(() => {
      this.status = "failed";
    });

    getStatus = vi.fn(() => this.status);
  }

  return {
    taskInstances,
    deferredQueue,
    listIncompleteDownloadsMock,
    removeStateMock,
    MockTask,
  };
});

vi.mock("../../../src/main/download/model-download-task", () => ({
  ModelDownloadTask: mocks.MockTask,
}));

vi.mock("../../../src/main/download/download-state", () => ({
  listIncompleteDownloads: mocks.listIncompleteDownloadsMock,
  removeState: mocks.removeStateMock,
}));

import {
  DownloadManager,
  isModelDownloaded,
  calcDirSizeGb,
} from "../../../src/main/download/download-manager";

describe("download-manager", () => {
  let modelsDir: string;

  beforeEach(() => {
    modelsDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "capty-download-manager-"),
    );
    mocks.taskInstances.length = 0;
    mocks.deferredQueue.length = 0;
    mocks.listIncompleteDownloadsMock.mockReset();
    mocks.removeStateMock.mockReset();
  });

  afterEach(() => {
    fs.rmSync(modelsDir, { recursive: true, force: true });
  });

  it("starts downloads immediately under the concurrency limit", async () => {
    const manager = new DownloadManager({
      modelsDir,
      mirrorUrl: "https://hf-mirror.com",
      onProgress: vi.fn(),
    });

    await manager.download(
      "model-a",
      "mlx-community/model-a",
      "/tmp/model-a",
      "asr",
    );

    expect(mocks.taskInstances).toHaveLength(1);
    expect(mocks.taskInstances[0].start).toHaveBeenCalledTimes(1);
    expect(mocks.taskInstances[0].opts.mirrorUrl).toBe("https://hf-mirror.com");
  });

  it("rejects duplicate downloads for the same active model", async () => {
    const manager = new DownloadManager({
      modelsDir,
      onProgress: vi.fn(),
    });
    const deferred = createDeferred();
    mocks.deferredQueue.push(deferred);

    const inFlight = manager.download(
      "model-a",
      "mlx-community/model-a",
      "/tmp/model-a",
      "asr",
    );

    await expect(
      manager.download(
        "model-a",
        "mlx-community/model-a",
        "/tmp/model-a",
        "asr",
      ),
    ).rejects.toThrow("already downloading");

    deferred.resolve();
    await inFlight;
  });

  it("queues downloads beyond the concurrency limit and starts them later", async () => {
    const manager = new DownloadManager({
      modelsDir,
      onProgress: vi.fn(),
    });
    const first = createDeferred();
    const second = createDeferred();
    const third = createDeferred();
    mocks.deferredQueue.push(first, second, third);

    const p1 = manager.download("a", "repo/a", "/tmp/a", "asr");
    const p2 = manager.download("b", "repo/b", "/tmp/b", "asr");
    const p3 = manager.download("c", "repo/c", "/tmp/c", "tts");

    expect(mocks.taskInstances).toHaveLength(3);
    expect(mocks.taskInstances[0].start).toHaveBeenCalledTimes(1);
    expect(mocks.taskInstances[1].start).toHaveBeenCalledTimes(1);
    expect(mocks.taskInstances[2].start).not.toHaveBeenCalled();
    expect(manager.getStatus("c")).toBe("pending");

    first.resolve();
    await p1;

    expect(mocks.taskInstances[2].start).toHaveBeenCalledTimes(1);

    second.resolve();
    third.resolve();
    await Promise.all([p2, p3]);
  });

  it("cancels queued downloads and rejects their pending promise", async () => {
    const manager = new DownloadManager({
      modelsDir,
      onProgress: vi.fn(),
    });
    const first = createDeferred();
    const second = createDeferred();
    const third = createDeferred();
    mocks.deferredQueue.push(first, second, third);

    const p1 = manager.download("a", "repo/a", "/tmp/a", "asr");
    const p2 = manager.download("b", "repo/b", "/tmp/b", "asr");
    const p3 = manager.download("c", "repo/c", "/tmp/c", "tts");

    expect(manager.cancel("c")).toBe(true);
    await expect(p3).rejects.toThrow("Cancelled");
    expect(mocks.taskInstances[2].cancel).toHaveBeenCalledTimes(1);

    first.resolve();
    second.resolve();
    await Promise.all([p1, p2]);
  });

  it("resumes incomplete downloads from persisted state", async () => {
    mocks.listIncompleteDownloadsMock.mockReturnValue([
      {
        modelId: "model-a",
        repo: "mlx-community/model-a",
        destDir: "/tmp/model-a",
        category: "asr",
        files: [],
        status: "paused",
      },
    ]);

    const manager = new DownloadManager({
      modelsDir,
      onProgress: vi.fn(),
    });

    await manager.resumeIncomplete("model-a");

    expect(mocks.taskInstances).toHaveLength(1);
    expect(mocks.taskInstances[0].repo).toBe("mlx-community/model-a");
    expect(mocks.taskInstances[0].start).toHaveBeenCalledTimes(1);
  });

  it("treats models with paused or downloading state files as incomplete", () => {
    const categoryDir = path.join(modelsDir, "asr");
    const modelDir = path.join(categoryDir, "model-a");
    fs.mkdirSync(modelDir, { recursive: true });
    fs.writeFileSync(path.join(modelDir, "weights.safetensors"), "weights");

    const stateDir = path.join(modelsDir, ".downloads");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "model-a.json"),
      JSON.stringify({ status: "paused" }),
    );

    expect(isModelDownloaded(categoryDir, "model-a")).toBe(false);
  });

  it("reports a downloaded model when it has weights and no blocking state", () => {
    const categoryDir = path.join(modelsDir, "asr");
    const modelDir = path.join(categoryDir, "model-a");
    fs.mkdirSync(modelDir, { recursive: true });
    fs.writeFileSync(path.join(modelDir, "weights.safetensors"), "weights");

    expect(isModelDownloaded(categoryDir, "model-a")).toBe(true);
  });

  it("calculates directory size from direct child files", () => {
    const dir = path.join(modelsDir, "sizes");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "a.bin"), Buffer.alloc(8 * 1024 * 1024));
    fs.writeFileSync(path.join(dir, "b.bin"), Buffer.alloc(8 * 1024 * 1024));

    expect(calcDirSizeGb(dir)).toBeGreaterThan(0);
  });
});
