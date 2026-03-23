import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Sessions
  createSession: (modelName: string) => ipcRenderer.invoke('session:create', modelName),
  listSessions: () => ipcRenderer.invoke('session:list'),
  getSession: (id: number) => ipcRenderer.invoke('session:get', id),
  updateSession: (id: number, fields: Record<string, unknown>) =>
    ipcRenderer.invoke('session:update', id, fields),

  // Segments
  addSegment: (opts: Record<string, unknown>) => ipcRenderer.invoke('segment:add', opts),

  // Audio
  saveSegmentAudio: (sessionDir: string, segmentIndex: number, pcmData: ArrayBuffer) =>
    ipcRenderer.invoke('audio:save-segment', sessionDir, segmentIndex, pcmData),
  saveFullAudio: (sessionDir: string, pcmData: ArrayBuffer) =>
    ipcRenderer.invoke('audio:save-full', sessionDir, pcmData),

  // Export
  exportTxt: (sessionId: number, opts: Record<string, unknown>) =>
    ipcRenderer.invoke('export:txt', sessionId, opts),
  exportSrt: (sessionId: number) => ipcRenderer.invoke('export:srt', sessionId),
  exportMarkdown: (sessionId: number) => ipcRenderer.invoke('export:markdown', sessionId),

  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config: Record<string, unknown>) => ipcRenderer.invoke('config:set', config),

  // Sidecar
  getSidecarUrl: () => ipcRenderer.invoke('sidecar:get-url'),

  // Models
  listModels: () => ipcRenderer.invoke('models:list'),

  // App
  getDataDir: () => ipcRenderer.invoke('app:get-data-dir'),
  selectDirectory: () => ipcRenderer.invoke('app:select-directory')
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('capty', api)
  } catch (error) {
    console.error('Failed to expose capty API:', error)
  }
} else {
  // @ts-expect-error fallback for non-isolated context
  window.capty = api
}

export type CaptyAPI = typeof api
