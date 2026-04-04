import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  systemPreferences,
} from "electron";
import { join } from "path";
import fs from "fs";
import { is } from "@electron-toolkit/utils";
import { readConfig, writeConfig, type WindowBounds } from "./config";
import { createDatabase, migrateUtcToLocal } from "./database";
import {
  registerIpcHandlers,
  migrateModelsDir,
  killSidecar,
} from "./ipc-handlers";
import { repairWavHeaders } from "./audio-files";
import Database from "better-sqlite3";

let mainWindow: BrowserWindow | null = null;
let db: Database.Database | null = null;

/**
 * Proxy that forwards all property access to the real `db` instance.
 * This allows IPC handlers to capture a stable reference at registration
 * time while the actual database is initialized later (after SetupWizard).
 */
const dbProxy = new Proxy({} as Database.Database, {
  get(_target, prop, receiver) {
    if (!db) throw new Error("Database not initialized yet");
    const value = Reflect.get(db, prop, receiver);
    return typeof value === "function" ? value.bind(db) : value;
  },
});

function createWindow(configDir: string): BrowserWindow {
  const config = readConfig(configDir);
  const saved = config.windowBounds;

  mainWindow = new BrowserWindow({
    width: saved?.width ?? 1200,
    height: saved?.height ?? 800,
    x: saved?.x,
    y: saved?.y,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
    },
  });

  // Save window bounds on move/resize (debounced)
  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  const saveBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized())
        return;
      const bounds = mainWindow.getBounds();
      const current = readConfig(configDir);
      const wb: WindowBounds = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
      writeConfig(configDir, { ...current, windowBounds: wb });
    }, 500);
  };
  mainWindow.on("resize", saveBounds);
  mainWindow.on("move", saveBounds);

  mainWindow.on("ready-to-show", () => {
    const cfg = readConfig(configDir);
    if (cfg.zoomFactor !== null && cfg.zoomFactor > 0) {
      mainWindow!.webContents.setZoomFactor(cfg.zoomFactor);
    }
    mainWindow!.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return mainWindow;
}

/** Initialize database and data directories for the given dataDir. */
function initDataDir(dataDir: string, configDir: string): Database.Database {
  // Ensure dataDir exists, then open database
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "capty.db");
  const database = createDatabase(dbPath);

  // Migrate old UTC timestamps to local time (one-time, guarded by user_version)
  const audioRenames = migrateUtcToLocal(database);
  const audioBaseDir = join(dataDir, "audio");
  for (const { oldPath, newPath } of audioRenames) {
    const oldDir = join(audioBaseDir, oldPath);
    const newDir = join(audioBaseDir, newPath);
    try {
      if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
        fs.renameSync(oldDir, newDir);
        const oldWav = join(newDir, `${oldPath}.wav`);
        const newWav = join(newDir, `${newPath}.wav`);
        if (fs.existsSync(oldWav)) {
          fs.renameSync(oldWav, newWav);
        }
      }
    } catch (err) {
      console.error(
        `[migration] Failed to rename audio dir ${oldPath} -> ${newPath}:`,
        err,
      );
    }
  }

  // Repair WAV files left with placeholder headers from abnormal exits
  repairWavHeaders(audioBaseDir);

  // Ensure models directory exists; migrate flat structure to asr/tts split
  const modelsDir = join(dataDir, "models");
  fs.mkdirSync(modelsDir, { recursive: true });
  migrateModelsDir(dataDir);
  const legacyUserModels = join(configDir, "user-models.json");
  if (fs.existsSync(legacyUserModels)) {
    try {
      fs.unlinkSync(legacyUserModels);
    } catch {
      // ignore cleanup errors
    }
  }

  return database;
}

app.whenReady().then(() => {
  // 1. Determine configDir
  const configDir = app.getPath("userData");

  // 2. Read config, determine dataDir
  const config = readConfig(configDir);
  const dataDir = config.dataDir;

  // 3. Initialize DB only if dataDir is already configured.
  //    For fresh installs, DB stays null until SetupWizard calls app:init-data-dir.
  if (dataDir) {
    db = initDataDir(dataDir, configDir);
  }

  // 4. Register IPC handlers with dbProxy — a lazy proxy that forwards to
  //    the real `db` once initialized. This lets handlers be registered once
  //    and work regardless of whether DB is ready at registration time.
  registerIpcHandlers({
    db: dbProxy,
    configDir,
    getMainWindow: () => mainWindow,
  });

  // 5. Called by SetupWizard after saving dataDir to config.
  //    Initializes DB in-process without relaunch.
  ipcMain.handle("app:init-data-dir", (_event, newDataDir: string) => {
    if (db) return; // already initialized
    db = initDataDir(newDataDir, configDir);
  });

  // 6. Zoom IPC handlers
  let zoomTimer: ReturnType<typeof setTimeout> | null = null;
  ipcMain.handle("app:set-zoom-factor", (_event, factor: number) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.setZoomFactor(factor);
    }
    if (zoomTimer) clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => {
      const current = readConfig(configDir);
      writeConfig(configDir, { ...current, zoomFactor: factor });
    }, 500);
  });

  ipcMain.handle("app:get-zoom-factor", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      return mainWindow.webContents.getZoomFactor();
    }
    return 1.0;
  });

  // 7. Request microphone permission on macOS
  if (process.platform === "darwin") {
    systemPreferences.askForMediaAccess("microphone").catch(() => {
      // User denied or error — app can still run without mic
    });
  }

  // 8. Create BrowserWindow
  createWindow(configDir);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(configDir);
    }
  });
});

app.on("before-quit", () => {
  killSidecar();
  if (db) {
    db.close();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
