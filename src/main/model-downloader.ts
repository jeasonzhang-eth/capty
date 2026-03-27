import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "fs";
import { join } from "path";

interface DownloadProgress {
  readonly downloaded: number;
  readonly total: number;
  readonly percent: number;
}

interface HFSibling {
  readonly rfilename: string;
}

interface HFModelInfo {
  readonly siblings: readonly HFSibling[];
}

/** Files to skip downloading (not needed for inference). */
const SKIP_FILES = new Set([".gitattributes", "README.md"]);

/** Default timeout for network requests (ms). */
const REQUEST_TIMEOUT = 30_000;

/** Max time to wait for data before considering the stream stalled (ms). */
const STALL_TIMEOUT = 30_000;

/** Max retry attempts per file. */
const MAX_RETRIES = 3;

/** Delay between retries (ms), multiplied by attempt number. */
const RETRY_DELAY_BASE = 2_000;

/** Fetch with an AbortController timeout (for connection + headers only). */
async function fetchWithTimeout(
  url: string,
  opts: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT,
): Promise<{ response: Response; controller: AbortController }> {
  const controller = new AbortController();
  // Merge with any existing signal
  const mergedOpts = { ...opts, signal: controller.signal };
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, mergedOpts);
    return { response, controller };
  } catch (err) {
    controller.abort();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a stream with a stall timeout: if no data arrives within
 * `stallMs`, abort the controller and throw.
 */
async function readStreamWithStallTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  controller: AbortController,
  stallMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(
        new Error(`Download stalled: no data received for ${stallMs / 1000}s`),
      );
    }, stallMs);

    reader.read().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Sleep helper. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch the file list from the HuggingFace API for the given repo.
 * Falls back to a hardcoded list if the API call fails.
 */
async function fetchFileList(
  repo: string,
  mirrorUrl?: string,
): Promise<string[]> {
  const baseUrl = mirrorUrl ?? "https://huggingface.co";
  const apiUrl = `${baseUrl}/api/models/${repo}`;
  console.log(`[model-downloader] Fetching file list: ${apiUrl}`);
  try {
    const { response } = await fetchWithTimeout(apiUrl, {}, 15_000);
    if (response.ok) {
      const info = (await response.json()) as HFModelInfo;
      return info.siblings
        .map((s) => s.rfilename)
        .filter((f) => !SKIP_FILES.has(f));
    }
  } catch (err) {
    console.error(
      `[model-downloader] Failed to fetch file list for ${repo}:`,
      err,
    );
  }

  // Fallback: common model files
  return [
    "config.json",
    "generation_config.json",
    "model.safetensors",
    "tokenizer_config.json",
    "tokenizer.json",
    "vocab.json",
    "merges.txt",
    "preprocessor_config.json",
    "chat_template.json",
  ];
}

/**
 * Download a single file with resume support and stall detection.
 * Returns the number of new bytes downloaded.
 */
