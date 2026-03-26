import { spawn, ChildProcess } from "child_process";
import { join } from "path";
import { existsSync } from "fs";

export interface SidecarOptions {
  /** In dev mode, path to the sidecar Python project root (contains .venv) */
  readonly sidecarDir: string;
  /** Directory where downloaded ASR models live */
  readonly modelsDir: string;
  /** Whether the app is running in development mode */
  readonly isDev: boolean;
}

/** Max auto-restart attempts before giving up */
const MAX_RESTART_ATTEMPTS = 5;

/** Base delay between restarts (doubles each attempt) */
const RESTART_BASE_DELAY_MS = 1000;

/** Reset the restart counter after this many ms of stable running */
const STABLE_THRESHOLD_MS = 60_000;

export class SidecarManager {
  private readonly opts: SidecarOptions;
  private process: ChildProcess | null = null;
  private port: number = 0;
  private ready: boolean = false;
  private intentionalStop: boolean = false;
  private restartAttempts: number = 0;
  private lastStartTime: number = 0;

  constructor(opts: SidecarOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    this.intentionalStop = false;
    this.port = await this.findFreePort();
    await this.spawnProcess();
  }

  stop(): void {
    this.intentionalStop = true;
    this.killProcess();
    this.ready = false;
  }

  async restart(): Promise<void> {
    this.stop();
    await this.start();
  }

  isReady(): boolean {
    return this.ready;
  }

  getPort(): number {
    return this.port;
  }

  getUrl(): string {
    return `http://localhost:${this.port}`;
  }

  private async spawnProcess(): Promise<void> {
    const { command, args } = this.buildCommand();
    this.process = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.lastStartTime = Date.now();

    this.process.stderr?.on("data", (data: Buffer) => {
      console.log("[sidecar]", data.toString().trim());
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      console.log("[sidecar]", data.toString().trim());
    });

    this.process.on("exit", (code, signal) => {
      console.log(
        `[sidecar] exited with code ${code}${signal ? ` (signal: ${signal})` : ""}`,
      );
      this.ready = false;
      this.process = null;

      if (!this.intentionalStop) {
        this.scheduleRestart();
      }
    });

    await this.waitForHealthy();
    this.ready = true;
  }

  private scheduleRestart(): void {
    // If the process ran stably for a while, reset the counter
    const uptime = Date.now() - this.lastStartTime;
    if (uptime >= STABLE_THRESHOLD_MS) {
      this.restartAttempts = 0;
    }

    if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      console.error(
        `[sidecar] Exceeded max restart attempts (${MAX_RESTART_ATTEMPTS}). Giving up.`,
      );
      return;
    }

    this.restartAttempts++;
    const delay = RESTART_BASE_DELAY_MS * Math.pow(2, this.restartAttempts - 1);
    console.log(
      `[sidecar] Auto-restarting in ${delay}ms (attempt ${this.restartAttempts}/${MAX_RESTART_ATTEMPTS})...`,
    );

    setTimeout(async () => {
      if (this.intentionalStop) return;
      try {
        // Reuse the same port so existing connections can reconnect
        await this.spawnProcess();
        console.log("[sidecar] Restarted successfully");
      } catch (err) {
        console.error("[sidecar] Restart failed:", err);
        this.scheduleRestart();
      }
    }, delay);
  }

  private killProcess(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  private buildCommand(): { command: string; args: string[] } {
    const runArgs = [
      "--port",
      String(this.port),
      "--models-dir",
      this.opts.modelsDir,
    ];

    if (this.opts.isDev) {
      // Dev mode: use the venv Python to run the module
      const venvPython = join(this.opts.sidecarDir, ".venv", "bin", "python");
      if (existsSync(venvPython)) {
        return {
          command: venvPython,
          args: ["-m", "capty_sidecar.main", ...runArgs],
        };
      }
      // Fallback: system python
      return {
        command: "python3",
        args: ["-m", "capty_sidecar.main", ...runArgs],
      };
    }

    // Production: bundled executable
    const bundledPath = join(this.opts.sidecarDir, "capty-sidecar");
    return { command: bundledPath, args: runArgs };
  }

  private async findFreePort(): Promise<number> {
    const net = await import("net");
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          const port = addr.port;
          server.close(() => resolve(port));
        } else {
          reject(new Error("Failed to get port"));
        }
      });
    });
  }

  private async waitForHealthy(timeoutMs: number = 30000): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 500;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(
          `http://localhost:${this.port}/health`,
        );
        if (response.ok) {
          return;
        }
      } catch {
        // Server not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
    throw new Error(
      `Sidecar failed to become healthy within ${timeoutMs}ms`,
    );
  }
}
