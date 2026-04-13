import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// Collect registered IPC handlers for testing
const handlers = new Map<string, (...args: any[]) => any>();

const mockWebContentsSend = vi.fn();

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler);
    }),
  },
  net: {
    fetch: vi.fn(),
  },
}));

// Mock global fetch used for health checks in tts:speak
const mockGlobalFetch = vi.fn();
vi.stubGlobal("fetch", mockGlobalFetch);

// Must import after mocks
import { register } from "../../../src/main/handlers/tts-handlers";
import { ipcMain } from "electron";

function makeTmpConfigDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "capty-tts-test-"));
  // Write a minimal config so readConfig doesn't fail
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      ttsProviders: [
        {
          id: "ext-1",
          name: "Test Provider",
          baseUrl: "http://tts.example.com",
          apiKey: "test-key",
          model: "tts-1",
          voice: "alloy",
          isSidecar: false,
        },
      ],
      selectedTtsProviderId: "ext-1",
      selectedTtsModelId: null,
    }),
  );
  return dir;
}

function createMockDb() {
  return {
    prepare: vi.fn().mockReturnValue({
      run: vi.fn().mockReturnValue({ lastInsertRowid: 1 }),
      get: vi.fn().mockReturnValue(null),
      all: vi.fn().mockReturnValue([]),
    }),
    exec: vi.fn(),
    pragma: vi.fn(),
    close: vi.fn(),
  } as any;
}

