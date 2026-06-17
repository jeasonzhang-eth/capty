import fs from "fs";
import { join } from "path";
import type Database from "better-sqlite3";
import { createSession, updateSession } from "../database";

export interface CreateSessionFromWavOptions {
  readonly db: Database.Database;
  readonly dataDir: string;
  /** Already filesystem-safe base name for the audio dir + wav file. */
  readonly baseName: string;
  /** Build the session title. `collisionIndex` is the dedup suffix (0 = no collision). */
  readonly buildTitle: (collisionIndex: number) => string;
  readonly startedAt: string;
  readonly modelName: string;
  readonly category: string;
  /** Produce the canonical WAV at `destPath`. Throwing triggers rollback. */
  readonly writeWav: (destPath: string) => Promise<void>;
}

export interface BuiltSession {
  readonly sessionId: number;
  readonly timestamp: string;
  readonly audioPath: string;
}

/**
 * Turn a produced WAV into a completed session. Dedups the directory name,
 * writes the WAV via `writeWav`, creates the session row, computes duration
 * from the WAV size, and rolls back the row + directory if anything throws.
 */
export async function createSessionFromWav(
  opts: CreateSessionFromWavOptions,
): Promise<BuiltSession> {
  const { db, dataDir, baseName, buildTitle, startedAt, modelName, category } =
    opts;

  let dirName = baseName;
  let sessionDir = join(dataDir, "audio", dirName);
  let suffix = 1;
  while (fs.existsSync(sessionDir)) {
    dirName = `${baseName}-${suffix}`;
    sessionDir = join(dataDir, "audio", dirName);
    suffix++;
  }
  const collisionIndex = suffix - 1;

  let sessionId: number | null = null;
  try {
    fs.mkdirSync(sessionDir, { recursive: true });
    const destPath = join(sessionDir, `${dirName}.wav`);
    await opts.writeWav(destPath);

    sessionId = createSession(db, { modelName, category });
    updateSession(db, sessionId, {
      audioPath: dirName,
      title: buildTitle(collisionIndex),
      startedAt,
    });

    const wavStat = fs.statSync(destPath);
    const pcmBytes = wavStat.size - 44;
    const durationSeconds = Math.round(pcmBytes / 32000);
    updateSession(db, sessionId, { status: "completed", durationSeconds });

    return { sessionId, timestamp: dirName, audioPath: destPath };
  } catch (err) {
    if (sessionId !== null) {
      try {
        db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
      } catch {
        // ignore cleanup errors
      }
    }
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    throw err;
  }
}
