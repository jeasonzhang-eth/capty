/**
 * Component contract tests for HistoryPanel.
 *
 * Verifies that the component mounts without crashing when reading from
 * Zustand stores (appStore, settingsStore, downloadStore) and renders
 * expected DOM elements for both empty and seeded states.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useAppStore } from "../../../src/renderer/stores/appStore";
import { useSettingsStore } from "../../../src/renderer/stores/settingsStore";
import { useDownloadStore } from "../../../src/renderer/stores/downloadStore";
import { HistoryPanel } from "../../../src/renderer/components/HistoryPanel";

/* ── Minimal required props (callbacks that still live in App.tsx) ── */
function makeProps(
  overrides: Partial<Parameters<typeof HistoryPanel>[0]> = {},
) {
  return {
    playingSessionId: null as number | null,
    regeneratingSessionId: null as number | null,
    regenerationProgress: 0,
    onSelectSession: vi.fn(),
    onDeleteSession: vi.fn(),
    onPlaySession: vi.fn(),
    onStopPlayback: vi.fn(),
    onRegenerateSubtitles: vi.fn(),
    onCancelRegeneration: vi.fn(),
    onUploadAudio: vi.fn(),
    ...overrides,
  };
}

/* ── Spy on console.error to detect render-time errors ── */
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  // Reset stores to initial empty state
  useAppStore.setState({
    sessions: [],
    currentSessionId: null,
    isRecording: false,
  });
  useSettingsStore.setState({
    historyPanelWidth: 240,
    sessionCategories: [
      { id: "recording", label: "Recordings", icon: "🎤", isBuiltin: true },
    ],
  });
  useDownloadStore.setState({
    downloadBadge: null,
  });
});

afterEach(() => {
  cleanup();
  consoleErrorSpy.mockRestore();
});

describe("HistoryPanel", () => {
  it("mounts without crashing with empty store state", () => {
    const { container } = render(<HistoryPanel {...makeProps()} />);
    expect(container).toBeTruthy();
  });

  it("produces no console.error during render with empty state", () => {
    render(<HistoryPanel {...makeProps()} />);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("renders the history panel container", () => {
    render(<HistoryPanel {...makeProps()} />);
    expect(screen.getByTestId("history-panel")).toBeInTheDocument();
  });

  it("renders Upload Audio button", () => {
    render(<HistoryPanel {...makeProps()} />);
    expect(screen.getByText("Upload Audio")).toBeInTheDocument();
  });

  it("renders session title when store has sessions and category is expanded", () => {
    useAppStore.setState({
      sessions: [
        {
          id: 1,
          title: "Test Meeting Notes",
          started_at: new Date().toISOString(),
          duration_seconds: 120,
          status: "completed",
          category: "recording",
          model_name: "test-model",
          sort_order: 0,
        },
      ],
      // Setting currentSessionId triggers auto-expand of the parent category
      currentSessionId: 1,
    });

    render(<HistoryPanel {...makeProps()} />);
    expect(screen.getByText("Test Meeting Notes")).toBeInTheDocument();
  });

  it("mounts without crashing with realistic seeded data", () => {
    useAppStore.setState({
      sessions: [
        {
          id: 1,
          title: "Morning Standup",
          started_at: new Date().toISOString(),
          duration_seconds: 300,
          status: "completed",
          category: "recording",
          model_name: "whisper-large-v3",
          sort_order: 0,
        },
        {
          id: 2,
          title: "Product Review",
          started_at: new Date(
            Date.now() - 2 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          duration_seconds: 1800,
          status: "completed",
          category: "recording",
          model_name: "whisper-large-v3",
          sort_order: 1,
        },
        {
          id: 3,
          title: "Active Recording",
          started_at: new Date().toISOString(),
          duration_seconds: null,
          status: "recording",
          category: "recording",
          model_name: "whisper-large-v3",
          sort_order: 2,
        },
      ],
      currentSessionId: 1,
      isRecording: true,
    });

    const { container } = render(<HistoryPanel {...makeProps()} />);
    expect(container).toBeTruthy();
    expect(screen.getByText("Morning Standup")).toBeInTheDocument();
    expect(screen.getByText("Product Review")).toBeInTheDocument();
  });

  it("produces no console.error during render with seeded data", () => {
    useAppStore.setState({
      sessions: [
        {
          id: 1,
          title: "Session A",
          started_at: new Date().toISOString(),
          duration_seconds: 60,
          status: "completed",
          category: "recording",
          model_name: "test",
          sort_order: 0,
        },
      ],
    });

    render(<HistoryPanel {...makeProps()} />);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("renders with optional onAiRename prop", () => {
    useAppStore.setState({
      sessions: [
        {
          id: 1,
          title: "AI Rename Test",
          started_at: new Date().toISOString(),
          duration_seconds: 60,
          status: "completed",
          category: "recording",
          model_name: "test",
          sort_order: 0,
        },
      ],
      currentSessionId: 1,
    });

    render(
      <HistoryPanel
        {...makeProps({
          onAiRename: vi.fn(),
          aiRenamingSessionId: null,
        })}
      />,
    );
    expect(screen.getByText("AI Rename Test")).toBeInTheDocument();
  });

  it("handles download badge state from downloadStore", () => {
    useDownloadStore.setState({ downloadBadge: "active" });

    const { container } = render(<HistoryPanel {...makeProps()} />);
    expect(container).toBeTruthy();
  });
});
