/**
 * Store integration tests — verify cross-store data flow and interactions.
 *
 * These tests exercise the same IPC mock layer as unit tests but focus on
 * multi-store scenarios that unit tests intentionally skip:
 *   - Config loading populating downstream stores
 *   - Session + settings category compatibility
 *   - Download badge computation from realistic data
 *   - Summary streaming lifecycle across store boundaries
 *   - Translation progress + abort flow
 *   - Store reset isolation
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { useAppStore } from "../../../src/renderer/stores/appStore";
import { useSettingsStore } from "../../../src/renderer/stores/settingsStore";
import { useDownloadStore } from "../../../src/renderer/stores/downloadStore";
import { useSummaryStore } from "../../../src/renderer/stores/summaryStore";
import { useTranslationStore } from "../../../src/renderer/stores/translationStore";
import { useTtsStore } from "../../../src/renderer/stores/ttsStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Typed mock helper to reduce repetitive casts. */
function mockIpc<T>(method: unknown): ReturnType<typeof vi.fn<() => Promise<T>>> {
  return method as ReturnType<typeof vi.fn>;
}

// ---------------------------------------------------------------------------
// Reset all stores + mocks before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState());
  useSettingsStore.setState(useSettingsStore.getInitialState());
  useDownloadStore.setState(useDownloadStore.getInitialState());
  useSummaryStore.setState(useSummaryStore.getInitialState());
  useTranslationStore.setState(useTranslationStore.getInitialState());
  useTtsStore.setState(useTtsStore.getInitialState());
  vi.clearAllMocks();
});

