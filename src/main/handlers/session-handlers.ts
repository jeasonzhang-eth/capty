import { ipcMain } from "electron";
import type { IpcDeps } from "./types";
import fs from "fs";
import { join } from "path";
import {
  createSession,
  getSession,
  listSessions,
  updateSession,
  deleteSession,
  reorderSessions,
  addSegment,
  getSegments,
  deleteSegmentsBySession,
} from "../database";
import {
  readConfig,
  writeConfig,
  getEffectiveCategories,
  type SessionCategory,
} from "../config";
import { deleteSessionAudio } from "../audio-files";

export function register(deps: IpcDeps): void {
  const { db, configDir } = deps;

  // Sessions
  ipcMain.handle(
    "session:create",
    (_event, modelName: string, category?: string) => {
      return createSession(db, { modelName, category });
    },
  );

  ipcMain.handle(
    "session:update-category",
    (_event, id: number, category: string) => {
      const config = readConfig(configDir);
      const validIds = getEffectiveCategories(config).map((c) => c.id);
      if (!validIds.includes(category))
        throw new Error(`Invalid category: ${category}`);
      updateSession(db, id, { category });
    },
  );

  ipcMain.handle("session:reorder", (_event, sessionIds: number[]) => {
    reorderSessions(db, sessionIds);
  });

  // Session categories (custom)
  ipcMain.handle("session-categories:list", () => {
    const config = readConfig(configDir);
    return getEffectiveCategories(config);
  });

  ipcMain.handle(
    "session-categories:save",
    (_event, categories: SessionCategory[]) => {
      const config = readConfig(configDir);
      writeConfig(configDir, { ...config, sessionCategories: categories });
    },
  );

  ipcMain.handle("session-categories:delete", (_event, categoryId: string) => {
    // Move sessions in deleted category to "recording"
    db.prepare(
      "UPDATE sessions SET category = 'recording' WHERE category = ?",
    ).run(categoryId);
    // Remove from config
    const config = readConfig(configDir);
    const updated = (config.sessionCategories ?? []).filter(
      (c) => c.id !== categoryId,
    );
    writeConfig(configDir, { ...config, sessionCategories: updated });
  });

  ipcMain.handle("session:list", () => {
    return listSessions(db);
  });

  ipcMain.handle("session:get", (_event, id: number) => {
    return getSession(db, id);
  });

  ipcMain.handle(
    "session:update",
    (_event, id: number, fields: Record<string, unknown>) => {
      updateSession(db, id, fields as any);
    },
  );

  ipcMain.handle("session:rename", (_event, id: number, newTitle: string) => {
    const session = getSession(db, id);
    if (!session) throw new Error("Session not found");

    const trimmed = newTitle.trim();
    if (!trimmed) throw new Error("Title cannot be empty");

    // Sanitize title for filesystem use
    const sanitized = trimmed.replace(/[/\\:*?"<>|]/g, "-").replace(/^\.+/, "");
    if (!sanitized) throw new Error("Invalid title");

    const config = readConfig(configDir);
    const dataDir = config.dataDir ?? join(configDir, "data");

    // Rename audio directory and main audio file if audio_path exists
    if (session.audio_path) {
      const oldDir = join(dataDir, "audio", session.audio_path);
      const newDir = join(dataDir, "audio", sanitized);

      if (oldDir !== newDir && fs.existsSync(oldDir)) {
        if (fs.existsSync(newDir)) {
          throw new Error(`Directory already exists: ${sanitized}`);
        }
        fs.renameSync(oldDir, newDir);

        // Rename main audio file inside the directory
        const oldAudioFile = join(newDir, `${session.audio_path}.wav`);
        const newAudioFile = join(newDir, `${sanitized}.wav`);
        if (fs.existsSync(oldAudioFile) && oldAudioFile !== newAudioFile) {
          fs.renameSync(oldAudioFile, newAudioFile);
        }
      }
    }

    // Update database
    updateSession(db, id, {
      title: trimmed,
      audioPath: session.audio_path ? sanitized : undefined,
    });
  });

  ipcMain.handle("session:delete", (_event, id: number) => {
    // Get session to find audio directory before deleting DB records
    const session = getSession(db, id);
    deleteSession(db, id);
    // Delete audio files if audio_path is set
    if (session?.audio_path) {
      const config = readConfig(configDir);
      const dataDir = config.dataDir ?? join(configDir, "data");
      const audioDir = join(dataDir, "audio", session.audio_path);
      deleteSessionAudio(audioDir);
    }
  });

  // Segments
  ipcMain.handle("segment:add", (_event, opts: Record<string, unknown>) => {
    return addSegment(db, opts as any);
  });

  ipcMain.handle("segment:list", (_event, sessionId: number) => {
    return getSegments(db, sessionId);
  });

  ipcMain.handle("segment:delete-by-session", (_event, sessionId: number) => {
    deleteSegmentsBySession(db, sessionId);
  });
}
