import { ipcMain, app } from "electron";
import type { IpcDeps } from "./types";
import { spawn } from "../shared/spawn";
import { readConfig } from "../config";
import { execFileSync, type ChildProcess } from "child_process";
import fs from "fs";
import path from "node:path";
import { join } from "path";

/** Managed sidecar child process (null when not started by us). */
let sidecarProcess: ChildProcess | null = null;

/** Find sidecar binary: packaged app first, then dev venv, then PATH. */
function findSidecarBin(): string {
  // Production: extraResources copies sidecar/dist/ → Resources/sidecar/
  if (app.isPackaged) {
    const prodBin = path.join(
      process.resourcesPath,
      "sidecar",
      "capty-sidecar",
      "capty-sidecar",
    );
    if (fs.existsSync(prodBin)) return prodBin;
  }
  // Dev: __dirname is out/main/, project root is 2 levels up
  const projectRoot = app.isPackaged
    ? app.getAppPath()
    : path.join(__dirname, "../..");
  const devBin = path.join(projectRoot, "sidecar/.venv/bin/capty-sidecar");
  if (fs.existsSync(devBin)) return devBin;
  // Fallback: PATH
  return "capty-sidecar";
}

/** Read sidecar port from config, validated to a safe integer range. */
function getSidecarPort(cfgDir: string): number {
  const config = readConfig(cfgDir);
  const raw = config.sidecar?.port;
  const port =
    typeof raw === "number" && Number.isInteger(raw) && raw > 0 && raw < 65536
      ? raw
      : 8765;
  _lastSidecarPort = port;
  return port;
}

/** Build sidecar base URL from config port. */
function getSidecarBaseUrl(cfgDir: string): string {
  return `http://localhost:${getSidecarPort(cfgDir)}`;
}

/** Poll /health until OK or timeout. */
async function waitForHealth(
  baseUrl: string,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Sidecar failed to start within timeout");
}

/** PID of last managed sidecar (kept for process.exit SIGKILL fallback). */
let _sidecarPid: number | null = null;

/** Last known sidecar port (for killing orphans on exit). */
let _lastSidecarPort: number = 8765;

/** Guard against concurrent sidecar:start calls (e.g. React StrictMode double-invoke). */
let _sidecarStarting: Promise<{ ok: boolean; error?: string }> | null = null;

/**
 * Check whether the process on the given port is actually a capty-sidecar
 * by probing /health and verifying the response contains `status: "ok"`.
 * Returns the PID(s) on the port if it IS sidecar, empty array otherwise.
 */