// ===========================================================================
// 1. Config Loading Chain
// ===========================================================================
describe("config loading chain", () => {
  const MOCK_CONFIG = {
    historyPanelWidth: 280,
    summaryPanelWidth: 350,
    hfMirrorUrl: "https://hf-mirror.com",
    llmProviders: [
      {
        id: "openai",
        name: "OpenAI",
        baseUrl: "https://api.openai.com",
        apiKey: "sk-test",
        model: "gpt-4",
        models: ["gpt-4", "gpt-3.5-turbo"],
        isPreset: true,
      },
      {
        id: "anthropic",
        name: "Anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-ant",
        model: "claude-3-opus",
        models: ["claude-3-opus", "claude-3-sonnet"],
        isPreset: true,
      },
    ],
    selectedSummaryModel: { providerId: "openai", model: "gpt-4" },
    selectedTranslateModel: { providerId: "anthropic", model: "claude-3-sonnet" },
    selectedRapidModel: { providerId: "openai", model: "gpt-3.5-turbo" },
    rapidRenamePrompt: "Generate a concise title",
    translatePrompt: "Translate {{text}} to {{target_language}}",
    sidecar: { port: 8765, autoStart: true },
  };

  const MOCK_CATEGORIES = [
    { id: "recording", label: "Recordings", icon: "●", isBuiltin: true },
    { id: "meeting", label: "Meetings", icon: "◎", isBuiltin: true },
    { id: "custom-1", label: "Lectures", icon: "📖", isBuiltin: false },
  ];

  const MOCK_PROMPT_TYPES = [
    { id: "summarize", label: "Summary", systemPrompt: "Summarize this meeting", isBuiltin: true },
    { id: "action-items", label: "Action Items", systemPrompt: "List action items", isBuiltin: false },
  ];

  function seedConfigMocks(): void {
    mockIpc(window.capty.getConfig).mockResolvedValue(MOCK_CONFIG);
    mockIpc(window.capty.getZoomFactor).mockResolvedValue(1.25);
    mockIpc(window.capty.getConfigDir).mockResolvedValue("/home/.config/capty");
    mockIpc(window.capty.listPromptTypes).mockResolvedValue(MOCK_PROMPT_TYPES);
    mockIpc(window.capty.listSessionCategories).mockResolvedValue(MOCK_CATEGORIES);
  }

  it("loadConfig populates settingsStore with all downstream data", async () => {
    seedConfigMocks();

    await useSettingsStore.getState().loadConfig();

    const s = useSettingsStore.getState();
    // Layout widths
    expect(s.historyPanelWidth).toBe(280);
    expect(s.summaryPanelWidth).toBe(350);
    // HF mirror
    expect(s.hfMirrorUrl).toBe("https://hf-mirror.com");
    // LLM providers
    expect(s.llmProviders).toHaveLength(2);
    expect(s.llmProviders[0].id).toBe("openai");
    expect(s.llmProviders[1].id).toBe("anthropic");
    // Model selections
    expect(s.selectedSummaryModel).toEqual({ providerId: "openai", model: "gpt-4" });
    expect(s.selectedTranslateModel).toEqual({ providerId: "anthropic", model: "claude-3-sonnet" });
    expect(s.selectedRapidModel).toEqual({ providerId: "openai", model: "gpt-3.5-turbo" });
    // Prompts
    expect(s.rapidRenamePrompt).toBe("Generate a concise title");
    expect(s.translatePrompt).toContain("{{text}}");
    // Sidecar
    expect(s.autoStartSidecar).toBe(true);
    // Zoom
    expect(s.zoomFactor).toBe(1.25);
    // Config dir
    expect(s.configDir).toBe("/home/.config/capty");
    // Categories
    expect(s.sessionCategories).toHaveLength(3);
    expect(s.sessionCategories.map((c) => c.id)).toEqual(["recording", "meeting", "custom-1"]);
    // Prompt types
    expect(s.promptTypes).toHaveLength(2);
    expect(s.promptTypes[0].id).toBe("summarize");
  });

  it("sessionCategories are available for HistoryPanel groupByCategory after loadConfig", async () => {
    seedConfigMocks();

    await useSettingsStore.getState().loadConfig();

    const categories = useSettingsStore.getState().sessionCategories;
    // Simulate what HistoryPanel's groupByCategory does: filter sessions by category
    const sessions = [
      { id: 1, title: "Meeting 1", category: "meeting", sort_order: 0 },
      { id: 2, title: "Recording 1", category: "recording", sort_order: 0 },
      { id: 3, title: "Lecture 1", category: "custom-1", sort_order: 0 },
      { id: 4, title: "Recording 2", category: "recording", sort_order: 0 },
    ];

    const grouped = categories.map((cat) => ({
      categoryId: cat.id,
      sessions: sessions.filter((s) => s.category === cat.id),
    }));

    expect(grouped).toHaveLength(3);
    expect(grouped[0].categoryId).toBe("recording");
    expect(grouped[0].sessions).toHaveLength(2);
    expect(grouped[1].categoryId).toBe("meeting");
    expect(grouped[1].sessions).toHaveLength(1);
    expect(grouped[2].categoryId).toBe("custom-1");
    expect(grouped[2].sessions).toHaveLength(1);
  });

  it("llmProviders from loadConfig are usable for model selection", async () => {
    seedConfigMocks();

    await useSettingsStore.getState().loadConfig();

    const { llmProviders, selectedSummaryModel } = useSettingsStore.getState();

    // Verify the selected provider actually exists in the providers list
    const matchedProvider = llmProviders.find(
      (p) => p.id === selectedSummaryModel?.providerId,
    );
    expect(matchedProvider).toBeDefined();
    expect(matchedProvider!.name).toBe("OpenAI");

    // Verify the selected model is in the provider's model list
    expect(matchedProvider!.models).toContain(selectedSummaryModel!.model);
  });
});

