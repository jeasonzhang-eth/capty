/**
 * Lightweight mock SSE server that mimics an OpenAI-compatible chat/completions
 * endpoint. Sends streaming chunks slowly so E2E tests can trigger actions
 * (e.g., session switching) mid-stream.
 */
import * as http from "node:http";

export interface MockLlmServerOptions {
  /** Words to stream one-by-one as SSE chunks. Default: 5 generic words. */
  readonly words?: string[];
  /** Delay in ms between each chunk. Default: 200. */
  readonly chunkDelayMs?: number;
}

const DEFAULT_WORDS = ["The", "quick", "brown", "fox", "jumps"];

export class MockLlmServer {
  private server: http.Server | null = null;
  private readonly words: string[];
  private readonly chunkDelayMs: number;

  constructor(opts: MockLlmServerOptions = {}) {
    this.words = opts.words ?? DEFAULT_WORDS;
    this.chunkDelayMs = opts.chunkDelayMs ?? 200;
  }

  /** Start the server on a random port. Returns the port number. */
  async start(): Promise<number> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        if (req.method === "POST" && req.url?.includes("/chat/completions")) {
          this.handleStream(res);
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address() as { port: number };
        resolve(addr.port);
      });
    });
  }

  /** Stop the server. */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private handleStream(res: http.ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    let i = 0;
    const send = (): void => {
      if (i < this.words.length) {
        const word = this.words[i];
        const chunk = JSON.stringify({
          model: "mock-model",
          choices: [{ delta: { content: word + " " } }],
        });
        res.write(`data: ${chunk}\n\n`);
        i++;
        setTimeout(send, this.chunkDelayMs);
      } else {
        res.write("data: [DONE]\n\n");
        res.end();
      }
    };

    send();
  }
}
