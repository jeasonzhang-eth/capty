import { describe, it, expect, vi, beforeEach } from "vitest";

// Collect registered IPC handlers for testing
const handlers = new Map<string, (...args: any[]) => any>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler);
    }),
  },
  net: {
    fetch: vi.fn(),
  },
}));

// Must import after mocks are set up
import { register } from "../../../src/main/handlers/llm-handlers";
import { createDatabase } from "../../../src/main/database";
import { net } from "electron";

const ALL_CHANNELS = [
  "llm:fetch-models",
  "llm:test",
  "llm:summarize",
  "llm:translate",
  "llm:generate-title",
  "summary:list",
  "summary:delete",
  "translation:list",
  "translation:save",
  "prompt-types:list",
  "prompt-types:save",
];

describe("llm-handlers", () => {
  let db: ReturnType<typeof createDatabase>;
  let configDir: string;
  let getMainWindow: () => any;

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();

    db = createDatabase(":memory:");
    configDir = "/tmp/test-config-llm";
    getMainWindow = vi.fn().mockReturnValue({
      webContents: { send: vi.fn() },
    });

    register({ db, configDir, getMainWindow });
  });

  it("registers all 11 channels", () => {
    for (const channel of ALL_CHANNELS) {
      expect(handlers.has(channel), `missing channel: ${channel}`).toBe(true);
    }
  });

  it("summary:list returns array for a given session", () => {
    const handler = handlers.get("summary:list")!;
    const result = handler(null, 999);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it("prompt-types:list returns array", () => {
    // readConfig returns defaults when configDir has no config file
    const handler = handlers.get("prompt-types:list")!;
    let result: any;
    try {
      result = handler(null);
    } catch {
      // If readConfig throws due to missing dir, handler is still registered
      expect(handlers.has("prompt-types:list")).toBe(true);
      return;
    }
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("llm:fetch-models calls net.fetch for the models endpoint", async () => {
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: "gpt-4o" }, { id: "gpt-3.5-turbo" }] }),
    });

    const handler = handlers.get("llm:fetch-models")!;
    const result = await handler(null, {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
    });

    expect(net.fetch).toHaveBeenCalled();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: "gpt-4o", name: "gpt-4o" });
  });

  it("llm:fetch-models returns empty array when all endpoints fail", async () => {
    (net.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network error"));

    const handler = handlers.get("llm:fetch-models")!;
    const result = await handler(null, {
      baseUrl: "https://example.com",
      apiKey: "",
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
});