describe("tts-handlers", () => {
  let configDir: string;
  let mockDb: any;
  let mockMainWindow: any;

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();

    configDir = makeTmpConfigDir();
    mockDb = createMockDb();
    mockMainWindow = {
      webContents: { send: mockWebContentsSend },
    };

    register({
      db: mockDb,
      configDir,
      getMainWindow: () => mockMainWindow,
    });
  });

  describe("channel registration", () => {
    it("registers all 7 TTS channels", () => {
      const expected = [
        "tts:check-provider",
        "tts:list-voices",
        "tts:speak",
        "tts:speak-stream",
        "tts:cancel-stream",
        "tts:test",
        "config:save-tts-settings",
      ];
      for (const ch of expected) {
        expect(handlers.has(ch), `channel "${ch}" should be registered`).toBe(
          true,
        );
      }
    });
  });

  describe("tts:check-provider", () => {
    it("returns not-ready when no provider is configured", async () => {
      // Override config to have no providers
      fs.writeFileSync(
        path.join(configDir, "config.json"),
        JSON.stringify({ ttsProviders: [], selectedTtsProviderId: null }),
      );

      const handler = handlers.get("tts:check-provider")!;
      const result = await handler({} as any);
      expect(result.ready).toBe(false);
      expect(result.reason).toBe("No TTS provider configured");
    });

    it("returns ready when external provider is reachable", async () => {
      const { net } = await import("electron");
      (net.fetch as any).mockResolvedValueOnce({ ok: true, status: 200 });

      const handler = handlers.get("tts:check-provider")!;
      const result = await handler({} as any);
      expect(result.ready).toBe(true);
      expect(result.reason).toMatch(/reachable/i);
    });

    it("returns not-ready when provider is unreachable", async () => {
      const { net } = await import("electron");
      (net.fetch as any).mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const handler = handlers.get("tts:check-provider")!;
      const result = await handler({} as any);
      expect(result.ready).toBe(false);
      expect(result.reason).toBe("Provider unreachable");
    });
  });

  describe("tts:list-voices", () => {
    it("returns voices from provider", async () => {
      const { net } = await import("electron");
      (net.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            { id: "alloy", name: "Alloy" },
            { id: "echo", name: "Echo" },
          ],
        }),
      });

      const handler = handlers.get("tts:list-voices")!;
      const result = await handler({} as any);
      expect(result.voices).toHaveLength(2);
      expect(result.voices[0].id).toBe("alloy");
    });

    it("returns empty voices on fetch failure", async () => {
      const { net } = await import("electron");
      (net.fetch as any).mockRejectedValueOnce(new Error("Network error"));

      const handler = handlers.get("tts:list-voices")!;
      const result = await handler({} as any);
      expect(result.voices).toEqual([]);
    });
  });

  describe("tts:speak", () => {
    it("throws when no provider is configured", async () => {
      fs.writeFileSync(
        path.join(configDir, "config.json"),
        JSON.stringify({ ttsProviders: [], selectedTtsProviderId: null }),
      );

      const handler = handlers.get("tts:speak")!;
      await expect(handler({} as any, "Hello")).rejects.toThrow(
        "No TTS provider configured",
      );
    });

    it("returns audio buffer on success", async () => {
      const { net } = await import("electron");
      const fakeBuffer = new ArrayBuffer(256);
      // global fetch for health check
      mockGlobalFetch.mockResolvedValueOnce({ ok: true });
      // net.fetch for speech request
      (net.fetch as any).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => fakeBuffer,
      });

      const handler = handlers.get("tts:speak")!;
      const result = await handler({} as any, "Hello");
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.byteLength).toBe(256);
    });
  });

  describe("tts:cancel-stream", () => {
    it("does not throw when cancelling non-existent stream", () => {
      const handler = handlers.get("tts:cancel-stream")!;
      expect(() => handler({} as any, "nonexistent-stream-id")).not.toThrow();
    });
  });

  describe("tts:test", () => {
    it("returns success:false when no model is selected for external provider", async () => {
      // Provider with empty model
      fs.writeFileSync(
        path.join(configDir, "config.json"),
        JSON.stringify({
          ttsProviders: [
            {
              id: "ext-1",
              name: "Test Provider",
              baseUrl: "http://tts.example.com",
              apiKey: "test-key",
              model: "",
              voice: "alloy",
              isSidecar: false,
            },
          ],
          selectedTtsProviderId: "ext-1",
          selectedTtsModelId: null,
        }),
      );

      const handler = handlers.get("tts:test")!;
      const result = await handler({} as any, {
        baseUrl: "http://tts.example.com",
        apiKey: "test-key",
        model: "",
        isSidecar: false,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No TTS model/i);
    });

    it("returns success:true when audio response has enough bytes", async () => {
      const { net } = await import("electron");
      const bigBuffer = new ArrayBuffer(200);
      (net.fetch as any).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => bigBuffer,
      });

      const handler = handlers.get("tts:test")!;
      const result = await handler({} as any, {
        baseUrl: "http://tts.example.com",
        apiKey: "test-key",
        model: "tts-1",
        isSidecar: false,
      });
      expect(result.success).toBe(true);
      expect(result.bytes).toBe(200);
    });
  });

  describe("config:save-tts-settings", () => {
    it("saves TTS settings to config file", () => {
      const handler = handlers.get("config:save-tts-settings")!;
      const newProviders = [
        {
          id: "ext-2",
          name: "New Provider",
          baseUrl: "http://new-tts.example.com",
          apiKey: "new-key",
          model: "tts-2",
          voice: "nova",
          isSidecar: false,
        },
      ];

      handler({} as any, {
        ttsProviders: newProviders,
        selectedTtsProviderId: "ext-2",
        selectedTtsModelId: null,
      });

      const saved = JSON.parse(
        fs.readFileSync(path.join(configDir, "config.json"), "utf-8"),
      );
      expect(saved.ttsProviders).toHaveLength(1);
      expect(saved.ttsProviders[0].id).toBe("ext-2");
      expect(saved.selectedTtsProviderId).toBe("ext-2");
      expect(saved.selectedTtsModelId).toBeNull();
    });

    it("preserves existing config fields when saving TTS settings", () => {
      // Pre-write config with extra fields
      fs.writeFileSync(
        path.join(configDir, "config.json"),
        JSON.stringify({
          ttsProviders: [],
          selectedTtsProviderId: null,
          selectedTtsModelId: null,
          someOtherField: "keep-me",
        }),
      );

      const handler = handlers.get("config:save-tts-settings")!;
      handler({} as any, {
        ttsProviders: [],
        selectedTtsProviderId: null,
        selectedTtsModelId: null,
      });

      const saved = JSON.parse(
        fs.readFileSync(path.join(configDir, "config.json"), "utf-8"),
      );
      expect(saved.someOtherField).toBe("keep-me");
    });
  });
});
