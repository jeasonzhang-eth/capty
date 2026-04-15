/**
 * Vitest setup for renderer store tests.
 * Mocks `window.capty` (the preload API) with vi.fn() stubs.
 * Each method returns a resolved promise by default.
 */
import { vi } from "vitest";

const methods = [
  "addSegment",
  "appendAudioStream",
  "asrFetchModels",
  "asrTest",
  "asrTranscribe",
  "cancelAudioDownload",
  "cancelDownload",
  "checkDependencies",
  "checkSidecarHealth",
  "checkTtsProvider",
  "closeAudioStream",
  "createSession",
  "decodeAudioFile",
  "deleteModel",
  "deleteSegments",
  "deleteSession",
  "deleteSessionCategory",
  "deleteSummary",
  "deleteTtsModel",
  "downloadAudio",
  "downloadModel",
  "downloadTtsModel",
  "exportMarkdown",
  "exportSrt",
  "exportTxt",
  "generateTitle",
  "getAudioDir",
  "getAudioDownloads",
  "getAudioDuration",
  "getAudioFilePath",
  "getConfig",
  "getConfigDir",
  "getDataDir",
  "getDefaultDataDir",
  "getIncompleteDownloads",
  "getSession",
  "getSidecarUrl",
  "getZoomFactor",
  "importAudio",
  "initDataDir",
  "listModels",
  "listPromptTypes",
  "listSegments",
  "listSessionCategories",
  "listSessions",
  "listSummaries",
  "listTranslations",
  "listTtsModels",
  "llmFetchModels",
  "onAudioDownloadProgress",
  "onAudioDownloadRetryTrigger",
  "onDownloadEvent",
  "onDownloadProgress",
  "onSummaryChunk",
  "onTtsDownloadProgress",
  "onTtsStreamData",
  "onTtsStreamEnd",
  "onTtsStreamError",
  "onTtsStreamHeader",
  "openAudioFolder",
  "openAudioStream",
  "openConfigDir",
  "pauseDownload",
  "readAudioFile",
  "removeAudioDownload",
  "renameSession",
  "reorderSessions",
  "resumeDownload",
  "retryAudioDownload",
  "saveBuffer",
  "saveFile",
  "saveFullAudio",
  "saveLayout",
  "saveModelMeta",
  "savePromptTypes",
  "saveSegmentAudio",
  "saveSessionCategories",
  "saveTranslation",
  "saveTtsModelMeta",
  "saveTtsSettings",
  "searchModels",
  "searchTtsModels",
  "selectDirectory",
  "setConfig",
  "setZoomFactor",
  "startSidecar",
  "stopSidecar",
  "summarize",
  "testLlmProvider",
  "transcribeFile",
  "translate",
  "ttsCancelStream",
  "ttsListVoices",
  "ttsSpeak",
  "ttsSpeakStream",
  "ttsTest",
  "updateSession",
  "updateSessionCategory",
] as const;

const capty: Record<string, ReturnType<typeof vi.fn>> = {};
for (const m of methods) {
  capty[m] = vi.fn().mockResolvedValue(undefined);
}
// Event listeners return a cleanup function by default
for (const m of methods) {
  if (m.startsWith("on")) {
    capty[m] = vi.fn().mockReturnValue(() => {});
  }
}

// When running under a DOM environment (happy-dom / jsdom), window already
// exists with document, etc.  We must NOT overwrite it — only attach `capty`.
// For pure-Node store tests, window is undefined, so we create a minimal stub.
if (typeof globalThis.window === "undefined") {
  (globalThis as any).window = { capty };
} else {
  (globalThis as any).window.capty = capty;
}

// Minimal localStorage mock for Node test environment.
// DOM environments (happy-dom) already provide localStorage, so only
// install the mock when it is missing.
if (typeof globalThis.localStorage === "undefined") {
  const localStorageStore: Record<string, string> = {};
  const localStorageMock = {
    getItem: (key: string) => localStorageStore[key] ?? null,
    setItem: (key: string, value: string) => {
      localStorageStore[key] = value;
    },
    removeItem: (key: string) => {
      delete localStorageStore[key];
    },
    clear: () => {
      for (const key of Object.keys(localStorageStore)) {
        delete localStorageStore[key];
      }
    },
  };
  (globalThis as any).localStorage = localStorageMock;
}
