import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createDatabase } from "../../../src/main/database";
import { createSessionFromWav } from "../../../src/main/audio/session-from-wav";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sfw-"));
}

function writeSilenceWav(dest: string, seconds: number): void {
  const dataBytes = 16000 * 2 * seconds;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(16000, 24);
  buf.writeUInt32LE(32000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);
  fs.writeFileSync(dest, buf);
}

describe("createSessionFromWav", () => {
  let dir: string;
  let db: ReturnType<typeof createDatabase>;

  beforeEach(() => {
    dir = tmp();
    db = createDatabase(path.join(dir, "test.db"));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates a session, names the dir after the base name, computes duration", async () => {
    const res = await createSessionFromWav({
      db,
      dataDir: dir,
      baseName: "我的合并录音",
      buildTitle: () => "我的合并录音",
      startedAt: "2026-06-17 10:00:00",
      modelName: "imported",
      category: "recording",
      writeWav: async (destPath) => writeSilenceWav(destPath, 3),
    });

    expect(res.timestamp).toBe("我的合并录音");
    const sessionDir = path.join(dir, "audio", "我的合并录音");
    expect(fs.existsSync(path.join(sessionDir, "我的合并录音.wav"))).toBe(true);

    const row = db
      .prepare("SELECT title, audio_path, duration_seconds, status FROM sessions WHERE id = ?")
      .get(res.sessionId) as any;
    expect(row.title).toBe("我的合并录音");
    expect(row.audio_path).toBe("我的合并录音");
    expect(row.duration_seconds).toBe(3);
    expect(row.status).toBe("completed");
  });

  it("deduplicates the dir name and passes the collision index to buildTitle", async () => {
    fs.mkdirSync(path.join(dir, "audio", "夜谈"), { recursive: true });
    const res = await createSessionFromWav({
      db,
      dataDir: dir,
      baseName: "夜谈",
      buildTitle: (collisionIndex) =>
        collisionIndex === 0 ? "夜谈" : `夜谈 (${collisionIndex})`,
      startedAt: "2026-06-17 10:00:00",
      modelName: "imported",
      category: "recording",
      writeWav: async (destPath) => writeSilenceWav(destPath, 1),
    });
    expect(res.timestamp).toBe("夜谈-1");
    const row = db
      .prepare("SELECT title, audio_path FROM sessions WHERE id = ?")
      .get(res.sessionId) as any;
    expect(row.audio_path).toBe("夜谈-1");
    expect(row.title).toBe("夜谈 (1)");
  });

  it("rolls back the session row and the dir when writeWav throws", async () => {
    await expect(
      createSessionFromWav({
        db,
        dataDir: dir,
        baseName: "坏的",
        buildTitle: () => "坏的",
        startedAt: "2026-06-17 10:00:00",
        modelName: "imported",
        category: "recording",
        writeWav: async () => {
          throw new Error("ffmpeg concat exited with code 1");
        },
      }),
    ).rejects.toThrow(/code 1/);

    expect(fs.existsSync(path.join(dir, "audio", "坏的"))).toBe(false);
    const count = db.prepare("SELECT COUNT(*) AS c FROM sessions").get() as any;
    expect(count.c).toBe(0);
  });
});
