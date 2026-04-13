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

vi.mock("../../../src/main/config", () => ({
  readConfig: vi.fn().mockReturnValue({
    sidecar: { port: 8765 },
    selectedModelId: "whisper-base",
    dataDir: "/tmp/test-data",
  }),
}));

vi.mock("../../../src/main/audio-files", () => ({
  pcmToWav: vi.fn((pcmBuffer: Buffer) => {
    const header = Buffer.alloc(44, 0);
    return Buffer.concat([header, pcmBuffer]);
  }),
}));

vi.mock("../../../src/main/shared/spawn", () => ({
  spawn: vi.fn(),
}));

// Must import after mocks are set up
import { register } from "../../../src/main/handlers/asr-handlers";
import { net } from "electron";

// Typed reference to the mocked net.fetch
const mockNetFetch = net.fetch as ReturnType<typeof vi.fn>;

function createMockDeps() {
  return {
    db: {} as any,
    configDir: "/tmp/test-config",
    getMainWindow: vi.fn().mockReturnValue(null),
  };
}

describe("asr-handlers", () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    mockNetFetch.mockReset();
    register(createMockDeps());
  });

  describe("channel registration", () => {
    it("registers asr:fetch-models", () => {
      expect(handlers.has("asr:fetch-models")).toBe(true);
    });

    it("registers asr:test", () => {
      expect(handlers.has("asr:test")).toBe(true);
    });

    it("registers asr:transcribe", () => {
      expect(handlers.has("asr:transcribe")).toBe(true);
    });

    it("registers audio:transcribe-file", () => {
      expect(handlers.has("audio:transcribe-file")).toBe(true);
    });
  });

  describe("asr:fetch-models", () => {
    it("calls sidecar URL correctly and returns models list", async () => {
      const models = [
        { id: "whisper-base", name: "Whisper Base", downloaded: true },
        { id: "whisper-small", name: "Whisper Small", downloaded: true },
      ];
      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce(models),
      });

      const handler = handlers.get("asr:fetch-models")!;
      const result = await handler(
        {},
        { baseUrl: "http://localhost:8765", apiKey: "" },
      );

      expect(mockNetFetch).toHaveBeenCalledWith(
        "http://localhost:8765/models",
        expect.objectContaining({ headers: {} }),
      );
      expect(result).toEqual([
        { id: "whisper-base", name: "Whisper Base" },
        { id: "whisper-small", name: "Whisper Small" },
      ]);
    });

    it("falls back to /v1/models if /models fails", async () => {
      const models = { data: [{ id: "gpt-4o-audio" }, { id: "whisper-1" }] };
      // First call (to /models) fails, second call (to /v1/models) succeeds
      mockNetFetch.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce(models),
      });

      const handler = handlers.get("asr:fetch-models")!;
      const result = await handler(
        {},
        { baseUrl: "http://external:8080", apiKey: "sk-test" },
      );

      expect(result).toEqual([
        { id: "gpt-4o-audio", name: "gpt-4o-audio" },
        { id: "whisper-1", name: "whisper-1" },
      ]);
    });

    it("returns empty array when all endpoints fail", async () => {
      mockNetFetch.mockResolvedValue({ ok: false });

      const handler = handlers.get("asr:fetch-models")!;
      const result = await handler(
        {},
        { baseUrl: "http://bad-host", apiKey: "" },
      );

      expect(result).toEqual([]);
    });

    it("filters out models with downloaded=false", async () => {
      const models = [
        { id: "whisper-base", downloaded: true },
        { id: "whisper-large", downloaded: false },
      ];
      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce(models),
      });

      const handler = handlers.get("asr:fetch-models")!;
      const result = await handler(
        {},
        { baseUrl: "http://localhost:8765", apiKey: "" },
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("whisper-base");
    });

    it("strips /v1 suffix from baseUrl", async () => {
      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce([]),
      });

      const handler = handlers.get("asr:fetch-models")!;
      await handler({}, { baseUrl: "http://localhost:8765/v1", apiKey: "" });

      expect(mockNetFetch).toHaveBeenCalledWith(
        "http://localhost:8765/models",
        expect.any(Object),
      );
    });

    it("includes Authorization header when apiKey is provided", async () => {
      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce([]),
      });

      const handler = handlers.get("asr:fetch-models")!;
      await handler(
        {},
        { baseUrl: "http://external:8080", apiKey: "my-secret-key" },
      );

      expect(mockNetFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: { Authorization: "Bearer my-secret-key" },
        }),
      );
    });
  });

  describe("asr:transcribe", () => {
    it("posts WAV audio to the transcription endpoint", async () => {
      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({ text: "hello world" }),
      });

      const handler = handlers.get("asr:transcribe")!;
      const pcmData = Buffer.alloc(100).buffer;
      const result = await handler({}, pcmData, {
        baseUrl: "http://localhost:8765",
        apiKey: "",
        model: "whisper-base",
      });

      expect(mockNetFetch).toHaveBeenCalledWith(
        "http://localhost:8765/v1/audio/transcriptions",
        expect.objectContaining({ method: "POST" }),
      );
      expect(result).toEqual({ text: "hello world" });
    });

    it("throws on non-ok response", async () => {
      mockNetFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValueOnce("Internal Server Error"),
      });

      const handler = handlers.get("asr:transcribe")!;
      const pcmData = Buffer.alloc(100).buffer;

      await expect(
        handler({}, pcmData, {
          baseUrl: "http://localhost:8765",
          apiKey: "",
          model: "whisper-base",
        }),
      ).rejects.toThrow("ASR API error (500)");
    });
  });

  describe("asr:test", () => {
    it("returns success when transcription succeeds", async () => {
      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({ text: "la la la" }),
      });

      const handler = handlers.get("asr:test")!;
      const result = await handler(
        {},
        {
          baseUrl: "http://external:8080",
          apiKey: "",
          model: "whisper-1",
          isSidecar: false,
        },
      );

      expect(result).toEqual({ success: true, text: "la la la" });
    });

    it("returns failure object on HTTP error instead of throwing", async () => {
      mockNetFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: vi.fn().mockResolvedValueOnce("Service Unavailable"),
      });

      const handler = handlers.get("asr:test")!;
      const result = await handler(
        {},
        {
          baseUrl: "http://external:8080",
          apiKey: "",
          model: "whisper-1",
          isSidecar: false,
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/503/);
    });

    it("returns failure when no model selected for sidecar without configured model", async () => {
      const { readConfig } = await import("../../../src/main/config");
      // getSidecarBaseUrl calls readConfig once for the port, then the handler
      // calls it again for selectedModelId — supply two responses in order
      (readConfig as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({
          sidecar: { port: 8765 },
          dataDir: "/tmp/test-data",
        })
        .mockReturnValueOnce({
          sidecar: { port: 8765 },
          selectedModelId: null,
          dataDir: "/tmp/test-data",
        });

      const handler = handlers.get("asr:test")!;
      const result = await handler(
        {},
        { baseUrl: "", apiKey: "", model: "", isSidecar: true },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No ASR model/i);
    });
  });

  describe("audio:transcribe-file", () => {
    it("posts file path to sidecar transcribe-file endpoint", async () => {
      const responseData = {
        text: "transcribed text",
        segments: [{ start: 0, end: 1, text: "transcribed text" }],
        duration: 1.5,
      };
      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce(responseData),
      });

      const handler = handlers.get("audio:transcribe-file")!;
      const result = await handler({}, "/path/to/audio.wav", {
        baseUrl: "http://localhost:8765",
        apiKey: "",
        model: "whisper-base",
      });

      expect(mockNetFetch).toHaveBeenCalledWith(
        "http://localhost:8765/v1/audio/transcribe-file",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        }),
      );
      expect(result).toEqual({
        text: "transcribed text",
        segments: [{ start: 0, end: 1, text: "transcribed text" }],
        duration: 1.5,
      });
    });

    it("throws on non-ok response", async () => {
      mockNetFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: vi.fn().mockResolvedValueOnce("Unprocessable Entity"),
      });

      const handler = handlers.get("audio:transcribe-file")!;

      await expect(
        handler({}, "/path/to/audio.mp3", {
          baseUrl: "http://localhost:8765",
          apiKey: "",
          model: "whisper-base",
        }),
      ).rejects.toThrow("Transcribe file error (422)");
    });
  });
});
