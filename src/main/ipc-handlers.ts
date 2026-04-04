import { ipcMain, dialog, BrowserWindow, app, shell, net } from "electron";
import { spawn, execSync, type ChildProcess } from "child_process";
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

/** Strip trailing /v1 so we can append /v1/... consistently. */
function normalizeTtsUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
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
  saveTranslation,
  getTranslations,
  createDownload,
  getDownload,
  listDownloads,
  updateDownload,
  deleteDownload,
  listInterruptedDownloads,
  reorderSessions,
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
  SessionCategory,
  getEffectivePromptTypes,
  getEffectiveCategories,
  DEFAULT_PROMPT_TYPES,
} from "./config";
import { pcmToWav } from "./audio-files";
import {
  DownloadManager,
  calcDirSizeGb,
  isModelDownloaded,
} from "./download/download-manager";

/** Track active yt-dlp child processes by download ID for cancel support. */
const activeDownloads = new Map<number, ChildProcess>();

/** Managed sidecar child process (null when not started by us). */
let sidecarProcess: ChildProcess | null = null;

/** Find sidecar binary: packaged app first, then dev venv, then PATH. */
function findSidecarBin(): string {
  // Production: extraResources copies sidecar/dist/ → Resources/sidecar/
  if (app.isPackaged) {
    const prodBin = path.join(
      process.resourcesPath,
      "sidecar",
      "capty-sidecar",
      "capty-sidecar",
    );
    if (fs.existsSync(prodBin)) return prodBin;
  }
  // Dev: __dirname is out/main/, project root is 2 levels up
  const projectRoot = app.isPackaged
    ? app.getAppPath()
    : path.join(__dirname, "../..");
  const devBin = path.join(projectRoot, "sidecar/.venv/bin/capty-sidecar");
  if (fs.existsSync(devBin)) return devBin;
  // Fallback: PATH
  return "capty-sidecar";
}

/** Parse port from sidecar base URL, default 8765. */
function parseSidecarPort(baseUrl: string): number {
  try {
    const port = new URL(baseUrl).port;
    return port ? Number(port) : 8765;
  } catch {
    return 8765;
  }
}

/** Cached sidecar port from config (invalidated on config:set). */
let _cachedSidecarPort: number | null = null;

/** Read sidecar port from config (cached). */
function getSidecarPort(cfgDir: string): number {
  if (_cachedSidecarPort !== null) return _cachedSidecarPort;
  const config = readConfig(cfgDir);
  _cachedSidecarPort = config.sidecar?.port ?? 8765;
  _lastSidecarPort = _cachedSidecarPort;
  return _cachedSidecarPort;
}

/** Build sidecar base URL from config port. */
function getSidecarBaseUrl(cfgDir: string): string {
  return `http://localhost:${getSidecarPort(cfgDir)}`;
}

/** Poll /health until OK or timeout. */
async function waitForHealth(
  baseUrl: string,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Sidecar failed to start within timeout");
}

/** PID of last managed sidecar (kept for process.exit SIGKILL fallback). */
let _sidecarPid: number | null = null;

/** Last known sidecar port (for killing orphans on exit). */
let _lastSidecarPort: number = 8765;

/** Guard against concurrent sidecar:start calls (e.g. React StrictMode double-invoke). */
let _sidecarStarting: Promise<{ ok: boolean; error?: string }> | null = null;

/**
 * Check whether the process on the given port is actually a capty-sidecar
 * by probing /health and verifying the response contains `status: "ok"`.
 * Returns the PID(s) on the port if it IS sidecar, empty array otherwise.
 */
