import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";
import os from "os";
import fs from "fs";

// Collect registered IPC handlers for testing
const handlers = new Map<string, (...args: any[]) => any>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler);
    }),
  },
  app: {
    isPackaged: false,
    getPath: vi.fn(() => os.tmpdir()),
  },
  net: {
    fetch: vi.fn(),
  },
}));

// Mock DownloadManager
const mockDownloadManager = {
  download: vi.fn(),
  pause: vi.fn().mockReturnValue(true),
  resumeIncomplete: vi.fn(),
  cancel: vi.fn().mockReturnValue(true),
  getIncompleteDownloads: vi.fn().mockReturnValue([]),
  setMirrorUrl: vi.fn(),
};

vi.mock("../../../src/main/download/download-manager", () => ({
  DownloadManager: vi.fn().mockImplementation(() => mockDownloadManager),
  calcDirSizeGb: vi.fn().mockReturnValue(1.5),
  isModelDownloaded: vi.fn().mockReturnValue(true),
}));

// Mock config
vi.mock("../../../src/main/config", () => ({
  readConfig: vi.fn().mockReturnValue({
    dataDir: undefined,
    hfMirrorUrl: undefined,
  }),
  writeConfig: vi.fn(),
  getDataDir: vi.fn().mockReturnValue("/tmp/capty/data"),
}));

// Must import after mocks
import { register, migrateModelsDir } from "../../../src/main/handlers/model-handlers";
import { ipcMain } from "electron";

const MODEL_CHANNELS = [
  "models:list",
  "models:download",
  "models:search",
  "models:delete",
  "models:save-meta",
  "tts-models:list",
  "tts-models:download",
  "tts-models:search",
  "tts-models:delete",
  "tts-models:save-meta",
  "download:pause",
  "download:resume",
  "download:cancel",
  "download:list-incomplete",
] as const;

function createMockDeps(configDir: string) {
  return {
    db: {} as any,
    configDir,
    getMainWindow: vi.fn().mockReturnValue({
      webContents: { send: vi.fn() },
    }),
  };
}

describe("model-handlers", () => {
  let tmpDir: string;

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "model-handlers-test-"));
  });

  describe("register()", () => {
    it("registers all 14 model/download channels", () => {
      const deps = createMockDeps(tmpDir);
      register(deps);

      for (const channel of MODEL_CHANNELS) {
        expect(handlers.has(channel), `missing channel: ${channel}`).toBe(true);
      }
    });

    it("calls ipcMain.handle for each channel exactly once", () => {
      const deps = createMockDeps(tmpDir);
      register(deps);

      const handleCalls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => c[0],
      );
      for (const channel of MODEL_CHANNELS) {
        const count = handleCalls.filter((ch) => ch === channel).length;
        expect(count, `channel ${channel} registered ${count} times`).toBe(1);
      }
    });
  });

  describe("models:list", () => {
    it("returns an array (empty when no models on disk)", async () => {
      const deps = createMockDeps(tmpDir);
      register(deps);

      const handler = handlers.get("models:list");
      expect(handler).toBeDefined();

      const result = await handler!();
      expect(Array.isArray(result)).toBe(true);
    });

    it("returns downloaded models when asr directory has model subdirs", async () => {
      // Set up a fake model directory
      const asrDir = path.join(tmpDir, "data", "models", "asr");
      const modelDir = path.join(asrDir, "mlx-community--whisper-small");
      fs.mkdirSync(modelDir, { recursive: true });
      // Write a config.json so inferModelTypeFromDir works
      fs.writeFileSync(
        path.join(modelDir, "config.json"),
        JSON.stringify({ model_type: "whisper" }),
      );

      // Mock readConfig to point to tmpDir
      const { readConfig } = await import("../../../src/main/config");
      (readConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        dataDir: path.join(tmpDir, "data"),
        hfMirrorUrl: undefined,
      });

      const { isModelDownloaded } = await import(
        "../../../src/main/download/download-manager"
      );
      (isModelDownloaded as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const deps = createMockDeps(tmpDir);
      register(deps);

      const handler = handlers.get("models:list");
      const result = await handler!();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("migrateModelsDir()", () => {
    it("is exported as a named function", () => {
      expect(typeof migrateModelsDir).toBe("function");
    });

    it("creates asr/ and tts/ subdirectories", () => {
      const modelsDir = path.join(tmpDir, "models");
      fs.mkdirSync(modelsDir, { recursive: true });

      migrateModelsDir(tmpDir);

      expect(fs.existsSync(path.join(modelsDir, "asr"))).toBe(true);
      expect(fs.existsSync(path.join(modelsDir, "tts"))).toBe(true);
    });

    it("is idempotent — does nothing if asr/ already exists", () => {
      const asrDir = path.join(tmpDir, "models", "asr");
      fs.mkdirSync(asrDir, { recursive: true });

      // Should not throw
      expect(() => migrateModelsDir(tmpDir)).not.toThrow();
      expect(fs.existsSync(asrDir)).toBe(true);
    });

    it("moves existing flat model dirs into asr/", () => {
      const modelsDir = path.join(tmpDir, "models");
      const oldModelDir = path.join(modelsDir, "some-model");
      fs.mkdirSync(oldModelDir, { recursive: true });
      fs.writeFileSync(path.join(oldModelDir, "config.json"), "{}");

      migrateModelsDir(tmpDir);

      // Old location gone, new location exists
      expect(fs.existsSync(oldModelDir)).toBe(false);
      expect(
        fs.existsSync(path.join(modelsDir, "asr", "some-model")),
      ).toBe(true);
    });
  });

  describe("download:list-incomplete", () => {
    it("returns empty array when no downloads are in progress", async () => {
      const deps = createMockDeps(tmpDir);
      register(deps);

      const handler = handlers.get("download:list-incomplete");
      expect(handler).toBeDefined();

      const result = await handler!();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });

  describe("download:pause", () => {
    it("calls pause on the download manager", async () => {
      const deps = createMockDeps(tmpDir);
      register(deps);

      // Trigger lazy init by calling list-incomplete first
      await handlers.get("download:list-incomplete")!();

      const handler = handlers.get("download:pause");
      await handler!({} as any, "some-model-id");

      expect(mockDownloadManager.pause).toHaveBeenCalledWith("some-model-id");
    });
  });

  describe("download:cancel", () => {
    it("calls cancel on the download manager", async () => {
      const deps = createMockDeps(tmpDir);
      register(deps);

      await handlers.get("download:list-incomplete")!();

      const handler = handlers.get("download:cancel");
      await handler!({} as any, "some-model-id");

      expect(mockDownloadManager.cancel).toHaveBeenCalledWith("some-model-id");
    });
  });
});
