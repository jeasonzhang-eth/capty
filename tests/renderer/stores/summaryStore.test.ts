import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSummaryStore } from "../../../src/renderer/stores/summaryStore";

describe("summaryStore", () => {
  beforeEach(() => {
    useSummaryStore.setState(useSummaryStore.getInitialState());
    vi.clearAllMocks();
  });

  describe("initial state", () => {
    it("has empty summaries array", () => {
      const state = useSummaryStore.getState();
      expect(state.summaries).toEqual([]);
    });

    it("has no generating tabs", () => {
      const state = useSummaryStore.getState();
      expect(state.generatingTabs.size).toBe(0);
    });

    it("has empty streamingContentMap", () => {
      const state = useSummaryStore.getState();
      expect(state.streamingContentMap).toEqual({});
    });

    it("has null generateError", () => {
      const state = useSummaryStore.getState();
      expect(state.generateError).toBeNull();
    });

    it("has default activePromptType of 'summarize'", () => {
      const state = useSummaryStore.getState();
      expect(state.activePromptType).toBe("summarize");
    });
  });

  describe("loadSummaries", () => {
    it("calls window.capty.listSummaries with sessionId and activePromptType", async () => {
      const mockSummaries = [
        {
          id: 1,
          session_id: 42,
          content: "Test summary",
          model_name: "gpt-4",
          provider_id: "openai",
          prompt_type: "summarize",
          created_at: "2026-04-13T00:00:00Z",
        },
      ];
      (window.capty.listSummaries as ReturnType<typeof vi.fn>).mockResolvedValue(mockSummaries);

      await useSummaryStore.getState().loadSummaries(42);

      expect(window.capty.listSummaries).toHaveBeenCalledOnce();
      expect(window.capty.listSummaries).toHaveBeenCalledWith(42, "summarize");
      expect(useSummaryStore.getState().summaries).toEqual(mockSummaries);
    });

    it("uses the current activePromptType when loading", async () => {
      useSummaryStore.getState().setActivePromptType("meeting-notes");
      (window.capty.listSummaries as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await useSummaryStore.getState().loadSummaries(10);

      expect(window.capty.listSummaries).toHaveBeenCalledWith(10, "meeting-notes");
    });

    it("clears generateError on successful load", async () => {
      useSummaryStore.setState({ generateError: "previous error" });
      (window.capty.listSummaries as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await useSummaryStore.getState().loadSummaries(1);

      expect(useSummaryStore.getState().generateError).toBeNull();
    });
  });

  describe("startGeneration / stopGeneration", () => {
    it("startGeneration adds promptType to generatingTabs", () => {
      useSummaryStore.getState().startGeneration("summarize");
      expect(useSummaryStore.getState().generatingTabs.has("summarize")).toBe(true);
    });

    it("startGeneration initializes streamingContentMap entry to empty string", () => {
      useSummaryStore.getState().startGeneration("summarize");
      expect(useSummaryStore.getState().streamingContentMap["summarize"]).toBe("");
    });

    it("startGeneration can manage multiple tabs concurrently", () => {
      useSummaryStore.getState().startGeneration("summarize");
      useSummaryStore.getState().startGeneration("meeting-notes");
      const { generatingTabs } = useSummaryStore.getState();
      expect(generatingTabs.has("summarize")).toBe(true);
      expect(generatingTabs.has("meeting-notes")).toBe(true);
      expect(generatingTabs.size).toBe(2);
    });

    it("stopGeneration removes promptType from generatingTabs", () => {
      useSummaryStore.getState().startGeneration("summarize");
      useSummaryStore.getState().stopGeneration("summarize");
      expect(useSummaryStore.getState().generatingTabs.has("summarize")).toBe(false);
    });

    it("stopGeneration removes entry from streamingContentMap", () => {
      useSummaryStore.getState().startGeneration("summarize");
      useSummaryStore.getState().appendStreamContent("summarize", "hello");
      useSummaryStore.getState().stopGeneration("summarize");
      expect(useSummaryStore.getState().streamingContentMap["summarize"]).toBeUndefined();
    });

    it("stopGeneration leaves other tabs unaffected", () => {
      useSummaryStore.getState().startGeneration("summarize");
      useSummaryStore.getState().startGeneration("meeting-notes");
      useSummaryStore.getState().stopGeneration("summarize");
      expect(useSummaryStore.getState().generatingTabs.has("meeting-notes")).toBe(true);
      expect(useSummaryStore.getState().generatingTabs.has("summarize")).toBe(false);
    });
  });

  describe("appendStreamContent", () => {
    it("sets initial content for a new promptType", () => {
      useSummaryStore.getState().appendStreamContent("summarize", "Hello");
      expect(useSummaryStore.getState().streamingContentMap["summarize"]).toBe("Hello");
    });

    it("accumulates content across multiple chunks", () => {
      useSummaryStore.getState().appendStreamContent("summarize", "Hello");
      useSummaryStore.getState().appendStreamContent("summarize", " world");
      useSummaryStore.getState().appendStreamContent("summarize", "!");
      expect(useSummaryStore.getState().streamingContentMap["summarize"]).toBe("Hello world!");
    });

    it("accumulates content per promptType independently", () => {
      useSummaryStore.getState().appendStreamContent("summarize", "Summary chunk");
      useSummaryStore.getState().appendStreamContent("meeting-notes", "Notes chunk");
      useSummaryStore.getState().appendStreamContent("summarize", " more");
      expect(useSummaryStore.getState().streamingContentMap["summarize"]).toBe("Summary chunk more");
      expect(useSummaryStore.getState().streamingContentMap["meeting-notes"]).toBe("Notes chunk");
    });
  });

  describe("setActivePromptType", () => {
    it("updates activePromptType", () => {
      useSummaryStore.getState().setActivePromptType("meeting-notes");
      expect(useSummaryStore.getState().activePromptType).toBe("meeting-notes");
    });

    it("can switch back to default type", () => {
      useSummaryStore.getState().setActivePromptType("meeting-notes");
      useSummaryStore.getState().setActivePromptType("summarize");
      expect(useSummaryStore.getState().activePromptType).toBe("summarize");
    });
  });

  describe("error handling", () => {
    it("setError stores the error message", () => {
      useSummaryStore.getState().setError("Something went wrong");
      expect(useSummaryStore.getState().generateError).toBe("Something went wrong");
    });

    it("clearError resets generateError to null", () => {
      useSummaryStore.getState().setError("error");
      useSummaryStore.getState().clearError();
      expect(useSummaryStore.getState().generateError).toBeNull();
    });
  });

  describe("deleteSummary", () => {
    it("calls window.capty.deleteSummary with the id", async () => {
      await useSummaryStore.getState().deleteSummary(5);
      expect(window.capty.deleteSummary).toHaveBeenCalledOnce();
      expect(window.capty.deleteSummary).toHaveBeenCalledWith(5);
    });
  });

  describe("setSummaries", () => {
    it("replaces the summaries array", () => {
      const mockSummaries = [
        {
          id: 1,
          session_id: 1,
          content: "content",
          model_name: "gpt-4",
          provider_id: "openai",
          prompt_type: "summarize",
          created_at: "2026-04-13T00:00:00Z",
        },
      ];
      useSummaryStore.getState().setSummaries(mockSummaries);
      expect(useSummaryStore.getState().summaries).toEqual(mockSummaries);
    });
  });

  describe("reset", () => {
    it("restores all state to initial values", () => {
      useSummaryStore.getState().startGeneration("summarize");
      useSummaryStore.getState().appendStreamContent("summarize", "chunk");
      useSummaryStore.getState().setError("error");
      useSummaryStore.getState().setActivePromptType("meeting-notes");

      useSummaryStore.getState().reset();

      const state = useSummaryStore.getState();
      expect(state.summaries).toEqual([]);
      expect(state.generatingTabs.size).toBe(0);
      expect(state.streamingContentMap).toEqual({});
      expect(state.generateError).toBeNull();
      expect(state.activePromptType).toBe("summarize");
    });
  });
});
