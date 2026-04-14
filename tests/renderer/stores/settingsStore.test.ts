import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  useSettingsStore,
  DEFAULT_HISTORY_WIDTH,
  DEFAULT_SUMMARY_WIDTH,
} from "../../../src/renderer/stores/settingsStore";

const DEFAULT_HF_URL = "https://huggingface.co";

describe("settingsStore", () => {
  beforeEach(() => {
    useSettingsStore.setState(useSettingsStore.getInitialState());
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------
  describe("initial state", () => {
    it("has correct defaults for all fields", () => {
      const s = useSettingsStore.getState();
      expect(s.configDir).toBeNull();
      expect(s.hfMirrorUrl).toBe(DEFAULT_HF_URL);
      expect(s.autoStartSidecar).toBe(true);
      expect(s.zoomFactor).toBe(1.0);
      expect(s.historyPanelWidth).toBe(DEFAULT_HISTORY_WIDTH);
      expect(s.summaryPanelWidth).toBe(DEFAULT_SUMMARY_WIDTH);
      expect(s.llmProviders).toEqual([]);
      expect(s.selectedSummaryModel).toBeNull();
      expect(s.selectedTranslateModel).toBeNull();
      expect(s.selectedRapidModel).toBeNull();
      expect(s.rapidRenamePrompt).toContain("Chinese title");
      expect(s.translatePrompt).toContain("{{text}}");
      expect(s.sessionCategories).toEqual([]);
      expect(s.promptTypes).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Setters
  // ---------------------------------------------------------------------------
  describe("setters", () => {
    it("setHfMirrorUrl updates hfMirrorUrl", () => {
      useSettingsStore.getState().setHfMirrorUrl("https://hf-mirror.com");
      expect(useSettingsStore.getState().hfMirrorUrl).toBe(
        "https://hf-mirror.com",
      );
    });

    it("setZoomFactor updates zoomFactor", () => {
      useSettingsStore.getState().setZoomFactor(1.5);
      expect(useSettingsStore.getState().zoomFactor).toBe(1.5);
    });

    it("setAutoStartSidecar updates autoStartSidecar", () => {
      useSettingsStore.getState().setAutoStartSidecar(false);
      expect(useSettingsStore.getState().autoStartSidecar).toBe(false);
    });

    it("setHistoryPanelWidth updates historyPanelWidth", () => {
      useSettingsStore.getState().setHistoryPanelWidth(300);
      expect(useSettingsStore.getState().historyPanelWidth).toBe(300);
    });

    it("setSummaryPanelWidth updates summaryPanelWidth", () => {
      useSettingsStore.getState().setSummaryPanelWidth(400);
      expect(useSettingsStore.getState().summaryPanelWidth).toBe(400);
    });

    it("setLlmProviders replaces llmProviders", () => {
      const providers = [
        {
          id: "p1",
          name: "Provider 1",
          baseUrl: "http://localhost",
          apiKey: "key",
          model: "gpt-4",
          models: ["gpt-4"],
          isPreset: false,
        },
      ];
      useSettingsStore.getState().setLlmProviders(providers);
      expect(useSettingsStore.getState().llmProviders).toEqual(providers);
    });

    it("setSelectedSummaryModel updates selectedSummaryModel", () => {
      const sel = { providerId: "p1", model: "gpt-4" };
      useSettingsStore.getState().setSelectedSummaryModel(sel);
      expect(useSettingsStore.getState().selectedSummaryModel).toEqual(sel);
    });

    it("setSelectedTranslateModel updates selectedTranslateModel", () => {
      const sel = { providerId: "p2", model: "claude-3" };
      useSettingsStore.getState().setSelectedTranslateModel(sel);
      expect(useSettingsStore.getState().selectedTranslateModel).toEqual(sel);
    });

    it("setSelectedRapidModel updates selectedRapidModel", () => {
      const sel = { providerId: "p3", model: "haiku" };
      useSettingsStore.getState().setSelectedRapidModel(sel);
      expect(useSettingsStore.getState().selectedRapidModel).toEqual(sel);
    });

    it("setRapidRenamePrompt updates rapidRenamePrompt", () => {
      useSettingsStore.getState().setRapidRenamePrompt("custom rename prompt");
      expect(useSettingsStore.getState().rapidRenamePrompt).toBe(
        "custom rename prompt",
      );
    });

    it("setTranslatePrompt updates translatePrompt", () => {
      useSettingsStore
        .getState()
        .setTranslatePrompt("translate: {{text}} to {{target_language}}");
      expect(useSettingsStore.getState().translatePrompt).toBe(
        "translate: {{text}} to {{target_language}}",
      );
    });

    it("setConfigDir updates configDir", () => {
      useSettingsStore.getState().setConfigDir("/home/user/.config/capty");
      expect(useSettingsStore.getState().configDir).toBe(
        "/home/user/.config/capty",
      );
    });

    it("setSessionCategories replaces sessionCategories", () => {
      const cats = [{ id: "c1", label: "Work", icon: "💼", isBuiltin: false }];
      useSettingsStore.getState().setSessionCategories(cats);
      expect(useSettingsStore.getState().sessionCategories).toEqual(cats);
    });

    it("setPromptTypes replaces promptTypes", () => {
      const types = [
        {
          id: "summarize",
          label: "Summary",
          systemPrompt: "Summarize this",
          isBuiltin: true,
        },
      ];
      useSettingsStore.getState().setPromptTypes(types);
      expect(useSettingsStore.getState().promptTypes).toEqual(types);
    });
  });

  // ---------------------------------------------------------------------------
  // loadConfig
  // ---------------------------------------------------------------------------
  describe("loadConfig", () => {
    it("calls window.capty.getConfig and populates settings fields", async () => {
      const mockConfig = {
        historyPanelWidth: 260,
        summaryPanelWidth: 350,
        hfMirrorUrl: "https://hf-mirror.com",
        llmProviders: [
          {
            id: "p1",
            name: "OpenAI",
            baseUrl: "https://api.openai.com",
            apiKey: "sk-xxx",
            model: "gpt-4",
            models: ["gpt-4"],
            isPreset: true,
          },
        ],
        selectedSummaryModel: { providerId: "p1", model: "gpt-4" },
        selectedTranslateModel: { providerId: "p1", model: "gpt-4" },
        selectedRapidModel: { providerId: "p1", model: "gpt-4" },
        rapidRenamePrompt: "my rename prompt",
        translatePrompt: "my translate prompt",
        sidecar: { port: 8765, autoStart: false },
      };
      (
        window.capty.getConfig as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockConfig);
      (window.capty.getZoomFactor as ReturnType<typeof vi.fn>).mockResolvedValue(1.25);
      (
        window.capty.getConfigDir as ReturnType<typeof vi.fn>
      ).mockResolvedValue("/home/.config/capty");
      (
        window.capty.listPromptTypes as ReturnType<typeof vi.fn>
      ).mockResolvedValue([
        {
          id: "summarize",
          label: "Summary",
          systemPrompt: "...",
          isBuiltin: true,
        },
      ]);
      (
        window.capty.listSessionCategories as ReturnType<typeof vi.fn>
      ).mockResolvedValue([
        { id: "recording", label: "Recording", icon: "🎙️", isBuiltin: true },
      ]);

      await useSettingsStore.getState().loadConfig();

      const s = useSettingsStore.getState();
      expect(window.capty.getConfig).toHaveBeenCalledOnce();
      expect(s.historyPanelWidth).toBe(260);
      expect(s.summaryPanelWidth).toBe(350);
      expect(s.hfMirrorUrl).toBe("https://hf-mirror.com");
      expect(s.llmProviders).toHaveLength(1);
      expect(s.selectedSummaryModel).toEqual({ providerId: "p1", model: "gpt-4" });
      expect(s.selectedTranslateModel).toEqual({
        providerId: "p1",
        model: "gpt-4",
      });
      expect(s.selectedRapidModel).toEqual({ providerId: "p1", model: "gpt-4" });
      expect(s.rapidRenamePrompt).toBe("my rename prompt");
      expect(s.translatePrompt).toBe("my translate prompt");
      expect(s.autoStartSidecar).toBe(false);
      expect(s.zoomFactor).toBe(1.25);
      expect(s.configDir).toBe("/home/.config/capty");
      expect(s.promptTypes).toHaveLength(1);
      expect(s.sessionCategories).toHaveLength(1);
    });

    it("leaves defaults unchanged when config values are absent", async () => {
      (
        window.capty.getConfig as ReturnType<typeof vi.fn>
      ).mockResolvedValue({});
      (window.capty.getZoomFactor as ReturnType<typeof vi.fn>).mockResolvedValue(1.0);
      (
        window.capty.getConfigDir as ReturnType<typeof vi.fn>
      ).mockResolvedValue(null);
      (
        window.capty.listPromptTypes as ReturnType<typeof vi.fn>
      ).mockResolvedValue([]);
      (
        window.capty.listSessionCategories as ReturnType<typeof vi.fn>
      ).mockResolvedValue([]);

      await useSettingsStore.getState().loadConfig();

      const s = useSettingsStore.getState();
      expect(s.hfMirrorUrl).toBe(DEFAULT_HF_URL);
      expect(s.historyPanelWidth).toBe(DEFAULT_HISTORY_WIDTH);
      expect(s.summaryPanelWidth).toBe(DEFAULT_SUMMARY_WIDTH);
      expect(s.llmProviders).toEqual([]);
      expect(s.selectedSummaryModel).toBeNull();
      expect(s.zoomFactor).toBe(1.0);
    });
  });

  // ---------------------------------------------------------------------------
  // saveConfig
  // ---------------------------------------------------------------------------
  describe("saveConfig", () => {
    it("merges partial config and calls window.capty.setConfig", async () => {
      const existingConfig = { hfMirrorUrl: "https://huggingface.co" };
      (
        window.capty.getConfig as ReturnType<typeof vi.fn>
      ).mockResolvedValue(existingConfig);

      await useSettingsStore
        .getState()
        .saveConfig({ hfMirrorUrl: "https://hf-mirror.com" });

      expect(window.capty.getConfig).toHaveBeenCalledOnce();
      expect(window.capty.setConfig).toHaveBeenCalledWith({
        hfMirrorUrl: "https://hf-mirror.com",
      });
    });

    it("preserves existing config fields when saving partial update", async () => {
      const existingConfig = {
        hfMirrorUrl: "https://huggingface.co",
        selectedModelId: "whisper-large-v3",
      };
      (
        window.capty.getConfig as ReturnType<typeof vi.fn>
      ).mockResolvedValue(existingConfig);

      await useSettingsStore
        .getState()
        .saveConfig({ rapidRenamePrompt: "my prompt" });

      expect(window.capty.setConfig).toHaveBeenCalledWith({
        hfMirrorUrl: "https://huggingface.co",
        selectedModelId: "whisper-large-v3",
        rapidRenamePrompt: "my prompt",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // saveLayoutWidths
  // ---------------------------------------------------------------------------
  describe("saveLayoutWidths", () => {
    it("updates state immediately and calls saveLayout after debounce", async () => {
      vi.useFakeTimers();

      useSettingsStore.getState().saveLayoutWidths(280, 360);

      expect(useSettingsStore.getState().historyPanelWidth).toBe(280);
      expect(useSettingsStore.getState().summaryPanelWidth).toBe(360);
      expect(window.capty.saveLayout).not.toHaveBeenCalled();

      vi.advanceTimersByTime(600);

      expect(window.capty.saveLayout).toHaveBeenCalledWith({
        historyPanelWidth: 280,
        summaryPanelWidth: 360,
      });

      vi.useRealTimers();
    });
  });

  // ---------------------------------------------------------------------------
  // addCategory
  // ---------------------------------------------------------------------------
  describe("addCategory", () => {
    it("saves to backend and reloads categories from server", async () => {
      const refreshedCats = [
        { id: "recording", label: "Recording", icon: "🎙️", isBuiltin: true },
        { id: "custom-123", label: "Work", icon: "💼", isBuiltin: false },
      ];
      (
        window.capty.listSessionCategories as ReturnType<typeof vi.fn>
      ).mockResolvedValue(refreshedCats);

      await useSettingsStore
        .getState()
        .addCategory({ label: "Work", icon: "💼" });

      expect(window.capty.saveSessionCategories).toHaveBeenCalledOnce();
      const savedArg = (
        window.capty.saveSessionCategories as ReturnType<typeof vi.fn>
      ).mock.calls[0][0] as Array<{ label: string; icon: string }>;
      expect(savedArg[savedArg.length - 1]).toMatchObject({
        label: "Work",
        icon: "💼",
        isBuiltin: false,
      });

      expect(window.capty.listSessionCategories).toHaveBeenCalledOnce();
      expect(useSettingsStore.getState().sessionCategories).toEqual(
        refreshedCats,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // deleteCategory
  // ---------------------------------------------------------------------------
  describe("deleteCategory", () => {
    it("calls deleteSessionCategory and reloads categories", async () => {
      const initialCats = [
        { id: "recording", label: "Recording", icon: "🎙️", isBuiltin: true },
        { id: "custom-abc", label: "Work", icon: "💼", isBuiltin: false },
      ];
      useSettingsStore.getState().setSessionCategories(initialCats);

      const afterDelete = [
        { id: "recording", label: "Recording", icon: "🎙️", isBuiltin: true },
      ];
      (
        window.capty.listSessionCategories as ReturnType<typeof vi.fn>
      ).mockResolvedValue(afterDelete);

      await useSettingsStore.getState().deleteCategory("custom-abc");

      expect(window.capty.deleteSessionCategory).toHaveBeenCalledWith(
        "custom-abc",
      );
      expect(window.capty.listSessionCategories).toHaveBeenCalledOnce();
      expect(useSettingsStore.getState().sessionCategories).toEqual(afterDelete);
    });
  });

  // ---------------------------------------------------------------------------
  // savePromptTypes
  // ---------------------------------------------------------------------------
  describe("savePromptTypes", () => {
    it("calls window.capty.savePromptTypes and reloads effective list", async () => {
      const newTypes = [
        {
          id: "summarize",
          label: "Summary",
          systemPrompt: "Summarize this meeting",
          isBuiltin: true,
        },
        {
          id: "action-items",
          label: "Action Items",
          systemPrompt: "List action items",
          isBuiltin: false,
        },
      ];
      const effectiveTypes = [...newTypes];
      (
        window.capty.listPromptTypes as ReturnType<typeof vi.fn>
      ).mockResolvedValue(effectiveTypes);

      await useSettingsStore.getState().savePromptTypes(newTypes);

      expect(window.capty.savePromptTypes).toHaveBeenCalledWith(newTypes);
      expect(window.capty.listPromptTypes).toHaveBeenCalledOnce();
      expect(useSettingsStore.getState().promptTypes).toEqual(effectiveTypes);
    });
  });
});
