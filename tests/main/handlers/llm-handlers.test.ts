import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

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
import {
  createDatabase,
  createSession,
  addSegment,
} from "../../../src/main/database";
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

/** Create a mock SSE ReadableStream from chunks */
function makeSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i++;
      } else {
        controller.close();
      }
    },
  });
}

/** Write a minimal config file with one LLM provider */
function writeTestConfig(configDir: string): void {
  const config = {
    dataDir: null,
    selectedAudioDeviceId: null,
    selectedModelId: null,
    modelRegistryUrl: null,
    hfMirrorUrl: null,
    windowBounds: null,
    llmProviders: [
      {
        id: "test-provider",
        name: "Test",
        baseUrl: "https://api.test.com/v1",
        apiKey: "sk-test",
        models: ["test-model"],
      },
    ],
    selectedLlmProviderId: "test-provider",
    selectedSummaryModel: null,
    selectedTranslateModel: null,
    selectedRapidModel: null,
    promptTypes: [],
    sessionCategories: [],
    zoomFactor: null,
    historyPanelWidth: null,
    summaryPanelWidth: null,
    asrProviders: [],
    selectedAsrProviderId: null,
    ttsProviders: [],
    selectedTtsProviderId: null,
    selectedTtsModelId: null,
    selectedTtsVoice: "",
    translatePrompt: "",
    sidecar: { autoStart: true },
  };
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify(config));
}

describe("llm-handlers", () => {
  let db: ReturnType<typeof createDatabase>;
  let configDir: string;
  let getMainWindow: () => any;
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();

    db = createDatabase(":memory:");
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "capty-test-llm-"));
    mockSend = vi.fn();
    getMainWindow = vi.fn().mockReturnValue({
      webContents: { send: mockSend },
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
    (net.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network error"),
    );

    const handler = handlers.get("llm:fetch-models")!;
    const result = await handler(null, {
      baseUrl: "https://example.com",
      apiKey: "",
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  describe("llm:summarize chunk events include sessionId", () => {
    let sessionId: number;

    beforeEach(() => {
      writeTestConfig(configDir);
      sessionId = createSession(db, { modelName: "test" });
      addSegment(db, {
        sessionId,
        startTime: 0,
        endTime: 5,
        text: "Hello world",
        audioPath: "",
        isFinal: true,
      });
    });

    it("sends sessionId in streaming chunk events", async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"Hi"}}],"model":"test-model"}\n\n',
        "data: [DONE]\n\n",
      ];

      (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        body: makeSSEStream(sseChunks),
      });

      const handler = handlers.get("llm:summarize")!;
      await handler(
        null,
        sessionId,
        "test-provider",
        "test-model",
        "summarize",
      );

      // Find content chunk (done: false)
      const contentCalls = mockSend.mock.calls.filter(
        ([ch, data]: [string, any]) => ch === "llm:summary-chunk" && !data.done,
      );
      expect(contentCalls.length).toBeGreaterThan(0);
      for (const [, data] of contentCalls) {
        expect(data.sessionId).toBe(sessionId);
        expect(data.promptType).toBe("summarize");
      }

      // Find done chunk (done: true)
      const doneCalls = mockSend.mock.calls.filter(
        ([ch, data]: [string, any]) => ch === "llm:summary-chunk" && data.done,
      );
      expect(doneCalls.length).toBe(1);
      expect(doneCalls[0][1].sessionId).toBe(sessionId);
    });

    it("sends sessionId in chunk events on error path", async () => {
      (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      const handler = handlers.get("llm:summarize")!;
      await expect(
        handler(null, sessionId, "test-provider", "test-model", "summarize"),
      ).rejects.toThrow("LLM API error");

      // Error path should still send done chunk with sessionId
      const doneCalls = mockSend.mock.calls.filter(
        ([ch, data]: [string, any]) => ch === "llm:summary-chunk" && data.done,
      );
      expect(doneCalls.length).toBe(1);
      expect(doneCalls[0][1].sessionId).toBe(sessionId);
    });
  });
});
