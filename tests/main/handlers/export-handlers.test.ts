import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDatabase } from "../../../src/main/database";

// Collect registered IPC handlers for testing
const handlers = new Map<string, (...args: any[]) => any>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: any[]) => any) => {
      handlers.set(channel, fn);
    }),
  },
  dialog: {
    showSaveDialog: vi.fn(),
  },
}));

// Must import after mocks are set up
import { register } from "../../../src/main/handlers/export-handlers";

describe("export-handlers", () => {
  let db: ReturnType<typeof createDatabase>;

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    db = createDatabase(":memory:");
  });

  function makeDeps(overrides: Partial<Parameters<typeof register>[0]> = {}) {
    return {
      db,
      configDir: "/tmp/test-config",
      getMainWindow: () => null,
      ...overrides,
    };
  }

  describe("channel registration", () => {
    it("registers all 5 export channels", () => {
      register(makeDeps());

      const expectedChannels = [
        "export:txt",
        "export:srt",
        "export:markdown",
        "export:save-file",
        "export:save-buffer",
      ];

      for (const channel of expectedChannels) {
        expect(
          handlers.has(channel),
          `channel "${channel}" should be registered`,
        ).toBe(true);
      }
    });
  });

  describe("export:txt", () => {
    it("returns plain text for a session with segments", () => {
      register(makeDeps());

      // Insert a session and segments into the in-memory database
      db.exec(
        `INSERT INTO sessions (id, title, started_at, model_name, status) VALUES (1, 'Test Session', '2026-04-13 10:00:00', 'test-model', 'done')`,
      );
      db.exec(
        `INSERT INTO segments (session_id, start_time, end_time, text, audio_path, is_final) VALUES (1, 0.0, 2.5, 'Hello world', '', 1)`,
      );
      db.exec(
        `INSERT INTO segments (session_id, start_time, end_time, text, audio_path, is_final) VALUES (1, 3.0, 5.8, '你好世界', '', 1)`,
      );

      const handler = handlers.get("export:txt")!;
      const result = handler({} as any, 1, { timestamps: false });
      expect(result).toBe("Hello world\n你好世界");
    });

    it("returns text with timestamps when timestamps option is true", () => {
      register(makeDeps());

      db.exec(
        `INSERT INTO sessions (id, title, started_at, model_name, status) VALUES (2, 'Session 2', '2026-04-13 10:00:00', 'test-model', 'done')`,
      );
      db.exec(
        `INSERT INTO segments (session_id, start_time, end_time, text, audio_path, is_final) VALUES (2, 0.0, 2.5, 'Hello', '', 1)`,
      );

      const handler = handlers.get("export:txt")!;
      const result = handler({} as any, 2, { timestamps: true });
      expect(result).toContain("[00:00:00]");
      expect(result).toContain("Hello");
    });
  });

  describe("export:srt", () => {
    it("returns SRT formatted content for a session with segments", () => {
      register(makeDeps());

      db.exec(
        `INSERT INTO sessions (id, title, started_at, model_name, status) VALUES (3, 'SRT Session', '2026-04-13 10:00:00', 'test-model', 'done')`,
      );
      db.exec(
        `INSERT INTO segments (session_id, start_time, end_time, text, audio_path, is_final) VALUES (3, 0.0, 2.5, 'Hello world', '', 1)`,
      );

      const handler = handlers.get("export:srt")!;
      const result = handler({} as any, 3);
      expect(result).toContain("1\n");
      expect(result).toContain("00:00:00,000 --> 00:00:02,500");
      expect(result).toContain("Hello world");
    });
  });

  describe("export:markdown", () => {
    it("returns markdown content with title and timestamps", () => {
      register(makeDeps());

      db.exec(
        `INSERT INTO sessions (id, title, started_at, model_name, status) VALUES (4, 'Markdown Session', '2026-04-13 10:00:00', 'test-model', 'done')`,
      );
      db.exec(
        `INSERT INTO segments (session_id, start_time, end_time, text, audio_path, is_final) VALUES (4, 0.0, 2.5, 'Hello world', '', 1)`,
      );

      const handler = handlers.get("export:markdown")!;
      const result = handler({} as any, 4);
      expect(result).toContain("## Markdown Session");
      expect(result).toContain("**00:00:00**");
      expect(result).toContain("Hello world");
    });
  });

  describe("export:save-file", () => {
    it("returns null when no main window is available", async () => {
      register(makeDeps({ getMainWindow: () => null }));

      const handler = handlers.get("export:save-file")!;
      const result = await handler({} as any, "test.txt", "content");
      expect(result).toBeNull();
    });
  });

  describe("export:save-buffer", () => {
    it("returns null when no main window is available", async () => {
      register(makeDeps({ getMainWindow: () => null }));

      const handler = handlers.get("export:save-buffer")!;
      const result = await handler(
        {} as any,
        "test.bin",
        new Uint8Array([1, 2, 3]),
        [{ name: "Binary", extensions: ["bin"] }],
      );
      expect(result).toBeNull();
    });
  });
});
