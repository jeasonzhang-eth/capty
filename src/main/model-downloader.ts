import { createWriteStream, existsSync, mkdirSync, statSync } from "fs";
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
    const response = await fetch(`${baseUrl}/api/models/${repo}`);
    if (response.ok) {
      const info = (await response.json()) as HFModelInfo;
      return info.siblings
        .map((s) => s.rfilename)
        .filter((f) => !SKIP_FILES.has(f));
    }
  } catch {
    // API call failed, use fallback
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

  const files = await fetchFileList(repo, mirrorUrl);

  // Calculate total size for progress tracking across all files
  let globalDownloaded = 0;
  let globalTotal = 0;

  // First pass: get total sizes for meaningful progress
  for (const file of files) {
    const filePath = join(destDir, file);
    const existingSize = existsSync(filePath) ? statSync(filePath).size : 0;

    try {
      const headResp = await fetch(`${resolveUrl}/${file}`, {
        method: "HEAD",
      });
      if (headResp.ok) {
        const contentLength = Number(
          headResp.headers.get("content-length") ?? 0,
        );
        globalTotal += contentLength + existingSize;
        globalDownloaded += existingSize;
      }
    } catch {
      // File may not exist, skip
    }
  }

  // If we couldn't get sizes, just use file count for progress
  const useFileProgress = globalTotal === 0;
  let filesCompleted = 0;

  for (const file of files) {
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
      const response = await fetch(fileUrl, { headers });
      if (!response.ok && response.status !== 416) {
        // 416 means range not satisfiable (file already complete)
        continue;
      }

      if (response.status === 416) {
        // File already complete
        filesCompleted++;
        if (useFileProgress) {
          onProgress({
            downloaded: filesCompleted,
            total: files.length,
            percent: (filesCompleted / files.length) * 100,
          });
        }
        continue;
      }

      const body = response.body;
      if (!body) continue;

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
        if (!useFileProgress) {
          onProgress({
            downloaded: globalDownloaded,
            total: globalTotal,
            percent:
              globalTotal > 0 ? (globalDownloaded / globalTotal) * 100 : 0,
          });
        }
      }
      writer.end();

      filesCompleted++;
      if (useFileProgress) {
        onProgress({
          downloaded: filesCompleted,
          total: files.length,
          percent: (filesCompleted / files.length) * 100,
        });
      }
    } catch {
      // Skip files that don't exist (not all models have all files)
    }
  }
}