async function downloadFile(
  fileUrl: string,
  filePath: string,
  onData: (bytes: number) => void,
): Promise<number> {
  // Resume support: start from existing file size
  let startByte = 0;
  if (existsSync(filePath)) {
    startByte = statSync(filePath).size;
  }

  const headers: Record<string, string> = {};
  if (startByte > 0) {
    headers["Range"] = `bytes=${startByte}-`;
  }

  console.log(
    `[model-downloader] GET ${fileUrl}${startByte > 0 ? ` (resume from ${(startByte / 1024 / 1024).toFixed(1)} MB)` : ""}`,
  );

  const { response, controller } = await fetchWithTimeout(
    fileUrl,
    { headers },
    60_000,
  );

  if (response.status === 416) {
    // File already complete (range not satisfiable)
    return 0;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const body = response.body;
  if (!body) {
    throw new Error("Response body is null");
  }

  // Ensure parent dir exists for nested files
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const writer = createWriteStream(filePath, {
    flags: startByte > 0 ? "a" : "w",
  });
  const reader = body.getReader();
  let bytesWritten = 0;

  try {
    while (true) {
      const { done, value } = await readStreamWithStallTimeout(
        reader,
        controller,
        STALL_TIMEOUT,
      );
      if (done) break;
      writer.write(Buffer.from(value));
      bytesWritten += value.byteLength;
      onData(value.byteLength);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
    writer.end();
  }

  return bytesWritten;
}

export async function downloadModel(
  repo: string,
  destDir: string,
  onProgress: (progress: DownloadProgress) => void,
  mirrorUrl?: string,
): Promise<void> {
  const baseUrl = mirrorUrl ?? "https://huggingface.co";
  const resolveUrl = `${baseUrl}/${repo}/resolve/main`;

  // Create dest dir
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  console.log(`[model-downloader] Starting download: ${repo} → ${destDir}`);
  console.log(`[model-downloader] Using base URL: ${baseUrl}`);

  const files = await fetchFileList(repo, mirrorUrl);
  console.log(`[model-downloader] Files to download: ${files.join(", ")}`);

  // Calculate total size for progress tracking across all files
  // Use parallel HEAD requests for speed
  let globalDownloaded = 0;
  let globalTotal = 0;

  // Track per-file sizes from HEAD (to detect missing sizes during download)
  const headFileSizes: number[] = [];

  const headResults = await Promise.allSettled(
    files.map(async (file) => {
      const filePath = join(destDir, file);
      const existingSize = existsSync(filePath) ? statSync(filePath).size : 0;
      try {
        const { response: headResp } = await fetchWithTimeout(
          `${resolveUrl}/${file}`,
          { method: "HEAD" },
          10_000,
        );
        if (headResp.ok) {
          const contentLength = Number(
            headResp.headers.get("content-length") ?? 0,
          );
          return { contentLength, existingSize };
        }
      } catch {
        // HEAD failed, skip this file's size
      }
      return { contentLength: 0, existingSize: 0 };
    }),
  );

  for (const result of headResults) {
    if (result.status === "fulfilled") {
      const { contentLength, existingSize } = result.value;
      headFileSizes.push(contentLength);
      if (contentLength > 0) {
        globalTotal += contentLength;
        globalDownloaded += Math.min(existingSize, contentLength);
      }
    } else {
      headFileSizes.push(0);
    }
  }

  let filesDownloaded = 0;
  let filesFailed = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = join(destDir, file);
    const fileUrl = `${resolveUrl}/${file}`;
    let succeeded = false;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        let sizeDiscovered = headFileSizes[i] > 0;

        const bytesWritten = await downloadFile(fileUrl, filePath, (bytes) => {
          globalDownloaded += bytes;
          if (globalTotal > 0) {
            onProgress({
              downloaded: globalDownloaded,
              total: globalTotal,
              percent: Math.min((globalDownloaded / globalTotal) * 100, 100),
            });
          }
        });

        // Verify file size matches expected size from HEAD
        if (sizeDiscovered && headFileSizes[i] > 0 && existsSync(filePath)) {
          const actualSize = statSync(filePath).size;
          if (actualSize < headFileSizes[i]) {
            throw new Error(
              `Incomplete download: ${file} is ${actualSize} bytes, expected ${headFileSizes[i]} bytes`,
            );
          }
        }

        // If HEAD didn't know the size, update globalTotal from actual file
        if (!sizeDiscovered && existsSync(filePath)) {
          const actualSize = statSync(filePath).size;
          if (actualSize > 0) {
            globalTotal += actualSize;
            // globalDownloaded already includes the bytes we wrote +
            // any bytes from resume, so reconcile
            globalDownloaded = globalDownloaded - bytesWritten + actualSize;
            sizeDiscovered = true;
          }
        }

        succeeded = true;
        filesDownloaded++;
        if (bytesWritten > 0) {
          console.log(
            `[model-downloader] Downloaded: ${file} (${(bytesWritten / 1024 / 1024).toFixed(1)} MB)`,
          );
        } else {
          console.log(`[model-downloader] Already complete: ${file}`);
        }
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[model-downloader] Attempt ${attempt}/${MAX_RETRIES} failed for ${file}: ${msg}`,
        );

        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_BASE * attempt;
          console.log(
            `[model-downloader] Retrying ${file} in ${delay / 1000}s...`,
          );
          await sleep(delay);

          // Re-sync globalDownloaded from actual file sizes (avoid double-count)
          globalDownloaded = 0;
          for (let j = 0; j < files.length; j++) {
            const fp = join(destDir, files[j]);
            const sz = existsSync(fp) ? statSync(fp).size : 0;
            globalDownloaded += Math.min(
              sz,
              headFileSizes[j] > 0 ? headFileSizes[j] : sz,
            );
          }
        }
      }
    }

    if (!succeeded) {
      filesFailed++;
      console.error(
        `[model-downloader] Failed to download ${file} after ${MAX_RETRIES} attempts`,
      );
    }
  }

  // Final progress update
  if (filesDownloaded > 0) {
    onProgress({ downloaded: globalTotal, total: globalTotal, percent: 100 });
  }

  console.log(
    `[model-downloader] Done: ${filesDownloaded} downloaded, ${filesFailed} failed`,
  );

  // If no files were actually downloaded, remove the empty directory
  // to avoid false "downloaded" status
  if (filesDownloaded === 0) {
    try {
      const entries = readdirSync(destDir);
      if (entries.length === 0) {
        rmSync(destDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors
    }
    throw new Error(
      `Failed to download model ${repo}: no files could be downloaded. ` +
        `Check your network or configure a HuggingFace mirror URL in Settings.`,
    );
  }
}

/** Check if a model is actually downloaded (has model weight files, not just an empty dir). */
export function isModelDownloaded(modelsDir: string, modelId: string): boolean {
  const modelPath = join(modelsDir, modelId);
  if (!existsSync(modelPath)) return false;
  try {
    const entries = readdirSync(modelPath);
    // Must have at least a model weight file
    // .safetensors = modern MLX/HF format, .npz = legacy MLX format,
    // .bin = PyTorch, .gguf = GGML
    return entries.some(
      (e) =>
        e.endsWith(".safetensors") ||
        e.endsWith(".npz") ||
        e.endsWith(".bin") ||
        e.endsWith(".gguf"),
    );
  } catch {
    return false;
  }
}

/** Calculate total size of a directory in GB (rounded to 2 decimals). */
export function calcDirSizeGb(dirPath: string): number {
  try {
    const entries = readdirSync(dirPath);
    let total = 0;
    for (const entry of entries) {
      try {
        const stat = statSync(join(dirPath, entry));
        if (stat.isFile()) total += stat.size;
      } catch {
        // skip unreadable files
      }
    }
    return Math.round((total / (1024 * 1024 * 1024)) * 100) / 100;
  } catch {
    return 0;
  }
}
