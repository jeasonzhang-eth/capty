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
import { createDatabase } from "./database";
import { registerIpcHandlers } from "./ipc-handlers";
import { repairWavHeaders } from "./audio-files";
import Database from "better-sqlite3";

let mainWindow: BrowserWindow | null = null;
let db: Database.Database | null = null;

function createWindow(configDir: string): BrowserWindow {
  const config = readConfig(configDir);
  const saved = config.windowBounds;

  mainWindow = new BrowserWindow({
    width: saved?.width ?? 900,
    height: saved?.height ?? 670,
    x: saved?.x,
    y: saved?.y,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
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

app.whenReady().then(() => {
  // 1. Determine configDir
  const configDir = app.getPath("userData");

  // 2. Read config, determine dataDir
  const config = readConfig(configDir);
  const dataDir = config.dataDir ?? join(configDir, "data");

  // 3. Ensure dataDir exists, then open database
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "capty.db");
  db = createDatabase(dbPath);

  // 3b. Repair WAV files left with placeholder headers from abnormal exits
  const audioDir = join(dataDir, "audio");
  repairWavHeaders(audioDir);

  // 4. Ensure models directory exists
  const modelsDir = join(dataDir, "models");
  fs.mkdirSync(modelsDir, { recursive: true });

  // 5. Register IPC handlers
  registerIpcHandlers({
    db,
    configDir,
    getMainWindow: () => mainWindow,
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
  if (db) {
    db.close();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
