import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import fs from "fs";
import { EventEmitter } from "events";

const handlers = new Map<string, (...args: any[]) => any>();
const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler);
    }),
  },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn() },
  net: { fetch: vi.fn() },
}));
vi.mock("../../../src/main/shared/spawn", () => ({ spawn: mockSpawn }));

import { register } from "../../../src/main/handlers/audio-handlers";
import { createDatabase } from "../../../src/main/database";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "merge-handler-"));
}
function mockFfmpegWritesWav(seconds: number) {
  mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
    const out = args[args.length - 1];
    const ee = new EventEmitter();
    setTimeout(() => {
      const dataBytes = 32000 * seconds;
      const buf = Buffer.alloc(44 + dataBytes);
      buf.write("RIFF", 0);
      buf.write("WAVE", 8);
      buf.write("data", 36);
      buf.writeUInt32LE(dataBytes, 40);
      fs.writeFileSync(out, buf);
      ee.emit("close", 0);
    }, 0);
    return ee as any;
  });
}

describe("audio:import-merged", () => {
  let dir: string;
  let configDir: string;
  let db: ReturnType<typeof createDatabase>;
  let win: any;

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    dir = tmp();
    configDir = path.join(dir, "config");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ dataDir: path.join(dir, "data") }),
    );
    db = createDatabase(path.join(dir, "test.db"));
    win = { webContents: { send: vi.fn() } };
    register({ db, configDir, getMainWindow: () => win } as any);
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("merges N inputs into exactly one session", async () => {
    mockFfmpegWritesWav(5);
    const a = path.join(dir, "seg1.wav");
    const b = path.join(dir, "seg2.wav");
    fs.writeFileSync(a, Buffer.alloc(100));
    fs.writeFileSync(b, Buffer.alloc(100));

    const handler = handlers.get("audio:import-merged")!;
    const res = await handler({}, [a, b], "我的会议");

    expect(res.imported).toHaveLength(1);
    expect(res.errors).toHaveLength(0);
    const count = db.prepare("SELECT COUNT(*) AS c FROM sessions").get() as any;
    expect(count.c).toBe(1);
    const row = db
      .prepare("SELECT title, audio_path FROM sessions WHERE id = ?")
      .get(res.imported[0].sessionId) as any;
    expect(row.title).toBe("我的会议");
    expect(row.audio_path).toBe("我的会议");
    const joined = (mockSpawn.mock.calls[0][1] as string[]).join(" ");
    expect(joined).toContain(`-i ${a} -i ${b}`);
  });

  it("returns an error and creates no session when ffmpeg fails", async () => {
    mockSpawn.mockImplementation(() => {
      const ee = new EventEmitter();
      setTimeout(() => ee.emit("close", 1), 0);
      return ee as any;
    });
    const a = path.join(dir, "seg1.wav");
    const b = path.join(dir, "seg2.wav");
    fs.writeFileSync(a, Buffer.alloc(100));
    fs.writeFileSync(b, Buffer.alloc(100));

    const handler = handlers.get("audio:import-merged")!;
    const res = await handler({}, [a, b], "坏会议");
    expect(res.imported).toHaveLength(0);
    expect(res.errors).toHaveLength(1);
    const count = db.prepare("SELECT COUNT(*) AS c FROM sessions").get() as any;
    expect(count.c).toBe(0);
  });

  it("rejects fewer than 2 valid inputs", async () => {
    const a = path.join(dir, "seg1.wav");
    fs.writeFileSync(a, Buffer.alloc(100));
    const handler = handlers.get("audio:import-merged")!;
    const res = await handler({}, [a], "x");
    expect(res).toBeNull();
  });

  it("pick-files returns selected paths without importing", async () => {
    const { dialog } = await import("electron");
    (dialog.showOpenDialog as any).mockResolvedValue({
      canceled: false,
      filePaths: ["/x/a.wav", "/x/b.wav"],
    });
    const handler = handlers.get("audio:pick-files")!;
    const paths = await handler({});
    expect(paths).toEqual(["/x/a.wav", "/x/b.wav"]);
    const count = db.prepare("SELECT COUNT(*) AS c FROM sessions").get() as any;
    expect(count.c).toBe(0);
  });
});
