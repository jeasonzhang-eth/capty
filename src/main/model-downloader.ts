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

/** Fetch with an AbortController timeout. */
async function fetchWithTimeout(
  url: string,
  opts: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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
  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/api/models/${repo}`,
      {},
      15_000,
    );
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
        const headResp = await fetchWithTimeout(
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

  let filesCompleted = 0;
  let filesDownloaded = 0;
  let filesFailed = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = join(destDir, file);
    const fileUrl = `${resolveUrl}/${file}`;

    // Resume support
    let startByte = 0;
    if (existsSync(filePath)) {
      startByte = statSync(filePath).size;
    }

    const headers: Record<string, string> = {};
    if (startByte > 0) {
      headers["Range"] = `bytes=${startByte}-`;
    }

    try {
      // Use a longer timeout for actual downloads (large files)
      const response = await fetchWithTimeout(fileUrl, { headers }, 60_000);
      if (!response.ok && response.status !== 416) {
        // 416 means range not satisfiable (file already complete)
        console.warn(
          `[model-downloader] HTTP ${response.status} for ${file}, skipping`,
        );
        filesFailed++;
        continue;
      }

      if (response.status === 416) {
        // File already complete
        filesCompleted++;
        filesDownloaded++;
        continue;
      }

      // If HEAD missed this file's size, get it from the GET response
      // and add to globalTotal so progress percentage stays sane
      if (headFileSizes[i] === 0) {
        const getContentLength = Number(
          response.headers.get("content-length") ?? 0,
        );
        if (getContentLength > 0) {
          const fullSize = getContentLength + startByte;
          globalTotal += fullSize;
          globalDownloaded += startByte;
        }
      }

      const body = response.body;
      if (!body) {
        filesFailed++;
        continue;
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        writer.write(Buffer.from(value));
        globalDownloaded += value.byteLength;
        if (globalTotal > 0) {
          onProgress({
            downloaded: globalDownloaded,
            total: globalTotal,
            percent: Math.min((globalDownloaded / globalTotal) * 100, 100),
          });
        }
      }
      writer.end();

      filesCompleted++;
      filesDownloaded++;
      console.log(`[model-downloader] Downloaded: ${file}`);
    } catch (err) {
      filesFailed++;
      console.error(`[model-downloader] Failed to download ${file}:`, err);
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
    // Must have at least a model weight file (mlx-audio uses safetensors)
    return entries.some(
      (e) =>
        e.endsWith(".safetensors") || e.endsWith(".bin") || e.endsWith(".gguf"),
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
