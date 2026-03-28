import { ipcMain, dialog, BrowserWindow, app, shell, net } from "electron";
import { spawn } from "child_process";
import fs from "fs";
import path from "node:path";
import { join } from "path";

/**
 * Validates that `targetPath` resolves to a location within `basePath`.
 * Throws if a path traversal is detected (e.g. via `../`).
 */
function assertPathWithin(basePath: string, targetPath: string): void {
  const resolved = path.resolve(targetPath);
  const resolvedBase = path.resolve(basePath);
  if (
    !resolved.startsWith(resolvedBase + path.sep) &&
    resolved !== resolvedBase
  ) {
    throw new Error(`Path traversal detected: ${targetPath}`);
  }
}

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
  TtsProvider,
  PromptType,
  getEffectivePromptTypes,
  DEFAULT_PROMPT_TYPES,
} from "./config";
import { pcmToWav } from "./audio-files";
import {
  DownloadManager,
  calcDirSizeGb,
  isModelDownloaded,
} from "./download/download-manager";

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
  readonly size_gb: number;
  readonly languages: readonly string[];
  readonly description: string;
  readonly downloaded?: boolean;
  readonly supported?: boolean;
}

interface RecommendedModel {
  readonly repo: string;
  readonly name: string;
  readonly type: string;
  readonly size_gb: number;
  readonly languages: readonly string[];
  readonly description: string;
}

/** Read a recommended models JSON file shipped with the app. */
function readRecommendedFile(filename: string): RecommendedModel[] {
  try {
    const registryPath = join(
      app.isPackaged
        ? join(process.resourcesPath, "resources")
        : join(__dirname, "../../resources"),
      filename,
    );
    return JSON.parse(
      fs.readFileSync(registryPath, "utf-8"),
    ) as RecommendedModel[];
  } catch {
    return [];
  }
}

/** Read recommended-models.json (ASR) shipped with the app. */
function readRecommendedModels(): RecommendedModel[] {
  return readRecommendedFile("recommended-models.json");
}

/** Read recommended-tts-models.json shipped with the app. */
function readRecommendedTtsModels(): RecommendedModel[] {
  return readRecommendedFile("recommended-tts-models.json");
}

/**
 * Migrate flat models/ directory to models/asr/ + models/tts/ structure.
 * Moves existing model directories (non-asr/tts) into models/asr/.
 */
export function migrateModelsDir(dataDir: string): void {
  const modelsDir = join(dataDir, "models");
  const asrDir = join(modelsDir, "asr");
  const ttsDir = join(modelsDir, "tts");

  // If asr/ already exists, migration is done
  if (fs.existsSync(asrDir)) return;

  fs.mkdirSync(asrDir, { recursive: true });
  fs.mkdirSync(ttsDir, { recursive: true });

  if (fs.existsSync(modelsDir)) {
    for (const entry of fs.readdirSync(modelsDir)) {
      if (entry === "asr" || entry === "tts") continue;
      const src = join(modelsDir, entry);
      try {
        if (fs.statSync(src).isDirectory()) {
          fs.renameSync(src, join(asrDir, entry));
        }
      } catch {
        // Skip entries that can't be moved
      }
    }
  }
}

/** Read model-meta.json from a model directory, fallback to inference. */
function readModelMeta(dirPath: string, dirName: string): ModelEntry {
  // Always use actual disk size for downloaded models (meta.size_gb may be stale)
  const actualSizeGb = calcDirSizeGb(dirPath);
  const supported = isModelSttSupported(dirPath);

  // Try model-meta.json first
  const metaPath = join(dirPath, "model-meta.json");
  try {
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      return {
        id: dirName,
        name: meta.name ?? dirName,
        type: meta.type ?? inferModelTypeFromDir(dirPath),
        repo: meta.repo ?? dirName.replace(/--/g, "/"),
        size_gb: actualSizeGb,
        languages: meta.languages ?? ["multilingual"],
        description: meta.description ?? "",
        downloaded: true,
        supported,
      };
    }
  } catch {
    // Fall through to inference
  }

  // Infer from directory name + config.json
  const repo = dirName.replace(/--/g, "/");
  const name = dirName.includes("--")
    ? (dirName.split("--").pop() ?? dirName)
    : dirName;
  return {
    id: dirName,
    name,
    type: inferModelTypeFromDir(dirPath),
    repo,
    size_gb: calcDirSizeGb(dirPath),
    languages: ["multilingual"],
    description: repo,
    downloaded: true,
    supported,
  };
}

