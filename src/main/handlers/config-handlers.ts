import { ipcMain, app, dialog, shell } from "electron";
import path from "node:path";
import { spawn } from "../shared/spawn";
import { readConfig, writeConfig, getDataDir } from "../config";
import type { IpcDeps } from "./types";

function getDefaultDataDir(): string {
  const documentsDir =
    process.env.ELECTRON_DOCUMENTS_DIR_OVERRIDE || app.getPath("documents");
  return path.join(documentsDir, "Capty");
}

export function register(deps: IpcDeps): void {
  const { configDir, getMainWindow } = deps;

  // Config
  ipcMain.handle("config:get", () => {
    return readConfig(configDir);
  });

  ipcMain.handle("config:set", (_event, partial: Record<string, unknown>) => {
    // Keys that must not be writable via generic config:set — each has a
    // dedicated IPC with validation (app:change-data-dir, etc.). Letting the
    // renderer write these here would enable SSRF (hfMirrorUrl), arbitrary
    // directory write (dataDir), and shell injection via sidecar.port.
    const BLOCKED_KEYS = new Set([
      "dataDir",
      "hfMirrorUrl",
      "modelRegistryUrl",
      "sidecar",
    ]);
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(partial)) {
      if (!BLOCKED_KEYS.has(key)) {
        sanitized[key] = value;
      }
    }
    const current = readConfig(configDir);
    writeConfig(configDir, { ...current, ...sanitized });
  });

  // Dedicated handler for the HF mirror toggle. Takes a boolean so the
  // renderer cannot inject an arbitrary URL into fetch() calls (SSRF).
  ipcMain.handle("config:set-hf-mirror", (_event, enabled: unknown) => {
    const current = readConfig(configDir);
    const hfMirrorUrl = enabled === true ? "https://hf-mirror.com" : null;
    writeConfig(configDir, { ...current, hfMirrorUrl });
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
    return getDefaultDataDir();
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
