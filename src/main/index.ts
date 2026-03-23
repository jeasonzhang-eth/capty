import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { readConfig } from './config'
import { createDatabase } from './database'
import { SidecarManager } from './sidecar'
import { registerIpcHandlers } from './ipc-handlers'
import Database from 'better-sqlite3'

let mainWindow: BrowserWindow | null = null
let db: Database.Database | null = null
let sidecar: SidecarManager | null = null

function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(() => {
  // 1. Determine configDir
  const configDir = app.getPath('userData')

  // 2. Read config, determine dataDir
  const config = readConfig(configDir)
  const dataDir = config.dataDir ?? join(configDir, 'data')

  // 3. Open database
  const dbPath = join(dataDir, 'capty.db')
  db = createDatabase(dbPath)

  // 4. Create SidecarManager (placeholder path — resolved in a future task)
  const sidecarPath = join(process.resourcesPath ?? '', 'sidecar', 'whisper-server')
  const modelsDir = join(dataDir, 'models')
  sidecar = new SidecarManager(sidecarPath, modelsDir)

  // 5. Register IPC handlers
  registerIpcHandlers({
    db,
    configDir,
    sidecar,
    getMainWindow: () => mainWindow
  })

  // 6. Create BrowserWindow
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  if (sidecar) {
    sidecar.stop()
  }
  if (db) {
    db.close()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
