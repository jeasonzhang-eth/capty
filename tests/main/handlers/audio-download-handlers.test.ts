import { describe, it, expect, vi, beforeEach } from "vitest";

// Collect registered IPC handlers for testing
const handlers = new Map<string, (...args: any[]) => any>();

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

// Must import after mocks
import { register } from "../../../src/main/handlers/audio-download-handlers";
import { createDatabase } from "../../../src/main/database";

describe("audio-download-handlers", () => {
  let db: ReturnType<typeof createDatabase>;

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    db = createDatabase(":memory:");
  });

  const makeDeps = () => ({
    db,
    configDir: "/tmp/test-capty",
    getMainWindow: () => null,
  });

  describe("channel registration", () => {
    it("registers all 5 audio download channels", () => {
      register(makeDeps());

      expect(handlers.has("audio:download-start")).toBe(true);
      expect(handlers.has("audio:download-list")).toBe(true);
      expect(handlers.has("audio:download-remove")).toBe(true);
      expect(handlers.has("audio:download-cancel")).toBe(true);
      expect(handlers.has("audio:download-retry")).toBe(true);
    });
  });

  describe("audio:download-list", () => {
    it("returns an empty array when no downloads exist", () => {
      register(makeDeps());
      const handler = handlers.get("audio:download-list")!;
      const result = handler();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });

    it("returns downloads after one is created", async () => {
      register(makeDeps());

      // Directly insert a download record via DB
      db.prepare(
        "INSERT INTO downloads (url, source, status, created_at) VALUES (?, ?, ?, ?)",
      ).run("https://example.com/video", "example.com", "pending", new Date().toISOString());

      const handler = handlers.get("audio:download-list")!;
      const result = handler();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0].url).toBe("https://example.com/video");
    });
  });

  describe("audio:download-remove", () => {
    it("removes a download record from the database", () => {
      register(makeDeps());

      const { lastInsertRowid } = db.prepare(
        "INSERT INTO downloads (url, source, status, created_at) VALUES (?, ?, ?, ?)",
      ).run("https://example.com/video", "example.com", "completed", new Date().toISOString());

      const id = Number(lastInsertRowid);

      const removeHandler = handlers.get("audio:download-remove")!;
      removeHandler({} as any, id);

      const listHandler = handlers.get("audio:download-list")!;
      const result = listHandler();
      expect(result).toHaveLength(0);
    });
  });

  describe("audio:download-cancel", () => {
    it("marks a download as cancelled", () => {
      register(makeDeps());

      const { lastInsertRowid } = db.prepare(
        "INSERT INTO downloads (url, source, status, created_at) VALUES (?, ?, ?, ?)",
      ).run("https://example.com/video", "example.com", "downloading", new Date().toISOString());

      const id = Number(lastInsertRowid);

      const cancelHandler = handlers.get("audio:download-cancel")!;
      cancelHandler({} as any, id);

      const row = db.prepare("SELECT status FROM downloads WHERE id = ?").get(id) as { status: string };
      expect(row.status).toBe("cancelled");
    });
  });

  describe("audio:download-retry", () => {
    it("throws when download is not found", async () => {
      register(makeDeps());
      const handler = handlers.get("audio:download-retry")!;
      await expect(handler({} as any, 9999)).rejects.toThrow("Download not found");
    });
  });
});

describe("helper functions (extractSource / isXiaoyuzhouUrl)", () => {
  // These are private module-level functions; we test their observable behavior
  // through audio:download-list and audio:download-start handler side effects,
  // but we also export them for direct testing.
  it("extractSource returns hostname without www prefix", async () => {
    const { extractSource } = await import("../../../src/main/handlers/audio-download-handlers");
    expect(extractSource("https://www.youtube.com/watch?v=abc")).toBe("youtube.com");
    expect(extractSource("https://example.com/path")).toBe("example.com");
    expect(extractSource("not-a-url")).toBe("unknown");
  });

  it("isXiaoyuzhouUrl returns true for xiaoyuzhoufm.com URLs", async () => {
    const { isXiaoyuzhouUrl } = await import("../../../src/main/handlers/audio-download-handlers");
    expect(isXiaoyuzhouUrl("https://www.xiaoyuzhoufm.com/episode/123")).toBe(true);
    expect(isXiaoyuzhouUrl("https://xiaoyuzhoufm.com/episode/123")).toBe(true);
    expect(isXiaoyuzhouUrl("https://www.youtube.com/watch?v=abc")).toBe(false);
    expect(isXiaoyuzhouUrl("not-a-url")).toBe(false);
  });
});
