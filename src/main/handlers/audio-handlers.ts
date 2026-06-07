import { ipcMain, dialog, shell, net } from "electron";
import type { IpcDeps } from "./types";
import { assertPathWithin } from "../shared/path";
import { spawn } from "../shared/spawn";
import {
  saveSegmentAudio,
  saveFullAudio,
  openAudioStream,
  appendAudioStream,
  finalizeAudioStream,
} from "../audio-files";
import { createSession, getSession, updateSession } from "../database";
import { readConfig } from "../config";
import fs from "fs";
import path from "path";
import { join } from "path";

/** Convert any audio file to 16kHz mono 16-bit WAV via ffmpeg. */
function convertToWav(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i",
      inputPath,
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
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    ffmpeg.on("error", (err) => {
      reject(
        new Error(
          `Failed to run ffmpeg. Make sure ffmpeg is installed (brew install ffmpeg). ${err.message}`,
        ),
      );
    });
  });
}

/** Build sidecar base URL from config port. */
function getSidecarBaseUrl(configDir: string): string {
  const config = readConfig(configDir);
  const port = config.sidecar?.port ?? 8765;
  return `http://localhost:${port}`;
}

export function register(deps: IpcDeps): void {
  const { db, configDir, getMainWindow } = deps;

  // Audio segment save (crash-safe, per-segment)
  ipcMain.handle(
    "audio:save-segment",
    (
      _event,
      sessionDir: string,
      segmentIndex: number,
      pcmData: ArrayBuffer,
    ) => {
      const config = readConfig(configDir);
      const audioBase = join(
        config.dataDir ?? join(configDir, "data"),
        "audio",
      );
      assertPathWithin(audioBase, sessionDir);
      saveSegmentAudio(sessionDir, segmentIndex, Buffer.from(pcmData));
    },
  );

  ipcMain.handle(
    "audio:save-full",
    (_event, sessionDir: string, pcmData: ArrayBuffer, fileName?: string) => {
      const config = readConfig(configDir);
      const audioBase = join(
        config.dataDir ?? join(configDir, "data"),
        "audio",
      );
      assertPathWithin(audioBase, sessionDir);
      saveFullAudio(sessionDir, Buffer.from(pcmData), fileName);
    },
  );

  // Streaming audio write (crash-safe)
  ipcMain.handle(
    "audio:stream-open",
    (_event, sessionDir: string, fileName: string) => {
      const config = readConfig(configDir);
      const audioBase = join(
        config.dataDir ?? join(configDir, "data"),
        "audio",
      );
      assertPathWithin(audioBase, sessionDir);
      openAudioStream(sessionDir, fileName);
    },
  );

  ipcMain.handle("audio:stream-write", (_event, pcmData: ArrayBuffer) => {
    appendAudioStream(Buffer.from(pcmData));
  });

  ipcMain.handle("audio:stream-close", () => {
    finalizeAudioStream();
  });

  // Audio read (supports WAV, MP3, FLAC, OGG, etc.)
  ipcMain.handle("audio:read-file", (_event, sessionId: number) => {
    const session = getSession(db, sessionId);
    if (!session?.audio_path) return null;
    const config = readConfig(configDir);
    const dataDir = config.dataDir ?? join(configDir, "data");
    const audioDir = join(dataDir, "audio", session.audio_path);
    // All audio is 16kHz mono WAV: {timestamp}.wav or full.wav (old recordings)
    const candidates = [
      join(audioDir, `${session.audio_path}.wav`),
      join(audioDir, "full.wav"),
    ];
    for (const filePath of candidates) {
      try {
        const buf = fs.readFileSync(filePath);
        return buf.buffer.slice(
          buf.byteOffset,
          buf.byteOffset + buf.byteLength,
        );
      } catch {
        // Try next candidate
      }
    }
    return null;
  });

  // Get audio file path for a session
  ipcMain.handle("audio:get-file-path", (_event, sessionId: number) => {
    const session = getSession(db, sessionId);
    if (!session?.audio_path) return null;
    const config = readConfig(configDir);
    const dataDir = config.dataDir ?? join(configDir, "data");
    const audioDir = join(dataDir, "audio", session.audio_path);
    const candidates = [
      join(audioDir, `${session.audio_path}.wav`),
      join(audioDir, "full.wav"),
    ];
    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) return filePath;
    }
    return null;
  });

  // Get audio directory path for a session
  ipcMain.handle("audio:get-dir", (_event, sessionId: number) => {
    const session = getSession(db, sessionId);
    if (!session?.audio_path) return null;
    const config = readConfig(configDir);
    const dataDir = config.dataDir ?? join(configDir, "data");
    return join(dataDir, "audio", session.audio_path);
  });

  // Open audio folder in Finder
  ipcMain.handle("audio:open-folder", (_event, sessionId: number) => {
    const session = getSession(db, sessionId);
    if (!session?.audio_path) return;
    const config = readConfig(configDir);
    const dataDir = config.dataDir ?? join(configDir, "data");
    const audioDir = join(dataDir, "audio", session.audio_path);
    if (fs.existsSync(audioDir)) {
      shell.openPath(audioDir);
    }
  });

  // Get audio duration from WAV header (all audio is converted to WAV on import)
  ipcMain.handle("audio:get-duration", (_event, filePath: string) => {
    const config = readConfig(configDir);
    const dataDir = config.dataDir ?? join(configDir, "data");
    assertPathWithin(dataDir, filePath);
    const fd = fs.openSync(filePath, "r");
    try {
      const header = Buffer.alloc(44);
      fs.readSync(fd, header, 0, 44, 0);
      const byteRate = header.readUInt32LE(28);
      const dataSize = header.readUInt32LE(40);
      if (byteRate > 0) {
        return Math.round(dataSize / byteRate);
      }
      return 0;
    } finally {
      fs.closeSync(fd);
    }
  });

  // Decode audio file to 16kHz mono WAV via sidecar (any format → WAV)
  ipcMain.handle("audio:decode-file", async (_event, filePath: string) => {
    const baseUrl = getSidecarBaseUrl(configDir);
    const resp = await net.fetch(`${baseUrl}/v1/audio/decode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: filePath }),
      signal: AbortSignal.timeout(120000), // 2min for large files
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Decode audio error (${resp.status}): ${errBody}`);
    }

    const arrayBuf = await resp.arrayBuffer();
    return arrayBuf;
  });

  // Import a single audio file into a new session. Throws on failure
  // (session/dir are cleaned up before rethrowing).
  async function importOneAudioFile(
    filePath: string,
  ): Promise<{ sessionId: number; timestamp: string; audioPath: string }> {
    // 1. Get file birthtime for session name
    const stat = fs.statSync(filePath);
    const birthtime = stat.birthtime;

    // 2. Format timestamps
    const pad = (n: number): string => String(n).padStart(2, "0");
    const dirTimestamp = `${birthtime.getFullYear()}-${pad(birthtime.getMonth() + 1)}-${pad(birthtime.getDate())}T${pad(birthtime.getHours())}-${pad(birthtime.getMinutes())}-${pad(birthtime.getSeconds())}`;
    const readableTimestamp = `${birthtime.getFullYear()}-${pad(birthtime.getMonth() + 1)}-${pad(birthtime.getDate())} ${pad(birthtime.getHours())}:${pad(birthtime.getMinutes())}:${pad(birthtime.getSeconds())}`;

    // 3. Deduplicate audio directory name
    const config = readConfig(configDir);
    const dataDir = config.dataDir ?? join(configDir, "data");
    let finalTimestamp = dirTimestamp;
    let sessionDir = join(dataDir, "audio", finalTimestamp);
    let suffix = 1;
    while (fs.existsSync(sessionDir)) {
      finalTimestamp = `${dirTimestamp}-${suffix}`;
      sessionDir = join(dataDir, "audio", finalTimestamp);
      suffix++;
    }

    let sessionId: number | null = null;
    try {
      fs.mkdirSync(sessionDir, { recursive: true });
      const destPath = join(sessionDir, `${finalTimestamp}.wav`);
      await convertToWav(filePath, destPath);

      // 4. Create session only after conversion succeeds.
      sessionId = createSession(db, {
        modelName: "imported",
        category: "recording",
      });
      updateSession(db, sessionId, {
        audioPath: finalTimestamp,
        title: readableTimestamp,
        startedAt: readableTimestamp,
      });

      // 5. Calculate duration from WAV and update session
      const wavStat = fs.statSync(destPath);
      const pcmBytes = wavStat.size - 44; // 44-byte WAV header
      const durationSeconds = Math.round(pcmBytes / 32000); // 16kHz * 16bit * mono
      updateSession(db, sessionId, {
        status: "completed",
        durationSeconds,
      });

      return { sessionId, timestamp: dirTimestamp, audioPath: destPath };
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

  // Audio import (upload one or more existing audio files)
  ipcMain.handle("audio:import", async () => {
    const win = getMainWindow();
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Audio Files",
          extensions: [
            "wav",
            "mp3",
            "m4a",
            "flac",
            "ogg",
            "aac",
            "wma",
            "opus",
          ],
        },
      ],
    });
    if (result.canceled || !result.filePaths.length) return null;

    const sendProgress = (data: Record<string, unknown>): void => {
      win.webContents.send("audio:import-progress", data);
    };

    sendProgress({
      type: "start",
      files: result.filePaths.map((f) => path.basename(f)),
    });

    // Import sequentially: each conversion runs ffmpeg, and serial imports
    // keep the directory-name deduplication race-free.
    const imported: {
      sessionId: number;
      timestamp: string;
      audioPath: string;
    }[] = [];
    const errors: { file: string; message: string }[] = [];
    for (let i = 0; i < result.filePaths.length; i++) {
      const filePath = result.filePaths[i];
      const file = path.basename(filePath);
      sendProgress({ type: "file", index: i, file, status: "converting" });
      try {
        const one = await importOneAudioFile(filePath);
        imported.push(one);
        sendProgress({
          type: "file",
          index: i,
          file,
          status: "done",
          sessionId: one.sessionId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ file: filePath, message });
        sendProgress({
          type: "file",
          index: i,
          file,
          status: "failed",
          error: message,
        });
      }
    }

    sendProgress({ type: "finished" });
    return { imported, errors };
  });
}
