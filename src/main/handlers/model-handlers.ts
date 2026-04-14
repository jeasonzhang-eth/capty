import { ipcMain, app } from "electron";
import type { IpcDeps } from "./types";
import { assertPathWithin } from "../shared/path";
import {
  DownloadManager,
  calcDirSizeGb,
  isModelDownloaded,
} from "../download/download-manager";
import { readConfig } from "../config";
import fs from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Module-scoped state
// ---------------------------------------------------------------------------

/** Track active yt-dlp child processes by download ID for cancel support. */
const activeDownloads = new Map<number, unknown>();

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Recommended model file helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Known model type sets
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Model type inference (from disk)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Model loading (ASR + TTS)
// ---------------------------------------------------------------------------

/** Files to exclude when computing download size (matching model-downloader). */
const SIZE_SKIP_FILES = new Set([".gitattributes", "README.md"]);

/** Infer ASR model type label from HuggingFace tags / model ID (for UI display only). */
function inferModelType(hfModel: HFSearchResult): string {
  const id = hfModel.id.toLowerCase();
  const tags = hfModel.tags.map((t) => t.toLowerCase());

  if (tags.includes("whisper") || id.includes("whisper")) return "whisper";
  if (tags.includes("qwen") || id.includes("qwen")) return "qwen-asr";
  if (tags.includes("parakeet") || id.includes("parakeet")) return "parakeet";
  return "asr";
}

/** Infer TTS model type label from HuggingFace tags / model ID (for UI display only). */
function inferTtsModelType(hfModel: HFSearchResult): string {
  const id = hfModel.id.toLowerCase();
  if (id.includes("qwen3-tts") || id.includes("qwen-tts")) return "qwen3-tts";
  if (id.includes("kokoro")) return "kokoro";
  if (id.includes("spark-tts") || id.includes("sparktts")) return "spark-tts";
  if (id.includes("outetts")) return "outetts";
  if (id.includes("chatterbox")) return "chatterbox";
  if (id.includes("voxtral")) return "voxtral";
  return "tts";
}

/** Keywords in model ID / HF tags that indicate a supported STT architecture. */
const STT_SUPPORTED_KEYWORDS = [
  "whisper",
  "qwen3-asr",
  "qwen-asr",
  "qwen3asr",
  "sensevoice",
  "glm-asr",
  "glmasr",
  "firered",
  "voxtral",
  "vibevoice",
  "canary",
  "moonshine",
  "mms",
  "granite-speech",
  "granite_speech",
  "parakeet",
];

/** Keywords that indicate an unsupported STT architecture. */
const STT_UNSUPPORTED_KEYWORDS = [
  "funasr",
  "paraformer",
  "conformer",
  "wav2vec",
  "hubert",
  "data2vec",
  "unispeech",
  "wavlm",
];

/** Keywords in model ID / HF tags that indicate a supported TTS architecture. */
const TTS_SUPPORTED_KEYWORDS = [
  "qwen3-tts",
  "qwen-tts",
  "qwen3tts",
  "outetts",
  "spark-tts",
  "sparktts",
  "marvis",
  "csm",
  "sesame",
  "voxcpm",
  "vibevoice",
  "chatterbox",
  "soprano",
  "bailing",
  "kitten",
  "echo-tts",
  "echo_tts",
  "fish-qwen3-omni",
  "fish_qwen3_omni",
];

/**
 * Infer STT support from HuggingFace metadata (model ID + tags).
 * Returns true/false/undefined (unknown).
 */
function inferSttSupportFromHF(hfModel: HFSearchResult): boolean | undefined {
  const combined = `${hfModel.id.toLowerCase()} ${hfModel.tags.map((t) => t.toLowerCase()).join(" ")}`;
  if (STT_SUPPORTED_KEYWORDS.some((k) => combined.includes(k))) return true;
  if (STT_UNSUPPORTED_KEYWORDS.some((k) => combined.includes(k))) return false;
  return undefined;
}

/**
 * Infer TTS support from HuggingFace metadata (model ID + tags).
 * Returns true/false/undefined (unknown).
 */
function inferTtsSupportFromHF(hfModel: HFSearchResult): boolean | undefined {
  const combined = `${hfModel.id.toLowerCase()} ${hfModel.tags.map((t) => t.toLowerCase()).join(" ")}`;
  if (TTS_SUPPORTED_KEYWORDS.some((k) => combined.includes(k))) return true;
  return undefined;
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

  return mlxResults.map((r, i) => ({
    ...hfModelToEntry(r, sizes[i]),
    supported: inferSttSupportFromHF(r),
  }));
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

// ---------------------------------------------------------------------------
// Register function (exported)
// ---------------------------------------------------------------------------

export function register(deps: IpcDeps): void {
  const { configDir, getMainWindow } = deps;

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

  // ASR Models
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

  // Model download (uses DownloadManager)
  ipcMain.handle(
    "models:download",
    async (_event, repo: string, destDir: string) => {
      const mgr = getDownloadManager();
      const modelId = destDir.split("/").pop() ?? repo.replace(/\//g, "--");
      await mgr.download(modelId, repo, destDir, "asr");
    },
  );

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
        type: inferTtsModelType(r),
        downloaded: isModelDownloaded(ttsModelsDir, entry.id),
        supported: inferTtsSupportFromHF(r),
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
}

// Suppress unused variable warning — activeDownloads is kept for future use
void activeDownloads;
