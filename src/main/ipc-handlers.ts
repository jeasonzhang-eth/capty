import { ipcMain, dialog, BrowserWindow, app, shell, net } from "electron";
import { spawn } from "child_process";
import fs from "fs";
import { join } from "path";
import Database from "better-sqlite3";
import {
  createSession,
  getSession,
  listSessions,
  addSegment,
  getSegments,
  updateSession,
  deleteSession,
  deleteSegmentsBySession,
  addSummary,
  getSummaries,
  deleteSummary,
} from "./database";
import {
  saveSegmentAudio,
  saveFullAudio,
  deleteSessionAudio,
  openAudioStream,
  appendAudioStream,
  finalizeAudioStream,
} from "./audio-files";
import { exportTXT, exportSRT, exportMarkdown } from "./export";
import {
  readConfig,
  writeConfig,
  getDataDir,
  LlmProvider,
  PromptType,
  getEffectivePromptTypes,
  DEFAULT_PROMPT_TYPES,
} from "./config";
import { pcmToWav } from "./audio-files";
import {
  calcDirSizeGb,
  downloadModel,
  isModelDownloaded,
} from "./model-downloader";

export interface IpcDeps {
  readonly db: Database.Database;
  readonly configDir: string;
  readonly getMainWindow: () => BrowserWindow | null;
}

interface ModelEntry {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly repo: string;
  readonly mlx_repo?: string;
  readonly size_gb: number;
  readonly languages: readonly string[];
  readonly description: string;
  readonly downloaded?: boolean;
}

const USER_MODELS_FILE = "user-models.json";

/** Read the builtin models.json shipped with the app. */
function readBuiltinModels(): ModelEntry[] {
  try {
    const registryPath = join(
      app.isPackaged
        ? join(process.resourcesPath, "resources")
        : join(__dirname, "../../resources"),
      "models.json",
    );
    return JSON.parse(fs.readFileSync(registryPath, "utf-8")) as ModelEntry[];
  } catch {
    return [];
  }
}

/** Read user-models.json — the single source of truth at runtime. */
function readUserModels(configDir: string): ModelEntry[] {
  const filePath = join(configDir, USER_MODELS_FILE);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as ModelEntry[];
  } catch {
    return [];
  }
}

function writeUserModels(configDir: string, models: ModelEntry[]): void {
  fs.mkdirSync(configDir, { recursive: true });
  const filePath = join(configDir, USER_MODELS_FILE);
  fs.writeFileSync(filePath, JSON.stringify(models, null, 2), "utf-8");
}

function addUserModel(configDir: string, model: ModelEntry): void {
  const existing = readUserModels(configDir);
  const idx = existing.findIndex((m) => m.id === model.id);
  if (idx >= 0) {
    existing[idx] = model;
  } else {
    existing.push(model);
  }
  writeUserModels(configDir, existing);
}

function removeUserModel(configDir: string, modelId: string): void {
  const existing = readUserModels(configDir);
  writeUserModels(
    configDir,
    existing.filter((m) => m.id !== modelId),
  );
}

/**
 * Initialize user-models.json from builtin models.json on first run.
 * Also picks up orphaned model directories and any new builtin models
 * added in app updates.
 */
