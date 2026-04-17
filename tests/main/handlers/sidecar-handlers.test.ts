import { describe, it, expect, vi, beforeEach } from "vitest";

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
    getAppPath: vi.fn().mockReturnValue("/mock/app"),
  },
}));

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
  },
}));

vi.mock("child_process", () => ({
  execSync: vi.fn().mockReturnValue(""),
}));

vi.mock("../../../src/main/config", () => ({
  readConfig: vi.fn().mockReturnValue({
    dataDir: "/tmp/test-data",
    sidecar: { port: 8765 },
  }),
}));

vi.mock("../../../src/main/shared/spawn", () => ({
  spawn: vi.fn(),
}));

// Must import after mocks
import {
  register,
  killSidecar,
} from "../../../src/main/handlers/sidecar-handlers";
import { readConfig } from "../../../src/main/config";

const mockDeps = {
  db: {} as any,
  configDir: "/tmp/test-config",
  getMainWindow: () => null,
};

describe("sidecar-handlers", () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    register(mockDeps);
  });

  describe("channel registration", () => {
    it("registers sidecar:get-url", () => {
      expect(handlers.has("sidecar:get-url")).toBe(true);
    });

    it("registers sidecar:health-check", () => {
      expect(handlers.has("sidecar:health-check")).toBe(true);
    });

    it("registers sidecar:start", () => {
      expect(handlers.has("sidecar:start")).toBe(true);
    });

    it("registers sidecar:stop", () => {
      expect(handlers.has("sidecar:stop")).toBe(true);
    });

    it("registers all 4 channels", () => {
      const sidecarChannels = [
        "sidecar:get-url",
        "sidecar:health-check",
        "sidecar:start",
        "sidecar:stop",
      ];
      for (const channel of sidecarChannels) {
        expect(
          handlers.has(channel),
          `channel "${channel}" should be registered`,
        ).toBe(true);
      }
    });
  });

  describe("sidecar:get-url", () => {
    it("returns a URL string", () => {
      const handler = handlers.get("sidecar:get-url")!;
      const result = handler();
      expect(typeof result).toBe("string");
      expect(result).toMatch(/^http:\/\/localhost:\d+$/);
    });

    it("returns URL using configured port", () => {
      const handler = handlers.get("sidecar:get-url")!;
      const result = handler();
      expect(result).toBe("http://localhost:8765");
    });

    it("reflects config port changes across calls", () => {
      vi.mocked(readConfig)
        .mockReturnValueOnce({
          dataDir: "/tmp/test-data",
          sidecar: { port: 8765 },
        } as any)
        .mockReturnValueOnce({
          dataDir: "/tmp/test-data",
          sidecar: { port: 9999 },
        } as any);

      const handler = handlers.get("sidecar:get-url")!;
      expect(handler()).toBe("http://localhost:8765");
      expect(handler()).toBe("http://localhost:9999");
    });
  });

  describe("sidecar:health-check", () => {
    it("returns { online: false } when fetch fails", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      const handler = handlers.get("sidecar:health-check")!;
      const result = await handler();
      expect(result).toEqual({ online: false });
    });

    it("returns { online: false } when response is not ok", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({}),
      });
      const handler = handlers.get("sidecar:health-check")!;
      const result = await handler();
      expect(result).toEqual({ online: false });
    });

    it("returns { online: false } when status is not ok", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ status: "starting" }),
      });
      const handler = handlers.get("sidecar:health-check")!;
      const result = await handler();
      expect(result).toEqual({ online: false });
    });

    it("returns { online: true } and health data when healthy", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ status: "ok", version: "1.0.0" }),
      });
      const handler = handlers.get("sidecar:health-check")!;
      const result = await handler();
      expect(result).toMatchObject({ online: true, status: "ok" });
    });
  });

  describe("sidecar:stop", () => {
    it("returns { ok: true }", () => {
      const handler = handlers.get("sidecar:stop")!;
      const result = handler();
      expect(result).toEqual({ ok: true });
    });
  });

  describe("killSidecar export", () => {
    it("is exported as a function", () => {
      expect(typeof killSidecar).toBe("function");
    });

    it("can be called without error when no process is running", () => {
      expect(() => killSidecar()).not.toThrow();
    });
  });
});