function findSidecarPidsOnPort(port: number): number[] {
  if (!Number.isInteger(port) || port <= 0 || port >= 65536) return [];
  // 1. Verify identity via /health (synchronous HTTP is not available,
  //    so we do a quick lsof + process-name check instead)
  try {
    const out = execFileSync("lsof", ["-ti", `tcp:${port}`], {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    if (!out) return [];
    const pids = out
      .split("\n")
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n > 0);
    // Verify each PID is actually a capty-sidecar (check process command)
    return pids.filter((pid) => {
      try {
        const cmd = execFileSync("ps", ["-o", "command=", "-p", String(pid)], {
          encoding: "utf-8",
          timeout: 2000,
        }).trim();
        return cmd.includes("capty-sidecar") || cmd.includes("capty_sidecar");
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

/** Kill the managed sidecar process and any orphan sidecar on the port. */
export function killSidecar(): void {
  // Kill managed process
  if (sidecarProcess) {
    _sidecarPid = sidecarProcess.pid ?? null;
    const proc = sidecarProcess;
    sidecarProcess = null;
    try {
      proc.kill("SIGTERM");
    } catch {
      // already dead
    }
  }
  // Kill orphan sidecar on the port (only if process name matches)
  for (const pid of findSidecarPidsOnPort(_lastSidecarPort)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already dead
    }
  }
}

// Last-resort SIGKILL: `process.on('exit')` fires synchronously right before
// the Node.js event loop stops. Any sidecar that survived SIGTERM gets killed.
process.on("exit", () => {
  if (_sidecarPid) {
    try {
      process.kill(_sidecarPid, "SIGKILL");
    } catch {
      // already dead — expected
    }
    _sidecarPid = null;
  }
});

export function register(deps: IpcDeps): void {
  const { configDir } = deps;

  ipcMain.handle("sidecar:get-url", () => {
    return getSidecarBaseUrl(configDir);
  });

  ipcMain.handle("sidecar:health-check", async () => {
    const url = getSidecarBaseUrl(configDir);
    try {
      const resp = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!resp.ok) return { online: false };
      const data = (await resp.json()) as Record<string, unknown>;
      // Verify this is actually a capty-sidecar (not another service on the port)
      if (data.status !== "ok") return { online: false };
      return { online: true, ...data };
    } catch {
      return { online: false };
    }
  });

  // Start sidecar process
  ipcMain.handle("sidecar:start", async () => {
    // Deduplicate concurrent starts (e.g. React StrictMode double-invoke)
    if (_sidecarStarting) return _sidecarStarting;
    const promise = doStartSidecar(configDir);
    _sidecarStarting = promise;
    try {
      return await promise;
    } finally {
      _sidecarStarting = null;
    }
  });

  // Stop sidecar process (managed + any orphan on the configured port)
  ipcMain.handle("sidecar:stop", () => {
    killSidecar();
    return { ok: true };
  });
}

async function doStartSidecar(
  cfgDir: string,
): Promise<{ ok: boolean; error?: string }> {
  const baseUrl = getSidecarBaseUrl(cfgDir);
  const port = getSidecarPort(cfgDir);

  // Already managed by us
  if (sidecarProcess) return { ok: true };

  // Already running externally? Verify it's actually capty-sidecar.
  try {
    const resp = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (resp.ok) {
      const data = (await resp.json()) as Record<string, unknown>;
      if (data.status === "ok") return { ok: true };
      // Port is occupied by a non-sidecar service
      const msg = `Port ${port} is in use by another service. Change the sidecar port in Settings → General.`;
      console.warn("[sidecar]", msg);
      return { ok: false, error: msg };
    }
  } catch {
    // not running — proceed to spawn
  }

  const bin = findSidecarBin();
  const config = readConfig(cfgDir);
  const dataDir = config.dataDir ?? join(cfgDir, "data");
  const modelsDir = join(dataDir, "models", "asr");

  console.log("[sidecar] binary:", bin, "exists:", fs.existsSync(bin));
  console.log("[sidecar] port:", port, "modelsDir:", modelsDir);

  sidecarProcess = spawn(
    bin,
    ["--models-dir", modelsDir, "--port", String(port)],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  _sidecarPid = sidecarProcess.pid ?? null;

  // Drain stdout so the pipe buffer never fills
  sidecarProcess.stdout?.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) console.log("[sidecar:out]", line);
  });

  // Wait for either early exit/error or successful health check
  const spawnOk = await new Promise<boolean>((resolve) => {
    let resolved = false;
    sidecarProcess!.on("error", (err) => {
      console.error("[sidecar] spawn error:", err.message);
      sidecarProcess = null;
      _sidecarPid = null;
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    });
    sidecarProcess!.on("exit", (code) => {
      console.log("[sidecar] exited early with code", code);
      sidecarProcess = null;
      _sidecarPid = null;
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    });
    // Drain stderr so the pipe buffer never fills
    sidecarProcess!.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) console.error("[sidecar]", line);
    });
    // Give a short grace period for spawn errors
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(true);
      }
    }, 500);
  });

  if (!spawnOk) {
    // Spawn failed — but maybe another sidecar is already running on the port
    // (e.g. orphan from previous session). Check health before giving up.
    try {
      const resp = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) {
        const data = (await resp.json()) as Record<string, unknown>;
        if (data.status === "ok") {
          console.log(
            "[sidecar] spawn failed but existing instance found on port — reusing",
          );
          return { ok: true };
        }
      }
    } catch {
      // no existing instance either
    }
    const msg =
      `Sidecar binary failed to launch: ${bin}` +
      (app.isPackaged
        ? " (packaged mode — run 'npm run dist:all' to include sidecar binary)"
        : " (dev mode — ensure sidecar venv is set up: cd sidecar && uv sync)");
    console.warn("[sidecar]", msg);
    return { ok: false, error: msg };
  }

  // Re-attach exit handler for after the grace period
  sidecarProcess?.on("exit", (code) => {
    console.log("[sidecar] exited with code", code);
    sidecarProcess = null;
    _sidecarPid = null;
  });

  try {
    await waitForHealth(baseUrl, 30000);
  } catch {
    console.warn("[sidecar] health check timed out after launch");
    return { ok: false, error: "Sidecar started but health check timed out" };
  }
  return { ok: true };
}
