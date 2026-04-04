/**
 * Single file download with HTTP Range resume and stall detection.
 */

import { createWriteStream, existsSync, mkdirSync, statSync } from "fs";
import {
  MAX_RETRIES,
  REQUEST_TIMEOUT,
  RETRY_DELAY_BASE,
  STALL_TIMEOUT,
} from "./types";

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": "capty/1.0 (Electron; https://github.com/capty)",
};

/** Fetch with timeout via AbortController. Chains an optional external signal. */
async function fetchWithTimeout(
  url: string,
  opts: RequestInit & { signal?: AbortSignal } = {},
  timeoutMs = REQUEST_TIMEOUT,
): Promise<{ response: Response; controller: AbortController }> {
  const controller = new AbortController();
  const externalSignal = opts.signal;

  // Link external abort signal (if provided)
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
      throw new Error("Download cancelled");
    }
    externalSignal.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
  }

  const mergedOpts: RequestInit = {
    ...opts,
    signal: controller.signal, // use internal controller
    redirect: "follow",
    headers: {
      ...DEFAULT_HEADERS,
      ...(opts.headers as Record<string, string>),
    },
  };
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

/** Read one chunk with stall detection. */
async function readWithStallTimeout(
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** HTTP 4xx client errors should not be retried (except 408 Request Timeout and 429 Too Many Requests). */
function isNonRetryableError(message: string): boolean {
  const match = message.match(/HTTP (\d{3})/);
  if (!match) return false;
  const status = parseInt(match[1], 10);
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export interface FileDownloadOptions {
  /** URL to download from. */
  readonly url: string;
  /** Local file path to save to. */
  readonly filePath: string;
  /** External abort signal to cancel the download. */
  readonly abortSignal?: AbortSignal;
  /** Called for each chunk of data received. */
  readonly onData?: (bytes: number) => void;
}

/**
 * Download a single file with Range resume support.
 * Returns the number of new bytes downloaded.
 * Throws on failure after all retries exhausted.
 */
export async function downloadFile(opts: FileDownloadOptions): Promise<number> {
  const { url, filePath, abortSignal, onData } = opts;

  // Per-file AbortController: all retries share one, linked to external signal once
  const fileController = new AbortController();
  if (abortSignal) {
    if (abortSignal.aborted) throw new Error("Download cancelled");
    abortSignal.addEventListener("abort", () => fileController.abort(), {
      once: true,
    });
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (fileController.signal.aborted) {
        throw new Error("Download cancelled");
      }

      const result = await downloadFileOnce(
        url,
        filePath,
        fileController.signal,
        onData,
      );
      return result;
    } catch (err) {
      if (fileController.signal.aborted) {
        throw new Error("Download cancelled");
      }

      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[file-download] Attempt ${attempt}/${MAX_RETRIES} failed for ${filePath}: ${msg}`,
      );

      // 404/403/401/410 etc. are deterministic — don't retry
      if (isNonRetryableError(msg)) {
        throw err;
      }

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_BASE * attempt;
        console.log(`[file-download] Retrying in ${delay / 1000}s...`);
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }

  // Unreachable but satisfies TypeScript
  throw new Error("All retries exhausted");
}

/** Single attempt to download a file. */
async function downloadFileOnce(
  url: string,
  filePath: string,
  abortSignal?: AbortSignal,
  onData?: (bytes: number) => void,
): Promise<number> {
  let startByte = 0;
  if (existsSync(filePath)) {
    startByte = statSync(filePath).size;
  }

  const headers: Record<string, string> = {};
  if (startByte > 0) {
    headers["Range"] = `bytes=${startByte}-`;
  }

  console.log(
    `[file-download] GET ${url}${startByte > 0 ? ` (resume from ${(startByte / 1024 / 1024).toFixed(1)} MB)` : ""}`,
  );

  const { response, controller } = await fetchWithTimeout(
    url,
    { headers, signal: abortSignal },
    60_000,
  );

  if (response.status === 416) {
    // File already complete
    return 0;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(
      `HTTP ${response.status} ${response.statusText} for ${url}${errText ? `: ${errText.slice(0, 200)}` : ""}`,
    );
  }

  const body = response.body;
  if (!body) {
    throw new Error("Response body is null");
  }

  // Ensure parent directory exists
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
      const { done, value } = await readWithStallTimeout(
        reader,
        controller,
        STALL_TIMEOUT,
      );
      if (done) break;
      writer.write(Buffer.from(value));
      bytesWritten += value.byteLength;
      onData?.(value.byteLength);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
    // Wait for writer to flush all data to disk before returning
    await new Promise<void>((resolve, reject) => {
      writer.end(() => resolve());
      writer.on("error", reject);
    });
  }

  return bytesWritten;
}

/** Get local file size (0 if not exists). */
export function getLocalFileSize(filePath: string): number {
  if (!existsSync(filePath)) return 0;
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}