function findSidecarPidsOnPort(port: number): number[] {
  // 1. Verify identity via /health (synchronous HTTP is not available,
  //    so we do a quick lsof + process-name check instead)
  try {
    const out = execSync(`lsof -ti tcp:${port}`, {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    if (!out) return [];
    const pids = out
      .split("\n")
      .map((s) => Number(s))
      .filter((n) => n > 0);
    // Verify each PID is actually a capty-sidecar (check process command)
    return pids.filter((pid) => {
      try {
        const cmd = execSync(`ps -o command= -p ${pid}`, {
          encoding: "utf-8",
          timeout: 2000,
        }).trim();
        return cmd.includes("capty-sidecar") || cmd.includes("capty_sidecar");
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

/** Kill the managed sidecar process and any orphan sidecar on the port. */
export function killSidecar(): void {
  // Kill managed process
  if (sidecarProcess) {
    _sidecarPid = sidecarProcess.pid ?? null;
    const proc = sidecarProcess;
    sidecarProcess = null;
    try {
      proc.kill("SIGTERM");
    } catch {
      // already dead
    }
  }
  // Kill orphan sidecar on the port (only if process name matches)
  for (const pid of findSidecarPidsOnPort(_lastSidecarPort)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already dead
    }
  }
}

// Last-resort SIGKILL: `process.on('exit')` fires synchronously right before
// the Node.js event loop stops. Any sidecar that survived SIGTERM gets killed.
process.on("exit", () => {
  if (_sidecarPid) {
    try {
      process.kill(_sidecarPid, "SIGKILL");
    } catch {
      // already dead — expected
    }
    _sidecarPid = null;
  }
});

/** Extract domain from URL for display. */
function extractSource(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

/** Parse yt-dlp download progress line. */
function parseYtdlpProgress(line: string): {
  percent: number;
  speed: string;
  eta: string;
} | null {
  const m = line.match(
    /\[download\]\s+([\d.]+)%\s+of\s+~?[\d.]+\S+\s+at\s+([\d.]+\S+)\s+ETA\s+(\S+)/,
  );
  if (!m) return null;
  return { percent: parseFloat(m[1]), speed: m[2], eta: m[3] };
}

/** Check if URL is a Xiaoyuzhou (小宇宙) podcast episode. */
function isXiaoyuzhouUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "www.xiaoyuzhoufm.com" || host === "xiaoyuzhoufm.com";
  } catch {
    return false;
  }
}

/** Fetch Xiaoyuzhou episode info from __NEXT_DATA__. */
async function fetchXiaoyuzhouEpisode(
  url: string,
): Promise<{ title: string; audioUrl: string; duration: number }> {
  const resp = await net.fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch episode page (${resp.status})`);
  }
  const html = await resp.text();

  // Extract __NEXT_DATA__ JSON
  const m = html.match(
    /<script\s+id="__NEXT_DATA__"\s+type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!m) throw new Error("Could not find __NEXT_DATA__ in episode page");

  const data = JSON.parse(m[1]);
  const episode = data?.props?.pageProps?.episode;
  if (!episode) throw new Error("Episode data not found in __NEXT_DATA__");

  const audioUrl = episode.enclosure?.url || episode.media?.url;
  if (!audioUrl) throw new Error("Audio URL not found in episode data");

  return {
    title: episode.title || "",
    audioUrl,
    duration: episode.duration || 0,
  };
}

/** Download a file via HTTP with progress reporting. */
async function httpDownload(
  audioUrl: string,
  destPath: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const resp = await net.fetch(audioUrl);
  if (!resp.ok) {
    throw new Error(`HTTP download failed (${resp.status})`);
  }

  const totalStr = resp.headers.get("content-length");
  const total = totalStr ? parseInt(totalStr, 10) : 0;
  let downloaded = 0;

  const reader = resp.body?.getReader();
  if (!reader) throw new Error("No response body");

  const chunks: Buffer[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    downloaded += value.byteLength;
    if (total > 0 && onProgress) {
      onProgress(Math.min(99.9, (downloaded / total) * 100));
    }
  }

  fs.writeFileSync(destPath, Buffer.concat(chunks));
}

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

  ipcMain.handle("config:set", (_event, partial: Record<string, unknown>) => {
    const current = readConfig(configDir);
    writeConfig(configDir, { ...current, ...partial });
    _cachedSidecarPort = null; // invalidate on any config change
  });

  // Sidecar
  ipcMain.handle("sidecar:get-url", () => {
    return getSidecarBaseUrl(configDir);
  });

  ipcMain.handle("sidecar:health-check", async () => {
    const url = getSidecarBaseUrl(configDir);
    try {
      const resp = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!resp.ok) return { online: false };
      const data = (await resp.json()) as Record<string, unknown>;
      // Verify this is actually a capty-sidecar (not another service on the port)
      if (data.status !== "ok") return { online: false };
      return { online: true, ...data };
    } catch {
      return { online: false };
    }
  });

  // Start sidecar process
  ipcMain.handle("sidecar:start", async () => {
    // Deduplicate concurrent starts (e.g. React StrictMode double-invoke)
    if (_sidecarStarting) return _sidecarStarting;
    const promise = doStartSidecar(configDir);
    _sidecarStarting = promise;
    try {
      return await promise;
    } finally {
      _sidecarStarting = null;
    }
  });

  async function doStartSidecar(
    cfgDir: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const baseUrl = getSidecarBaseUrl(cfgDir);
    const port = getSidecarPort(cfgDir);

    // Already managed by us
    if (sidecarProcess) return { ok: true };

    // Already running externally? Verify it's actually capty-sidecar.
    try {
      const resp = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) {
        const data = (await resp.json()) as Record<string, unknown>;
        if (data.status === "ok") return { ok: true };
        // Port is occupied by a non-sidecar service
        const msg = `Port ${port} is in use by another service. Change the sidecar port in Settings → General.`;
        console.warn("[sidecar]", msg);
        return { ok: false, error: msg };
      }
    } catch {
      // not running — proceed to spawn
    }

    const bin = findSidecarBin();
    const config = readConfig(configDir);
    const dataDir = config.dataDir ?? join(configDir, "data");
    const modelsDir = join(dataDir, "models", "asr");

    console.log("[sidecar] binary:", bin, "exists:", fs.existsSync(bin));
    console.log("[sidecar] port:", port, "modelsDir:", modelsDir);

    sidecarProcess = spawn(
      bin,
      ["--models-dir", modelsDir, "--port", String(port)],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    _sidecarPid = sidecarProcess.pid ?? null;

    // Drain stdout so the pipe buffer never fills
    sidecarProcess.stdout?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) console.log("[sidecar:out]", line);
    });

    // Wait for either early exit/error or successful health check
    const spawnOk = await new Promise<boolean>((resolve) => {
      let resolved = false;
      sidecarProcess!.on("error", (err) => {
        console.error("[sidecar] spawn error:", err.message);
        sidecarProcess = null;
        _sidecarPid = null;
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      });
      sidecarProcess!.on("exit", (code) => {
        console.log("[sidecar] exited early with code", code);
        sidecarProcess = null;
        _sidecarPid = null;
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      });
      // Drain stderr so the pipe buffer never fills
      sidecarProcess!.stderr?.on("data", (chunk: Buffer) => {
        const line = chunk.toString().trim();
        if (line) console.error("[sidecar]", line);
      });
      // Give a short grace period for spawn errors
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(true);
        }
      }, 500);
    });

    if (!spawnOk) {
      // Spawn failed — but maybe another sidecar is already running on the port
      // (e.g. orphan from previous session). Check health before giving up.
      try {
        const resp = await fetch(`${baseUrl}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (resp.ok) {
          const data = (await resp.json()) as Record<string, unknown>;
          if (data.status === "ok") {
            console.log(
              "[sidecar] spawn failed but existing instance found on port — reusing",
            );
            return { ok: true };
          }
        }
      } catch {
        // no existing instance either
      }
      const msg =
        `Sidecar binary failed to launch: ${bin}` +
        (app.isPackaged
          ? " (packaged mode — run 'npm run dist:all' to include sidecar binary)"
          : " (dev mode — ensure sidecar venv is set up: cd sidecar && uv sync)");
      console.warn("[sidecar]", msg);
      return { ok: false, error: msg };
    }

    // Re-attach exit handler for after the grace period
    sidecarProcess?.on("exit", (code) => {
      console.log("[sidecar] exited with code", code);
      sidecarProcess = null;
      _sidecarPid = null;
    });

    try {
      await waitForHealth(baseUrl, 30000);
    } catch {
      console.warn("[sidecar] health check timed out after launch");
      return { ok: false, error: "Sidecar started but health check timed out" };
    }
    return { ok: true };
  }

  // Stop sidecar process (managed + any orphan on the configured port)
  ipcMain.handle("sidecar:stop", () => {
    killSidecar();
    return { ok: true };
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

  // ASR connectivity test (send 1s 440Hz sine wave, verify transcription)
  ipcMain.handle(
    "asr:test",
    async (
      _event,
      provider: {
        baseUrl: string;
        apiKey: string;
        model: string;
        isSidecar?: boolean;
      },
    ) => {
      const baseUrl = provider.isSidecar
        ? getSidecarBaseUrl(configDir)
        : provider.baseUrl;
      const resolvedUrl = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");

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

      const resp = await net.fetch(`${resolvedUrl}/v1/audio/transcriptions`, {
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
      provider: {
        baseUrl: string;
        apiKey: string;
        model: string;
        isSidecar?: boolean;
      },
    ) => {
      const rawUrl = provider.isSidecar
        ? getSidecarBaseUrl(configDir)
        : provider.baseUrl;
      const baseUrl = normalizeTtsUrl(rawUrl);

      // Resolve model: sidecar uses local path, external uses provider.model
      let modelValue = provider.model ?? "";
      if (provider.isSidecar) {
        const config = readConfig(configDir);
        const ttsModelId = config.selectedTtsModelId;
        if (ttsModelId) {
          const dataDir = config.dataDir ?? join(configDir, "data");
          modelValue = join(dataDir, "models", "tts", ttsModelId);
        }
      }

      const body: Record<string, unknown> = { input: "Hello" };
      if (modelValue) body.model = modelValue;

      // Sidecar may lazy-load the TTS model on first request (can take 60s+)
      const timeoutMs = provider.isSidecar ? 120_000 : 30_000;
      const resp = await net.fetch(`${baseUrl}/v1/audio/speech`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(provider.apiKey
            ? { Authorization: `Bearer ${provider.apiKey}` }
            : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
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

  ipcMain.handle("config:get-default-data-dir", () => {
    return path.join(app.getPath("documents"), "Capty");
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
      model: string,
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
            ...(provider.apiKey
              ? { Authorization: `Bearer ${provider.apiKey}` }
              : {}),
          },
          body: JSON.stringify({
            model: model,
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
        let actualModel = model;
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
                  promptType,
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
          promptType,
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
          promptType,
        });
        throw err;
      }
    },
  );

  // LLM Generate Title (non-streaming, for AI rename)
  ipcMain.handle(
    "llm:generate-title",
    async (
      _event,
      sessionId: number,
      providerId: string,
      model: string,
      systemPrompt: string,
    ) => {
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

      const segments = getSegments(db, sessionId);
      if (segments.length === 0) {
        throw new Error("No transcript segments found for this session");
      }

      const transcriptText = segments.map((s: any) => s.text).join("\n");

      const baseUrl = provider.baseUrl.replace(/\/+$/, "");
      const resp = await net.fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(provider.apiKey
            ? { Authorization: `Bearer ${provider.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: transcriptText },
          ],
          stream: false,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`LLM API error (${resp.status}): ${body}`);
      }

      const data = (await resp.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const title = data.choices?.[0]?.message?.content?.trim() ?? "";
      if (!title) {
        throw new Error("LLM returned empty title");
      }
      return title;
    },
  );

  // LLM Translate single segment (non-streaming)
  ipcMain.handle(
    "llm:translate",
    async (
      _event,
      providerId: string,
      model: string,
      text: string,
      targetLanguage: string,
      promptTemplate: string,
    ) => {
      const config = readConfig(configDir);
      if (!providerId) {
        throw new Error("No LLM provider selected for translation");
      }
      const provider = config.llmProviders.find(
        (p: LlmProvider) => p.id === providerId,
      );
      if (!provider) {
        throw new Error("Selected translate LLM provider not found");
      }

      const prompt = promptTemplate
        .replace("{{target_language}}", targetLanguage)
        .replace("{{text}}", text);

      const baseUrl = provider.baseUrl.replace(/\/+$/, "");

      const resp = await net.fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(provider.apiKey
            ? { Authorization: `Bearer ${provider.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
        }),
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Translate API error (${resp.status}): ${body}`);
      }

      const json = (await resp.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = json.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error("LLM returned empty translation");
      }
      return content;
    },
  );

  // Translation persistence
  ipcMain.handle(
    "translation:save",
    (
      _event,
      segmentId: number,
      sessionId: number,
      targetLanguage: string,
      translatedText: string,
    ) => {
      return saveTranslation(db, {
        segmentId,
        sessionId,
        targetLanguage,
        translatedText,
      });
    },
  );

  ipcMain.handle(
    "translation:list",
    (_event, sessionId: number, targetLanguage: string) => {
      return getTranslations(db, sessionId, targetLanguage);
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

  // LLM: fetch available models from provider
  ipcMain.handle(
    "llm:fetch-models",
    async (_event, provider: { baseUrl: string; apiKey: string }) => {
      const baseUrl = provider.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
      const headers: Record<string, string> = {};
      if (provider.apiKey)
        headers["Authorization"] = `Bearer ${provider.apiKey}`;

      const endpoints = [`${baseUrl}/v1/models`, `${baseUrl}/models`];

      for (const url of endpoints) {
        try {
          const resp = await net.fetch(url, {
            headers,
            signal: AbortSignal.timeout(15000),
          });
          if (!resp.ok) continue;
          const data = await resp.json();

          // OpenAI format: {data: [{id, ...}, ...]}
          if (data.data && Array.isArray(data.data)) {
            return data.data.map((m: { id: string }) => ({
              id: m.id,
              name: m.id,
            }));
          }
          // Array format: [{id, name?, ...}, ...]
          if (Array.isArray(data)) {
            return data.map((m: { id: string; name?: string }) => ({
              id: m.id,
              name: m.name || m.id,
            }));
          }
        } catch {
          continue;
        }
      }
      return [];
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
    const sessionId = createSession(db, {
      modelName: "imported",
      category: "download",
    });
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
    const url = provider.isSidecar
      ? getSidecarBaseUrl(configDir)
      : provider.baseUrl;
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
        const normalizedUrl = normalizeTtsUrl(url);
        const resp = await net.fetch(`${normalizedUrl}/v1/audio/speech`, {
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

  // TTS voice listing (OpenAI-compatible /v1/audio/voices)
  ipcMain.handle("tts:list-voices", async () => {
    const config = readConfig(configDir);
    const provider = (config.ttsProviders ?? []).find(
      (p) => p.id === (config.selectedTtsProviderId ?? "sidecar"),
    );
    const url = provider?.isSidecar
      ? getSidecarBaseUrl(configDir)
      : (provider?.baseUrl ?? "http://localhost:8765");
    const baseUrl = normalizeTtsUrl(url);

    try {
      const resp = await net.fetch(`${baseUrl}/v1/audio/voices`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) return { model: "", voices: [] };
      const data = (await resp.json()) as {
        items?: Array<{ id: string; name: string }>;
      };
      // Mistral format: { items: [{id, name}], total, page, ... }
      const voices = (data.items ?? []).map((v) => ({
        id: v.id,
        name: v.name || v.id,
        lang: "",
        gender: "",
      }));
      return { model: "", voices };
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
      const url = provider.isSidecar
        ? getSidecarBaseUrl(configDir)
        : provider.baseUrl;

      // Guard: check provider reachability before making TTS request
      try {
        await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
      } catch {
        throw new Error(
          "TTS provider is not available. Check that the sidecar or external TTS server is running.",
        );
      }

      // Resolve model: sidecar uses local path, external uses provider.model
      let modelValue = "";
      if (provider.isSidecar) {
        const ttsModelId = config.selectedTtsModelId;
        if (ttsModelId) {
          const dataDir = config.dataDir ?? join(configDir, "data");
          modelValue = join(dataDir, "models", "tts", ttsModelId);
        }
      } else {
        modelValue = provider.model ?? "";
      }

      const baseUrl = normalizeTtsUrl(url);
      // Sidecar: opts.voice (from UI selector) > provider.voice
      // External: provider.voice (from Settings config) only
      const voiceValue = provider.isSidecar
        ? opts?.voice || provider?.voice || undefined
        : provider?.voice || undefined;
      const bodyObj: Record<string, unknown> = {
        input: text,
        model: modelValue || undefined,
        voice: voiceValue,
        speed: opts?.speed ?? 1.0,
      };
      if (provider.isSidecar) {
        bodyObj.lang_code = opts?.langCode ?? "auto";
      }
      const resp = await net.fetch(`${baseUrl}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyObj),
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

  // TTS streaming — active stream abort controllers
  const activeStreams = new Map<string, AbortController>();

  ipcMain.handle(
    "tts:speak-stream",
    async (
      _event,
      streamId: string,
      text: string,
      opts?: { voice?: string; speed?: number; langCode?: string },
    ) => {
      const win = getMainWindow();
      const config = readConfig(configDir);
      const selectedId = config.selectedTtsProviderId ?? "sidecar";
      const provider = (config.ttsProviders ?? []).find(
        (p) => p.id === selectedId,
      );
      if (!provider) {
        win?.webContents.send("tts:stream-error", {
          streamId,
          error: "No TTS provider configured",
        });
        return;
      }
      const url = provider.isSidecar
        ? getSidecarBaseUrl(configDir)
        : provider.baseUrl;

      // Resolve model: sidecar uses local path, external uses provider.model
      let modelValue = "";
      if (provider.isSidecar) {
        const ttsModelId = config.selectedTtsModelId;
        if (ttsModelId) {
          const dataDir = config.dataDir ?? join(configDir, "data");
          modelValue = join(dataDir, "models", "tts", ttsModelId);
        }
      } else {
        modelValue = provider.model ?? "";
      }

      const controller = new AbortController();
      activeStreams.set(streamId, controller);

      try {
        const baseUrl = normalizeTtsUrl(url);
        const voiceValue = provider.isSidecar
          ? opts?.voice || provider?.voice || undefined
          : provider?.voice || undefined;
        const bodyObj: Record<string, unknown> = {
          input: text,
          model: modelValue || undefined,
          voice: voiceValue,
          speed: opts?.speed ?? 1.0,
        };
        if (provider.isSidecar) {
          bodyObj.lang_code = opts?.langCode ?? "auto";
        }

        if (provider.isSidecar) {
          // Sidecar: NDJSON streaming via /v1/audio/speech/stream
          const resp = await net.fetch(`${baseUrl}/v1/audio/speech/stream`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bodyObj),
            signal: controller.signal,
          });

          if (!resp.ok) {
            const errBody = await resp.text();
            win?.webContents.send("tts:stream-error", {
              streamId,
              error: `TTS stream failed (${resp.status}): ${errBody}`,
            });
            return;
          }

          const reader = resp.body!.getReader();
          const decoder = new TextDecoder();
          let ndjsonBuf = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            ndjsonBuf += decoder.decode(value, { stream: true });

            const lines = ndjsonBuf.split("\n");
            ndjsonBuf = lines.pop() ?? "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              try {
                const parsed = JSON.parse(trimmed) as {
                  type: string;
                  data?: string;
                  sample_rate?: number;
                  is_final?: boolean;
                  message?: string;
                };

                if (parsed.type === "header") {
                  win?.webContents.send("tts:stream-header", {
                    streamId,
                    sampleRate: parsed.sample_rate,
                  });
                } else if (parsed.type === "audio") {
                  if (parsed.data && parsed.data.length > 0) {
                    win?.webContents.send("tts:stream-data", {
                      streamId,
                      data: parsed.data,
                      sampleRate: parsed.sample_rate,
                      isFinal: parsed.is_final,
                    });
                  }
                  if (
                    parsed.is_final &&
                    (!parsed.data || parsed.data.length === 0)
                  ) {
                    win?.webContents.send("tts:stream-end", { streamId });
                  }
                } else if (parsed.type === "error") {
                  win?.webContents.send("tts:stream-error", {
                    streamId,
                    error: parsed.message ?? "Unknown TTS error",
                  });
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }
        } else {
          // External provider: chunked WAV streaming via /v1/audio/speech
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (provider.apiKey) {
            headers["Authorization"] = `Bearer ${provider.apiKey}`;
          }
          const resp = await net.fetch(`${baseUrl}/v1/audio/speech`, {
            method: "POST",
            headers,
            body: JSON.stringify(bodyObj),
            signal: controller.signal,
          });

          if (!resp.ok) {
            const errBody = await resp.text();
            win?.webContents.send("tts:stream-error", {
              streamId,
              error: `TTS stream failed (${resp.status}): ${errBody}`,
            });
            return;
          }

          const reader = resp.body!.getReader();
          let wavHeaderParsed = false;
          let headerBuf = Buffer.alloc(0);
          let sampleRate = 24000;
          let dataOffset = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            if (!wavHeaderParsed) {
              headerBuf = Buffer.concat([headerBuf, Buffer.from(value)]);
              // WAV header needs at least 44 bytes
              if (headerBuf.length < 44) continue;

              // Parse sample rate from WAV header (bytes 24-27)
              sampleRate = headerBuf.readUInt32LE(24);

              // Find "data" chunk to locate PCM start
              let off = 12; // skip RIFF header (12 bytes)
              while (off < headerBuf.length - 8) {
                const chunkId = headerBuf.toString("ascii", off, off + 4);
                const chunkSize = headerBuf.readUInt32LE(off + 4);
                if (chunkId === "data") {
                  dataOffset = off + 8;
                  break;
                }
                off += 8 + chunkSize;
              }

              if (dataOffset === 0) {
                // "data" chunk not found yet, need more bytes
                continue;
              }

              wavHeaderParsed = true;
              win?.webContents.send("tts:stream-header", {
                streamId,
                sampleRate,
              });

              // Send remaining PCM data after header
              const pcmData = headerBuf.subarray(dataOffset);
              if (pcmData.length > 0) {
                win?.webContents.send("tts:stream-data", {
                  streamId,
                  data: pcmData.toString("base64"),
                  sampleRate,
                  isFinal: false,
                });
              }
            } else {
              // Stream raw PCM data chunks
              const chunk = Buffer.from(value);
              if (chunk.length > 0) {
                win?.webContents.send("tts:stream-data", {
                  streamId,
                  data: chunk.toString("base64"),
                  sampleRate,
                  isFinal: false,
                });
              }
            }
          }
        }

        // Stream ended naturally
        win?.webContents.send("tts:stream-end", { streamId });
      } catch (err: any) {
        if (err?.name === "AbortError") {
          // Cancelled by user — no error event needed
        } else {
          win?.webContents.send("tts:stream-error", {
            streamId,
            error: err?.message ?? "TTS stream failed",
          });
        }
      } finally {
        activeStreams.delete(streamId);
      }
    },
  );

  ipcMain.handle("tts:cancel-stream", (_event, streamId: string) => {
    const controller = activeStreams.get(streamId);
    if (controller) {
      controller.abort();
      activeStreams.delete(streamId);
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

  // Export save buffer (binary data: images, Word docs)
  ipcMain.handle(
    "export:save-buffer",
    async (
      _event,
      defaultName: string,
      data: Uint8Array,
      filters: { name: string; extensions: string[] }[],
    ) => {
      const win = getMainWindow();
      if (!win) return null;
      const result = await dialog.showSaveDialog(win, {
        defaultPath: defaultName,
        filters,
      });
      if (result.canceled || !result.filePath) return null;
      fs.writeFileSync(result.filePath, Buffer.from(data));
      return result.filePath;
    },
  );

  // ─── Audio Download via yt-dlp ───

  ipcMain.handle("audio:download-list", () => {
    return listDownloads(db);
  });

  ipcMain.handle("audio:download-remove", (_event, downloadId: number) => {
    const dl = getDownload(db, downloadId);
    if (dl?.temp_dir) {
      try {
        fs.rmSync(dl.temp_dir, { recursive: true, force: true });
      } catch {
        // temp dir may already be cleaned
      }
    }
    deleteDownload(db, downloadId);
  });

  ipcMain.handle("audio:download-cancel", (_event, downloadId: number) => {
    const proc = activeDownloads.get(downloadId);
    if (proc) {
      proc.kill("SIGTERM");
      activeDownloads.delete(downloadId);
    }
    const dl = getDownload(db, downloadId);
    if (dl?.temp_dir) {
      try {
        fs.rmSync(dl.temp_dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    updateDownload(db, downloadId, { status: "cancelled", progress: 0 });
    const win = getMainWindow();
    if (win) {
      win.webContents.send("audio:download-progress", {
        id: downloadId,
        stage: "cancelled" as const,
      });
    }
  });

  ipcMain.handle("audio:download-start", async (_event, url: string) => {
    const win = getMainWindow();
    const source = extractSource(url);
    const isXyz = isXiaoyuzhouUrl(url);

    // 1. Check yt-dlp exists (skip for Xiaoyuzhou — uses direct HTTP)
    if (!isXyz) {
      try {
        await new Promise<void>((resolve, reject) => {
          const check = spawn("which", ["yt-dlp"]);
          check.on("close", (code) =>
            code === 0 ? resolve() : reject(new Error("not found")),
          );
          check.on("error", reject);
        });
      } catch {
        throw new Error("yt-dlp not found. Install: brew install yt-dlp");
      }
    }

    // 2. Create download record
    const downloadId = createDownload(db, { url, source });

    // 3. Run download async (don't await — return downloadId immediately)
    const config = readConfig(configDir);
    const dataDir = config.dataDir ?? join(configDir, "data");

    (async () => {
      try {
        // Push fetching-info event
        if (win) {
          win.webContents.send("audio:download-progress", {
            id: downloadId,
            stage: "fetching-info",
          });
        }

        // Shared timestamp helpers
        const now = new Date();
        const pad = (n: number): string => String(n).padStart(2, "0");
        const dirTimestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        const readableTimestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

        const tempDir = join(
          dataDir,
          "audio",
          ".downloading",
          String(downloadId),
        );
        fs.mkdirSync(tempDir, { recursive: true });

        let videoTitle = "";
        let downloadedFilePath = "";

        if (isXyz) {
          // ── Xiaoyuzhou (小宇宙) direct download path ──
          const episode = await fetchXiaoyuzhouEpisode(url);
          videoTitle = episode.title;

          if (videoTitle) {
            updateDownload(db, downloadId, { title: videoTitle });
          }

          updateDownload(db, downloadId, {
            temp_dir: tempDir,
            status: "downloading",
          });
          if (win) {
            win.webContents.send("audio:download-progress", {
              id: downloadId,
              stage: "downloading",
              title: videoTitle || undefined,
              source,
            });
          }

          // Determine file extension from audio URL
          const audioExt =
            episode.audioUrl.match(/\.(m4a|mp3|ogg|opus|wav)/i)?.[1] || "m4a";
          downloadedFilePath = join(tempDir, `${dirTimestamp}.${audioExt}`);

          await httpDownload(
            episode.audioUrl,
            downloadedFilePath,
            (percent) => {
              updateDownload(db, downloadId, { progress: percent });
              if (win) {
                win.webContents.send("audio:download-progress", {
                  id: downloadId,
                  stage: "downloading",
                  percent,
                });
              }
            },
          );

          // Check if cancelled during download
          const currentDl = getDownload(db, downloadId);
          if (currentDl?.status === "cancelled") return;
        } else {
          // ── yt-dlp download path ──

          // Fetch video title
          try {
            videoTitle = await new Promise<string>((resolve, reject) => {
              const proc = spawn("yt-dlp", [
                "--print",
                "title",
                "--no-playlist",
                url,
              ]);
              let out = "";
              proc.stdout.on("data", (chunk: Buffer) => {
                out += chunk.toString();
              });
              proc.on("close", (code) => {
                if (code === 0) resolve(out.trim());
                else
                  reject(
                    new Error(`yt-dlp title fetch exited with code ${code}`),
                  );
              });
              proc.on("error", reject);
            });
          } catch {
            videoTitle = "";
          }

          if (videoTitle) {
            updateDownload(db, downloadId, { title: videoTitle });
          }

          const outputTemplate = join(tempDir, `${dirTimestamp}.%(ext)s`);
          updateDownload(db, downloadId, {
            temp_dir: tempDir,
            status: "downloading",
          });
          if (win) {
            win.webContents.send("audio:download-progress", {
              id: downloadId,
              stage: "downloading",
              title: videoTitle || undefined,
              source,
            });
          }

          const ytdlp = spawn("yt-dlp", [
            "-f",
            "ba",
            "--continue",
            "--newline",
            "--no-playlist",
            "-o",
            outputTemplate,
            url,
          ]);
          activeDownloads.set(downloadId, ytdlp);

          let stderrBuf = "";
          ytdlp.stderr.on("data", (chunk: Buffer) => {
            stderrBuf += chunk.toString();
          });

          ytdlp.stdout.on("data", (chunk: Buffer) => {
            const lines = chunk.toString().split("\n");
            for (const line of lines) {
              const progress = parseYtdlpProgress(line);
              if (progress) {
                updateDownload(db, downloadId, {
                  progress: progress.percent,
                  speed: progress.speed,
                  eta: progress.eta,
                });
                if (win) {
                  win.webContents.send("audio:download-progress", {
                    id: downloadId,
                    stage: "downloading",
                    percent: progress.percent,
                    speed: progress.speed,
                    eta: progress.eta,
                  });
                }
              }
            }
          });

          const exitCode = await new Promise<number | null>((resolve) => {
            ytdlp.on("close", resolve);
          });
          activeDownloads.delete(downloadId);

          // Check if cancelled
          const currentDl = getDownload(db, downloadId);
          if (currentDl?.status === "cancelled") return;

          if (exitCode !== 0) {
            const errMsg =
              stderrBuf.trim().split("\n").pop() ||
              `yt-dlp exited with code ${exitCode}`;
            updateDownload(db, downloadId, {
              status: "failed",
              error: errMsg,
            });
            if (win) {
              win.webContents.send("audio:download-progress", {
                id: downloadId,
                stage: "error",
                error: errMsg,
              });
            }
            return;
          }

          // Find downloaded file
          const files = fs.readdirSync(tempDir);
          const downloadedFile = files.find((f) => !f.endsWith(".part"));
          if (!downloadedFile) {
            updateDownload(db, downloadId, {
              status: "failed",
              error: "Downloaded file not found in temp directory",
            });
            if (win) {
              win.webContents.send("audio:download-progress", {
                id: downloadId,
                stage: "error",
                error: "Downloaded file not found",
              });
            }
            return;
          }
          downloadedFilePath = join(tempDir, downloadedFile);
        }

        // ── Shared: convert → session → cleanup ──

        // Converting stage
        updateDownload(db, downloadId, { status: "converting", progress: 100 });
        if (win) {
          win.webContents.send("audio:download-progress", {
            id: downloadId,
            stage: "converting",
          });
        }

        // Deduplicate session directory
        let finalTimestamp = dirTimestamp;
        let sessionDir = join(dataDir, "audio", finalTimestamp);
        let suffix = 1;
        while (fs.existsSync(sessionDir)) {
          finalTimestamp = `${dirTimestamp}-${suffix}`;
          sessionDir = join(dataDir, "audio", finalTimestamp);
          suffix++;
        }
        fs.mkdirSync(sessionDir, { recursive: true });

        const wavPath = join(sessionDir, `${finalTimestamp}.wav`);
        await convertToWav(downloadedFilePath, wavPath);

        // Calculate duration
        const wavStat = fs.statSync(wavPath);
        const pcmBytes = wavStat.size - 44;
        const durationSeconds = Math.round(pcmBytes / 32000); // 16kHz * 16bit * mono

        // Create session
        const modelTag = isXyz ? "xiaoyuzhou" : "yt-dlp";
        const sessionTitle = videoTitle
          ? `${readableTimestamp} ${videoTitle}`
          : readableTimestamp;
        const sessionId = createSession(db, {
          modelName: modelTag,
          category: "download",
        });
        updateSession(db, sessionId, {
          audioPath: finalTimestamp,
          title: sessionTitle,
          startedAt: readableTimestamp,
          status: "completed",
          durationSeconds,
        });

        // Update download record
        const completedAt = new Date();
        const completedStr = `${completedAt.getFullYear()}-${pad(completedAt.getMonth() + 1)}-${pad(completedAt.getDate())} ${pad(completedAt.getHours())}:${pad(completedAt.getMinutes())}:${pad(completedAt.getSeconds())}`;
        updateDownload(db, downloadId, {
          status: "completed",
          session_id: sessionId,
          completed_at: completedStr,
          progress: 100,
        });

        // Clean up temp dir
        fs.rmSync(tempDir, { recursive: true, force: true });

        // Push completed event
        if (win) {
          win.webContents.send("audio:download-progress", {
            id: downloadId,
            stage: "completed",
            sessionId,
          });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        updateDownload(db, downloadId, { status: "failed", error: message });
        if (win) {
          win.webContents.send("audio:download-progress", {
            id: downloadId,
            stage: "error",
            error: message,
          });
        }
      }
    })();

    return { downloadId };
  });

  ipcMain.handle("audio:download-retry", async (_event, downloadId: number) => {
    const dl = getDownload(db, downloadId);
    if (!dl) throw new Error("Download not found");

    // Delete old record and start a fresh download with the same URL
    const url = dl.url;
    deleteDownload(db, downloadId);

    // Trigger new download via IPC event to renderer, which calls downloadAudio()
    const win = getMainWindow();
    if (win) {
      win.webContents.send("audio:download-retry-trigger", { url });
    }
  });
}
