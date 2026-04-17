import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import fs from "fs";
import { EventEmitter } from "events";

// Collect registered IPC handlers for testing
const handlers = new Map<string, (...args: any[]) => any>();
const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler);
    }),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showOpenDialogSync: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
  },
}));

vi.mock("../../../src/main/shared/spawn", () => ({
  spawn: mockSpawn,
}));

// Must import after mocks
import { register } from "../../../src/main/handlers/audio-handlers";
import { dialog, ipcMain } from "electron";
import { createDatabase } from "../../../src/main/database";

const ALL_CHANNELS = [
  "audio:stream-open",
  "audio:stream-write",
  "audio:stream-close",
  "audio:save-segment",
  "audio:save-full",
  "audio:read-file",
  "audio:get-file-path",
  "audio:get-dir",
  "audio:open-folder",
  "audio:get-duration",
  "audio:decode-file",
  "audio:import",
];

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "audio-handlers-test-"));
}

describe("audio-handlers", () => {
  let tmpDir: string;
  let configDir: string;
  let dbPath: string;
  let db: ReturnType<typeof createDatabase>;

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();

    tmpDir = makeTmpDir();
    configDir = path.join(tmpDir, "config");
    fs.mkdirSync(configDir, { recursive: true });

    // Write minimal config so readConfig works
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ dataDir: path.join(tmpDir, "data") }),
    );

    dbPath = path.join(configDir, "capty.db");
    db = createDatabase(dbPath);

    register({
      db,
      configDir,
      getMainWindow: () => null,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("channel registration", () => {
    it("registers all 12 audio channels", () => {
      for (const ch of ALL_CHANNELS) {
        expect(handlers.has(ch), `missing channel: ${ch}`).toBe(true);
      }
    });

    it("registers exactly the audio channels (no extras from this module)", () => {
      // All registered channels should be audio: prefixed
      for (const ch of handlers.keys()) {
        expect(ch.startsWith("audio:")).toBe(true);
      }
    });
  });

  describe("audio:get-dir", () => {
    it("returns null when session does not exist", () => {
      const handler = handlers.get("audio:get-dir")!;
      const result = handler({} as any, 9999);
      expect(result).toBeNull();
    });

    it("returns null when session has no audio_path", () => {
      // Insert session without audio_path via DB directly
      const result = db
        .prepare(
          "INSERT INTO sessions (model_name, status) VALUES (?, ?)",
        )
        .run("test-model", "recording");
      const sessionId = result.lastInsertRowid as number;

      const handler = handlers.get("audio:get-dir")!;
      const dirResult = handler({} as any, sessionId);
      expect(dirResult).toBeNull();
    });

    it("returns path string for session with audio_path", () => {
      // Insert session with audio_path
      const insertResult = db
        .prepare(
          "INSERT INTO sessions (model_name, status, audio_path) VALUES (?, ?, ?)",
        )
        .run("test-model", "recording", "2024-01-01T10-00-00");
      const sessionId = insertResult.lastInsertRowid as number;

      const handler = handlers.get("audio:get-dir")!;
      const dirResult = handler({} as any, sessionId);

      expect(typeof dirResult).toBe("string");
      expect(dirResult).toContain("audio");
      expect(dirResult).toContain("2024-01-01T10-00-00");
    });
  });

  describe("audio:stream-open + audio:stream-close lifecycle", () => {
    it("opens a stream and closes it without error", () => {
      const dataDir = path.join(tmpDir, "data");
      const audioBase = path.join(dataDir, "audio");
      const sessionDir = path.join(audioBase, "2024-01-01T12-00-00");
      fs.mkdirSync(sessionDir, { recursive: true });

      const openHandler = handlers.get("audio:stream-open")!;
      const closeHandler = handlers.get("audio:stream-close")!;

      expect(() =>
        openHandler({} as any, sessionDir, "recording.wav"),
      ).not.toThrow();

      expect(() => closeHandler({} as any)).not.toThrow();

      // After close, the file should exist (finalizeAudioStream flushes)
      const wavPath = path.join(sessionDir, "recording.wav");
      expect(fs.existsSync(wavPath)).toBe(true);
    });

    it("rejects a session directory outside the audio base", () => {
      const outsideDir = path.join(tmpDir, "outside");
      fs.mkdirSync(outsideDir, { recursive: true });

      const openHandler = handlers.get("audio:stream-open")!;
      expect(() =>
        openHandler({} as any, outsideDir, "recording.wav"),
      ).toThrow();
    });
  });

  describe("audio:stream-write", () => {
    it("appends PCM data to an open stream", () => {
      const dataDir = path.join(tmpDir, "data");
      const sessionDir = path.join(dataDir, "audio", "2024-01-01T13-00-00");
      fs.mkdirSync(sessionDir, { recursive: true });

      const openHandler = handlers.get("audio:stream-open")!;
      const writeHandler = handlers.get("audio:stream-write")!;
      const closeHandler = handlers.get("audio:stream-close")!;

      openHandler({} as any, sessionDir, "recording.wav");

      // Write some PCM bytes
      const pcm = new ArrayBuffer(100);
      expect(() => writeHandler({} as any, pcm)).not.toThrow();

      closeHandler({} as any);
    });
  });

  describe("audio:import", () => {
    it("rolls back the session when ffmpeg conversion fails", async () => {
      handlers.clear();
      register({
        db,
        configDir,
        getMainWindow: () => ({ webContents: {} } as any),
      });

      const sourcePath = path.join(tmpDir, "broken.mp3");
      fs.writeFileSync(sourcePath, Buffer.from("broken-audio"));

      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: [sourcePath],
      } as any);

      mockSpawn.mockImplementationOnce(() => {
        const child = new EventEmitter() as any;
        queueMicrotask(() => child.emit("close", 1));
        return child;
      });

      const handler = handlers.get("audio:import")!;
      await expect(handler({} as any)).rejects.toThrow(
        "ffmpeg exited with code 1",
      );

      const row = db
        .prepare("SELECT COUNT(*) AS count FROM sessions")
        .get() as { count: number };
      expect(row.count).toBe(0);

      const audioRoot = path.join(tmpDir, "data", "audio");
      const audioEntries = fs.existsSync(audioRoot)
        ? fs.readdirSync(audioRoot)
        : [];
      expect(audioEntries).toHaveLength(0);
    });
  });
});
