import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTtsStore, TtsProviderConfig, TtsVoice } from "../../../src/renderer/stores/ttsStore";

const PROVIDER_A: TtsProviderConfig = {
  id: "provider-a",
  name: "Provider A",
  baseUrl: "http://localhost:8080",
  apiKey: "",
  model: "model-a",
  voice: "voice-1",
  isSidecar: true,
};

const PROVIDER_B: TtsProviderConfig = {
  id: "provider-b",
  name: "Provider B",
  baseUrl: "https://api.example.com",
  apiKey: "sk-test",
  model: "model-b",
  voice: "voice-2",
  isSidecar: false,
};

const VOICE_LIST: TtsVoice[] = [
  { id: "v1", name: "Alice", lang: "en", gender: "female" },
  { id: "v2", name: "Bob", lang: "en", gender: "male" },
];

describe("ttsStore", () => {
  beforeEach(() => {
    useTtsStore.setState(useTtsStore.getInitialState());
    vi.clearAllMocks();
  });

  // ── initial state ──────────────────────────────────────────────────────────

  it("has correct initial state", () => {
    const state = useTtsStore.getState();
    expect(state.ttsProviders).toEqual([]);
    expect(state.selectedTtsProviderId).toBeNull();
    expect(state.ttsModels).toEqual([]);
    expect(state.selectedTtsModelId).toBe("");
    expect(state.selectedTtsVoice).toBe("");
    expect(state.ttsVoices).toEqual([]);
  });

  // ── setTtsProviders ────────────────────────────────────────────────────────

  it("setTtsProviders updates providers array", () => {
    useTtsStore.getState().setTtsProviders([PROVIDER_A, PROVIDER_B]);
    expect(useTtsStore.getState().ttsProviders).toEqual([PROVIDER_A, PROVIDER_B]);
  });

  it("setTtsProviders replaces previous providers", () => {
    useTtsStore.getState().setTtsProviders([PROVIDER_A]);
    useTtsStore.getState().setTtsProviders([PROVIDER_B]);
    expect(useTtsStore.getState().ttsProviders).toEqual([PROVIDER_B]);
  });

  // ── setSelectedTtsProviderId ───────────────────────────────────────────────

  it("setSelectedTtsProviderId updates selected provider id", () => {
    useTtsStore.getState().setSelectedTtsProviderId("provider-a");
    expect(useTtsStore.getState().selectedTtsProviderId).toBe("provider-a");
  });

  it("setSelectedTtsProviderId accepts null", () => {
    useTtsStore.getState().setSelectedTtsProviderId("provider-a");
    useTtsStore.getState().setSelectedTtsProviderId(null);
    expect(useTtsStore.getState().selectedTtsProviderId).toBeNull();
  });

  // ── setSelectedTtsModel ───────────────────────────────────────────────────

  it("setSelectedTtsModel updates selectedTtsModelId", () => {
    useTtsStore.getState().setSelectedTtsModel("kokoro-v1");
    expect(useTtsStore.getState().selectedTtsModelId).toBe("kokoro-v1");
  });

  // ── setSelectedTtsVoice ───────────────────────────────────────────────────

  it("setSelectedTtsVoice updates selectedTtsVoice", () => {
    useTtsStore.getState().setSelectedTtsVoice("af_sky");
    expect(useTtsStore.getState().selectedTtsVoice).toBe("af_sky");
  });

  // ── loadVoices ────────────────────────────────────────────────────────────

  it("loadVoices calls window.capty.ttsListVoices and updates ttsVoices", async () => {
    (window.capty.ttsListVoices as ReturnType<typeof vi.fn>).mockResolvedValue({
      voices: VOICE_LIST,
    });

    await useTtsStore.getState().loadVoices();

    expect(window.capty.ttsListVoices).toHaveBeenCalledOnce();
    expect(useTtsStore.getState().ttsVoices).toEqual(VOICE_LIST);
  });

  it("loadVoices defaults selectedTtsVoice to first voice when current voice not in list", async () => {
    useTtsStore.setState({ selectedTtsVoice: "stale-voice" });
    (window.capty.ttsListVoices as ReturnType<typeof vi.fn>).mockResolvedValue({
      voices: VOICE_LIST,
    });

    await useTtsStore.getState().loadVoices();

    expect(useTtsStore.getState().selectedTtsVoice).toBe("v1");
  });

  it("loadVoices does not change selectedTtsVoice when current voice is in list", async () => {
    useTtsStore.setState({ selectedTtsVoice: "v2" });
    (window.capty.ttsListVoices as ReturnType<typeof vi.fn>).mockResolvedValue({
      voices: VOICE_LIST,
    });

    await useTtsStore.getState().loadVoices();

    expect(useTtsStore.getState().selectedTtsVoice).toBe("v2");
  });

  it("loadVoices sets ttsVoices to empty array when ttsListVoices throws", async () => {
    (window.capty.ttsListVoices as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("unavailable"),
    );

    await useTtsStore.getState().loadVoices();

    expect(useTtsStore.getState().ttsVoices).toEqual([]);
  });

  // ── saveTtsSettings ───────────────────────────────────────────────────────

  it("saveTtsSettings calls window.capty.saveTtsSettings with merged payload", async () => {
    useTtsStore.setState({ selectedTtsModelId: "kokoro-v1" });
    (window.capty.saveTtsSettings as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await useTtsStore.getState().saveTtsSettings({
      ttsProviders: [PROVIDER_A],
      selectedTtsProviderId: "provider-a",
    });

    expect(window.capty.saveTtsSettings).toHaveBeenCalledOnce();
    expect(window.capty.saveTtsSettings).toHaveBeenCalledWith({
      ttsProviders: [PROVIDER_A],
      selectedTtsProviderId: "provider-a",
      selectedTtsModelId: "kokoro-v1",
    });
  });

  it("saveTtsSettings updates ttsProviders and selectedTtsProviderId in state", async () => {
    (window.capty.saveTtsSettings as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await useTtsStore.getState().saveTtsSettings({
      ttsProviders: [PROVIDER_A, PROVIDER_B],
      selectedTtsProviderId: "provider-b",
    });

    const state = useTtsStore.getState();
    expect(state.ttsProviders).toEqual([PROVIDER_A, PROVIDER_B]);
    expect(state.selectedTtsProviderId).toBe("provider-b");
  });

  it("saveTtsSettings persists explicit selectedTtsModelId override", async () => {
    (window.capty.saveTtsSettings as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await useTtsStore.getState().saveTtsSettings({
      ttsProviders: [PROVIDER_A],
      selectedTtsProviderId: "provider-a",
      selectedTtsModelId: "kokoro-v2",
    });

    expect(useTtsStore.getState().selectedTtsModelId).toBe("kokoro-v2");
    expect(window.capty.saveTtsSettings).toHaveBeenCalledWith(
      expect.objectContaining({ selectedTtsModelId: "kokoro-v2" }),
    );
  });

  // ── reset ─────────────────────────────────────────────────────────────────

  it("reset restores initial state", () => {
    useTtsStore.getState().setTtsProviders([PROVIDER_A]);
    useTtsStore.getState().setSelectedTtsProviderId("provider-a");
    useTtsStore.getState().setSelectedTtsModel("kokoro-v1");
    useTtsStore.getState().setSelectedTtsVoice("af_sky");

    useTtsStore.getState().reset();

    const state = useTtsStore.getState();
    expect(state.ttsProviders).toEqual([]);
    expect(state.selectedTtsProviderId).toBeNull();
    expect(state.selectedTtsModelId).toBe("");
    expect(state.selectedTtsVoice).toBe("");
  });
});
