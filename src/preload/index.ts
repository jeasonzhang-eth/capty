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

  // App
  getDataDir: () => ipcRenderer.invoke("app:get-data-dir"),
  selectDirectory: () => ipcRenderer.invoke("app:select-directory"),

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

  // Segments
  deleteSegments: (sessionId: number) =>
    ipcRenderer.invoke("segment:delete-by-session", sessionId),

  // Audio read
  readAudioFile: (sessionId: number) =>
    ipcRenderer.invoke("audio:read-file", sessionId),
  getAudioDir: (sessionId: number) =>
    ipcRenderer.invoke("audio:get-dir", sessionId),

  // Export save file
  saveFile: (defaultName: string, content: string) =>
    ipcRenderer.invoke("export:save-file", defaultName, content),
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
