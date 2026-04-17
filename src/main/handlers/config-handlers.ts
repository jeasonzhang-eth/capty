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

/**
 * Accept null (user turned off the mirror) or an https URL. Reject anything
 * that could become SSRF in a later fetch() call (file:, http:, javascript:,
 * data:, etc). Returns `undefined` to signal "ignore this write".
 */
function sanitizeHfMirrorUrl(v: unknown): string | null | undefined {
  if (v === null || v === "") return null;
  if (typeof v !== "string") return undefined;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:") return undefined;
    return v;
  } catch {
    return undefined;
  }
}

/**
 * Accept only a well-typed `{ autoStart?: boolean, port?: int[1,65535] }`.
 * Drops unknown sub-fields and invalid types silently so the renderer cannot
 * smuggle malicious values (e.g. a port string that would shell-inject if
 * interpolated).
 */
function sanitizeSidecar(
  v: unknown,
): { autoStart?: boolean; port?: number } | undefined {
  if (!v || typeof v !== "object") return undefined;
  const src = v as Record<string, unknown>;
  const clean: { autoStart?: boolean; port?: number } = {};
  if (typeof src.autoStart === "boolean") clean.autoStart = src.autoStart;
  if (
    typeof src.port === "number" &&
    Number.isInteger(src.port) &&
    src.port > 0 &&
    src.port < 65536
  ) {
    clean.port = src.port;
  }
  return clean;
}

export function register(deps: IpcDeps): void {
  const { configDir, getMainWindow } = deps;

  // Config
  ipcMain.handle("config:get", () => {
    return readConfig(configDir);
  });

  ipcMain.handle("config:set", (_event, partial: Record<string, unknown>) => {
    // Keys with no dedicated IPC that would open a direct attack surface —
    // keep these fully blocked and route through their dedicated handlers.
    //   dataDir         -> app:change-data-dir (validates home containment)
    //   modelRegistryUrl -> currently no writer, block by default
    const HARD_BLOCKED = new Set(["dataDir", "modelRegistryUrl"]);
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(partial)) {
      if (HARD_BLOCKED.has(key)) continue;
      if (key === "hfMirrorUrl") {
        const clean = sanitizeHfMirrorUrl(value);
        if (clean !== undefined) sanitized.hfMirrorUrl = clean;
        continue;
      }
      if (key === "sidecar") {
        const clean = sanitizeSidecar(value);
        if (clean !== undefined) sanitized.sidecar = clean;
        continue;
      }
      sanitized[key] = value;
    }
    const current = readConfig(configDir);
    writeConfig(configDir, { ...current, ...sanitized });
  });

  // Dedicated handler for the HF mirror toggle. Takes a boolean so the
  // SetupWizard flow cannot accidentally send a typo'd URL.
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