// ===========================================================================
// 2. Session + Settings Interaction
// ===========================================================================
describe("session + settings interaction", () => {
  it("sessions loaded via appStore are groupable by settingsStore categories", async () => {
    // Seed settings categories
    const categories = [
      { id: "recording", label: "Recordings", icon: "●", isBuiltin: true },
      { id: "meeting", label: "Meetings", icon: "◎", isBuiltin: true },
    ];
    useSettingsStore.getState().setSessionCategories(categories);

    // Seed sessions via IPC mock
    const mockSessions = [
      { id: 1, title: "Stand-up", started_at: "2026-04-15T09:00:00Z", duration_seconds: 600, model_name: "whisper", status: "completed", category: "meeting", sort_order: 0 },
      { id: 2, title: "Dictation", started_at: "2026-04-15T10:00:00Z", duration_seconds: 120, model_name: "whisper", status: "completed", category: "recording", sort_order: 1 },
      { id: 3, title: "Sprint Review", started_at: "2026-04-15T14:00:00Z", duration_seconds: 1800, model_name: "whisper", status: "completed", category: "meeting", sort_order: 2 },
    ];
    mockIpc(window.capty.listSessions).mockResolvedValue(mockSessions);

    await useAppStore.getState().loadSessions();

    const sessions = useAppStore.getState().sessions;
    const cats = useSettingsStore.getState().sessionCategories;

    expect(sessions).toHaveLength(3);

    // Group sessions the same way HistoryPanel does
    const grouped = cats.map((cat) => ({
      category: cat,
      sessions: sessions.filter((s) => (s.category || "recording") === cat.id),
    }));

    expect(grouped[0].category.label).toBe("Recordings");
    expect(grouped[0].sessions).toHaveLength(1);
    expect(grouped[1].category.label).toBe("Meetings");
    expect(grouped[1].sessions).toHaveLength(2);
  });

  it("sessions with missing category default to 'recording'", async () => {
    useSettingsStore.getState().setSessionCategories([
      { id: "recording", label: "Recordings", icon: "●", isBuiltin: true },
    ]);

    const mockSessions = [
      { id: 1, title: "Untitled", started_at: "2026-04-15T09:00:00Z", duration_seconds: 60, model_name: "whisper", status: "completed", category: "", sort_order: 0 },
    ];
    mockIpc(window.capty.listSessions).mockResolvedValue(mockSessions);

    await useAppStore.getState().loadSessions();

    const sessions = useAppStore.getState().sessions;
    const cats = useSettingsStore.getState().sessionCategories;

    // The groupByCategory logic uses: (s.category || "recording")
    const recordingCat = cats.find((c) => c.id === "recording")!;
    const filtered = sessions.filter(
      (s) => (s.category || "recording") === recordingCat.id,
    );
    expect(filtered).toHaveLength(1);
  });
});

// ===========================================================================
// 3. Download Badge Computation
// ===========================================================================
describe("download badge computation", () => {
  it("returns 'active' when there are active audio downloads", () => {
    const items = [
      { id: 1, url: "https://example.com/a.mp3", title: "Audio 1", source: null, status: "downloading", progress: 50, speed: "1.2 MB/s", eta: "00:30", session_id: null, error: null, created_at: "2026-04-15T10:00:00Z", completed_at: null },
      { id: 2, url: "https://example.com/b.mp3", title: "Audio 2", source: null, status: "completed", progress: 100, speed: null, eta: null, session_id: 1, error: null, created_at: "2026-04-15T09:00:00Z", completed_at: "2026-04-15T09:05:00Z" },
    ];

    useDownloadStore.getState().setAudioDownloads(items);

    expect(useDownloadStore.getState().downloadBadge).toBe("active");
  });

  it("returns 'failed' when there are failed but no active downloads", () => {
    const items = [
      { id: 1, url: "https://example.com/a.mp3", title: "Audio 1", source: null, status: "failed", progress: 0, speed: null, eta: null, session_id: null, error: "network timeout", created_at: "2026-04-15T10:00:00Z", completed_at: null },
      { id: 2, url: "https://example.com/b.mp3", title: "Audio 2", source: null, status: "completed", progress: 100, speed: null, eta: null, session_id: 1, error: null, created_at: "2026-04-15T09:00:00Z", completed_at: "2026-04-15T09:05:00Z" },
    ];

    useDownloadStore.getState().setAudioDownloads(items);

    expect(useDownloadStore.getState().downloadBadge).toBe("failed");
  });

  it("returns null when all downloads are completed", () => {
    const items = [
      { id: 1, url: "https://example.com/a.mp3", title: "Audio 1", source: null, status: "completed", progress: 100, speed: null, eta: null, session_id: 1, error: null, created_at: "2026-04-15T09:00:00Z", completed_at: "2026-04-15T09:05:00Z" },
    ];

    useDownloadStore.getState().setAudioDownloads(items);

    expect(useDownloadStore.getState().downloadBadge).toBeNull();
  });

  it("computeBadge recalculates from current audioDownloads state", () => {
    // Start with an active download
    const items = [
      { id: 1, url: "https://example.com/a.mp3", title: "Audio 1", source: null, status: "downloading", progress: 50, speed: "1.0 MB/s", eta: "00:10", session_id: null, error: null, created_at: "2026-04-15T10:00:00Z", completed_at: null },
    ];
    useDownloadStore.getState().setAudioDownloads(items);
    expect(useDownloadStore.getState().downloadBadge).toBe("active");

    // Manually override badge to null (simulating stale state)
    useDownloadStore.setState({ downloadBadge: null });
    expect(useDownloadStore.getState().downloadBadge).toBeNull();

    // computeBadge should restore the correct value
    useDownloadStore.getState().computeBadge();
    expect(useDownloadStore.getState().downloadBadge).toBe("active");
  });

  it("loadAudioDownloads fetches from IPC and updates badge", async () => {
    const items = [
      { id: 1, url: "https://example.com/a.mp3", title: "Audio 1", source: null, status: "fetching-info", progress: 0, speed: null, eta: null, session_id: null, error: null, created_at: "2026-04-15T10:00:00Z", completed_at: null },
    ];
    mockIpc(window.capty.getAudioDownloads).mockResolvedValue(items);

    await useDownloadStore.getState().loadAudioDownloads();

    expect(useDownloadStore.getState().audioDownloads).toHaveLength(1);
    expect(useDownloadStore.getState().downloadBadge).toBe("active");
  });

  it("'pending' and 'converting' statuses count as active", () => {
    const items = [
      { id: 1, url: "https://example.com/a.mp3", title: null, source: null, status: "pending", progress: 0, speed: null, eta: null, session_id: null, error: null, created_at: "2026-04-15T10:00:00Z", completed_at: null },
    ];
    useDownloadStore.getState().setAudioDownloads(items);
    expect(useDownloadStore.getState().downloadBadge).toBe("active");

    const items2 = [
      { id: 2, url: "https://example.com/b.mp3", title: null, source: null, status: "converting", progress: 90, speed: null, eta: null, session_id: null, error: null, created_at: "2026-04-15T10:00:00Z", completed_at: null },
    ];
    useDownloadStore.getState().setAudioDownloads(items2);
    expect(useDownloadStore.getState().downloadBadge).toBe("active");
  });
});

