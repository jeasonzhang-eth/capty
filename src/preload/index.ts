import { contextBridge } from 'electron'

const captyApi = {}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('capty', captyApi)
  } catch (error) {
    console.error('Failed to expose capty API:', error)
  }
} else {
  // @ts-expect-error fallback for non-isolated context
  window.capty = captyApi
}