function ensureUserModels(configDir: string): void {
  const filePath = join(configDir, USER_MODELS_FILE);
  const exists = fs.existsSync(filePath);

  if (!exists) {
    // First run: seed from builtin registry
    const builtin = readBuiltinModels();
    writeUserModels(configDir, builtin);
    return;
  }

  // Existing file: merge in any NEW builtin models from app updates
  const current = readUserModels(configDir);
  const currentIds = new Set(current.map((m) => m.id));
  const builtin = readBuiltinModels();
  let changed = false;

  for (const bm of builtin) {
    if (!currentIds.has(bm.id)) {
      current.push(bm);
      currentIds.add(bm.id);
      changed = true;
    } else if (bm.mlx_repo) {
      // Backfill mlx_repo for existing entries from builtin updates
      const existing = current.find((m) => m.id === bm.id);
      if (existing && !existing.mlx_repo) {
        (existing as { mlx_repo?: string }).mlx_repo = bm.mlx_repo;
        changed = true;
      }
    }
  }

  // Also scan models directory for orphaned downloads
  const config = readConfig(configDir);
  const dataDir = config.dataDir ?? join(configDir, "data");
  const modelsDir = join(dataDir, "models");

  if (fs.existsSync(modelsDir)) {
    try {
      for (const dir of fs.readdirSync(modelsDir)) {
        if (currentIds.has(dir)) continue;
        if (!isModelDownloaded(modelsDir, dir)) continue;
        // Infer metadata from directory name
        const repo = dir.replace(/--/g, "/");
        const name = dir.split("--").pop() ?? dir;
        const lower = dir.toLowerCase();
        const type = lower.includes("whisper")
          ? "whisper"
          : lower.includes("qwen")
            ? "qwen-asr"
            : "whisper";
        current.push({
          id: dir,
          name,
          type,
          repo,
          size_gb: calcDirSizeGb(join(modelsDir, dir)),
          languages: ["multilingual"],
          description: repo,
        });
        changed = true;
      }
    } catch {
      // Cannot read models dir
    }
  }

  // Backfill size for existing entries that have size_gb == 0
  for (const m of current) {
    if (m.size_gb === 0 && isModelDownloaded(modelsDir, m.id)) {
      const size = calcDirSizeGb(join(modelsDir, m.id));
      if (size > 0) {
        m.size_gb = size;
        changed = true;
      }
    }
  }

  if (changed) {
    writeUserModels(configDir, current);
  }
}

