# Merge Audio Files On Upload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user select two or more audio files at upload time, order them, and merge them into a single transcribed session.

**Architecture:** A new ffmpeg single-pass concat module produces one canonical WAV from N inputs in the chosen order. A shared `createSessionFromWav` helper turns any produced WAV into a session (dedup dir, create row, duration, rollback) and is used by both single-file import and merge. The renderer's `ImportManagerDialog` gains a staging view (reorderable list + title + "merge"/"import separately" actions) shown only when ≥2 files are selected.

**Tech Stack:** Electron (main/preload/renderer), TypeScript, ffmpeg (via `src/main/shared/spawn`), better-sqlite3, React, Vitest (run with `ELECTRON_RUN_AS_NODE=true ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run <path>`).

**Spec:** `docs/superpowers/specs/2026-06-17-merge-audio-on-upload-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/main/audio/merge.ts` (new) | `mergeAudioFiles(orderedPaths, outputPath)` — one ffmpeg concat-filter command. |
| `src/main/audio/session-from-wav.ts` (new) | `createSessionFromWav(opts)` — shared: dedup dir, mkdir, write WAV, create session, compute duration, roll back on error. |
| `src/renderer/shared/natural-sort.ts` (new) | `sortPathsByName(paths)` — pure natural filename sort. |
| `src/main/handlers/audio-handlers.ts` (modify) | Add `audio:pick-files` + `audio:import-merged`; refactor `importOneAudioFile` onto the shared helper. |
| `src/preload/index.ts` (modify) | Expose `pickFiles()` and `importMerged(paths, title)`. |
| `src/renderer/components/ImportManagerDialog.tsx` (modify) | Staging view: reorderable list, title field, merge/separate actions. |
| `src/renderer/hooks/useSessionManagement.ts` (modify) | Branch on file count; staging state; call the right IPC. |
| `src/main/index.ts` (modify) | Register nothing new (handlers self-register); no change expected — listed only if a channel constant needs export. |

Run the full main suite with:
`ELECTRON_RUN_AS_NODE=true ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run tests/main`

> NOTE: `tests/main/handlers/audio-handlers.test.ts > "rolls back the session when ffmpeg conversion fails"` fails on clean `main` (environmental: `win.webContents.send is not a function`). That failure is **pre-existing** and unrelated to this work. Do not try to fix it; just confirm no *new* failures appear.

---

## Task 1: `mergeAudioFiles` ffmpeg concat module

**Files:**
- Create: `src/main/audio/merge.ts`
- Test: `tests/main/audio/merge.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/main/audio/merge.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));
vi.mock("../../../src/main/shared/spawn", () => ({ spawn: mockSpawn }));

import { mergeAudioFiles } from "../../../src/main/audio/merge";

function fakeProc() {
  const ee = new EventEmitter() as EventEmitter & { kill?: () => void };
  return ee;
}

describe("mergeAudioFiles", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects when fewer than 2 inputs are given", async () => {
    await expect(mergeAudioFiles(["/a.wav"], "/out.wav")).rejects.toThrow(
      /at least 2/,
    );
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("builds a concat-filter command with inputs in order and canonical format", async () => {
    const proc = fakeProc();
    mockSpawn.mockReturnValue(proc);
    const p = mergeAudioFiles(["/a.wav", "/b.m4a", "/c.mp3"], "/out.wav");
    // simulate success
    proc.emit("close", 0);
    await expect(p).resolves.toBeUndefined();

    const [cmd, args] = mockSpawn.mock.calls[0];
    expect(cmd).toBe("ffmpeg");
    const joined = (args as string[]).join(" ");
    // inputs present and in order
    expect(joined).toContain("-i /a.wav -i /b.m4a -i /c.mp3");
    // concat filter with N=3
    expect(joined).toContain("[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]");
    expect(args).toContain("-map");
    expect(args).toContain("[out]");
    // canonical 16kHz mono s16
    expect(joined).toContain("-ar 16000");
    expect(joined).toContain("-ac 1");
    expect(joined).toContain("-sample_fmt s16");
    // output last
    expect((args as string[])[(args as string[]).length - 1]).toBe("/out.wav");
  });

  it("rejects with the exit code on non-zero ffmpeg exit", async () => {
    const proc = fakeProc();
    mockSpawn.mockReturnValue(proc);
    const p = mergeAudioFiles(["/a.wav", "/b.wav"], "/out.wav");
    proc.emit("close", 1);
    await expect(p).rejects.toThrow(/code 1/);
  });

  it("rejects when ffmpeg cannot be spawned", async () => {
    const proc = fakeProc();
    mockSpawn.mockReturnValue(proc);
    const p = mergeAudioFiles(["/a.wav", "/b.wav"], "/out.wav");
    proc.emit("error", new Error("ENOENT"));
    await expect(p).rejects.toThrow(/ffmpeg/i);
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `ELECTRON_RUN_AS_NODE=true ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run tests/main/audio/merge.test.ts`
Expected: FAIL — cannot find module `src/main/audio/merge`.

- [ ] **Step 3: Implement `merge.ts`**

```typescript
// src/main/audio/merge.ts
import { spawn } from "../shared/spawn";

