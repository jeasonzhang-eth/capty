import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// Collect registered IPC handlers for testing
const handlers = new Map<string, (...args: any[]) => any>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((ch: string, fn: (...args: any[]) => any) => {
      handlers.set(ch, fn);
    }),
  },
  app: {
    getPath: vi.fn(() => "/tmp/test"),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
  },
}));

// Must import after mocks
import { register } from "../../../src/main/handlers/config-handlers";
import { ipcMain, app, dialog, shell } from "electron";
import { createDatabase } from "../../../src/main/database";

function makeDeps(overrides: Partial<Parameters<typeof register>[0]> = {}) {
  const db = createDatabase(":memory:");
  return {
    db,
    configDir: "/tmp/test-config",
    getMainWindow: () => null,
    ...overrides,
  };
}

describe("config-handlers", () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
  });

  describe("registration", () => {
    it("registers all 9 expected channels", () => {
      const deps = makeDeps();
      register(deps);

      const expectedChannels = [
        "config:get",
        "config:set",
        "config:get-default-data-dir",
        "app:get-config-dir",
        "app:get-data-dir",
        "app:open-config-dir",
        "app:select-directory",
        "layout:save",
        "deps:check",
      ];

      for (const channel of expectedChannels) {
        expect(
          handlers.has(channel),
          `channel "${channel}" should be registered`,
        ).toBe(true);
      }
    });
  });

  describe("config:get", () => {
    it("returns a config object", () => {
      register(makeDeps());
      const handler = handlers.get("config:get")!;
      const result = handler({} as any);
      expect(result).toBeDefined();
      expect(typeof result).toBe("object");
    });
  });

  describe("config:set", () => {
    it("updates config without throwing", () => {
      register(makeDeps());
      const setHandler = handlers.get("config:set")!;
      expect(() =>
        setHandler({} as any, { someSetting: "value" }),
      ).not.toThrow();
    });

    it("persists values that can be retrieved via config:get", () => {
      register(makeDeps());
      const getHandler = handlers.get("config:get")!;
      const setHandler = handlers.get("config:set")!;

      setHandler({} as any, { __testKey: "hello" });
      const config = getHandler({} as any);
      expect((config as any).__testKey).toBe("hello");
    });

    it("blocks security-sensitive keys (dataDir, hfMirrorUrl, sidecar, modelRegistryUrl)", () => {
      // These keys have dedicated IPCs with validation. Letting config:set
      // write them would enable SSRF (hfMirrorUrl), arbitrary directory
      // writes (dataDir), and shell injection via sidecar.port.
      const configDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "capty-config-handlers-"),
      );
      register(makeDeps({ configDir }));

      const getHandler = handlers.get("config:get")!;
      const setHandler = handlers.get("config:set")!;

      setHandler({} as any, {
        dataDir: "/tmp/capty-data",
        hfMirrorUrl: "https://hf-mirror.com",
        sidecar: { port: "8765; evil" },
        modelRegistryUrl: "https://attacker.example/registry.json",
        // A non-blocked key should still pass through.
        zoomFactor: 1.25,
      });
      const config = getHandler({} as any);

      expect((config as any).dataDir).toBeFalsy();
      expect((config as any).hfMirrorUrl).toBeFalsy();
      // sidecar keeps its default (not overwritten with the malicious port).
      expect((config as any).sidecar?.port).not.toBe("8765; evil");
      expect((config as any).modelRegistryUrl).toBeFalsy();
      expect((config as any).zoomFactor).toBe(1.25);

      fs.rmSync(configDir, { recursive: true, force: true });
    });
  });

  describe("config:get-default-data-dir", () => {
    it("returns a string path", () => {
      register(makeDeps());
      const handler = handlers.get("config:get-default-data-dir")!;
      const result = handler({} as any);
      expect(typeof result).toBe("string");
      expect(result).toContain("Capty");
    });

    it("uses documents override when provided", () => {
      const original = process.env.ELECTRON_DOCUMENTS_DIR_OVERRIDE;
      process.env.ELECTRON_DOCUMENTS_DIR_OVERRIDE = "/tmp/e2e-documents";
      try {
        register(makeDeps());
        const handler = handlers.get("config:get-default-data-dir")!;
        expect(handler({} as any)).toBe("/tmp/e2e-documents/Capty");
      } finally {
        if (original === undefined) {
          delete process.env.ELECTRON_DOCUMENTS_DIR_OVERRIDE;
        } else {
          process.env.ELECTRON_DOCUMENTS_DIR_OVERRIDE = original;
        }
      }
    });
  });

  describe("app:get-config-dir", () => {
    it("returns the configDir passed via deps", () => {
      register(makeDeps({ configDir: "/tmp/test-config" }));
      const handler = handlers.get("app:get-config-dir")!;
      expect(handler({} as any)).toBe("/tmp/test-config");
    });
  });

  describe("app:get-data-dir", () => {
    it("returns a string", () => {
      register(makeDeps());
      const handler = handlers.get("app:get-data-dir")!;
      const result = handler({} as any);
      // May be string or null depending on config; just verify it doesn't throw
      expect(result === null || typeof result === "string").toBe(true);
    });
  });

  describe("app:open-config-dir", () => {
    it("calls shell.openPath with configDir", () => {
      register(makeDeps({ configDir: "/tmp/open-test" }));
      const handler = handlers.get("app:open-config-dir")!;
      handler({} as any);
      expect(shell.openPath).toHaveBeenCalledWith("/tmp/open-test");
    });
  });

  describe("app:select-directory", () => {
    it("returns null when getMainWindow returns null", async () => {
      register(makeDeps({ getMainWindow: () => null }));
      const handler = handlers.get("app:select-directory")!;
      const result = await handler({} as any);
      expect(result).toBeNull();
    });
  });

  describe("layout:save", () => {
    it("saves layout widths without throwing", () => {
      register(makeDeps());
      const handler = handlers.get("layout:save")!;
      expect(() =>
        handler({} as any, {
          historyPanelWidth: 300,
          summaryPanelWidth: 400,
        }),
      ).not.toThrow();
    });
  });

  describe("deps:check", () => {
    it("returns an array of dependency check results", async () => {
      register(makeDeps());
      const handler = handlers.get("deps:check")!;
      const result = await handler({} as any);
      expect(Array.isArray(result)).toBe(true);
      for (const dep of result as any[]) {
        expect(dep).toHaveProperty("name");
        expect(dep).toHaveProperty("installed");
        expect(dep).toHaveProperty("version");
      }
    });
  });
});
