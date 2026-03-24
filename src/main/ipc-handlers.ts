import { ipcMain, dialog, BrowserWindow, app } from "electron";
import fs from "fs";
import { join } from "path";
import Database from "better-sqlite3";
import { SidecarManager } from "./sidecar";
import {
  createSession,
  getSession,
  listSessions,
  addSegment,
  getSegments,
  updateSession,
  deleteSession,
  deleteSegmentsBySession,
} from "./database";
import {
  saveSegmentAudio,
  saveFullAudio,
  deleteSessionAudio,
} from "./audio-files";
import { exportTXT, exportSRT, exportMarkdown } from "./export";
import { readConfig, writeConfig, getDataDir } from "./config";
import { downloadModel } from "./model-downloader";

export interface IpcDeps {
  readonly db: Database.Database;
  readonly configDir: string;
  readonly sidecar: SidecarManager;
  readonly getMainWindow: () => BrowserWindow | null;
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const { db, configDir, sidecar, getMainWindow } = deps;

  // Sessions
  ipcMain.handle("session:create", (_event, modelName: string) => {
    return createSession(db, { modelName });
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

  // Audio
  ipcMain.handle(
    "audio:save-segment",
    (
      _event,
      sessionDir: string,
      segmentIndex: number,
      pcmData: ArrayBuffer,
    ) => {
      saveSegmentAudio(sessionDir, segmentIndex, Buffer.from(pcmData));
    },
  );

  ipcMain.handle(
    "audio:save-full",
    (_event, sessionDir: string, pcmData: ArrayBuffer, fileName?: string) => {
      saveFullAudio(sessionDir, Buffer.from(pcmData), fileName);
    },
  );

  // Export
  ipcMain.handle(
    "export:txt",
    (_event, sessionId: number, opts: Record<string, unknown>) => {
      const session = getSession(db, sessionId);
      const segments = getSegments(db, sessionId);
      return exportTXT(session, segments, opts as any);
    },
  );

  ipcMain.handle("export:srt", (_event, sessionId: number) => {
    const session = getSession(db, sessionId);
    const segments = getSegments(db, sessionId);
    return exportSRT(session, segments);
  });

  ipcMain.handle("export:markdown", (_event, sessionId: number) => {
    const session = getSession(db, sessionId);
    const segments = getSegments(db, sessionId);
    return exportMarkdown(session, segments);
  });

  // Config
  ipcMain.handle("config:get", () => {
    return readConfig(configDir);
  });

  ipcMain.handle("config:set", (_event, config: Record<string, unknown>) => {
    writeConfig(configDir, config as any);
  });

  // Sidecar
  ipcMain.handle("sidecar:get-url", () => {
    return sidecar.getUrl();
  });

  // Models — read from local registry, mark downloaded status
  ipcMain.handle("models:list", () => {
    try {
      const registryPath = join(
        app.isPackaged
          ? join(process.resourcesPath, "resources")
          : join(__dirname, "../../resources"),
        "models.json",
      );
      const raw = fs.readFileSync(registryPath, "utf-8");
      const models = JSON.parse(raw) as {
        id: string;
        name: string;
        size_gb: number;
      }[];
      const config = readConfig(configDir);
      const dataDir = config.dataDir ?? join(configDir, "data");
      const modelsDir = join(dataDir, "models");
      return models.map((m) => ({
        ...m,
        downloaded: fs.existsSync(join(modelsDir, m.id)),
      }));
    } catch {
      return [];
    }
  });

  // App
  ipcMain.handle("app:get-data-dir", () => {
    return getDataDir(configDir);
  });

  ipcMain.handle("app:select-directory", async () => {
    const win = getMainWindow();
    if (!win) {
      return null;
    }
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Model download
  ipcMain.handle(
    "models:download",
    async (_event, repo: string, destDir: string) => {
      const win = getMainWindow();
      await downloadModel(repo, destDir, (progress) => {
        win?.webContents.send("models:download-progress", progress);
      });
    },
  );

  // Audio read
  ipcMain.handle("audio:read-file", (_event, sessionId: number) => {
    const session = getSession(db, sessionId);
    if (!session?.audio_path) return null;
    const config = readConfig(configDir);
    const dataDir = config.dataDir ?? join(configDir, "data");
    const audioDir = join(dataDir, "audio", session.audio_path);
    // Try {timestamp}.wav first, fall back to full.wav for old recordings
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

  // Get audio directory path for a session
  ipcMain.handle("audio:get-dir", (_event, sessionId: number) => {
    const session = getSession(db, sessionId);
    if (!session?.audio_path) return null;
    const config = readConfig(configDir);
    const dataDir = config.dataDir ?? join(configDir, "data");
    return join(dataDir, "audio", session.audio_path);
  });

  // Export save file
  ipcMain.handle(
    "export:save-file",
    async (_event, defaultName: string, content: string) => {
      const win = getMainWindow();
      if (!win) return null;
      const result = await dialog.showSaveDialog(win, {
        defaultPath: defaultName,
        filters: [
          { name: "Text Files", extensions: ["txt", "srt", "md"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (result.canceled || !result.filePath) return null;
      fs.writeFileSync(result.filePath, content, "utf-8");
      return result.filePath;
    },
  );
}