// ===========================================================================
// 4. Summary Generation Flow
// ===========================================================================
describe("summary generation flow", () => {
  it("full streaming lifecycle: start → append chunks → stop", () => {
    const store = useSummaryStore.getState;

    // Start generation for "summarize"
    store().startGeneration("summarize");
    expect(store().generatingTabs.has("summarize")).toBe(true);
    expect(store().streamingContentMap["summarize"]).toBe("");

    // Append streaming chunks
    store().appendStreamContent("summarize", "This is ");
    expect(store().streamingContentMap["summarize"]).toBe("This is ");

    store().appendStreamContent("summarize", "a summary.");
    expect(store().streamingContentMap["summarize"]).toBe("This is a summary.");

    // Stop generation
    store().stopGeneration("summarize");
    expect(store().generatingTabs.has("summarize")).toBe(false);
    expect(store().streamingContentMap["summarize"]).toBeUndefined();
  });

  it("multiple prompt types can stream concurrently", () => {
    const store = useSummaryStore.getState;

    store().startGeneration("summarize");
    store().startGeneration("action-items");

    store().appendStreamContent("summarize", "Summary chunk");
    store().appendStreamContent("action-items", "Action chunk");

    expect(store().generatingTabs.size).toBe(2);
    expect(store().streamingContentMap["summarize"]).toBe("Summary chunk");
    expect(store().streamingContentMap["action-items"]).toBe("Action chunk");

    // Stop one, the other remains
    store().stopGeneration("summarize");
    expect(store().generatingTabs.has("summarize")).toBe(false);
    expect(store().generatingTabs.has("action-items")).toBe(true);
    expect(store().streamingContentMap["action-items"]).toBe("Action chunk");
  });

  it("loadSummaries calls IPC with active prompt type", async () => {
    const mockSummaries = [
      { id: 1, session_id: 42, content: "Meeting summary", model_name: "gpt-4", provider_id: "openai", prompt_type: "summarize", created_at: "2026-04-15T10:00:00Z" },
    ];
    mockIpc(window.capty.listSummaries).mockResolvedValue(mockSummaries);

    // Set active prompt type first
    useSummaryStore.getState().setActivePromptType("summarize");

    await useSummaryStore.getState().loadSummaries(42);

    expect(window.capty.listSummaries).toHaveBeenCalledWith(42, "summarize");
    expect(useSummaryStore.getState().summaries).toHaveLength(1);
    expect(useSummaryStore.getState().summaries[0].content).toBe("Meeting summary");
    expect(useSummaryStore.getState().generateError).toBeNull();
  });

  it("error state can be set and cleared independently of generation", () => {
    useSummaryStore.getState().setError("Provider rate limited");
    expect(useSummaryStore.getState().generateError).toBe("Provider rate limited");

    useSummaryStore.getState().clearError();
    expect(useSummaryStore.getState().generateError).toBeNull();
  });

  it("reset clears all generation state", () => {
    useSummaryStore.getState().startGeneration("summarize");
    useSummaryStore.getState().appendStreamContent("summarize", "partial");
    useSummaryStore.getState().setError("test error");
    useSummaryStore.getState().setSummaries([
      { id: 1, session_id: 1, content: "x", model_name: "m", provider_id: "p", prompt_type: "summarize", created_at: "2026-04-15T10:00:00Z" },
    ]);

    useSummaryStore.getState().reset();

    const s = useSummaryStore.getState();
    expect(s.summaries).toEqual([]);
    expect(s.generatingTabs.size).toBe(0);
    expect(s.streamingContentMap).toEqual({});
    expect(s.generateError).toBeNull();
    expect(s.activePromptType).toBe("summarize");
  });
});

