import { createWriteStream, existsSync, mkdirSync, statSync } from "fs";
import { join } from "path";

interface DownloadProgress {
  readonly downloaded: number;
  readonly total: number;
  readonly percent: number;
}

export async function downloadModel(
  repo: string,
  destDir: string,
  onProgress: (progress: DownloadProgress) => void,
  mirrorUrl?: string,
): Promise<void> {
  const baseUrl = mirrorUrl ?? "https://huggingface.co";
  const url = `${baseUrl}/${repo}/resolve/main`;

  // Create dest dir
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  // Get file list (simplified - download config.json and model files)
  const files = [
    "config.json",
    "model.safetensors",
    "tokenizer.json",
    "preprocessor_config.json",
  ];

  for (const file of files) {
    const filePath = join(destDir, file);
    const fileUrl = `${url}/${file}`;

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

      const total =
        Number(response.headers.get("content-length") ?? 0) + startByte;
      const body = response.body;
      if (!body) continue;

      const writer = createWriteStream(filePath, {
        flags: startByte > 0 ? "a" : "w",
      });
      const reader = body.getReader();

      let downloaded = startByte;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        writer.write(Buffer.from(value));
        downloaded += value.byteLength;
        onProgress({
          downloaded,
          total,
          percent: total > 0 ? (downloaded / total) * 100 : 0,
        });
      }
      writer.end();
    } catch {
      // Skip files that don't exist (not all models have all files)
    }
  }
}
