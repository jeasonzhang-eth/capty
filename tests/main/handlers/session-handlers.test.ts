import { describe, it, expect, vi, beforeEach } from "vitest";

// Collect registered IPC handlers for testing
const handlers = new Map<string, (...args: any[]) => any>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler);
    }),
  },
}));

// Must import after mocks are set up
import { register } from "../../../src/main/handlers/session-handlers";
import { createDatabase } from "../../../src/main/database";
import type { IpcDeps } from "../../../src/main/handlers/types";
import fs from "fs";
import os from "os";
import path from "path";

function makeDeps(configDir: string): IpcDeps {
  const db = createDatabase(":memory:");
  return {
    db,
    configDir,
    getMainWindow: () => null,
  };
}

describe("session-handlers", () => {
  let deps: IpcDeps;
  let configDir: string;

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "capty-test-"));
    deps = makeDeps(configDir);
    register(deps);
  });

  describe("channel registration", () => {
    it("registers all 14 session channels", () => {
      const expected = [
        "session:create",
        "session:list",
        "session:get",
        "session:update",
        "session:rename",
        "session:delete",
        "session:reorder",
        "session:update-category",
        "session-categories:list",
        "session-categories:save",
        "session-categories:delete",
        "segment:add",
        "segment:list",
        "segment:delete-by-session",
      ];
      for (const channel of expected) {
        expect(
          handlers.has(channel),
          `channel "${channel}" should be registered`,
        ).toBe(true);
      }
    });
  });

  describe("session CRUD", () => {
    it("session:create creates a session and returns its id", async () => {
      const handler = handlers.get("session:create")!;
      const id = await handler({} as any, "Qwen3-ASR-0.6B");
      expect(typeof id).toBe("number");
      expect(id).toBeGreaterThan(0);
    });

    it("session:list returns created session", async () => {
      const create = handlers.get("session:create")!;
      const list = handlers.get("session:list")!;

      await create({} as any, "Qwen3-ASR-0.6B");
      const sessions = await list({} as any);

      expect(Array.isArray(sessions)).toBe(true);
      expect(sessions.length).toBe(1);
      expect(sessions[0].model_name).toBe("Qwen3-ASR-0.6B");
    });

    it("session:get returns a session by id", async () => {
      const create = handlers.get("session:create")!;
      const get = handlers.get("session:get")!;

      const id = await create({} as any, "Qwen3-ASR-0.6B");
      const session = await get({} as any, id);

      expect(session).toBeDefined();
      expect(session.id).toBe(id);
      expect(session.model_name).toBe("Qwen3-ASR-0.6B");
    });

    it("session:delete removes the session", async () => {
      const create = handlers.get("session:create")!;
      const list = handlers.get("session:list")!;
      const del = handlers.get("session:delete")!;

      const id = await create({} as any, "Qwen3-ASR-0.6B");
      await del({} as any, id);
      const sessions = await list({} as any);

      expect(sessions.length).toBe(0);
    });
  });

  describe("segment round-trip", () => {
    it("segment:add then segment:list returns the segment", async () => {
      const createSession = handlers.get("session:create")!;
      const addSegment = handlers.get("segment:add")!;
      const listSegments = handlers.get("segment:list")!;

      const sessionId = await createSession({} as any, "Qwen3-ASR-0.6B");
      await addSegment({} as any, {
        sessionId,
        startTime: 0.0,
        endTime: 1.5,
        text: "Hello world",
        audioPath: "seg-0.wav",
        isFinal: true,
      });

      const segments = await listSegments({} as any, sessionId);
      expect(Array.isArray(segments)).toBe(true);
      expect(segments.length).toBe(1);
      expect(segments[0].text).toBe("Hello world");
      expect(segments[0].session_id).toBe(sessionId);
    });
  });
});