// ===========================================================================
// 5. Translation Flow
// ===========================================================================
describe("translation flow", () => {
  it("setProgress tracks translation progress per session", () => {
    const store = useTranslationStore.getState;

    store().setProgress(1, 0);
    expect(store().translationProgressMap[1]).toBe(0);

    store().setProgress(1, 50);
    expect(store().translationProgressMap[1]).toBe(50);

    store().setProgress(1, 100);
    expect(store().translationProgressMap[1]).toBe(100);
  });

  it("multiple sessions can have independent progress", () => {
    const store = useTranslationStore.getState;

    store().setProgress(1, 30);
    store().setProgress(2, 70);

    expect(store().translationProgressMap[1]).toBe(30);
    expect(store().translationProgressMap[2]).toBe(70);
  });

  it("requestAbort sets abort flag and isAborted reflects it", () => {
    const store = useTranslationStore.getState;

    expect(store().isAborted(1)).toBe(false);

    store().requestAbort(1);
    expect(store().isAborted(1)).toBe(true);
    expect(store().abortMap[1]).toBe(true);

    // Other sessions remain unaffected
    expect(store().isAborted(2)).toBe(false);
  });

  it("clearAbort removes the abort flag for a session", () => {
    const store = useTranslationStore.getState;

    store().requestAbort(1);
    expect(store().isAborted(1)).toBe(true);

    store().clearAbort(1);
    expect(store().isAborted(1)).toBe(false);
    expect(store().abortMap[1]).toBeUndefined();
  });

  it("loadTranslations fetches from IPC and populates translations map", async () => {
    const mockRows = [
      { segment_id: 1, translated_text: "Hello" },
      { segment_id: 2, translated_text: "World" },
    ];
    mockIpc(window.capty.listTranslations).mockResolvedValue(mockRows);

    await useTranslationStore.getState().loadTranslations(42, "en");

    expect(window.capty.listTranslations).toHaveBeenCalledWith(42, "en");
    const { translations, activeTranslationLang } = useTranslationStore.getState();
    expect(translations[1]).toBe("Hello");
    expect(translations[2]).toBe("World");
    expect(activeTranslationLang).toBe("en");
  });

  it("abort + progress interaction: progress continues until checked", () => {
    const store = useTranslationStore.getState;

    // Simulate a translation in progress
    store().setProgress(1, 25);
    expect(store().translationProgressMap[1]).toBe(25);

    // Request abort
    store().requestAbort(1);

    // Progress can still be updated (the caller checks isAborted to stop)
    store().setProgress(1, 50);
    expect(store().translationProgressMap[1]).toBe(50);
    expect(store().isAborted(1)).toBe(true);
  });
});

