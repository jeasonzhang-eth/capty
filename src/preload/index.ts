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
    ipcRenderer.on("models:download-progress", (_event, progress) =>
      callback(progress),
    );
    return () => {
      ipcRenderer.removeAllListeners("models:download-progress");
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
  getAudioDir: (sessionId: number) =>
    ipcRenderer.invoke("audio:get-dir", sessionId),
  openAudioFolder: (sessionId: number) =>
    ipcRenderer.invoke("audio:open-folder", sessionId),

  // Export save file
  saveFile: (defaultName: string, content: string) =>
    ipcRenderer.invoke("export:save-file", defaultName, content),

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
  summarize: (sessionId: number, providerId: string, promptType: string) =>
    ipcRenderer.invoke("llm:summarize", sessionId, providerId, promptType),
  onSummaryChunk: (
    callback: (data: { content: string; done: boolean }) => void,
  ) => {
    ipcRenderer.on("llm:summary-chunk", (_event, data) => callback(data));
    return () => {
      ipcRenderer.removeAllListeners("llm:summary-chunk");
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
