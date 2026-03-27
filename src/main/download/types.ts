/** Shared types for the download module. */

export type DownloadCategory = "asr" | "tts";

export type TaskStatus =
  | "pending"
  | "downloading"
  | "paused"
  | "completed"
  | "failed";

export interface FileState {
  readonly name: string;
  readonly totalBytes: number;
  readonly downloadedBytes: number;
  readonly completed: boolean;
}

/** Persisted to `<models-dir>/.downloads/<model-id>.json`. */
export interface DownloadState {
  readonly modelId: string;
  readonly repo: string;
  readonly destDir: string;
  readonly category: DownloadCategory;
  readonly files: readonly FileState[];
  readonly status: TaskStatus;
  readonly error?: string;
  readonly updatedAt: string;
}

export interface DownloadProgress {
  readonly modelId: string;
  readonly category: DownloadCategory;
  readonly downloaded: number;
  readonly total: number;
  readonly percent: number;
  readonly status: TaskStatus;
  readonly error?: string;
}

/** Files to skip downloading (not needed for inference). */
export const SKIP_FILES = new Set([".gitattributes", "README.md"]);

/** Max time to wait for data before considering the stream stalled (ms). */
export const STALL_TIMEOUT = 30_000;

/** Max retry attempts per file. */
export const MAX_RETRIES = 3;

/** Base delay between retries (ms), multiplied by attempt number. */
export const RETRY_DELAY_BASE = 2_000;

/** Default timeout for network requests (ms). */
export const REQUEST_TIMEOUT = 30_000;

/** Max concurrent file downloads per model. */
export const MAX_FILES_PER_MODEL = 3;

/** Max concurrent model downloads. */
export const MAX_CONCURRENT_MODELS = 2;

/** State persistence interval (ms). */
export const STATE_SAVE_INTERVAL = 10_000;

/** Progress percentage step for state save. */
export const STATE_SAVE_PERCENT_STEP = 5;
