import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const invoke = vi.fn();
  const on = vi.fn();
  const removeListener = vi.fn();
  const exposeInMainWorld = vi.fn();
  return {
    invoke,
    on,
    removeListener,
    exposeInMainWorld,
  };
});

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: mocks.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeListener: mocks.removeListener,
  },
}));

describe("preload api", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.invoke.mockReset();
    mocks.on.mockReset();
    mocks.removeListener.mockReset();
    mocks.exposeInMainWorld.mockReset();
    (process as any).contextIsolated = true;
  });

  it("exposes the capty API on window", async () => {
    await import("../../src/preload/index");

    expect(mocks.exposeInMainWorld).toHaveBeenCalledTimes(1);
    expect(mocks.exposeInMainWorld).toHaveBeenCalledWith(
      "capty",
      expect.objectContaining({
        createSession: expect.any(Function),
        changeDataDir: expect.any(Function),
        onDownloadEvent: expect.any(Function),
        onTtsStreamHeader: expect.any(Function),
      }),
    );
  });

  it("forwards invoke calls with the expected channel and arguments", async () => {
    await import("../../src/preload/index");
    const api = mocks.exposeInMainWorld.mock.calls[0][1] as Record<
      string,
      (...args: any[]) => any
    >;

    const fields = { status: "completed" };
    const provider = {
      baseUrl: "http://localhost:8765",
      apiKey: "test-key",
      model: "whisper-base",
    };

    api.createSession("whisper-base");
    api.updateSession(7, fields);
    api.changeDataDir("/tmp/new-data");
    api.transcribeFile("/tmp/audio.wav", provider);

    expect(mocks.invoke).toHaveBeenNthCalledWith(
      1,
      "session:create",
      "whisper-base",
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      "session:update",
      7,
      fields,
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      3,
      "app:change-data-dir",
      "/tmp/new-data",
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      4,
      "audio:transcribe-file",
      "/tmp/audio.wav",
      provider,
    );
  });

  it("registers ipc event listeners and unsubscribes them correctly", async () => {
    await import("../../src/preload/index");
    const api = mocks.exposeInMainWorld.mock.calls[0][1] as Record<
      string,
      (...args: any[]) => any
    >;

    const onDownload = vi.fn();
    const offDownload = api.onDownloadEvent(onDownload);

    expect(mocks.on).toHaveBeenCalledWith(
      "download:progress",
      expect.any(Function),
    );

    const downloadHandler = mocks.on.mock.calls[0][1] as (
      event: unknown,
      data: unknown,
    ) => void;
    const payload = { modelId: "model-a", percent: 50 };
    downloadHandler({}, payload);
    expect(onDownload).toHaveBeenCalledWith(payload);

    offDownload();
    expect(mocks.removeListener).toHaveBeenCalledWith(
      "download:progress",
      downloadHandler,
    );
  });

  it("wraps streaming event helpers consistently", async () => {
    await import("../../src/preload/index");
    const api = mocks.exposeInMainWorld.mock.calls[0][1] as Record<
      string,
      (...args: any[]) => any
    >;

    const onHeader = vi.fn();
    const unsubscribe = api.onTtsStreamHeader(onHeader);

    expect(mocks.on).toHaveBeenCalledWith(
      "tts:stream-header",
      expect.any(Function),
    );

    const headerHandler = mocks.on.mock.calls[0][1] as (
      event: unknown,
      data: unknown,
    ) => void;
    const headerPayload = { streamId: "stream-1", sampleRate: 24000 };
    headerHandler({}, headerPayload);
    expect(onHeader).toHaveBeenCalledWith(headerPayload);

    unsubscribe();
    expect(mocks.removeListener).toHaveBeenCalledWith(
      "tts:stream-header",
      headerHandler,
    );
  });
});
