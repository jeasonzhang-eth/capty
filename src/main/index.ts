import { app, BrowserWindow, shell, systemPreferences } from "electron";
import { join } from "path";
import fs from "fs";
import { is } from "@electron-toolkit/utils";
import { readConfig } from "./config";
import { createDatabase } from "./database";
import { SidecarManager } from "./sidecar";
import { registerIpcHandlers } from "./ipc-handlers";
import Database from "better-sqlite3";

let mainWindow: BrowserWindow | null = null;
let db: Database.Database | null = null;
let sidecar: SidecarManager | null = null;

function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
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

  // 4. Create SidecarManager
  const modelsDir = join(dataDir, "models");
  fs.mkdirSync(modelsDir, { recursive: true });
  const sidecarDir = is.dev
    ? join(__dirname, "../../sidecar")
    : join(process.resourcesPath, "sidecar");
  sidecar = new SidecarManager({
    sidecarDir,
    modelsDir,
    isDev: is.dev,
  });

  // 5. Register IPC handlers
  registerIpcHandlers({
    db,
    configDir,
    sidecar,
    getMainWindow: () => mainWindow,
  });

  // 6. Request microphone permission on macOS
  if (process.platform === "darwin") {
    systemPreferences.askForMediaAccess("microphone").catch(() => {
      // User denied or error — app can still run without mic
    });
  }

  // 7. Create BrowserWindow
  createWindow();

  // 8. Start sidecar in background (don't block window)
  sidecar.start().catch((err) => {
    console.error("[sidecar] Failed to start:", err);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  if (sidecar) {
    sidecar.stop();
  }
  if (db) {
    db.close();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
