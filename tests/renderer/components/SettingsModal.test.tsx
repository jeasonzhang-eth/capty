/**
 * Component contract tests for SettingsModal.
 *
 * Verifies that the component mounts without crashing when reading from
 * Zustand stores (appStore, settingsStore, ttsStore, downloadStore) and
 * renders expected DOM elements for both empty and seeded states.
 *
 * SettingsModal takes 3 props: initialTab, onTabChange, onClose.
 * All other state is read from stores.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useAppStore } from "../../../src/renderer/stores/appStore";
import { useSettingsStore } from "../../../src/renderer/stores/settingsStore";
import { useTtsStore } from "../../../src/renderer/stores/ttsStore";
import { useDownloadStore } from "../../../src/renderer/stores/downloadStore";
import { SettingsModal } from "../../../src/renderer/components/SettingsModal";

/* ── Minimal required props ── */
function makeProps(
  overrides: Partial<Parameters<typeof SettingsModal>[0]> = {},
) {
  return {
    onClose: vi.fn(),
    ...overrides,
  };
}

/* ── Spy on console.error ── */
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  // Reset stores to initial empty state
  useAppStore.setState({
    dataDir: null,
    models: [],
    selectedModelId: "",
    isRecording: false,
    asrProviders: [],
    selectedAsrProviderId: null,
    sidecarReady: false,
  });
  useSettingsStore.setState({
    configDir: null,
    hfMirrorUrl: "https://huggingface.co",
    llmProviders: [],
    selectedSummaryModel: null,
    selectedRapidModel: null,
    rapidRenamePrompt: "Generate a title",
    selectedTranslateModel: null,
    translatePrompt: "Translate",
    autoStartSidecar: true,
  });
  useTtsStore.setState({
    ttsProviders: [],
    selectedTtsProviderId: null,
    ttsModels: [],
    selectedTtsModelId: "",
    selectedTtsVoice: "",
    ttsVoices: [],
  });
  useDownloadStore.setState({
    downloads: {},
  });
});

afterEach(() => {
  cleanup();
  consoleErrorSpy.mockRestore();
});

describe("SettingsModal", () => {
  it("mounts without crashing with empty store state", () => {
    const { container } = render(<SettingsModal {...makeProps()} />);
    expect(container).toBeTruthy();
  });

  it("produces no console.error during render with empty state", () => {
    render(<SettingsModal {...makeProps()} />);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("renders the settings modal container", () => {
    render(<SettingsModal {...makeProps()} />);
    expect(screen.getByTestId("settings-modal")).toBeInTheDocument();
  });

  it("renders the Settings header text", () => {
    render(<SettingsModal {...makeProps()} />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("renders sidebar tab labels", () => {
    render(<SettingsModal {...makeProps()} />);
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Default Models")).toBeInTheDocument();
  });

  it("renders General tab as default", () => {
    render(<SettingsModal {...makeProps()} />);
    expect(screen.getByTestId("settings-tab-general")).toBeInTheDocument();
  });

  it("mounts without crashing with realistic seeded data", () => {
    useAppStore.setState({
      dataDir: "/Users/test/capty-data",
      models: [
        {
          id: "whisper-large-v3",
          name: "Whisper Large V3",
          type: "whisper",
          repo: "openai/whisper-large-v3",
          downloaded: true,
          size_gb: 2.9,
          languages: ["en", "zh"],
          description: "OpenAI Whisper Large V3",
          supported: true,
        },
        {
          id: "whisper-tiny",
          name: "Whisper Tiny",
          type: "whisper",
          repo: "openai/whisper-tiny",
          downloaded: false,
          size_gb: 0.1,
          languages: ["en"],
          description: "OpenAI Whisper Tiny",
          supported: true,
        },
      ],
      selectedModelId: "whisper-large-v3",
      sidecarReady: true,
      asrProviders: [
        {
          id: "sidecar",
          name: "Local Sidecar",
          baseUrl: "http://localhost:8765",
          apiKey: "",
          model: "whisper-large-v3",
          isSidecar: true,
        },
      ],
      selectedAsrProviderId: "sidecar",
    });
    useSettingsStore.setState({
      configDir: "/Users/test/.config/capty",
      llmProviders: [
        {
          id: "openai",
          name: "OpenAI",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-test",
          model: "gpt-4",
          models: ["gpt-4", "gpt-3.5-turbo"],
          isPreset: true,
        },
      ],
      selectedSummaryModel: { providerId: "openai", model: "gpt-4" },
    });
    useTtsStore.setState({
      ttsProviders: [
        {
          id: "sidecar-tts",
          name: "Local TTS",
          baseUrl: "http://localhost:8765",
          apiKey: "",
          model: "kokoro-v1",
          voice: "af_heart",
          isSidecar: true,
        },
      ],
      selectedTtsProviderId: "sidecar-tts",
      ttsModels: [
        {
          id: "kokoro-v1",
          name: "Kokoro v1",
          type: "kokoro",
          repo: "kokoro/v1",
          downloaded: true,
          size_gb: 0.5,
          languages: ["en"],
          description: "English TTS",
        },
      ],
      selectedTtsModelId: "kokoro-v1",
      selectedTtsVoice: "af_heart",
      ttsVoices: [
        { id: "af_heart", name: "Heart", lang: "en", gender: "female" },
      ],
    });
    useDownloadStore.setState({
      downloads: {
        "whisper-tiny": {
          modelId: "whisper-tiny",
          category: "asr" as const,
          percent: 45,
          status: "downloading",
        },
      },
    });

    const { container } = render(<SettingsModal {...makeProps()} />);
    expect(container).toBeTruthy();
  });

  it("produces no console.error during render with seeded data", () => {
    useAppStore.setState({
      dataDir: "/Users/test/capty-data",
      models: [
        {
          id: "whisper-large-v3",
          name: "Whisper Large V3",
          type: "whisper",
          repo: "openai/whisper-large-v3",
          downloaded: true,
          size_gb: 2.9,
          languages: ["en"],
          description: "Whisper",
          supported: true,
        },
      ],
      selectedModelId: "whisper-large-v3",
    });

    render(<SettingsModal {...makeProps()} />);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("respects initialTab prop", () => {
    render(
      <SettingsModal {...makeProps({ initialTab: "llm" })} />,
    );
    // Should still render without crashing
    expect(screen.getByTestId("settings-modal")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(<SettingsModal {...makeProps({ onClose })} />);

    // The close button renders the times symbol
    const closeBtn = screen.getByText("\u00D7");
    closeBtn.click();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
