/**
 * Singleton download manager.
 *
 * Coordinates all model downloads with concurrency limits,
 * pause/resume/cancel, and crash recovery.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "fs";
import { join } from "path";
import type { DownloadCategory, DownloadProgress, TaskStatus } from "./types";
import { MAX_CONCURRENT_MODELS, SKIP_FILES } from "./types";
import { listIncompleteDownloads, removeState } from "./download-state";
import { ModelDownloadTask } from "./model-download-task";

export interface DownloadManagerOptions {
  readonly modelsDir: string;
  readonly mirrorUrl?: string;
  readonly onProgress: (progress: DownloadProgress) => void;
}

export class DownloadManager {
  private readonly modelsDir: string;
  private mirrorUrl: string | undefined;
  private readonly onProgress: (progress: DownloadProgress) => void;
  private readonly activeTasks = new Map<string, ModelDownloadTask>();
  private readonly pendingQueue: Array<{
    task: ModelDownloadTask;
    resolve: () => void;
    reject: (err: Error) => void;
  }> = [];

  constructor(opts: DownloadManagerOptions) {
    this.modelsDir = opts.modelsDir;
    this.mirrorUrl = opts.mirrorUrl;
    this.onProgress = opts.onProgress;
  }

  /** Update the HuggingFace mirror URL. */
  setMirrorUrl(url: string | undefined): void {
    this.mirrorUrl = url;
  }

  /** Start downloading a model. Returns a promise that resolves when complete. */
  async download(
    modelId: string,
    repo: string,
    destDir: string,
    category: DownloadCategory,
  ): Promise<void> {
    // Already downloading this model?
    if (this.activeTasks.has(modelId)) {
      throw new Error(`Model ${modelId} is already downloading`);
    }

    const task = new ModelDownloadTask({
      modelId,
      repo,
      destDir,
      category,
      modelsDir: this.modelsDir,
      mirrorUrl: this.mirrorUrl,
      onProgress: this.onProgress,
    });

    // If under concurrency limit, start immediately
    if (this.activeTasks.size < MAX_CONCURRENT_MODELS) {
      return this.startTask(task);
    }

    // Queue the download
    return new Promise<void>((resolve, reject) => {
      this.pendingQueue.push({ task, resolve, reject });
    });
  }

  /** Pause a downloading model. */
  pause(modelId: string): boolean {
    const task = this.activeTasks.get(modelId);
    if (!task) return false;
    task.pause();
    return true;
  }

  /** Resume a paused model download. */
  async resume(modelId: string): Promise<void> {
    const task = this.activeTasks.get(modelId);
    if (task && task.getStatus() === "paused") {
      await task.start();
      return;
    }

    // Not in active tasks — might be from crash recovery
    // We need the state to reconstruct
    throw new Error(`No paused download found for ${modelId}`);
  }

  /** Cancel a download (active or queued). */
  cancel(modelId: string): boolean {
    // Check active tasks
    const task = this.activeTasks.get(modelId);
    if (task) {
      task.cancel();
      this.activeTasks.delete(modelId);
      this.processQueue();
      return true;
    }

    // Check pending queue
    const idx = this.pendingQueue.findIndex(
      (q) => q.task.modelId === modelId,
    );
    if (idx >= 0) {
      const [removed] = this.pendingQueue.splice(idx, 1);
      removed.task.cancel();
      removed.reject(new Error("Cancelled"));
      return true;
    }

    // Try removing just the state file
    removeState(this.modelsDir, modelId);
    return false;
  }

  /** Get status of a specific download. */
  getStatus(modelId: string): TaskStatus | null {
    const task = this.activeTasks.get(modelId);
    if (task) return task.getStatus();

    // Check queue
    const queued = this.pendingQueue.find(
      (q) => q.task.modelId === modelId,
    );
    if (queued) return "pending";

    return null;
  }

  /** List all incomplete downloads from previous sessions. */
  getIncompleteDownloads(): Array<{
    modelId: string;
    repo: string;
    destDir: string;
    category: DownloadCategory;
    percent: number;
    status: TaskStatus;
  }> {
    const states = listIncompleteDownloads(this.modelsDir);
    return states.map((s) => {
      const totalBytes = s.files.reduce(
        (sum, f) => sum + f.totalBytes,
        0,
      );
      const downloadedBytes = s.files.reduce(
        (sum, f) => sum + f.downloadedBytes,
        0,
      );
      const percent =
        totalBytes > 0
          ? Math.min((downloadedBytes / totalBytes) * 100, 100)
          : 0;

      return {
        modelId: s.modelId,
        repo: s.repo,
        destDir: s.destDir,
        category: s.category,
        percent,
        status: s.status,
      };
    });
  }

  /** Resume an incomplete download from crash recovery state. */
  async resumeIncomplete(modelId: string): Promise<void> {
    const incompletes = listIncompleteDownloads(this.modelsDir);
    const state = incompletes.find((s) => s.modelId === modelId);
    if (!state) {
      throw new Error(`No incomplete download found for ${modelId}`);
    }

    return this.download(
      state.modelId,
      state.repo,
      state.destDir,
      state.category,
    );
  }

  /** Start a task and manage its lifecycle. */
  private async startTask(task: ModelDownloadTask): Promise<void> {
    this.activeTasks.set(task.modelId, task);

    try {
      await task.start();
    } finally {
      this.activeTasks.delete(task.modelId);
      this.processQueue();
    }
  }

  /** Start the next queued download if under concurrency limit. */
  private processQueue(): void {
    while (
      this.pendingQueue.length > 0 &&
      this.activeTasks.size < MAX_CONCURRENT_MODELS
    ) {
      const next = this.pendingQueue.shift()!;
      this.startTask(next.task).then(next.resolve, next.reject);
    }
  }
}

// ─── Utility functions (kept from old model-downloader.ts) ─────────────

/** Check if a model has been downloaded (has model weight files). */
export function isModelDownloaded(
  modelsDir: string,
  modelId: string,
): boolean {
  const modelPath = join(modelsDir, modelId);
  if (!existsSync(modelPath)) return false;
  try {
    const entries = readdirSync(modelPath);
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