/** Known STT model types from mlx-audio MODEL_REMAPPING (keys + values). */
const KNOWN_STT_TYPES = new Set([
  // Keys (config.json model_type → remapping key)
  "fireredasr2",
  "glm",
  "sensevoice",
  "voxtral",
  "voxtral_realtime",
  "vibevoice",
  "qwen3_asr",
  "canary",
  "moonshine",
  "mms",
  "granite_speech",
  // Values (module names that some models report as model_type)
  "glmasr",
  "vibevoice_asr",
]);

/** Known TTS model types from mlx-audio MODEL_REMAPPING (keys + values). */
const KNOWN_TTS_TYPES = new Set([
  // Keys
  "qwen3_tts",
  "outetts",
  "spark",
  "marvis",
  "csm",
  "voxcpm",
  "voxcpm1.5",
  "vibevoice_streaming",
  "chatterbox_turbo",
  "soprano",
  "bailingmm",
  "kitten",
  "echo_tts",
  "fish_qwen3_omni",
  // Values (module names that some models report as model_type)
  "sesame",
  "kitten_tts",
  "vibevoice",
]);

/** Infer model type from config.json's model_type / architectures fields. */
function inferModelTypeFromDir(dirPath: string): string {
  const configPath = join(dirPath, "config.json");
  try {
    if (!fs.existsSync(configPath)) return "auto";
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const modelType = (cfg.model_type ?? "").toLowerCase();

    // Check against mlx-audio known model types
    if (KNOWN_STT_TYPES.has(modelType)) return modelType;
    if (KNOWN_TTS_TYPES.has(modelType)) return modelType;

    // Fallback: keyword-based detection
    const architectures = (cfg.architectures ?? [])
      .map((a: string) => a.toLowerCase())
      .join(" ");
    const combined = `${modelType} ${architectures}`;
    if (combined.includes("whisper")) return "whisper";
    if (combined.includes("qwen")) return "qwen-asr";
    if (combined.includes("parakeet")) return "parakeet";
  } catch {
    // Cannot read config.json
  }
  return "auto";
}

/**
 * Check if a downloaded ASR model is supported by mlx-audio STT.
 *
 * Returns true if:
 * - model_type is in KNOWN_STT_TYPES
 * - model_type matches whisper/qwen/parakeet keywords
 * - no config.json or no model_type (benefit of the doubt)
 *
 * Returns false if model_type is present but not recognized as STT-compatible.
 */
function isModelSttSupported(dirPath: string): boolean {
  const configPath = join(dirPath, "config.json");
  try {
    if (!fs.existsSync(configPath)) return true; // No config → unknown, assume OK
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const modelType = (cfg.model_type ?? "").toLowerCase();
    if (!modelType) return true; // No model_type → unknown, assume OK

    // Check against known STT types
    if (KNOWN_STT_TYPES.has(modelType)) return true;

    // Check keyword-based patterns
    const architectures = (cfg.architectures ?? [])
      .map((a: string) => a.toLowerCase())
      .join(" ");
    const combined = `${modelType} ${architectures}`;
    if (
      combined.includes("whisper") ||
      combined.includes("qwen") ||
      combined.includes("parakeet")
    ) {
      return true;
    }

    // model_type is present but not recognized → unsupported
    return false;
  } catch {
    return true; // Cannot read config → assume OK
  }
}

/** Write model-meta.json into the model directory after download. */
function writeModelMeta(
  dirPath: string,
  meta: {
    repo: string;
    name: string;
    type: string;
    size_gb: number;
    languages: readonly string[];
    description: string;
  },
): void {
  const metaPath = join(dirPath, "model-meta.json");
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        repo: meta.repo,
        name: meta.name,
        type: meta.type,
        size_gb: meta.size_gb,
        languages: meta.languages,
        description: meta.description,
        downloaded_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf-8",
  );
}