/**
 * Concatenate several audio files into a single canonical WAV
 * (16 kHz / mono / 16-bit) in one ffmpeg pass. Output order matches the
 * order of `orderedPaths`. Inputs may be any ffmpeg-readable format.
 */
export function mergeAudioFiles(
  orderedPaths: readonly string[],
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (orderedPaths.length < 2) {
      reject(new Error("mergeAudioFiles requires at least 2 input files"));
      return;
    }

    const inputs = orderedPaths.flatMap((p) => ["-i", p]);
    const labels = orderedPaths.map((_, i) => `[${i}:a]`).join("");
    const filter = `${labels}concat=n=${orderedPaths.length}:v=0:a=1[out]`;

    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner",
      ...inputs,
      "-filter_complex",
      filter,
      "-map",
      "[out]",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-sample_fmt",
      "s16",
      "-f",
      "wav",
      "-y",
      outputPath,
    ]);

    ffmpeg.on("close", (code: number) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg concat exited with code ${code}`));
    });
    ffmpeg.on("error", (err: Error) => {
      reject(
        new Error(
          `Failed to run ffmpeg. Make sure ffmpeg is installed (brew install ffmpeg). ${err.message}`,
        ),
      );
    });
  });
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `ELECTRON_RUN_AS_NODE=true ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run tests/main/audio/merge.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/audio/merge.ts tests/main/audio/merge.test.ts
git commit -m "feat: add ffmpeg concat module for merging audio files"
```

---

## Task 2: `createSessionFromWav` shared helper

**Files:**
- Create: `src/main/audio/session-from-wav.ts`
- Test: `tests/main/audio/session-from-wav.test.ts`

This helper centralizes: sanitize/dedup the dir name, mkdir, produce the WAV
(via a caller-supplied `writeWav`), create + populate the session row, compute
duration from the WAV size, and roll everything back if `writeWav` throws.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/main/audio/session-from-wav.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createDatabase } from "../../../src/main/database";
import { createSessionFromWav } from "../../../src/main/audio/session-from-wav";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sfw-"));
}

// Write a valid 16kHz mono 16-bit WAV with `seconds` of silence.
function writeSilenceWav(dest: string, seconds: number): void {
  const dataBytes = 16000 * 2 * seconds; // 16k * 16bit/8 * mono
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
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `ELECTRON_RUN_AS_NODE=true ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run tests/main/audio/session-from-wav.test.ts`
Expected: FAIL — cannot find module `session-from-wav`.

- [ ] **Step 3: Implement `session-from-wav.ts`**

> Confirm the exact import names against `src/main/database.ts` before writing
> (the file uses `createSession(db, {...})` and `updateSession(db, id, {...})`,
> as in `audio-handlers.ts:254-272`). `createDatabase` is exported there too.

```typescript
// src/main/audio/session-from-wav.ts
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
  readonly timestamp: string; // == final dir name (audio_path)
  readonly audioPath: string; // absolute path to the wav file
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

  // Deduplicate directory name.
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
    const pcmBytes = wavStat.size - 44; // 44-byte WAV header
    const durationSeconds = Math.round(pcmBytes / 32000); // 16kHz * 16bit * mono
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
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `ELECTRON_RUN_AS_NODE=true ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run tests/main/audio/session-from-wav.test.ts`
Expected: PASS (3 tests). If `createDatabase` is not exported from `database.ts`, open that file and use the actual exported constructor name.

- [ ] **Step 5: Commit**

```bash
git add src/main/audio/session-from-wav.ts tests/main/audio/session-from-wav.test.ts
git commit -m "feat: add shared createSessionFromWav helper"
```

---

## Task 3: Refactor `importOneAudioFile` onto the shared helper

Keep behavior identical (same dir naming with `_` sanitize, same `name (n)`
title on collision). This is a pure refactor — the existing import tests must
stay green (modulo the pre-existing environmental failure noted above).

**Files:**
- Modify: `src/main/handlers/audio-handlers.ts:218-290`

- [ ] **Step 1: Replace the body of `importOneAudioFile`**

Replace the whole function (currently lines ~218-290) with:

```typescript
  // Import a single audio file into a new session. Throws on failure
  // (session/dir are cleaned up before rethrowing).
  async function importOneAudioFile(
    filePath: string,
  ): Promise<{ sessionId: number; timestamp: string; audioPath: string }> {
    // Session title and directory name reuse the source file name.
    const sourceName = path.basename(filePath, path.extname(filePath));
    const safeName =
      sourceName.replace(/[\\/:*?"<>|]/g, "_").trim() || "imported";

    // File birthtime is used as the session start time.
    const stat = fs.statSync(filePath);
    const birthtime = stat.birthtime;
    const pad = (n: number): string => String(n).padStart(2, "0");
    const readableTimestamp = `${birthtime.getFullYear()}-${pad(birthtime.getMonth() + 1)}-${pad(birthtime.getDate())} ${pad(birthtime.getHours())}:${pad(birthtime.getMinutes())}:${pad(birthtime.getSeconds())}`;

    const config = readConfig(configDir);
    const dataDir = config.dataDir ?? join(configDir, "data");

    return createSessionFromWav({
      db,
      dataDir,
      baseName: safeName,
      buildTitle: (collisionIndex) =>
        collisionIndex === 0 ? sourceName : `${sourceName} (${collisionIndex})`,
      startedAt: readableTimestamp,
      modelName: "imported",
      category: "recording",
      writeWav: (destPath) => convertToWav(filePath, destPath),
    });
  }
```

- [ ] **Step 2: Add the import at the top of `audio-handlers.ts`**

After the existing `import { readConfig } from "../config";` line add:

```typescript
import { createSessionFromWav } from "../audio/session-from-wav";
import { mergeAudioFiles } from "../audio/merge";
```

(`mergeAudioFiles` is used in Task 4; importing it now is fine.)

- [ ] **Step 3: Typecheck + run the audio-handlers tests**

Run: `npx tsc --noEmit`
Expected: no new errors (the pre-existing `src/preload/index.ts` "Cannot find name 'window'" error may still show — that is pre-existing).

Run: `ELECTRON_RUN_AS_NODE=true ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run tests/main/handlers/audio-handlers.test.ts`
Expected: the same single pre-existing failure ("rolls back the session when ffmpeg conversion fails"), all other tests PASS. No *new* failures.

- [ ] **Step 4: Commit**

```bash
git add src/main/handlers/audio-handlers.ts
git commit -m "refactor: route single-file import through createSessionFromWav"
```

---

## Task 4: `audio:pick-files` and `audio:import-merged` handlers

**Files:**
- Modify: `src/main/handlers/audio-handlers.ts` (add two handlers near `audio:import`, ~line 393)
- Test: `tests/main/handlers/audio-merge-handler.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/main/handlers/audio-merge-handler.test.ts
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
// ffmpeg mock that "produces" a WAV at the last arg path then exits 0.
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
    // two real input files (existence is checked)
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

    // ffmpeg called once with both inputs in order
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
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `ELECTRON_RUN_AS_NODE=true ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run tests/main/handlers/audio-merge-handler.test.ts`
Expected: FAIL — handlers `audio:import-merged` / `audio:pick-files` not registered.

- [ ] **Step 3: Add the handlers**

Insert just before the closing `}` of `register(...)` (after the `audio:import-paths` handler, ~line 393). Reuse the module-level `AUDIO_EXTENSIONS` and `sanitizeSessionDirName`.

First add the import near the other imports at the top:

```typescript
import { sanitizeSessionDirName } from "../shared/session-name";
```

Then the handlers:

```typescript
  // Pick audio files via the OS dialog WITHOUT importing — the renderer
  // decides whether to import separately or merge.
  ipcMain.handle("audio:pick-files", async () => {
    const win = getMainWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Audio Files", extensions: AUDIO_EXTENSIONS }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths;
  });

  // Merge several audio files (in the given order) into ONE session.
  ipcMain.handle(
    "audio:import-merged",
    async (_event, paths: string[], title: string) => {
      const win = getMainWindow();
      if (!win) return null;

      const valid = (Array.isArray(paths) ? paths : []).filter((f) => {
        if (typeof f !== "string" || !path.isAbsolute(f)) return false;
        const ext = path.extname(f).slice(1).toLowerCase();
        if (!AUDIO_EXTENSIONS.includes(ext)) return false;
        try {
          return fs.statSync(f).isFile();
        } catch {
          return false;
        }
      });
      if (valid.length < 2) return null;

      const send = (data: Record<string, unknown>): void =>
        win.webContents.send("audio:import-progress", data);

      const displayName = path.basename(valid[0]);
      send({ type: "start", files: [displayName] });
      send({ type: "file", index: 0, file: displayName, status: "converting" });

      const config = readConfig(configDir);
      const dataDir = config.dataDir ?? join(configDir, "data");

      // Earliest source-file birthtime becomes the session start time.
      const pad = (n: number): string => String(n).padStart(2, "0");
      const birthtimes = valid.map((f) => fs.statSync(f).birthtime.getTime());
      const earliest = new Date(Math.min(...birthtimes));
      const startedAt = `${earliest.getFullYear()}-${pad(earliest.getMonth() + 1)}-${pad(earliest.getDate())} ${pad(earliest.getHours())}:${pad(earliest.getMinutes())}:${pad(earliest.getSeconds())}`;

      const cleanTitle = (title ?? "").trim();
      const fallback = path.basename(valid[0], path.extname(valid[0]));
      const finalTitle = cleanTitle || fallback;
      const baseName = sanitizeSessionDirName(finalTitle) || startedAt;

      try {
        const built = await createSessionFromWav({
          db,
          dataDir,
          baseName,
          buildTitle: () => finalTitle,
          startedAt,
          modelName: "imported",
          category: "recording",
          writeWav: (destPath) => mergeAudioFiles(valid, destPath),
        });
        send({
          type: "file",
          index: 0,
          file: displayName,
          status: "done",
          sessionId: built.sessionId,
        });
        send({ type: "finished" });
        return { imported: [built], errors: [] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({
          type: "file",
          index: 0,
          file: displayName,
          status: "failed",
          error: message,
        });
        send({ type: "finished" });
        return { imported: [], errors: [{ file: displayName, message }] };
      }
    },
  );
```

- [ ] **Step 4: Run the test + typecheck**

Run: `ELECTRON_RUN_AS_NODE=true ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run tests/main/handlers/audio-merge-handler.test.ts`
Expected: PASS (4 tests).
Run: `npx tsc --noEmit` — no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/handlers/audio-handlers.ts tests/main/handlers/audio-merge-handler.test.ts
git commit -m "feat: add audio:pick-files and audio:import-merged IPC handlers"
```

---

## Task 5: Preload — expose `pickFiles` and `importMerged`

**Files:**
- Modify: `src/preload/index.ts` (after `importAudioPaths`, ~line 243)

- [ ] **Step 1: Add the two methods**

```typescript
  pickFiles: () =>
    ipcRenderer.invoke("audio:pick-files") as Promise<string[] | null>,
  importMerged: (paths: string[], title: string) =>
    ipcRenderer.invoke("audio:import-merged", paths, title) as Promise<{
      imported: {
        sessionId: number;
        timestamp: string;
        audioPath: string;
      }[];
      errors: { file: string; message: string }[];
    } | null>,
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. `CaptyAPI = typeof api`, so the new methods become available on `window.capty` automatically.

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat: expose pickFiles and importMerged on the preload api"
```

---

## Task 6: Natural-sort helper + staging view in `ImportManagerDialog`

**Files:**
- Create: `src/renderer/shared/natural-sort.ts`
- Test: `tests/renderer/natural-sort.test.ts`
- Modify: `src/renderer/components/ImportManagerDialog.tsx`

### 6a. Natural sort helper (TDD)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/renderer/natural-sort.test.ts
import { describe, it, expect } from "vitest";
import { sortPathsByName } from "../../src/renderer/shared/natural-sort";

describe("sortPathsByName", () => {
  it("orders DJI-style numbered files in ascending numeric order", () => {
    const input = [
      "/x/DJI_20260401_182020.wav",
      "/x/DJI_20260401_163715.wav",
      "/x/DJI_20260401_170000.wav",
    ];
    expect(sortPathsByName(input)).toEqual([
      "/x/DJI_20260401_163715.wav",
      "/x/DJI_20260401_170000.wav",
      "/x/DJI_20260401_182020.wav",
    ]);
  });

  it("sorts by basename, numeric-aware (2 before 10)", () => {
    const input = ["/a/clip-10.m4a", "/a/clip-2.m4a", "/a/clip-1.m4a"];
    expect(sortPathsByName(input)).toEqual([
      "/a/clip-1.m4a",
      "/a/clip-2.m4a",
      "/a/clip-10.m4a",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = ["/a/b.wav", "/a/a.wav"];
    const copy = [...input];
    sortPathsByName(input);
    expect(input).toEqual(copy);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL** —
`ELECTRON_RUN_AS_NODE=true ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run tests/renderer/natural-sort.test.ts`

- [ ] **Step 3: Implement**

```typescript
// src/renderer/shared/natural-sort.ts
/** Sort file paths by basename, numeric-aware, without mutating the input. */
export function sortPathsByName(paths: readonly string[]): string[] {
  const base = (p: string): string => p.split(/[/\\]/).pop() ?? p;
  return [...paths].sort((a, b) =>
    base(a).localeCompare(base(b), undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}
```

- [ ] **Step 4: Run, confirm PASS** (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/shared/natural-sort.ts tests/renderer/natural-sort.test.ts
git commit -m "feat: add numeric-aware natural sort for file paths"
```

### 6b. Staging view in `ImportManagerDialog`

The dialog gains an optional staging mode driven by new props. When the parent
hands it a non-empty `stagingPaths`, it renders the reorderable list + title +
actions **instead of** the dropzone/records. The list uses the same native
drag-and-drop reorder pattern as `HistoryPanel` session rows.

- [ ] **Step 1: Extend the props interface**

In `ImportManagerDialog.tsx`, extend `ImportManagerDialogProps`:

```typescript
  // Staging: when non-empty, show the reorder+merge view instead of the dropzone.
  readonly stagingPaths?: readonly string[];
  readonly onConfirmMerge?: (orderedPaths: string[], title: string) => void;
  readonly onConfirmSeparate?: (orderedPaths: string[]) => void;
  readonly onCancelStaging?: () => void;
```

- [ ] **Step 2: Add staging state + render branch**

Inside the component, after the existing `useState`/`useEffect` for ESC, add:

```typescript
  const [order, setOrder] = useState<string[]>([]);
  const [mergeTitle, setMergeTitle] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const staging = (stagingPaths?.length ?? 0) >= 2;

  useEffect(() => {
    if (staging) {
      const sorted = [...(stagingPaths as string[])];
      setOrder(sorted);
      const first = sorted[0].split(/[/\\]/).pop() ?? "";
      setMergeTitle(first.replace(/\.[^.]+$/, ""));
    }
  }, [staging, stagingPaths]);

  const baseName = (p: string): string => p.split(/[/\\]/).pop() ?? p;

  function moveItem(from: number, to: number): void {
    setOrder((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }
```

> The parent (Task 7) is responsible for sorting `stagingPaths` with
> `sortPathsByName` before passing them in, so the default order is correct.

- [ ] **Step 3: Render the staging UI**

Immediately after `const dropBorder = ...` `return createPortal(` opening, branch
on `staging`. Replace the existing inner dialog body so that when `staging` is
true it renders this block (and otherwise renders the existing dropzone+records
unchanged). Concretely, wrap the existing "Drop zone" + "Records list" JSX in
`{!staging && ( ... )}` and add this block right after the header:

```tsx
        {staging && (
          <div
            data-testid="merge-staging"
            style={{ padding: "0 20px 16px", display: "flex", flexDirection: "column", gap: "12px" }}
          >
            <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
              拖拽调整顺序，合并为一个 session（共 {order.length} 段）
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {order.map((p, i) => (
                <div
                  key={p}
                  data-testid={`merge-item-${i}`}
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIdx !== null && dragIdx !== i) moveItem(dragIdx, i);
                    setDragIdx(null);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px 10px",
                    backgroundColor: "var(--bg-secondary, #1c1c1f)",
                    borderRadius: "8px",
                    cursor: "grab",
                  }}
                >
                  <span style={{ color: "var(--text-muted)", fontSize: "12px", width: "18px" }}>
                    {i + 1}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      fontSize: "13px",
                      color: "var(--text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={baseName(p)}
                  >
                    {baseName(p)}
                  </span>
                  <button
                    onClick={() => moveItem(i, i - 1)}
                    disabled={i === 0}
                    style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: i === 0 ? "default" : "pointer" }}
                    title="上移"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveItem(i, i + 1)}
                    disabled={i === order.length - 1}
                    style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: i === order.length - 1 ? "default" : "pointer" }}
                    title="下移"
                  >
                    ↓
                  </button>
                </div>
              ))}
            </div>

            <input
              data-testid="merge-title"
              value={mergeTitle}
              onChange={(e) => setMergeTitle(e.target.value)}
              placeholder="合并后的 session 名称"
              style={{
                fontSize: "13px",
                padding: "8px 10px",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                backgroundColor: "var(--bg-primary)",
                color: "var(--text-primary)",
                outline: "none",
              }}
            />

            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                data-testid="merge-cancel"
                onClick={() => onCancelStaging?.()}
                disabled={isImporting}
                style={{ padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--border)", background: "none", color: "var(--text-muted)", cursor: "pointer" }}
              >
                取消
              </button>
              <button
                data-testid="merge-separate"
                onClick={() => onConfirmSeparate?.([...order])}
                disabled={isImporting}
                style={{ padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--border)", background: "none", color: "var(--text-primary)", cursor: "pointer" }}
              >
                分别导入
              </button>
              <button
                data-testid="merge-confirm"
                onClick={() => onConfirmMerge?.([...order], mergeTitle.trim())}
                disabled={isImporting || order.length < 2}
                style={{ padding: "8px 14px", borderRadius: "8px", border: "none", background: "var(--accent)", color: "#fff", cursor: "pointer" }}
              >
                合并为一个 session
              </button>
            </div>
          </div>
        )}
```

Also add the new props to the destructured parameter list of
`ImportManagerDialog({ ... })`: `stagingPaths, onConfirmMerge, onConfirmSeparate, onCancelStaging`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit` — no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ImportManagerDialog.tsx
git commit -m "feat: add merge staging view to ImportManagerDialog"
```

---

## Task 7: Wire staging into `useSessionManagement` + `App`

**Files:**
- Modify: `src/renderer/hooks/useSessionManagement.ts` (upload/drop handlers ~735-755, exports ~847-855)
- Modify: `src/renderer/App.tsx` (where `ImportManagerDialog` is rendered)

- [ ] **Step 1: Add staging state and a helper to start staging**

In `useSessionManagement.ts`, near the other import state (`~653-657`), add:

```typescript
  const [stagingPaths, setStagingPaths] = useState<readonly string[]>([]);
```

Add an import for the sorter at the top of the file:

```typescript
import { sortPathsByName } from "../shared/natural-sort";
```

- [ ] **Step 2: Replace `handleUploadAudio` and `handleDropAudioFiles`**

```typescript
  // Decide: 1 file → import immediately; ≥2 files → open staging to choose
  // merge vs separate import.
  const beginImportFromPaths = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return Promise.resolve();
      if (paths.length === 1) {
        return runImport(() => window.capty.importAudioPaths(paths));
      }
      setStagingPaths(sortPathsByName(paths));
      setShowImportManager(true);
      return Promise.resolve();
    },
    [runImport],
  );

  const handleUploadAudio = useCallback(async () => {
    const paths = await window.capty.pickFiles();
    if (!paths || paths.length === 0) return;
    await beginImportFromPaths(paths);
  }, [beginImportFromPaths]);

  const handleDropAudioFiles = useCallback(
    (files: File[]) => {
      const paths = files
        .map((f) => {
          try {
            return window.capty.getPathForFile(f);
          } catch {
            return "";
          }
        })
        .filter(Boolean);
      return beginImportFromPaths(paths);
    },
    [beginImportFromPaths],
  );

  const handleConfirmMerge = useCallback(
    async (orderedPaths: string[], title: string) => {
      setStagingPaths([]);
      await runImport(() => window.capty.importMerged(orderedPaths, title));
    },
    [runImport],
  );

  const handleConfirmSeparate = useCallback(
    async (orderedPaths: string[]) => {
      setStagingPaths([]);
      await runImport(() => window.capty.importAudioPaths(orderedPaths));
    },
    [runImport],
  );

  const handleCancelStaging = useCallback(() => {
    setStagingPaths([]);
  }, []);
```

- [ ] **Step 3: Export the new handlers + state**

In the returned object (~847-855) add:

```typescript
    stagingPaths,
    handleConfirmMerge,
    handleConfirmSeparate,
    handleCancelStaging,
```

- [ ] **Step 4: Pass them through in `App.tsx`**

Find where `<ImportManagerDialog ... />` is rendered and add the new props
(names come from whatever the hook's return is destructured as in `App.tsx` —
match the existing style, e.g. `session.stagingPaths`):

```tsx
          stagingPaths={stagingPaths}
          onConfirmMerge={handleConfirmMerge}
          onConfirmSeparate={handleConfirmSeparate}
          onCancelStaging={handleCancelStaging}
```

> If `App.tsx` destructures the hook return into a namespace object, prefix
> accordingly. Grep `ImportManagerDialog` in `App.tsx` to find the exact site
> and the surrounding prop-passing convention before editing.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit` — no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/hooks/useSessionManagement.ts src/renderer/App.tsx
git commit -m "feat: route multi-file uploads through the merge staging flow"
```

---

## Task 8: Full suite, CHANGELOG, manual e2e checklist

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Run the full main test suite**

Run: `ELECTRON_RUN_AS_NODE=true ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run tests`
Expected: all green except the one pre-existing `audio-handlers.test.ts` failure.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` — only the pre-existing `src/preload/index.ts` "Cannot find name 'window'" error, if present.

- [ ] **Step 3: Update CHANGELOG**

Under `## [Unreleased]` → `### Added`, add:

```markdown
- Merge multiple audio files into one session at upload time. Selecting or dropping two or more files opens a staging view in the upload dialog where you can reorder the segments (default natural filename sort, drag or ↑/↓ to adjust) and either "合并为一个 session" (ffmpeg concatenates them in order into one transcribed session) or "分别导入" (the previous one-session-per-file behavior). Single-file uploads import immediately as before. Useful for recorders that auto-split long recordings (e.g. DJI's 30-minute segments).
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for merge-audio-on-upload"
```

- [ ] **Step 5: Manual e2e (record results in the PR description)**

In a tmux dev session (`tmux new-session -d -s capty-dev "bash /tmp/capty_dev.sh 2>&1 | tee /tmp/capty_dev.log"` with `/tmp/capty_dev.sh` = `exec npm run dev`):

1. Click Upload, select 1 file → imports immediately (no staging). ✅/❌
2. Click Upload, select 3 files → staging view appears, files in natural order. ✅/❌
3. Drag the 3rd item to the top → order updates; ↑/↓ buttons also work. ✅/❌
4. Edit the title, click "合并为一个 session" → one session created, name = title, plays back as the segments back-to-back, duration ≈ sum. ✅/❌
5. Repeat with "分别导入" → three separate sessions (old behavior). ✅/❌
6. Confirm the original source files on disk are untouched. ✅/❌

---

## Self-Review

- **Spec coverage:** upload-only merge (Tasks 4,6,7) ✓; natural sort default + drag reorder (Tasks 6a,6b) ✓; one merged session, sources untouched (Task 4 — `valid` paths only read) ✓; single ffmpeg concat pass (Task 1) ✓; extend ImportManagerDialog not new modal (Task 6b) ✓; 1-file no-staging (Task 7) ✓; rollback on failure (Tasks 2,4) ✓; folder matches title via `sanitizeSessionDirName` (Task 4) ✓; earliest birthtime as startedAt (Task 4) ✓. No out-of-scope work (no existing-session merge).
- **Placeholder scan:** none — every code step has full code.
- **Type consistency:** `createSessionFromWav` options/return (`BuiltSession { sessionId, timestamp, audioPath }`) match its usages in Tasks 3 & 4; `mergeAudioFiles(orderedPaths, outputPath)` signature consistent across Tasks 1, 3, 4; IPC names `audio:pick-files` / `audio:import-merged` consistent across Tasks 4, 5; preload `pickFiles` / `importMerged(paths, title)` match hook calls in Task 7; dialog props (`stagingPaths`, `onConfirmMerge`, `onConfirmSeparate`, `onCancelStaging`) consistent across Tasks 6b & 7.
