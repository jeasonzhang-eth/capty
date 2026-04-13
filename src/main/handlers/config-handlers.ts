import { ipcMain, app, dialog, shell } from "electron";
import path from "node:path";
import { spawn } from "../shared/spawn";
import { readConfig, writeConfig, getDataDir } from "../config";
import type { IpcDeps } from "./types";

/** Cached sidecar port from config (invalidated on config:set). */
let _cachedSidecarPort: number | null = null;

export function register(deps: IpcDeps): void {
  const { configDir, getMainWindow } = deps;

  // Config
  ipcMain.handle("config:get", () => {
    return readConfig(configDir);
  });

  ipcMain.handle("config:set", (_event, partial: Record<string, unknown>) => {
    const current = readConfig(configDir);
    writeConfig(configDir, { ...current, ...partial });
    _cachedSidecarPort = null; // invalidate on any config change
  });

  // Layout persistence
  ipcMain.handle(
    "layout:save",
    (
      _event,
      opts: { historyPanelWidth?: number; summaryPanelWidth?: number },
    ) => {
      const current = readConfig(configDir);
      writeConfig(configDir, {
        ...current,
        ...(opts.historyPanelWidth !== undefined && {
          historyPanelWidth: opts.historyPanelWidth,
        }),
        ...(opts.summaryPanelWidth !== undefined && {
          summaryPanelWidth: opts.summaryPanelWidth,
        }),
      });
    },
  );

  // App
  ipcMain.handle("app:get-data-dir", () => {
    return getDataDir(configDir);
  });

  ipcMain.handle("config:get-default-data-dir", () => {
    return path.join(app.getPath("documents"), "Capty");
  });

  ipcMain.handle("app:get-config-dir", () => {
    return configDir;
  });

  ipcMain.handle("app:select-directory", async () => {
    const win = getMainWindow();
    if (!win) {
      return null;
    }
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("app:open-config-dir", () => {
    shell.openPath(configDir);
  });

  // ── Dependency check (brew / ffmpeg / yt-dlp) ──────────────────────
  ipcMain.handle("deps:check", async () => {
    const deps: Array<{ cmd: string; versionArgs: string[] }> = [
      { cmd: "brew", versionArgs: ["--version"] },
      { cmd: "ffmpeg", versionArgs: ["-version"] },
      { cmd: "yt-dlp", versionArgs: ["--version"] },
    ];
    return Promise.all(
      deps.map(async ({ cmd, versionArgs }) => {
        try {
          await new Promise<void>((resolve, reject) => {
            const check = spawn("which", [cmd]);
            check.on("close", (code) =>
              code === 0 ? resolve() : reject(new Error("not found")),
            );
            check.on("error", reject);
          });
          let version: string | null = null;
          try {
            version = await new Promise<string>((resolve, reject) => {
              const proc = spawn(cmd, versionArgs);
              let out = "";
              proc.stdout?.on("data", (d: Buffer) => {
                out += d.toString();
              });
              const timer = setTimeout(() => {
                proc.kill();
                reject(new Error("timeout"));
              }, 5000);
              proc.on("close", (code) => {
                clearTimeout(timer);
                code === 0
                  ? resolve(out.trim().split("\n")[0])
                  : reject(new Error("non-zero exit"));
              });
              proc.on("error", reject);
            });
          } catch {
            version = "installed";
          }
          return { name: cmd, installed: true, version };
        } catch {
          return { name: cmd, installed: false, version: null };
        }
      }),
    );
  });
}
