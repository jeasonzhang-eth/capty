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

function loadLocalModels(configDir: string): ModelEntry[] {
  // Read local models.json
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

  // Mark downloaded status
  const config = readConfig(configDir);
  const dataDir = config.dataDir ?? join(configDir, "data");
  const modelsDir = join(dataDir, "models");

  return localModels.map((m) => ({
    ...m,
    downloaded: fs.existsSync(join(modelsDir, m.id)),
  }));
}

interface HFSearchResult {
  readonly id: string;
  readonly modelId: string;
  readonly tags: readonly string[];
  readonly downloads: number;
  readonly pipeline_tag?: string;
}

interface HFTreeFile {
  readonly path: string;
  readonly size: number;
  readonly type: string;
}

/** Files to exclude when computing download size (matching model-downloader). */
const SIZE_SKIP_FILES = new Set([".gitattributes", "README.md"]);

/** Infer our internal model type from HuggingFace tags / model ID. */
function inferModelType(hfModel: HFSearchResult): string {
  const id = hfModel.id.toLowerCase();
  const tags = hfModel.tags.map((t) => t.toLowerCase());

  if (tags.includes("whisper") || id.includes("whisper")) return "whisper";
  if (tags.includes("qwen") || id.includes("qwen")) return "qwen-asr";
  // Default to whisper for generic ASR models (most common on HF)
  return "whisper";
}

/** Fetch the total download size (in GB) for a repo via the tree API. */
async function fetchRepoSizeGb(repo: string, baseUrl: string): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(`${baseUrl}/api/models/${repo}/tree/main`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return 0;
    const files = (await resp.json()) as HFTreeFile[];
    const totalBytes = files
      .filter((f) => f.type === "file" && !SIZE_SKIP_FILES.has(f.path))
      .reduce((sum, f) => sum + (f.size ?? 0), 0);
    return Math.round((totalBytes / (1024 * 1024 * 1024)) * 100) / 100;
  } catch {
    clearTimeout(timeout);
    return 0;
  }
}

function formatSizeStr(sizeGb: number): string {
  if (sizeGb <= 0) return "";
  return sizeGb < 1
    ? ` | ~${Math.round(sizeGb * 1024)} MB`
    : ` | ~${sizeGb} GB`;
}

function hfModelToEntry(hfModel: HFSearchResult, sizeGb: number): ModelEntry {
  const type = inferModelType(hfModel);
  const id = hfModel.id.replace(/\//g, "--");
  const sizeStr = formatSizeStr(sizeGb);
  return {
    id,
    name: hfModel.id.split("/").pop() ?? hfModel.id,
    type,
    repo: hfModel.id,
    size_gb: sizeGb,
    languages: ["multilingual"],
    description: `${hfModel.id} (${(hfModel.downloads ?? 0).toLocaleString()} downloads${sizeStr})`,
  };
}

async function searchHuggingFaceModels(
  query: string,
  mirrorUrl?: string,
): Promise<ModelEntry[]> {
  const baseUrl = mirrorUrl ?? "https://huggingface.co";
  const params = new URLSearchParams({
    search: query,
    pipeline_tag: "automatic-speech-recognition",
    sort: "downloads",
    direction: "-1",
    limit: "20",
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let results: HFSearchResult[];
  try {
    const resp = await fetch(`${baseUrl}/api/models?${params}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return [];
    results = (await resp.json()) as HFSearchResult[];
  } catch {
    clearTimeout(timeout);
    return [];
  }

  // Fetch file sizes for each result in parallel via the tree API
  const sizes = await Promise.all(
    results.map((r) => fetchRepoSizeGb(r.id, baseUrl)),
  );

  return results.map((r, i) => hfModelToEntry(r, sizes[i]));
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

  // Models — read from local (builtin) registry
  ipcMain.handle("models:list", () => {
    return loadLocalModels(configDir);
  });

  // Search HuggingFace for ASR models
  ipcMain.handle("models:search", async (_event, query: string) => {
    const config = readConfig(configDir);
    const mirrorUrl = config.hfMirrorUrl ?? undefined;
    const results = await searchHuggingFaceModels(query, mirrorUrl);
    // Mark downloaded status
    const dataDir = config.dataDir ?? join(configDir, "data");
    const modelsDir = join(dataDir, "models");
    return results.map((m) => ({
      ...m,
      downloaded: fs.existsSync(join(modelsDir, m.id)),
    }));
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
