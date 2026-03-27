/**
 * Coordinates downloading all files for a single model.
 * Supports pause, resume, cancel, and concurrent file downloads.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "fs";
import { join } from "path";
import type {
  DownloadCategory,
  DownloadProgress,
  FileState,
  TaskStatus,
} from "./types";
import {
  MAX_FILES_PER_MODEL,
  REQUEST_TIMEOUT,
  SKIP_FILES,
  STATE_SAVE_INTERVAL,
  STATE_SAVE_PERCENT_STEP,
} from "./types";
import { downloadFile, getLocalFileSize } from "./file-download-task";
import { removeState, saveState } from "./download-state";

interface HFModelInfo {
  readonly siblings: ReadonlyArray<{ readonly rfilename: string }>;
}

/** Simple concurrency limiter (avoids external dependency). */
function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  return async function <T>(fn: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      if (queue.length > 0) {
        queue.shift()!();
      }
    }
  };
}

export interface ModelDownloadTaskOptions {
  readonly modelId: string;
  readonly repo: string;
  readonly destDir: string;
  readonly category: DownloadCategory;
  readonly modelsDir: string;
  readonly mirrorUrl?: string;
  readonly onProgress: (progress: DownloadProgress) => void;
}

export class ModelDownloadTask {
  readonly modelId: string;
  readonly repo: string;
  readonly destDir: string;
  readonly category: DownloadCategory;

  private readonly modelsDir: string;
  private readonly baseUrl: string;
  private readonly resolveUrl: string;
  private readonly onProgress: (progress: DownloadProgress) => void;

  private abortController: AbortController | null = null;
  private status: TaskStatus = "pending";
  private error: string | undefined;
  private fileStates: FileState[] = [];
  private totalBytes = 0;
  private downloadedBytes = 0;
  private lastSavedPercent = 0;
  private lastSavedTime = 0;

  constructor(opts: ModelDownloadTaskOptions) {
    this.modelId = opts.modelId;
    this.repo = opts.repo;
    this.destDir = opts.destDir;
    this.category = opts.category;
    this.modelsDir = opts.modelsDir;
    this.baseUrl = opts.mirrorUrl ?? "https://huggingface.co";
    this.resolveUrl = `${this.baseUrl}/${opts.repo}/resolve/main`;
    this.onProgress = opts.onProgress;
  }

  getStatus(): TaskStatus {
    return this.status;
  }

  getError(): string | undefined {
    return this.error;
  }

