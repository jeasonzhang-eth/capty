/**
 * Component contract tests for SummaryPanel.
 *
 * Verifies that the component mounts without crashing when reading from
 * Zustand stores (appStore, settingsStore, summaryStore, ttsStore) and
 * renders expected DOM elements for both empty and seeded states.
 *
 * SummaryPanel takes NO props -- it reads everything from stores.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useAppStore } from "../../../src/renderer/stores/appStore";
import { useSettingsStore } from "../../../src/renderer/stores/settingsStore";
import { useSummaryStore } from "../../../src/renderer/stores/summaryStore";
import { useTtsStore } from "../../../src/renderer/stores/ttsStore";
import { SummaryPanel } from "../../../src/renderer/components/SummaryPanel";

/* ── Spy on console.error ── */
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  // Reset all stores to initial state
  useAppStore.setState({
    currentSessionId: null,
    segments: [],
    ttsProviderReady: false,
  });
  useSettingsStore.setState({
    llmProviders: [],
    selectedSummaryModel: null,
    promptTypes: [
      {
        id: "summarize",
        label: "Summary",
        systemPrompt: "Summarize the text",
        isBuiltin: true,
      },
    ],
    summaryPanelWidth: 320,
  });
  useSummaryStore.setState({
    summaries: [],
    generatingTabs: new Set<string>(),
    streamingContentMap: {},
    generateError: null,
    activePromptType: "summarize",
  });
  useTtsStore.setState({
    ttsModels: [],
    selectedTtsModelId: "",
    selectedTtsVoice: "",
    ttsVoices: [],
    ttsProviders: [],
    selectedTtsProviderId: null,
  });
});

afterEach(() => {
  cleanup();
  consoleErrorSpy.mockRestore();
});

describe("SummaryPanel", () => {
  it("mounts without crashing with empty store state", () => {
    const { container } = render(<SummaryPanel />);
    expect(container).toBeTruthy();
  });

  it("produces no console.error during render with empty state", () => {
    render(<SummaryPanel />);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("renders empty-state message when no session is selected", () => {
    render(<SummaryPanel />);
    expect(
      screen.getByText("Select a session to view results"),
    ).toBeInTheDocument();
  });

  it("renders prompt type tabs from settingsStore", () => {
    useSettingsStore.setState({
      promptTypes: [
        {
          id: "summarize",
          label: "Summary",
          systemPrompt: "...",
          isBuiltin: true,
        },
        {
          id: "minutes",
          label: "Minutes",
          systemPrompt: "...",
          isBuiltin: true,
        },
      ],
    });

    render(<SummaryPanel />);
    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(screen.getByText("Minutes")).toBeInTheDocument();
  });

  it("mounts without crashing with realistic seeded data", () => {
    useAppStore.setState({
      currentSessionId: 1,
      segments: [
        { id: 1, start_time: 0, end_time: 5, text: "Hello world" },
        { id: 2, start_time: 5, end_time: 10, text: "This is a test" },
      ],
      ttsProviderReady: true,
    });
    useSettingsStore.setState({
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
    useSummaryStore.setState({
      summaries: [
        {
          id: 1,
          session_id: 1,
          content: "This is a test summary of the meeting.",
          model_name: "gpt-4",
          provider_id: "openai",
          prompt_type: "summarize",
          created_at: "2026-04-15T10:00:00",
        },
      ],
    });
    useTtsStore.setState({
      ttsModels: [
        {
          id: "kokoro-v1",
          name: "Kokoro v1",
          type: "kokoro",
          repo: "kokoro/v1",
          downloaded: true,
          size_gb: 0.5,
          languages: ["en"],
          description: "English TTS model",
        },
      ],
      selectedTtsModelId: "kokoro-v1",
    });

    const { container } = render(<SummaryPanel />);
    expect(container).toBeTruthy();
  });

  it("produces no console.error during render with seeded data", () => {
    useAppStore.setState({
      currentSessionId: 1,
      segments: [{ id: 1, start_time: 0, end_time: 5, text: "Test" }],
    });
    useSummaryStore.setState({
      summaries: [
        {
          id: 1,
          session_id: 1,
          content: "Summary content here",
          model_name: "gpt-4",
          provider_id: "openai",
          prompt_type: "summarize",
          created_at: "2026-04-15T10:00:00",
        },
      ],
    });

    render(<SummaryPanel />);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("renders summary content when session has summaries", () => {
    useAppStore.setState({
      currentSessionId: 1,
      segments: [{ id: 1, start_time: 0, end_time: 5, text: "Test" }],
    });
    useSummaryStore.setState({
      summaries: [
        {
          id: 1,
          session_id: 1,
          content: "Meeting discussed quarterly targets.",
          model_name: "gpt-4",
          provider_id: "openai",
          prompt_type: "summarize",
          created_at: "2026-04-15T10:00:00",
        },
      ],
    });

    render(<SummaryPanel />);
    // The summary content is rendered as HTML via marked/DOMPurify
    expect(
      screen.getByText("Meeting discussed quarterly targets."),
    ).toBeInTheDocument();
  });

  it("handles streaming state without crashing", () => {
    useAppStore.setState({ currentSessionId: 1, segments: [{ id: 1, start_time: 0, end_time: 5, text: "Test" }] });
    useSummaryStore.setState({
      generatingTabs: new Set(["summarize"]),
      streamingContentMap: { summarize: "Generating summary..." },
      activePromptType: "summarize",
    });

    const { container } = render(<SummaryPanel />);
    expect(container).toBeTruthy();
  });

  it("handles error state without crashing", () => {
    useAppStore.setState({ currentSessionId: 1, segments: [{ id: 1, start_time: 0, end_time: 5, text: "Test" }] });
    useSummaryStore.setState({
      generateError: "LLM provider connection failed",
    });

    const { container } = render(<SummaryPanel />);
    expect(container).toBeTruthy();
  });
});
