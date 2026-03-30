import { contextBridge, ipcRenderer } from "electron";

const api = {
  // Sessions
  createSession: (modelName: string) =>
    ipcRenderer.invoke("session:create", modelName),
  listSessions: () => ipcRenderer.invoke("session:list"),
  getSession: (id: number) => ipcRenderer.invoke("session:get", id),
  updateSession: (id: number, fields: Record<string, unknown>) =>
    ipcRenderer.invoke("session:update", id, fields),
  deleteSession: (id: number) => ipcRenderer.invoke("session:delete", id),
  renameSession: (id: number, newTitle: string) =>
    ipcRenderer.invoke("session:rename", id, newTitle),

  // Segments
  addSegment: (opts: Record<string, unknown>) =>
    ipcRenderer.invoke("segment:add", opts),
  listSegments: (sessionId: number) =>
    ipcRenderer.invoke("segment:list", sessionId),

  // Audio
  saveSegmentAudio: (
    sessionDir: string,
    segmentIndex: number,
    pcmData: ArrayBuffer,
  ) =>
    ipcRenderer.invoke("audio:save-segment", sessionDir, segmentIndex, pcmData),
  saveFullAudio: (
    sessionDir: string,
    pcmData: ArrayBuffer,
    fileName?: string,
  ) => ipcRenderer.invoke("audio:save-full", sessionDir, pcmData, fileName),

  // Export
  exportTxt: (sessionId: number, opts: Record<string, unknown>) =>
    ipcRenderer.invoke("export:txt", sessionId, opts),
  exportSrt: (sessionId: number) => ipcRenderer.invoke("export:srt", sessionId),
  exportMarkdown: (sessionId: number) =>
    ipcRenderer.invoke("export:markdown", sessionId),

  // Config
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (config: Record<string, unknown>) =>
    ipcRenderer.invoke("config:set", config),

  // Sidecar
  getSidecarUrl: () => ipcRenderer.invoke("sidecar:get-url"),
  checkSidecarHealth: () =>
    ipcRenderer.invoke("sidecar:health-check") as Promise<{
      online: boolean;
      [key: string]: unknown;
    }>,

  // External ASR
  asrTranscribe: (
    pcmData: ArrayBuffer,
    provider: { baseUrl: string; apiKey: string; model: string },
  ) =>
    ipcRenderer.invoke("asr:transcribe", pcmData, provider) as Promise<{
      text: string;
    }>,
  asrTest: (provider: { baseUrl: string; apiKey: string; model: string }) =>
    ipcRenderer.invoke("asr:test", provider) as Promise<{ success: boolean }>,
  asrFetchModels: (provider: { baseUrl: string; apiKey: string }) =>
    ipcRenderer.invoke("asr:fetch-models", provider) as Promise<
      Array<{ id: string; name: string }>
    >,
  llmFetchModels: (provider: { baseUrl: string; apiKey: string }) =>
    ipcRenderer.invoke("llm:fetch-models", provider) as Promise<
      Array<{ id: string; name: string }>
    >,

  // Models
  listModels: () => ipcRenderer.invoke("models:list"),
  searchModels: (query: string) => ipcRenderer.invoke("models:search", query),
  deleteModel: (modelId: string) =>
    ipcRenderer.invoke("models:delete", modelId),
  saveModelMeta: (modelId: string, meta: Record<string, unknown>) =>
    ipcRenderer.invoke("models:save-meta", modelId, meta),

  // Zoom
  setZoomFactor: (factor: number) =>
    ipcRenderer.invoke("app:set-zoom-factor", factor),
  getZoomFactor: () =>
    ipcRenderer.invoke("app:get-zoom-factor") as Promise<number>,

  // Layout
  saveLayout: (opts: {
    historyPanelWidth?: number;
    summaryPanelWidth?: number;
  }) => ipcRenderer.invoke("layout:save", opts),

  // App
  getDataDir: () => ipcRenderer.invoke("app:get-data-dir"),
  getConfigDir: () =>
    ipcRenderer.invoke("app:get-config-dir") as Promise<string>,
  selectDirectory: () => ipcRenderer.invoke("app:select-directory"),
  openConfigDir: () => ipcRenderer.invoke("app:open-config-dir"),

  // Model download
  downloadModel: (repo: string, destDir: string) =>
    ipcRenderer.invoke("models:download", repo, destDir),
  onDownloadProgress: (
    callback: (progress: {
      downloaded: number;
      total: number;
      percent: number;
    }) => void,
  ) => {
    const handler = (_event: any, progress: any) => callback(progress);
    ipcRenderer.on("models:download-progress", handler);
    return () => {
      ipcRenderer.removeListener("models:download-progress", handler);
    };
  },

  // Download control (pause / resume / cancel)
  pauseDownload: (modelId: string) =>
    ipcRenderer.invoke("download:pause", modelId) as Promise<boolean>,
  resumeDownload: (modelId: string) =>
    ipcRenderer.invoke("download:resume", modelId) as Promise<void>,
  cancelDownload: (modelId: string) =>
    ipcRenderer.invoke("download:cancel", modelId) as Promise<boolean>,
  getIncompleteDownloads: () =>
    ipcRenderer.invoke("download:list-incomplete") as Promise<
      Array<{
        modelId: string;
        repo: string;
        destDir: string;
        category: "asr" | "tts";
        percent: number;
        status: string;
      }>
    >,
  onDownloadEvent: (
    callback: (progress: {
      modelId: string;
      category: "asr" | "tts";
      downloaded: number;
      total: number;
      percent: number;
      status: string;
      error?: string;
    }) => void,
  ) => {
    const handler = (_event: any, progress: any) => callback(progress);
    ipcRenderer.on("download:progress", handler);
    return () => {
      ipcRenderer.removeListener("download:progress", handler);
    };
  },

  // Streaming audio write (crash-safe)
  openAudioStream: (sessionDir: string, fileName: string) =>
    ipcRenderer.invoke("audio:stream-open", sessionDir, fileName),
  appendAudioStream: (pcmData: ArrayBuffer) =>
    ipcRenderer.invoke("audio:stream-write", pcmData),
  closeAudioStream: () => ipcRenderer.invoke("audio:stream-close"),

  // Segments
  deleteSegments: (sessionId: number) =>
    ipcRenderer.invoke("segment:delete-by-session", sessionId),

  // Audio read
  readAudioFile: (sessionId: number) =>
    ipcRenderer.invoke("audio:read-file", sessionId),
  getAudioFilePath: (sessionId: number) =>
    ipcRenderer.invoke("audio:get-file-path", sessionId) as Promise<
      string | null
    >,
  getAudioDir: (sessionId: number) =>
    ipcRenderer.invoke("audio:get-dir", sessionId),
  openAudioFolder: (sessionId: number) =>
    ipcRenderer.invoke("audio:open-folder", sessionId),

  // Audio import
  importAudio: () =>
    ipcRenderer.invoke("audio:import") as Promise<{
      sessionId: number;
      timestamp: string;
      audioPath: string;
    } | null>,
  getAudioDuration: (filePath: string) =>
    ipcRenderer.invoke("audio:get-duration", filePath) as Promise<number>,
  transcribeFile: (
    filePath: string,
    provider: { baseUrl: string; apiKey: string; model: string },
  ) =>
    ipcRenderer.invoke("audio:transcribe-file", filePath, provider) as Promise<{
      text: string;
      segments: Array<{ start: number; end: number; text: string }>;
      duration: number;
    }>,
  decodeAudioFile: (filePath: string, sidecarBaseUrl: string) =>
    ipcRenderer.invoke(
      "audio:decode-file",
      filePath,
      sidecarBaseUrl,
    ) as Promise<ArrayBuffer>,

  // Export save file
  saveFile: (defaultName: string, content: string) =>
    ipcRenderer.invoke("export:save-file", defaultName, content),
  saveBuffer: (
    defaultName: string,
    data: Uint8Array,
    filters: { name: string; extensions: string[] }[],
  ) => ipcRenderer.invoke("export:save-buffer", defaultName, data, filters),

  // TTS
  checkTtsProvider: () =>
    ipcRenderer.invoke("tts:check-provider") as Promise<{
      ready: boolean;
      reason: string;
    }>,
  ttsTest: (provider: { baseUrl: string; apiKey: string; model: string }) =>
    ipcRenderer.invoke("tts:test", provider) as Promise<{
      success: boolean;
      bytes: number;
    }>,
  ttsListVoices: (modelDir: string) =>
    ipcRenderer.invoke("tts:list-voices", modelDir) as Promise<{
      model: string;
      voices: Array<{ id: string; name: string; lang: string; gender: string }>;
    }>,
  ttsSpeak: (
    text: string,
    opts?: { voice?: string; speed?: number; langCode?: string },
  ) => ipcRenderer.invoke("tts:speak", text, opts) as Promise<ArrayBuffer>,

  // TTS Streaming
  ttsSpeakStream: (
    streamId: string,
    text: string,
    opts?: { voice?: string; speed?: number; langCode?: string },
  ) => ipcRenderer.invoke("tts:speak-stream", streamId, text, opts),
  ttsCancelStream: (streamId: string) =>
    ipcRenderer.invoke("tts:cancel-stream", streamId),
  onTtsStreamHeader: (
    callback: (data: { streamId: string; sampleRate: number }) => void,
  ) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("tts:stream-header", handler);
    return () => {
      ipcRenderer.removeListener("tts:stream-header", handler);
    };
  },
  onTtsStreamData: (
    callback: (data: {
      streamId: string;
      data: string;
      sampleRate: number;
      isFinal: boolean;
    }) => void,
  ) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("tts:stream-data", handler);
    return () => {
      ipcRenderer.removeListener("tts:stream-data", handler);
    };
  },
  onTtsStreamEnd: (callback: (data: { streamId: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("tts:stream-end", handler);
    return () => {
      ipcRenderer.removeListener("tts:stream-end", handler);
    };
  },
  onTtsStreamError: (
    callback: (data: { streamId: string; error: string }) => void,
  ) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("tts:stream-error", handler);
    return () => {
      ipcRenderer.removeListener("tts:stream-error", handler);
    };
  },

  // TTS Models
  listTtsModels: () => ipcRenderer.invoke("tts-models:list"),
  searchTtsModels: (query: string) =>
    ipcRenderer.invoke("tts-models:search", query),
  deleteTtsModel: (modelId: string) =>
    ipcRenderer.invoke("tts-models:delete", modelId),
  saveTtsModelMeta: (modelId: string, meta: Record<string, unknown>) =>
    ipcRenderer.invoke("tts-models:save-meta", modelId, meta),
  downloadTtsModel: (repo: string, destDir: string) =>
    ipcRenderer.invoke("tts-models:download", repo, destDir),
  onTtsDownloadProgress: (
    callback: (progress: {
      downloaded: number;
      total: number;
      percent: number;
    }) => void,
  ) => {
    const handler = (_event: any, progress: any) => callback(progress);
    ipcRenderer.on("tts-models:download-progress", handler);
    return () => {
      ipcRenderer.removeListener("tts-models:download-progress", handler);
    };
  },
  saveTtsSettings: (settings: {
    ttsProviders: Array<{
      id: string;
      name: string;
      baseUrl: string;
      apiKey: string;
      model: string;
      voice: string;
      isSidecar: boolean;
    }>;
    selectedTtsProviderId: string | null;
    selectedTtsModelId: string | null;
  }) => ipcRenderer.invoke("config:save-tts-settings", settings),

  // LLM
  testLlmProvider: (provider: {
    baseUrl: string;
    apiKey: string;
    model: string;
  }) =>
    ipcRenderer.invoke("llm:test", provider) as Promise<{
      success: boolean;
      model: string;
    }>,
  summarize: (
    sessionId: number,
    providerId: string,
    model: string,
    promptType: string,
  ) =>
    ipcRenderer.invoke(
      "llm:summarize",
      sessionId,
      providerId,
      model,
      promptType,
    ),
  generateTitle: (
    sessionId: number,
    providerId: string,
    model: string,
    systemPrompt: string,
  ) =>
    ipcRenderer.invoke(
      "llm:generate-title",
      sessionId,
      providerId,
      model,
      systemPrompt,
    ) as Promise<string>,
  translate: (
    providerId: string,
    model: string,
    text: string,
    targetLanguage: string,
    promptTemplate: string,
  ) =>
    ipcRenderer.invoke(
      "llm:translate",
      providerId,
      model,
      text,
      targetLanguage,
      promptTemplate,
    ) as Promise<string>,
  saveTranslation: (
    segmentId: number,
    sessionId: number,
    targetLanguage: string,
    translatedText: string,
  ) =>
    ipcRenderer.invoke(
      "translation:save",
      segmentId,
      sessionId,
      targetLanguage,
      translatedText,
    ) as Promise<number>,
  listTranslations: (sessionId: number, targetLanguage: string) =>
    ipcRenderer.invoke(
      "translation:list",
      sessionId,
      targetLanguage,
    ) as Promise<
      Array<{
        id: number;
        segment_id: number;
        session_id: number;
        target_language: string;
        translated_text: string;
      }>
    >,
  onSummaryChunk: (
    callback: (data: { content: string; done: boolean }) => void,
  ) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("llm:summary-chunk", handler);
    return () => {
      ipcRenderer.removeListener("llm:summary-chunk", handler);
    };
  },
  listSummaries: (sessionId: number, promptType?: string) =>
    ipcRenderer.invoke("summary:list", sessionId, promptType),
  deleteSummary: (summaryId: number) =>
    ipcRenderer.invoke("summary:delete", summaryId),
  listPromptTypes: () => ipcRenderer.invoke("prompt-types:list"),
  savePromptTypes: (
    types: {
      id: string;
      label: string;
      systemPrompt: string;
      isBuiltin: boolean;
    }[],
  ) => ipcRenderer.invoke("prompt-types:save", types),

  // Audio download (yt-dlp)
  downloadAudio: (url: string) =>
    ipcRenderer.invoke("audio:download-start", url) as Promise<{
      downloadId: number;
    }>,
  cancelAudioDownload: (downloadId: number) =>
    ipcRenderer.invoke("audio:download-cancel", downloadId) as Promise<void>,
  retryAudioDownload: (downloadId: number) =>
    ipcRenderer.invoke("audio:download-retry", downloadId) as Promise<void>,
  getAudioDownloads: () =>
    ipcRenderer.invoke("audio:download-list") as Promise<
      Array<{
        id: number;
        url: string;
        title: string | null;
        source: string | null;
        status: string;
        progress: number;
        speed: string | null;
        eta: string | null;
        session_id: number | null;
        error: string | null;
        created_at: string;
        completed_at: string | null;
      }>
    >,
  removeAudioDownload: (downloadId: number) =>
    ipcRenderer.invoke("audio:download-remove", downloadId) as Promise<void>,
  onAudioDownloadProgress: (
    callback: (event: {
      id: number;
      stage: string;
      title?: string;
      source?: string;
      percent?: number;
      speed?: string;
      eta?: string;
      sessionId?: number;
      error?: string;
    }) => void,
  ) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("audio:download-progress", handler);
    return () => {
      ipcRenderer.removeListener("audio:download-progress", handler);
    };
  },
  onAudioDownloadRetryTrigger: (callback: (data: { url: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("audio:download-retry-trigger", handler);
    return () => {
      ipcRenderer.removeListener("audio:download-retry-trigger", handler);
    };
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("capty", api);
  } catch (error) {
    console.error("Failed to expose capty API:", error);
  }
} else {
  // @ts-expect-error fallback for non-isolated context
  window.capty = api;
}

export type CaptyAPI = typeof api;
