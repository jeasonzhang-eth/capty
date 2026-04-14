/**
 * IPC handlers entry point — delegates registration to focused modules.
 *
 * The handlers were split from a 3412-line god module into 10 domain modules
 * under `./handlers/`. This file is the orchestration layer only.
 *
 * Module mapping (84 channels total):
 *   session         — 14 channels (CRUD on sessions, segments, categories)
 *   sidecar         —  4 channels + lifecycle state (start/stop/health)
 *   asr             —  4 channels (ASR fetch/test/transcribe)
 *   model           — 14 channels (model list/download/search/delete)
 *   llm             — 11 channels (LLM fetch/test/summarize/translate)
 *   tts             —  7 channels (TTS check/list/speak/stream)
 *   audio           — 12 channels (streaming, save, read, decode, import)
 *   audio-download  —  5 channels (yt-dlp / xiaoyuzhou / HTTP)
 *   config          —  9 channels (config get/set, paths, deps)
 *   export          —  5 channels (txt/srt/markdown/save)
 */

import { register as registerSession } from "./handlers/session-handlers";
import { register as registerSidecar } from "./handlers/sidecar-handlers";
import { register as registerAsr } from "./handlers/asr-handlers";
import { register as registerModel } from "./handlers/model-handlers";
import { register as registerLlm } from "./handlers/llm-handlers";
import { register as registerTts } from "./handlers/tts-handlers";
import { register as registerAudio } from "./handlers/audio-handlers";
import { register as registerAudioDownload } from "./handlers/audio-download-handlers";
import { register as registerConfig } from "./handlers/config-handlers";
import { register as registerExport } from "./handlers/export-handlers";
import type { IpcDeps } from "./handlers/types";

export type { IpcDeps };

export function registerIpcHandlers(deps: IpcDeps): void {
  registerSession(deps);
  registerSidecar(deps);
  registerAsr(deps);
  registerModel(deps);
  registerLlm(deps);
  registerTts(deps);
  registerAudio(deps);
  registerAudioDownload(deps);
  registerConfig(deps);
  registerExport(deps);
}

// Backwards-compatible re-exports for src/main/index.ts:
export { killSidecar } from "./handlers/sidecar-handlers";
export { migrateModelsDir } from "./handlers/model-handlers";
