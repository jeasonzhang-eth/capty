import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const mocks = vi.hoisted(() => ({
  downloadFileMock: vi.fn(),
  getLocalFileSizeMock: vi.fn(),
  saveStateMock: vi.fn(),
  removeStateMock: vi.fn(),
}));

vi.mock("../../../src/main/download/file-download-task", () => ({
  downloadFile: mocks.downloadFileMock,
  getLocalFileSize: mocks.getLocalFileSizeMock,
}));

vi.mock("../../../src/main/download/download-state", () => ({
  saveState: mocks.saveStateMock,
  removeState: mocks.removeStateMock,
}));

import { ModelDownloadTask } from "../../../src/main/download/model-download-task";

describe("model-download-task", () => {
  let tmpDir: string;
  let destDir: string;
  const fetchMock = vi.fn();

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "capty-model-task-"));
    destDir = path.join(tmpDir, "model");
    mocks.downloadFileMock.mockReset();
    mocks.getLocalFileSizeMock.mockReset();
    mocks.saveStateMock.mockReset();
    mocks.removeStateMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fails fast on deterministic 4xx model-list errors without retrying", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const progress = vi.fn();
    const task = new ModelDownloadTask({
      modelId: "missing-model",
      repo: "mlx-community/missing-model",
      destDir,
      category: "asr",
      modelsDir: tmpDir,
      onProgress: progress,
    });

    await expect(task.start()).rejects.toThrow(
      "Cannot access mlx-community/missing-model: HTTP 404 Not Found",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(task.getStatus()).toBe("failed");
    expect(mocks.saveStateMock).toHaveBeenCalled();
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("completes successfully and removes persisted state after download", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          siblings: [{ rfilename: "weights.safetensors" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-length": "4" }),
      });

    mocks.getLocalFileSizeMock.mockReturnValue(0);
    mocks.downloadFileMock.mockImplementation(
      async ({
        filePath,
        onData,
      }: {
        filePath: string;
        onData?: (bytes: number) => void;
      }) => {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, Buffer.alloc(4));
        onData?.(4);
        return 4;
      },
    );

    const progress = vi.fn();
    const task = new ModelDownloadTask({
      modelId: "model-a",
      repo: "mlx-community/model-a",
      destDir,
      category: "asr",
      modelsDir: tmpDir,
      onProgress: progress,
    });

    await expect(task.start()).resolves.toBeUndefined();

    expect(task.getStatus()).toBe("completed");
    expect(mocks.removeStateMock).toHaveBeenCalledWith(tmpDir, "model-a");
    expect(mocks.downloadFileMock).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "completed",
        total: 4,
        downloaded: 4,
        percent: 100,
      }),
    );
  });
});