  /** Start or resume the download. */
  async start(): Promise<void> {
    if (this.status === "downloading") return;

    this.status = "downloading";
    this.error = undefined;
    this.abortController = new AbortController();

    try {
      if (!existsSync(this.destDir)) {
        mkdirSync(this.destDir, { recursive: true });
      }

      console.log(
        `[model-download] Starting: ${this.repo} → ${this.destDir}`,
      );

      // Fetch file list
      const files = await this.fetchFileList();
      console.log(
        `[model-download] Files to download: ${files.join(", ")}`,
      );

      // HEAD requests to get file sizes (parallel)
      await this.resolveFileSizes(files);

      // Persist initial state
      this.persistState();
      this.emitProgress();

      // Download files with concurrency limit
      const limiter = createLimiter(MAX_FILES_PER_MODEL);
      const results = await Promise.allSettled(
        this.fileStates.map((fs) =>
          limiter(() => this.downloadSingleFile(fs.name)),
        ),
      );

      // Check for failures
      const failures = results.filter((r) => r.status === "rejected");

      if (this.abortController?.signal.aborted) {
        // Was paused or cancelled — don't change status
        return;
      }

      if (failures.length > 0 && failures.length === results.length) {
        // All files failed
        this.status = "failed";
        this.error = "All files failed to download";
        this.persistState();
        this.emitProgress();
        throw new Error(this.error);
      }

      if (failures.length > 0) {
        // Some files failed
        const failedNames = this.fileStates
          .filter((f) => !f.completed)
          .map((f) => f.name);
        this.status = "failed";
        this.error = `Failed to download: ${failedNames.join(", ")}`;
        this.persistState();
        this.emitProgress();
        throw new Error(this.error);
      }

      // Check if any files were actually downloaded
      const hasFiles = existsSync(this.destDir) && readdirSync(this.destDir).length > 0;
      if (!hasFiles) {
        // Clean up empty dir
        try {
          rmSync(this.destDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
        this.status = "failed";
        this.error = "No files could be downloaded";
        this.persistState();
        this.emitProgress();
        throw new Error(this.error);
      }

      // Success!
      this.status = "completed";
      removeState(this.modelsDir, this.modelId);
      this.emitProgress();
      console.log(`[model-download] Completed: ${this.repo}`);
    } catch (err) {
      if (this.status !== "paused" && this.status !== "failed") {
        this.status = "failed";
        this.error =
          err instanceof Error ? err.message : "Download failed";
        this.persistState();
        this.emitProgress();
      }
      throw err;
    }
  }

  /** Pause the download. Files in progress will be aborted but partial data is preserved. */
  pause(): void {
    if (this.status !== "downloading") return;
    this.status = "paused";
    this.abortController?.abort();
    this.abortController = null;
    this.persistState();
    this.emitProgress();
    console.log(`[model-download] Paused: ${this.repo}`);
  }

  /** Cancel the download and clean up files. */
  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.status = "failed";
    this.error = "Cancelled by user";

    // Remove state file
    removeState(this.modelsDir, this.modelId);

    // Remove downloaded files
    if (existsSync(this.destDir)) {
      try {
        rmSync(this.destDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }

    this.emitProgress();
    console.log(`[model-download] Cancelled: ${this.repo}`);
  }

  /** Fetch the HuggingFace file list for this repo. */
  private async fetchFileList(): Promise<string[]> {
    const apiUrl = `${this.baseUrl}/api/models/${this.repo}`;
    console.log(`[model-download] Fetching file list: ${apiUrl}`);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      const response = await fetch(apiUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) {
        const info = (await response.json()) as HFModelInfo;
        return info.siblings
          .map((s) => s.rfilename)
          .filter((f) => !SKIP_FILES.has(f));
      }
    } catch (err) {
      console.error(
        `[model-download] Failed to fetch file list for ${this.repo}:`,
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

  /** HEAD request all files to determine total download size. */
  private async resolveFileSizes(files: string[]): Promise<void> {
    const headResults = await Promise.allSettled(
      files.map(async (file) => {
        const filePath = join(this.destDir, file);
        const existingSize = getLocalFileSize(filePath);
        try {
          const controller = new AbortController();
          const timer = setTimeout(
            () => controller.abort(),
            REQUEST_TIMEOUT,
          );
          const resp = await fetch(
            `${this.resolveUrl}/${file}`,
            { method: "HEAD", signal: controller.signal },
          );
          clearTimeout(timer);
          if (resp.ok) {
            const contentLength = Number(
              resp.headers.get("content-length") ?? 0,
            );
            return { file, contentLength, existingSize };
          }
        } catch {
          // HEAD failed
        }
        return { file, contentLength: 0, existingSize: 0 };
      }),
    );

    this.fileStates = [];
    this.totalBytes = 0;
    this.downloadedBytes = 0;

    for (const result of headResults) {
      if (result.status !== "fulfilled") continue;
      const { file, contentLength, existingSize } = result.value;
      const completed =
        contentLength > 0 && existingSize >= contentLength;
      this.fileStates.push({
        name: file,
        totalBytes: contentLength,
        downloadedBytes: Math.min(existingSize, contentLength || existingSize),
        completed,
      });
      this.totalBytes += contentLength;
      this.downloadedBytes += Math.min(
        existingSize,
        contentLength || existingSize,
      );
    }
  }

  /** Download a single file with progress tracking. */
  private async downloadSingleFile(fileName: string): Promise<void> {
    const filePath = join(this.destDir, fileName);
    const fileUrl = `${this.resolveUrl}/${fileName}`;

    // Find file state index
    const idx = this.fileStates.findIndex((f) => f.name === fileName);
    if (idx < 0) return;

    // Skip already completed files
    if (this.fileStates[idx].completed) {
      console.log(`[model-download] Already complete: ${fileName}`);
      return;
    }

    const bytesWritten = await downloadFile({
      url: fileUrl,
      filePath,
      abortSignal: this.abortController?.signal,
      onData: (bytes) => {
        this.downloadedBytes += bytes;
        this.fileStates[idx] = {
          ...this.fileStates[idx],
          downloadedBytes: this.fileStates[idx].downloadedBytes + bytes,
        };
        this.emitProgress();
        this.maybePersistState();
      },
    });

    // Verify file size
    const expected = this.fileStates[idx].totalBytes;
    if (expected > 0 && existsSync(filePath)) {
      const actual = statSync(filePath).size;
      if (actual < expected) {
        throw new Error(
          `Incomplete download: ${fileName} is ${actual} bytes, expected ${expected}`,
        );
      }
    }

    // If HEAD didn't know the size, reconcile from actual
    if (expected === 0 && existsSync(filePath)) {
      const actual = statSync(filePath).size;
      if (actual > 0) {
        this.totalBytes += actual;
        this.downloadedBytes =
          this.downloadedBytes - bytesWritten + actual;
      }
    }

    // Mark completed
    this.fileStates[idx] = {
      ...this.fileStates[idx],
      completed: true,
      downloadedBytes: expected > 0 ? expected : getLocalFileSize(filePath),
    };

    if (bytesWritten > 0) {
      console.log(
        `[model-download] Downloaded: ${fileName} (${(bytesWritten / 1024 / 1024).toFixed(1)} MB)`,
      );
    }
  }

  /** Emit progress to the callback. */
  private emitProgress(): void {
    const percent =
      this.totalBytes > 0
        ? Math.min((this.downloadedBytes / this.totalBytes) * 100, 100)
        : 0;

    this.onProgress({
      modelId: this.modelId,
      category: this.category,
      downloaded: this.downloadedBytes,
      total: this.totalBytes,
      percent,
      status: this.status,
      error: this.error,
    });
  }

  /** Persist state to disk at throttled intervals. */
  private maybePersistState(): void {
    const now = Date.now();
    const percent =
      this.totalBytes > 0
        ? (this.downloadedBytes / this.totalBytes) * 100
        : 0;

    // Save every STATE_SAVE_PERCENT_STEP percent or STATE_SAVE_INTERVAL ms
    if (
      percent - this.lastSavedPercent >= STATE_SAVE_PERCENT_STEP ||
      now - this.lastSavedTime >= STATE_SAVE_INTERVAL
    ) {
      this.persistState();
      this.lastSavedPercent = percent;
      this.lastSavedTime = now;
    }
  }

  /** Write current state to disk. */
  private persistState(): void {
    saveState(this.modelsDir, {
      modelId: this.modelId,
      repo: this.repo,
      destDir: this.destDir,
      category: this.category,
      files: this.fileStates,
      status: this.status,
      error: this.error,
      updatedAt: new Date().toISOString(),
    });
  }
}
