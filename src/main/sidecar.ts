import { spawn, ChildProcess } from 'child_process'

export class SidecarManager {
  private readonly sidecarPath: string
  private readonly modelsDir: string
  private process: ChildProcess | null = null
  private port: number = 0
  private ready: boolean = false

  constructor(sidecarPath: string, modelsDir: string) {
    this.sidecarPath = sidecarPath
    this.modelsDir = modelsDir
  }

  async start(): Promise<void> {
    this.port = await this.findFreePort()
    this.process = spawn(this.sidecarPath, [
      '--port', String(this.port),
      '--models-dir', this.modelsDir,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })

    this.process.on('exit', () => {
      this.ready = false
    })

    await this.waitForHealthy()
    this.ready = true
  }

  stop(): void {
    if (this.process) {
      this.process.kill()
      this.process = null
    }
    this.ready = false
  }

  async restart(): Promise<void> {
    this.stop()
    await this.start()
  }

  isReady(): boolean {
    return this.ready
  }

  getPort(): number {
    return this.port
  }

  getUrl(): string {
    return `http://localhost:${this.port}`
  }

  private async findFreePort(): Promise<number> {
    const net = await import('net')
    return new Promise((resolve, reject) => {
      const server = net.createServer()
      server.listen(0, () => {
        const addr = server.address()
        if (addr && typeof addr === 'object') {
          const port = addr.port
          server.close(() => resolve(port))
        } else {
          reject(new Error('Failed to get port'))
        }
      })
    })
  }

  private async waitForHealthy(timeoutMs: number = 30000): Promise<void> {
    const startTime = Date.now()
    const pollInterval = 500

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(`http://localhost:${this.port}/health`)
        if (response.ok) {
          return
        }
      } catch {
        // Server not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval))
    }
    throw new Error(`Sidecar failed to become healthy within ${timeoutMs}ms`)
  }
}