/** Load ASR models: disk-scanned downloaded + recommended (not yet downloaded). */
async function loadAsrModels(configDir: string): Promise<ModelEntry[]> {
  const config = readConfig(configDir);
  const dataDir = config.dataDir ?? join(configDir, "data");
  const modelsDir = join(dataDir, "models", "asr");
  const mirrorUrl = config.hfMirrorUrl ?? undefined;

  // 1. Scan disk for downloaded models
  const downloaded: ModelEntry[] = [];
  const downloadedIds = new Set<string>();

  if (fs.existsSync(modelsDir)) {
    try {
      for (const dir of fs.readdirSync(modelsDir)) {
        const dirPath = join(modelsDir, dir);
        if (!fs.statSync(dirPath).isDirectory()) continue;
        if (!isModelDownloaded(modelsDir, dir)) continue;
        const entry = readModelMeta(dirPath, dir);
        downloaded.push(entry);
        downloadedIds.add(entry.id);
      }
    } catch {
      // Cannot read models dir
    }
  }

  // 2. Read recommended models, filter out already downloaded
  const recommended = readRecommendedModels();
  const notDownloadedRec = recommended.filter((r) => {
    const id = r.repo.replace(/\//g, "--");
    return !downloadedIds.has(id);
  });

  // 3. Fetch actual sizes from HF tree API for non-downloaded recommended models
  const baseUrl = mirrorUrl ?? "https://huggingface.co";
  const sizes = await Promise.all(
    notDownloadedRec.map((r) => fetchRepoSizeGb(r.repo, baseUrl)),
  );

  const notDownloaded: ModelEntry[] = notDownloadedRec.map((r, i) => ({
    id: r.repo.replace(/\//g, "--"),
    name: r.name,
    type: r.type,
    repo: r.repo,
    size_gb: sizes[i] > 0 ? sizes[i] : r.size_gb, // API size, fallback to hardcoded
    languages: r.languages,
    description: r.description,
    downloaded: false,
    supported: true, // Recommended models are known to be compatible
  }));

  const all = [...downloaded, ...notDownloaded];

  // Sort: group by type (alphabetically), then by size within each group
  all.sort((a, b) => {
    const typeCmp = a.type.localeCompare(b.type);
    if (typeCmp !== 0) return typeCmp;
    return a.size_gb - b.size_gb;
  });

  return all;
}

/** Load TTS models: disk-scanned downloaded + recommended (not yet downloaded). */
async function loadTtsModels(configDir: string): Promise<ModelEntry[]> {
  const config = readConfig(configDir);
  const dataDir = config.dataDir ?? join(configDir, "data");
  const modelsDir = join(dataDir, "models", "tts");
  const mirrorUrl = config.hfMirrorUrl ?? undefined;

  // 1. Scan disk for downloaded TTS models
  const downloaded: ModelEntry[] = [];
  const downloadedIds = new Set<string>();

  if (fs.existsSync(modelsDir)) {
    try {
      for (const dir of fs.readdirSync(modelsDir)) {
        const dirPath = join(modelsDir, dir);
        if (!fs.statSync(dirPath).isDirectory()) continue;
        if (!isModelDownloaded(modelsDir, dir)) continue;
        const entry = readModelMeta(dirPath, dir);
        downloaded.push(entry);
        downloadedIds.add(entry.id);
      }
    } catch {
      // Cannot read models dir
    }
  }

  // 2. Read recommended TTS models, filter out already downloaded
  const recommended = readRecommendedTtsModels();
  const notDownloadedRec = recommended.filter((r) => {
    const id = r.repo.replace(/\//g, "--");
    return !downloadedIds.has(id);
  });

  // 3. Fetch actual sizes from HF tree API
  const baseUrl = mirrorUrl ?? "https://huggingface.co";
  const sizes = await Promise.all(
    notDownloadedRec.map((r) => fetchRepoSizeGb(r.repo, baseUrl)),
  );

  const notDownloaded: ModelEntry[] = notDownloadedRec.map((r, i) => ({
    id: r.repo.replace(/\//g, "--"),
    name: r.name,
    type: r.type,
    repo: r.repo,
    size_gb: sizes[i] > 0 ? sizes[i] : r.size_gb,
    languages: r.languages,
    description: r.description,
    downloaded: false,
    supported: true,
  }));

  const all = [...downloaded, ...notDownloaded];
  all.sort((a, b) => {
    const typeCmp = a.type.localeCompare(b.type);
    if (typeCmp !== 0) return typeCmp;
    return a.size_gb - b.size_gb;
  });

  return all;
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

/** Infer model type label from HuggingFace tags / model ID (for UI display only). */
function inferModelType(hfModel: HFSearchResult): string {
  const id = hfModel.id.toLowerCase();
  const tags = hfModel.tags.map((t) => t.toLowerCase());

  if (tags.includes("whisper") || id.includes("whisper")) return "whisper";
  if (tags.includes("qwen") || id.includes("qwen")) return "qwen-asr";
  if (tags.includes("parakeet") || id.includes("parakeet")) return "parakeet";
  return "auto";
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
    author: "mlx-community",
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

  // Filter: only MLX-compatible models (must have mlx/safetensors tag)
  const mlxResults = results.filter((r) => {
    const tags = r.tags.map((t) => t.toLowerCase());
    return tags.includes("mlx") || tags.includes("safetensors");
  });

  // Fetch file sizes for each result in parallel via the tree API
  const sizes = await Promise.all(
    mlxResults.map((r) => fetchRepoSizeGb(r.id, baseUrl)),
  );

  return mlxResults.map((r, i) => hfModelToEntry(r, sizes[i]));
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const { db, configDir, getMainWindow } = deps;

  // Download manager — lazily initialized when first download starts
  let downloadManager: DownloadManager | null = null;

  function getDownloadManager(): DownloadManager {
    if (!downloadManager) {
      const config = readConfig(configDir);
      const dataDir = config.dataDir ?? join(configDir, "data");
      const modelsDir = join(dataDir, "models");
      const win = getMainWindow();
      downloadManager = new DownloadManager({
        modelsDir,
        mirrorUrl: config.hfMirrorUrl ?? undefined,
        onProgress: (progress) => {
          win?.webContents.send("download:progress", progress);
          // Also send legacy progress events for backward compatibility
          const legacyChannel =
            progress.category === "tts"
              ? "tts-models:download-progress"
              : "models:download-progress";
          win?.webContents.send(legacyChannel, {
            downloaded: progress.downloaded,
            total: progress.total,
            percent: progress.percent,
          });
        },
      });
    }
    // Sync mirror URL from config each time
    const config = readConfig(configDir);
    downloadManager.setMirrorUrl(config.hfMirrorUrl ?? undefined);
    return downloadManager;
  }

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

  // External ASR connectivity test (send 1s 440Hz sine wave)
  ipcMain.handle(
    "asr:test",
    async (
      _event,
      provider: { baseUrl: string; apiKey: string; model: string },
    ) => {
      // Generate 1 second of 440Hz sine wave at 16kHz 16bit mono
      const sampleRate = 16000;
      const duration = 1; // seconds
      const frequency = 440; // Hz
      const numSamples = sampleRate * duration;
      const pcmBuffer = Buffer.alloc(numSamples * 2); // 16bit = 2 bytes per sample
      for (let i = 0; i < numSamples; i++) {
        const sample = Math.round(
          Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 16000,
        );
        pcmBuffer.writeInt16LE(sample, i * 2);
      }
      const wavBuffer = pcmToWav(pcmBuffer, sampleRate, 1, 16);

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
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errBody}`);
      }

      const result = (await resp.json()) as { text?: string };
      return { success: true, text: result.text ?? "" };
    },
  );

  // TTS connectivity test (send short text, verify audio response)
  ipcMain.handle(
    "tts:test",
    async (
      _event,
      provider: { baseUrl: string; apiKey: string; model: string },
    ) => {
      const baseUrl = provider.baseUrl.replace(/\/+$/, "");
      const formData = new FormData();
      formData.append("input", "Hello");
      if (provider.model) formData.append("model", provider.model);

      const resp = await net.fetch(`${baseUrl}/v1/audio/speech`, {
        method: "POST",
        headers: {
          ...(provider.apiKey
            ? { Authorization: `Bearer ${provider.apiKey}` }
            : {}),
        },
        body: formData,
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errBody}`);
      }

      const buffer = await resp.arrayBuffer();
      if (buffer.byteLength < 100) {
        throw new Error(
          `TTS returned too little data (${buffer.byteLength} bytes)`,
        );
      }
      return { success: true, bytes: buffer.byteLength };
    },
  );

  // Models — builtin registry + user-downloaded models
  ipcMain.handle("models:list", async () => {
    return loadAsrModels(configDir);
  });

  // Write model-meta.json into an ASR model directory (called after download)
  ipcMain.handle(
    "models:save-meta",
    (_event, modelId: string, meta: Record<string, unknown>) => {
      const config = readConfig(configDir);
      const dataDir = config.dataDir ?? join(configDir, "data");
      const modelsDir = join(dataDir, "models", "asr");
      const dirPath = join(modelsDir, modelId);
      if (fs.existsSync(dirPath)) {
        writeModelMeta(
          dirPath,
          meta as unknown as {
            repo: string;
            name: string;
            type: string;
            size_gb: number;
            languages: readonly string[];
            description: string;
          },
        );
      }
    },
  );

  // Search HuggingFace for ASR models
  ipcMain.handle("models:search", async (_event, query: string) => {
    const config = readConfig(configDir);
    const mirrorUrl = config.hfMirrorUrl ?? undefined;
    const results = await searchHuggingFaceModels(query, mirrorUrl);
    // Mark downloaded status
    const dataDir = config.dataDir ?? join(configDir, "data");
    const modelsDir = join(dataDir, "models", "asr");
    return results.map((m) => ({
      ...m,
      downloaded: isModelDownloaded(modelsDir, m.id),
    }));
  });

  // Delete a downloaded ASR model — just remove the directory
  ipcMain.handle("models:delete", async (_event, modelId: string) => {
    const config = readConfig(configDir);
    const dataDir = config.dataDir ?? join(configDir, "data");
    const modelsDir = join(dataDir, "models", "asr");
    const modelPath = join(modelsDir, modelId);
    assertPathWithin(modelsDir, modelPath);

    if (fs.existsSync(modelPath)) {
      fs.rmSync(modelPath, { recursive: true, force: true });
    }
  });

  // TTS Models — builtin registry + user-downloaded TTS models
  ipcMain.handle("tts-models:list", async () => {
    return loadTtsModels(configDir);
  });

  // Write model-meta.json into a TTS model directory (called after download)
  ipcMain.handle(
    "tts-models:save-meta",
    (_event, modelId: string, meta: Record<string, unknown>) => {
      const config = readConfig(configDir);
      const dataDir = config.dataDir ?? join(configDir, "data");
      const modelsDir = join(dataDir, "models", "tts");
      const dirPath = join(modelsDir, modelId);
      if (fs.existsSync(dirPath)) {
        writeModelMeta(
          dirPath,
          meta as unknown as {
            repo: string;
            name: string;
            type: string;
            size_gb: number;
            languages: readonly string[];
            description: string;
          },
        );
      }
    },
  );

  // Search HuggingFace for TTS models
  ipcMain.handle("tts-models:search", async (_event, query: string) => {
    const config = readConfig(configDir);
    const mirrorUrl = config.hfMirrorUrl ?? undefined;
    const baseUrl = mirrorUrl ?? "https://huggingface.co";

    const params = new URLSearchParams({
      search: query,
      author: "mlx-community",
      pipeline_tag: "text-to-speech",
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

    const mlxResults = results.filter((r) => {
      const tags = r.tags.map((t) => t.toLowerCase());
      return tags.includes("mlx") || tags.includes("safetensors");
    });

    const sizes = await Promise.all(
      mlxResults.map((r) => fetchRepoSizeGb(r.id, baseUrl)),
    );

    // Mark downloaded status
    const dataDir = config.dataDir ?? join(configDir, "data");
    const ttsModelsDir = join(dataDir, "models", "tts");

    return mlxResults.map((r, i) => {
      const entry = hfModelToEntry(r, sizes[i]);
      return {
        ...entry,
        type: "tts",
        downloaded: isModelDownloaded(ttsModelsDir, entry.id),
      };
    });
  });

  // Delete a downloaded TTS model
  ipcMain.handle("tts-models:delete", async (_event, modelId: string) => {
    const config = readConfig(configDir);
    const dataDir = config.dataDir ?? join(configDir, "data");
    const ttsModelsDir = join(dataDir, "models", "tts");
    const modelPath = join(ttsModelsDir, modelId);
    assertPathWithin(ttsModelsDir, modelPath);
    if (fs.existsSync(modelPath)) {
      fs.rmSync(modelPath, { recursive: true, force: true });
    }
  });

  // TTS model download (uses DownloadManager)
  ipcMain.handle(
    "tts-models:download",
    async (_event, repo: string, destDir: string) => {
      const mgr = getDownloadManager();
      // Extract model ID from destDir (last path segment)
      const modelId = destDir.split("/").pop() ?? repo.replace(/\//g, "--");
      await mgr.download(modelId, repo, destDir, "tts");
    },
  );

  // Save TTS settings (providers + selection)
  ipcMain.handle(
    "config:save-tts-settings",
    (
      _event,
      settings: {
        ttsProviders: TtsProvider[];
        selectedTtsProviderId: string | null;
        selectedTtsModelId: string | null;
      },
    ) => {
      const config = readConfig(configDir);
      writeConfig(configDir, {
        ...config,
        ttsProviders: settings.ttsProviders,
        selectedTtsProviderId: settings.selectedTtsProviderId,
        selectedTtsModelId: settings.selectedTtsModelId,
      });
    },
  );

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

  // Model download (uses DownloadManager)
  ipcMain.handle(
    "models:download",
    async (_event, repo: string, destDir: string) => {
      const mgr = getDownloadManager();
      const modelId = destDir.split("/").pop() ?? repo.replace(/\//g, "--");
      await mgr.download(modelId, repo, destDir, "asr");
    },
  );

  // Download control: pause / resume / cancel / list incomplete
  ipcMain.handle("download:pause", (_event, modelId: string) => {
    const mgr = getDownloadManager();
    return mgr.pause(modelId);
  });

  ipcMain.handle("download:resume", async (_event, modelId: string) => {
    const mgr = getDownloadManager();
    await mgr.resumeIncomplete(modelId);
  });

  ipcMain.handle("download:cancel", (_event, modelId: string) => {
    const mgr = getDownloadManager();
    return mgr.cancel(modelId);
  });

  ipcMain.handle("download:list-incomplete", () => {
    const mgr = getDownloadManager();
    return mgr.getIncompleteDownloads();
  });

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

  // Audio import (upload existing audio file — no ffmpeg needed)
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

    // 3. Format timestamps
    const pad = (n: number): string => String(n).padStart(2, "0");
    const dirTimestamp = `${birthtime.getFullYear()}-${pad(birthtime.getMonth() + 1)}-${pad(birthtime.getDate())}T${pad(birthtime.getHours())}-${pad(birthtime.getMinutes())}-${pad(birthtime.getSeconds())}`;
    const readableTimestamp = `${birthtime.getFullYear()}-${pad(birthtime.getMonth() + 1)}-${pad(birthtime.getDate())} ${pad(birthtime.getHours())}:${pad(birthtime.getMinutes())}:${pad(birthtime.getSeconds())}`;

    // 4. Deduplicate audio directory name
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

    // 5. Create session with deduplicated path
    const sessionId = createSession(db, { modelName: "imported" });
    updateSession(db, sessionId, {
      audioPath: finalTimestamp,
      title: readableTimestamp,
      startedAt: readableTimestamp,
    });
    fs.mkdirSync(sessionDir, { recursive: true });
    const destPath = join(sessionDir, `${finalTimestamp}.wav`);
    await convertToWav(filePath, destPath);

    // 6. Calculate duration from WAV and update session
    const wavStat = fs.statSync(destPath);
    const pcmBytes = wavStat.size - 44; // 44-byte WAV header
    const durationSeconds = Math.round(pcmBytes / 32000); // 16kHz * 16bit * mono
    updateSession(db, sessionId, {
      status: "completed",
      durationSeconds,
    });

    return { sessionId, timestamp: dirTimestamp, audioPath: destPath };
  });

  // Get audio duration from WAV header (all audio is converted to WAV on import)
  ipcMain.handle("audio:get-duration", (_event, filePath: string) => {
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

  // Transcribe audio file via sidecar (file-path based, no ffmpeg)
  ipcMain.handle(
    "audio:transcribe-file",
    async (
      _event,
      filePath: string,
      provider: { baseUrl: string; apiKey: string; model: string },
    ) => {
      const baseUrl = provider.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
      const resp = await net.fetch(`${baseUrl}/v1/audio/transcribe-file`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(provider.apiKey
            ? { Authorization: `Bearer ${provider.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          file_path: filePath,
          model: provider.model,
        }),
        signal: AbortSignal.timeout(300000), // 5min for large files
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`Transcribe file error (${resp.status}): ${errBody}`);
      }

      const data = (await resp.json()) as {
        text?: string;
        segments?: Array<{ start: number; end: number; text: string }>;
        duration?: number;
      };
      return {
        text: data.text ?? "",
        segments: data.segments ?? [],
        duration: data.duration ?? 0,
      };
    },
  );

  // Decode audio file to 16kHz mono WAV via sidecar (any format → WAV)
  ipcMain.handle(
    "audio:decode-file",
    async (_event, filePath: string, sidecarBaseUrl: string) => {
      const baseUrl = sidecarBaseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
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
    },
  );

  // TTS provider reachability check
  ipcMain.handle("tts:check-provider", async () => {
    const config = readConfig(configDir);
    const selectedId = config.selectedTtsProviderId ?? "sidecar";
    const provider = (config.ttsProviders ?? []).find(
      (p) => p.id === selectedId,
    );
    if (!provider) {
      return { ready: false, reason: "No TTS provider configured" };
    }
    const url = provider.baseUrl ?? "http://localhost:8765";
    try {
      if (provider.isSidecar) {
        // Check sidecar /health endpoint for tts_loaded
        const resp = await fetch(`${url}/health`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!resp.ok) {
          return { ready: false, reason: `Sidecar returned ${resp.status}` };
        }
        const data = (await resp.json()) as Record<string, unknown>;
        return { ready: true, reason: "Sidecar online", ...data };
      } else {
        // External: check if /v1/audio/speech endpoint is reachable
        const resp = await net.fetch(`${url}/v1/audio/speech`, {
          method: "OPTIONS",
          signal: AbortSignal.timeout(3000),
        });
        // Any non-network-error response means the server is reachable
        return { ready: true, reason: `Provider reachable (${resp.status})` };
      }
    } catch {
      return { ready: false, reason: "Provider unreachable" };
    }
  });

  // TTS voice listing
  ipcMain.handle("tts:list-voices", async (_event, modelDir: string) => {
    const config = readConfig(configDir);
    const provider = (config.ttsProviders ?? []).find(
      (p) => p.id === (config.selectedTtsProviderId ?? "sidecar"),
    );
    const url = provider?.baseUrl ?? "http://localhost:8765";

    // Guard: check provider reachability first — return empty on failure
    try {
      await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    } catch {
      return { model: "", voices: [] };
    }

    try {
      const resp = await net.fetch(
        `${url}/tts/voices?model_dir=${encodeURIComponent(modelDir)}`,
        { signal: AbortSignal.timeout(10000) },
      );
      if (!resp.ok) return { model: "", voices: [] };
      return await resp.json();
    } catch {
      return { model: "", voices: [] };
    }
  });

  // TTS (text-to-speech via provider)
  ipcMain.handle(
    "tts:speak",
    async (
      _event,
      text: string,
      opts?: { voice?: string; speed?: number; langCode?: string },
    ) => {
      const config = readConfig(configDir);
      const selectedId = config.selectedTtsProviderId ?? "sidecar";
      const provider = (config.ttsProviders ?? []).find(
        (p) => p.id === selectedId,
      );
      if (!provider) {
        throw new Error("No TTS provider configured. Add one in Settings.");
      }
      const url = provider.baseUrl ?? "http://localhost:8765";

      // Guard: check provider reachability before making TTS request
      try {
        await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
      } catch {
        throw new Error(
          "TTS provider is not available. Check that the sidecar or external TTS server is running.",
        );
      }

      // Resolve the TTS model path so the sidecar can auto-switch
      const ttsModelId = config.selectedTtsModelId;
      let ttsModelPath = "";
      if (ttsModelId) {
        const dataDir = config.dataDir ?? join(configDir, "data");
        ttsModelPath = join(dataDir, "models", "tts", ttsModelId);
      }

      const formData = new FormData();
      formData.append("input", text);
      if (ttsModelPath) formData.append("model", ttsModelPath);
      formData.append("voice", opts?.voice ?? provider?.voice ?? "auto");
      formData.append("speed", String(opts?.speed ?? 1.0));
      formData.append("lang_code", opts?.langCode ?? "auto");

      const resp = await net.fetch(`${url}/v1/audio/speech`, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(120000),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`TTS failed (${resp.status}): ${errBody}`);
      }

      const buffer = await resp.arrayBuffer();
      return Buffer.from(buffer);
    },
  );

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