// ===========================================================================
// 6. Multi-Store Reset Isolation
// ===========================================================================
describe("multi-store reset isolation", () => {
  it("resetting appStore does not affect settingsStore", () => {
    // Populate both stores
    useAppStore.getState().setRecording(true);
    useAppStore.getState().setSessions([
      { id: 1, title: "Session 1", started_at: "2026-04-15T09:00:00Z", duration_seconds: 600, model_name: "whisper", status: "completed", category: "recording", sort_order: 0 },
    ]);
    useSettingsStore.getState().setLlmProviders([
      { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com", apiKey: "sk-test", model: "gpt-4", models: ["gpt-4"], isPreset: true },
    ]);
    useSettingsStore.getState().setHistoryPanelWidth(300);

    // Reset only appStore
    useAppStore.getState().reset();

    // appStore should be reset
    expect(useAppStore.getState().isRecording).toBe(false);
    expect(useAppStore.getState().sessions).toEqual([]);

    // settingsStore should be untouched
    expect(useSettingsStore.getState().llmProviders).toHaveLength(1);
    expect(useSettingsStore.getState().historyPanelWidth).toBe(300);
  });

  it("resetting summaryStore does not affect translationStore", () => {
    // Populate both stores
    useSummaryStore.getState().startGeneration("summarize");
    useSummaryStore.getState().appendStreamContent("summarize", "some content");
    useTranslationStore.getState().setProgress(1, 60);
    useTranslationStore.getState().setActiveTranslationLang("zh");

    // Reset only summaryStore
    useSummaryStore.getState().reset();

    // summaryStore should be reset
    expect(useSummaryStore.getState().generatingTabs.size).toBe(0);
    expect(useSummaryStore.getState().streamingContentMap).toEqual({});

    // translationStore should be untouched
    expect(useTranslationStore.getState().translationProgressMap[1]).toBe(60);
    expect(useTranslationStore.getState().activeTranslationLang).toBe("zh");
  });

  it("resetting translationStore does not affect downloadStore", () => {
    // Populate both stores
    useTranslationStore.getState().setProgress(1, 80);
    useTranslationStore.getState().requestAbort(2);
    useDownloadStore.getState().setDownload("model-a", {
      modelId: "model-a",
      category: "asr",
      percent: 45,
      status: "downloading",
    });

    // Reset only translationStore
    useTranslationStore.getState().reset();

    // translationStore should be reset
    expect(useTranslationStore.getState().translationProgressMap).toEqual({});
    expect(useTranslationStore.getState().abortMap).toEqual({});

    // downloadStore should be untouched
    expect(useDownloadStore.getState().downloads["model-a"]).toBeDefined();
    expect(useDownloadStore.getState().downloads["model-a"].percent).toBe(45);
  });

  it("resetting ttsStore does not affect appStore", () => {
    // Populate both stores
    useTtsStore.getState().setTtsProviders([
      { id: "sidecar", name: "Sidecar", baseUrl: "http://localhost:8765", apiKey: "", model: "kokoro", voice: "af_heart", isSidecar: true },
    ]);
    useAppStore.getState().setRecording(true);
    useAppStore.getState().setCurrentSessionId(42);

    // Reset only ttsStore
    useTtsStore.getState().reset();

    // ttsStore should be reset
    expect(useTtsStore.getState().ttsProviders).toEqual([]);
    expect(useTtsStore.getState().selectedTtsProviderId).toBeNull();

    // appStore should be untouched
    expect(useAppStore.getState().isRecording).toBe(true);
    expect(useAppStore.getState().currentSessionId).toBe(42);
  });

  it("all six stores can be independently populated without interference", () => {
    // Populate all stores simultaneously
    useAppStore.getState().setRecording(true);
    useSettingsStore.getState().setHfMirrorUrl("https://hf-mirror.com");
    useDownloadStore.getState().setShowDownloadManager(true);
    useSummaryStore.getState().startGeneration("summarize");
    useTranslationStore.getState().setProgress(1, 50);
    useTtsStore.getState().setSelectedTtsProviderId("kokoro");

    // Verify all stores have their values
    expect(useAppStore.getState().isRecording).toBe(true);
    expect(useSettingsStore.getState().hfMirrorUrl).toBe("https://hf-mirror.com");
    expect(useDownloadStore.getState().showDownloadManager).toBe(true);
    expect(useSummaryStore.getState().generatingTabs.has("summarize")).toBe(true);
    expect(useTranslationStore.getState().translationProgressMap[1]).toBe(50);
    expect(useTtsStore.getState().selectedTtsProviderId).toBe("kokoro");
  });
});
