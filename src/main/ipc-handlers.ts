import { ipcMain, dialog, BrowserWindow, app, shell } from "electron";
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

interface ModelEntry {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly repo: string;
  readonly size_gb: number;
  readonly languages: readonly string[];
  readonly description: string;
  readonly downloaded?: boolean;
}

const DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/jeasonzhang-eth/capty/main/resources/models.json";

async function loadModelList(
  configDir: string,
  forceRemote = false,
): Promise<ModelEntry[]> {
  // 1. Read local models.json
  let localModels: ModelEntry[] = [];
  try {
    const registryPath = join(
      app.isPackaged
        ? join(process.resourcesPath, "resources")
        : join(__dirname, "../../resources"),
      "models.json",
    );
    const raw = fs.readFileSync(registryPath, "utf-8");
    localModels = JSON.parse(raw) as ModelEntry[];
  } catch {
    // Local registry not found
  }

  // 2. Try fetching remote model list
  let remoteModels: ModelEntry[] = [];
  if (forceRemote || localModels.length > 0) {
    try {
      const config = readConfig(configDir);
      const url = config.modelRegistryUrl ?? DEFAULT_REGISTRY_URL;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (resp.ok) {
        remoteModels = (await resp.json()) as ModelEntry[];
      }
    } catch {
      // Remote fetch failed — silently degrade to local only
    }
  }

  // 3. Merge: remote can override/extend local (keyed by id)
  const modelMap = new Map<string, ModelEntry>();
  for (const m of localModels) {
    modelMap.set(m.id, m);
  }
  for (const m of remoteModels) {
    modelMap.set(m.id, m);
  }

  // 4. Mark downloaded status
  const config = readConfig(configDir);
  const dataDir = config.dataDir ?? join(configDir, "data");
  const modelsDir = join(dataDir, "models");

  return Array.from(modelMap.values()).map((m) => ({
    ...m,
    downloaded: fs.existsSync(join(modelsDir, m.id)),
  }));
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

  // Models — read from local registry, optionally merge remote list
  ipcMain.handle("models:list", async () => {
    return loadModelList(configDir);
  });

  ipcMain.handle("models:refresh", async () => {
    return loadModelList(configDir, true);
  });

  // Delete a downloaded model
  ipcMain.handle("models:delete", async (_event, modelId: string) => {
    const config = readConfig(configDir);
    const dataDir = config.dataDir ?? join(configDir, "data");
    const modelsDir = join(dataDir, "models");
    const modelPath = join(modelsDir, modelId);

    if (fs.existsSync(modelPath)) {
      // Notify sidecar to unload if it's the active model
      try {
        const sidecarUrl = sidecar.getUrl();
        if (sidecarUrl) {
          const healthResp = await fetch(`${sidecarUrl}/health`);
          if (healthResp.ok) {
            const health = (await healthResp.json()) as {
              current_model: string | null;
            };
            if (health.current_model === modelId) {
              // Unload by switching to a non-existent placeholder (triggers unload)
              // Better: just call a dedicated unload endpoint or accept the model switch will fail
              // For now, the sidecar will handle the missing model gracefully
            }
          }
        }
      } catch {
        // Sidecar not available, proceed with deletion
      }

      fs.rmSync(modelPath, { recursive: true, force: true });
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
      const config = readConfig(configDir);
      const mirrorUrl = config.hfMirrorUrl ?? undefined;
      await downloadModel(
        repo,
        destDir,
        (progress) => {
          win?.webContents.send("models:download-progress", progress);
        },
        mirrorUrl,
      );
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
