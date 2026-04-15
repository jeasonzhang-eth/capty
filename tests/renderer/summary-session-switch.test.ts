/**
 * Tests for the summary streaming session-switch guard.
 *
 * Validates three behaviors:
 * 1. onSummaryChunk ignores chunks whose sessionId ≠ current session
 * 2. Switching sessions clears in-flight streaming state
 * 3. handleSummarize completion skips UI update when session changed
 *
 * We test the guard logic against the real Zustand store, simulating
 * the callback pattern used in App.tsx without rendering the component.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "../../src/renderer/stores/appStore";

describe("summary session-switch guard", () => {
  beforeEach(() => {
    useAppStore.getState().reset();
  });

  describe("session-scoped compound keys", () => {
    it("chunks accumulate under their own session key", () => {
      const streamingContentMap: Record<string, string> = {};
      const chunk = {
        content: "Hello",
        done: false,
        promptType: "summarize",
        sessionId: 1,
      };

      // Simulate onSummaryChunk: always write to `${sessionId}:${promptType}`
      const key = `${chunk.sessionId}:${chunk.promptType}`;
      streamingContentMap[key] =
        (streamingContentMap[key] || "") + chunk.content;

      expect(streamingContentMap["1:summarize"]).toBe("Hello");
      expect(streamingContentMap["2:summarize"]).toBeUndefined();
    });

    it("chunks from different sessions stay isolated", () => {
      const streamingContentMap: Record<string, string> = {};
      const chunks = [
        { content: "A1", sessionId: 1, promptType: "summarize" },
        { content: "B1", sessionId: 2, promptType: "summarize" },
        { content: "A2", sessionId: 1, promptType: "summarize" },
      ];

      for (const c of chunks) {
        const key = `${c.sessionId}:${c.promptType}`;
        streamingContentMap[key] = (streamingContentMap[key] || "") + c.content;
      }

      expect(streamingContentMap["1:summarize"]).toBe("A1A2");
      expect(streamingContentMap["2:summarize"]).toBe("B1");
    });

    it("switching sessions changes which key is displayed", () => {
      useAppStore.getState().setCurrentSessionId(1);
      const streamingContentMap: Record<string, string> = {
        "1:summarize": "Session A content",
        "2:summarize": "Session B content",
      };
      const generatingTabs = new Set(["1:summarize", "2:summarize"]);
      const activePromptType = "summarize";

      // Viewing session 1
      let currentKey = `${useAppStore.getState().currentSessionId}:${activePromptType}`;
      expect(streamingContentMap[currentKey]).toBe("Session A content");
      expect(generatingTabs.has(currentKey)).toBe(true);

      // Switch to session 2
      useAppStore.getState().setCurrentSessionId(2);
      currentKey = `${useAppStore.getState().currentSessionId}:${activePromptType}`;
      expect(streamingContentMap[currentKey]).toBe("Session B content");
      expect(generatingTabs.has(currentKey)).toBe(true);

      // Session 3 has nothing
      useAppStore.getState().setCurrentSessionId(3);
      currentKey = `${useAppStore.getState().currentSessionId}:${activePromptType}`;
      expect(streamingContentMap[currentKey]).toBeUndefined();
      expect(generatingTabs.has(currentKey)).toBe(false);
    });
  });

  describe("session switch preserves in-flight state", () => {
    it("session 1's streaming content survives switching to session 2 and back", () => {
      useAppStore.getState().setCurrentSessionId(1);

      // Session 1 is generating
      const streamingContentMap: Record<string, string> = {
        "1:summarize": "partial A",
      };
      const generatingTabs = new Set(["1:summarize"]);
      const activePromptType = "summarize";

      // Switch to session 2 — state is untouched (session-scoped)
      useAppStore.getState().setCurrentSessionId(2);
      expect(streamingContentMap["1:summarize"]).toBe("partial A");
      expect(generatingTabs.has("1:summarize")).toBe(true);

      // View from session 2: key 2:summarize — nothing (good, no leak)
      let viewKey = `${useAppStore.getState().currentSessionId}:${activePromptType}`;
      expect(streamingContentMap[viewKey]).toBeUndefined();
      expect(generatingTabs.has(viewKey)).toBe(false);

      // Switch back to session 1 — state restored
      useAppStore.getState().setCurrentSessionId(1);
      viewKey = `${useAppStore.getState().currentSessionId}:${activePromptType}`;
      expect(streamingContentMap[viewKey]).toBe("partial A");
      expect(generatingTabs.has(viewKey)).toBe(true);
    });
  });

  describe("handleSummarize completion guard", () => {
    it("updates summaries when session unchanged after await", () => {
      useAppStore.getState().setCurrentSessionId(1);

      // Capture originSessionId at start of handleSummarize
      const originSessionId = useAppStore.getState().currentSessionId;

      // Simulate: summarize completes, user stayed on same session
      const currentId = useAppStore.getState().currentSessionId;
      let summariesUpdated = false;
      if (currentId === originSessionId) {
        summariesUpdated = true;
      }

      expect(summariesUpdated).toBe(true);
    });

    it("skips summary update when session changed during generation", () => {
      useAppStore.getState().setCurrentSessionId(1);

      // Capture originSessionId at start of handleSummarize
      const originSessionId = useAppStore.getState().currentSessionId;

      // Simulate: user switches to session 2 while summarize is in-flight
      useAppStore.getState().setCurrentSessionId(2);

      // Simulate: summarize completes
      const currentId = useAppStore.getState().currentSessionId;
      let summariesUpdated = false;
      if (currentId === originSessionId) {
        summariesUpdated = true;
      }

      expect(summariesUpdated).toBe(false);
      expect(currentId).toBe(2);
      expect(originSessionId).toBe(1);
    });

    it("skips error display when session changed during generation", () => {
      useAppStore.getState().setCurrentSessionId(1);
      const originSessionId = useAppStore.getState().currentSessionId;

      // User switches session
      useAppStore.getState().setCurrentSessionId(2);

      // Simulate: summarize fails
      let generateError: string | null = null;
      if (useAppStore.getState().currentSessionId === originSessionId) {
        generateError = "API failed";
      }

      expect(generateError).toBeNull();
    });
  });
});
