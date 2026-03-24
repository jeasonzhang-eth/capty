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

export class SidecarManager {
  private readonly opts: SidecarOptions;
  private process: ChildProcess | null = null;
  private port: number = 0;
  private ready: boolean = false;

  constructor(opts: SidecarOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    this.port = await this.findFreePort();

    const { command, args } = this.buildCommand();
    this.process = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      console.log("[sidecar]", data.toString().trim());
    });

    this.process.on("exit", (code) => {
      console.log(`[sidecar] exited with code ${code}`);
      this.ready = false;
    });

    await this.waitForHealthy();
    this.ready = true;
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
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