function loadAllModels(configDir: string): ModelEntry[] {
  ensureUserModels(configDir);

  const models = readUserModels(configDir);
  const config = readConfig(configDir);
  const dataDir = config.dataDir ?? join(configDir, "data");
  const modelsDir = join(dataDir, "models");

  const withStatus = models.map((m) => ({
    ...m,
    downloaded: isModelDownloaded(modelsDir, m.id),
  }));

  // Sort: group by type (alphabetically), then by size within each group
  withStatus.sort((a, b) => {
    const typeCmp = a.type.localeCompare(b.type);
    if (typeCmp !== 0) return typeCmp;
    return a.size_gb - b.size_gb;
  });

  return withStatus;
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

export function registerIpcHandlers(deps: IpcDeps): void {
  const { db, configDir, getMainWindow } = deps;

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
    const config = readConfig(configDir);
    const sidecarProvider = (config.asrProviders ?? []).find(
      (p) => p.isSidecar,
    );
    return sidecarProvider?.baseUrl ?? "http://localhost:8765";
  });

  ipcMain.handle("sidecar:health-check", async () => {
    const config = readConfig(configDir);
    const sidecarProvider = (config.asrProviders ?? []).find(
      (p) => p.isSidecar,
    );
    const url = sidecarProvider?.baseUrl ?? "http://localhost:8765";
    try {
      const resp = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!resp.ok) return { online: false };
      const data = (await resp.json()) as Record<string, unknown>;
      return { online: true, ...data };
    } catch {
      return { online: false };
    }
  });

  // External ASR transcription (OpenAI-compatible API)
  ipcMain.handle(
    "asr:transcribe",
    async (
      _event,
      pcmData: ArrayBuffer,
      provider: { baseUrl: string; apiKey: string; model: string },
    ) => {
      const wavBuffer = pcmToWav(Buffer.from(pcmData), 16000, 1, 16);

      const formData = new FormData();
      formData.append(
        "file",
        new Blob([wavBuffer], { type: "audio/wav" }),
        "audio.wav",
      );
      formData.append("model", provider.model);

      // Strip trailing /v1 or / to avoid double /v1/v1 paths
      const baseUrl = provider.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
      const resp = await net.fetch(`${baseUrl}/v1/audio/transcriptions`, {
        method: "POST",
        headers: {
          ...(provider.apiKey
            ? { Authorization: `Bearer ${provider.apiKey}` }
            : {}),
        },
        body: formData,
        signal: AbortSignal.timeout(60000),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`ASR API error (${resp.status}): ${errBody}`);
      }

      const result = (await resp.json()) as { text?: string };
      return { text: result.text ?? "" };
    },
  );

  // External ASR: fetch available models from server
  ipcMain.handle(
    "asr:fetch-models",
    async (_event, provider: { baseUrl: string; apiKey: string }) => {
      const baseUrl = provider.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
      const headers: Record<string, string> = {};
      if (provider.apiKey)
        headers["Authorization"] = `Bearer ${provider.apiKey}`;

      const endpoints = [`${baseUrl}/models`, `${baseUrl}/v1/models`];

      for (const url of endpoints) {
        try {
          const resp = await net.fetch(url, {
            headers,
            signal: AbortSignal.timeout(5000),
          });
          if (!resp.ok) continue;
          const data = await resp.json();

          // Sidecar format: array [{id, name, downloaded?, ...}, ...]
          if (Array.isArray(data)) {
            const available = data.filter(
              (m: { downloaded?: boolean }) => m.downloaded !== false,
            );
            return available.map((m: { id: string; name?: string }) => ({
              id: m.id,
              name: m.name || m.id,
            }));
          }
          // OpenAI format: {data: [{id, ...}, ...]}
          if (data.data && Array.isArray(data.data)) {
            return data.data.map((m: { id: string }) => ({
              id: m.id,
              name: m.id,
            }));
          }
        } catch {
          continue;
        }
      }
      return [];
    },
  );

  // External ASR connectivity test (send short silent audio)
  ipcMain.handle(
    "asr:test",
    async (
      _event,
      provider: { baseUrl: string; apiKey: string; model: string },
    ) => {
      // 0.1 second of silence at 16kHz 16bit mono = 3200 bytes
      const silentPcm = Buffer.alloc(3200);
      const wavBuffer = pcmToWav(silentPcm, 16000, 1, 16);

      const formData = new FormData();
      formData.append(
        "file",
        new Blob([wavBuffer], { type: "audio/wav" }),
        "test.wav",
      );
      formData.append("model", provider.model);

      const baseUrl = provider.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
      const resp = await net.fetch(`${baseUrl}/v1/audio/transcriptions`, {
        method: "POST",
        headers: {
          ...(provider.apiKey
            ? { Authorization: `Bearer ${provider.apiKey}` }
            : {}),
        },
        body: formData,
        signal: AbortSignal.timeout(10000),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errBody}`);
      }

      return { success: true };
    },
  );

  // Models — builtin registry + user-downloaded models
  ipcMain.handle("models:list", () => {
    return loadAllModels(configDir);
  });

  // Add a model to the user registry (called after downloading from search)
  ipcMain.handle(
    "models:save-meta",
    (_event, _modelId: string, meta: Record<string, unknown>) => {
      addUserModel(configDir, meta as unknown as ModelEntry);
    },
  );

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
      downloaded: isModelDownloaded(modelsDir, m.id),
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
        const cfg = readConfig(configDir);
        const sidecarProvider = (cfg.asrProviders ?? []).find(
          (p) => p.isSidecar,
        );
        const sidecarUrl = sidecarProvider?.baseUrl ?? "http://localhost:8765";
        const healthResp = await fetch(`${sidecarUrl}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (healthResp.ok) {
          // Sidecar is online — it will handle the missing model gracefully
        }
      } catch {
        // Sidecar not available, proceed with deletion
      }

      fs.rmSync(modelPath, { recursive: true, force: true });
    }

    // Also remove from user registry
    removeUserModel(configDir, modelId);
  });

  // Layout persistence
  ipcMain.handle(
    "layout:save",
    (
      _event,
      opts: { historyPanelWidth?: number; summaryPanelWidth?: number },
    ) => {
      const current = readConfig(configDir);
      writeConfig(configDir, {
        ...current,
        ...(opts.historyPanelWidth !== undefined && {
          historyPanelWidth: opts.historyPanelWidth,
        }),
        ...(opts.summaryPanelWidth !== undefined && {
          summaryPanelWidth: opts.summaryPanelWidth,
        }),
      });
    },
  );

  // App
  ipcMain.handle("app:get-data-dir", () => {
    return getDataDir(configDir);
  });

  ipcMain.handle("app:get-config-dir", () => {
    return configDir;
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

  ipcMain.handle("app:open-config-dir", () => {
    shell.openPath(configDir);
  });

  // Model download
  ipcMain.handle(
    "models:download",
    async (_event, repo: string, destDir: string) => {
      const win = getMainWindow();
      const config = readConfig(configDir);
      const mirrorUrl = config.hfMirrorUrl ?? undefined;

      // For Whisper models, prefer mlx_repo (MLX weights from mlx-community)
      const models = readUserModels(configDir);
      const model = models.find((m) => m.repo === repo);
      const effectiveRepo = model?.mlx_repo ?? repo;

      await downloadModel(
        effectiveRepo,
        destDir,
        (progress) => {
          win?.webContents.send("models:download-progress", progress);
        },
        mirrorUrl,
      );
    },
  );

  // Streaming audio write (crash-safe)
  ipcMain.handle(
    "audio:stream-open",
    (_event, sessionDir: string, fileName: string) => {
      openAudioStream(sessionDir, fileName);
    },
  );

  ipcMain.handle("audio:stream-write", (_event, pcmData: ArrayBuffer) => {
    appendAudioStream(Buffer.from(pcmData));
  });

  ipcMain.handle("audio:stream-close", () => {
    finalizeAudioStream();
  });

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

  // LLM Summarization (streaming SSE)
  ipcMain.handle(
    "llm:summarize",
    async (
      _event,
      sessionId: number,
      providerId: string,
      promptType: string,
    ) => {
      const win = getMainWindow();
      const config = readConfig(configDir);
      if (!providerId) {
        throw new Error("No LLM provider selected");
      }
      const provider = config.llmProviders.find(
        (p: LlmProvider) => p.id === providerId,
      );
      if (!provider) {
        throw new Error("Selected LLM provider not found");
      }
      if (!provider.apiKey) {
        throw new Error("API key not configured for selected provider");
      }

      // Resolve the system prompt from prompt type
      const effectiveTypes = getEffectivePromptTypes(config);
      const pType = effectiveTypes.find((t) => t.id === promptType);
      const systemPrompt =
        pType?.systemPrompt ??
        DEFAULT_PROMPT_TYPES.find((t) => t.id === "summarize")!.systemPrompt;

      // Gather all segments for this session
      const segments = getSegments(db, sessionId);
      if (segments.length === 0) {
        throw new Error("No transcript segments found for this session");
      }

      const transcriptText = segments.map((s: any) => s.text).join("\n");

      // Call OpenAI-compatible API with streaming
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);

      try {
        const baseUrl = provider.baseUrl.replace(/\/+$/, "");
        const resp = await net.fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${provider.apiKey}`,
          },
          body: JSON.stringify({
            model: provider.model,
            messages: [
              {
                role: "system",
                content: systemPrompt,
              },
              {
                role: "user",
                content: transcriptText,
              },
            ],
            stream: true,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!resp.ok) {
          const body = await resp.text();
          throw new Error(`LLM API error (${resp.status}): ${body}`);
        }

        // Parse SSE stream
        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let fullContent = "";
        let actualModel = provider.model;
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE lines
          const lines = buffer.split("\n");
          // Keep the last potentially incomplete line in the buffer
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data) as {
                model?: string;
                choices?: { delta?: { content?: string } }[];
              };
              if (parsed.model) {
                actualModel = parsed.model;
              }
              const delta = parsed.choices?.[0]?.delta?.content ?? "";
              if (delta) {
                fullContent += delta;
                win?.webContents.send("llm:summary-chunk", {
                  content: delta,
                  done: false,
                });
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
        }

        // Signal streaming complete
        win?.webContents.send("llm:summary-chunk", {
          content: "",
          done: true,
        });

        if (!fullContent) {
          throw new Error("LLM returned empty response");
        }

        // Save to database
        const summaryId = addSummary(db, {
          sessionId,
          content: fullContent,
          modelName: actualModel,
          providerId: provider.id,
          promptType: promptType || "summarize",
        });

        // Return the new summary record
        return {
          id: summaryId,
          session_id: sessionId,
          content: fullContent,
          model_name: actualModel,
          provider_id: provider.id,
          prompt_type: promptType || "summarize",
          created_at: new Date().toLocaleString("sv-SE").replace(" ", "T"),
        };
      } catch (err) {
        // Signal error to renderer so streaming card can clean up
        win?.webContents.send("llm:summary-chunk", {
          content: "",
          done: true,
        });
        throw err;
      }
    },
  );

  // LLM Provider Test
  ipcMain.handle(
    "llm:test",
    async (
      _event,
      provider: { baseUrl: string; apiKey: string; model: string },
    ) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const baseUrl = provider.baseUrl.replace(/\/+$/, "");
        const resp = await net.fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${provider.apiKey}`,
          },
          body: JSON.stringify({
            model: provider.model,
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 1,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!resp.ok) {
          const body = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${body}`);
        }
        const data = (await resp.json()) as {
          model?: string;
        };
        return { success: true, model: data.model ?? provider.model };
      } catch (err) {
        clearTimeout(timeout);
        throw err;
      }
    },
  );

  ipcMain.handle(
    "summary:list",
    (_event, sessionId: number, promptType?: string) => {
      return getSummaries(db, sessionId, promptType);
    },
  );

  ipcMain.handle("summary:delete", (_event, summaryId: number) => {
    deleteSummary(db, summaryId);
  });

  // Prompt Types
  ipcMain.handle("prompt-types:list", () => {
    const config = readConfig(configDir);
    return getEffectivePromptTypes(config);
  });

  ipcMain.handle("prompt-types:save", (_event, types: PromptType[]) => {
    const config = readConfig(configDir);
    writeConfig(configDir, { ...config, promptTypes: types });
  });

  // Audio import (upload existing audio file)
  ipcMain.handle("audio:import", async () => {
    const win = getMainWindow();
    if (!win) return null;

    // 1. Open file dialog
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
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

    const filePath = result.filePaths[0];

    // 2. Get file birthtime for session name
    const stat = fs.statSync(filePath);
    const birthtime = stat.birthtime;

    // 3. Format timestamp (same as useSession.ts)
    const formatTs = (d: Date): string =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}-${String(d.getMinutes()).padStart(2, "0")}-${String(d.getSeconds()).padStart(2, "0")}`;
    const timestamp = formatTs(birthtime);

    // 4. Create session
    const sessionId = createSession(db, { modelName: "imported" });
    updateSession(db, sessionId, { audioPath: timestamp, title: timestamp });

    // 5. Create audio directory
    const config = readConfig(configDir);
    const dataDir = config.dataDir ?? join(configDir, "data");
    const sessionDir = join(dataDir, "audio", timestamp);
    fs.mkdirSync(sessionDir, { recursive: true });

    // 6. Convert to 16kHz mono WAV via ffmpeg
    const outputPath = join(sessionDir, `${timestamp}.wav`);
    await convertToWav(filePath, outputPath);

    // 7. Calculate duration and update session
    const wavBuffer = fs.readFileSync(outputPath);
    const pcmBytes = wavBuffer.length - 44;
    const durationSeconds = Math.round(pcmBytes / 32000); // 16kHz * 16bit * mono
    updateSession(db, sessionId, {
      status: "completed",
      durationSeconds,
    });

    return { sessionId, timestamp };
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
