import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTranslationStore } from "../../../src/renderer/stores/translationStore";

describe("translationStore", () => {
  beforeEach(() => {
    useTranslationStore.setState({
      translationProgressMap: {},
      translations: {},
      activeTranslationLang: null,
      abortMap: {},
    });
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("has correct initial state (empty maps, null lang)", () => {
    const state = useTranslationStore.getState();
    expect(state.translationProgressMap).toEqual({});
    expect(state.translations).toEqual({});
    expect(state.activeTranslationLang).toBeNull();
    expect(state.abortMap).toEqual({});
  });

  describe("setActiveTranslationLang", () => {
    it("updates activeTranslationLang state", () => {
      useTranslationStore.getState().setActiveTranslationLang("zh-CN");
      expect(useTranslationStore.getState().activeTranslationLang).toBe("zh-CN");
    });

    it("persists lang to localStorage when non-null", () => {
      useTranslationStore.getState().setActiveTranslationLang("ja");
      expect(localStorage.getItem("capty:activeTranslationLang")).toBe("ja");
    });

    it("removes key from localStorage when lang is null", () => {
      localStorage.setItem("capty:activeTranslationLang", "ja");
      useTranslationStore.getState().setActiveTranslationLang(null);
      expect(localStorage.getItem("capty:activeTranslationLang")).toBeNull();
      expect(useTranslationStore.getState().activeTranslationLang).toBeNull();
    });
  });

  describe("loadTranslations", () => {
    it("calls window.capty.listTranslations with sessionId and language", async () => {
      (window.capty.listTranslations as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await useTranslationStore.getState().loadTranslations(10, "zh-CN");
      expect(window.capty.listTranslations).toHaveBeenCalledWith(10, "zh-CN");
    });

    it("maps rows from listTranslations into translations record", async () => {
      const mockRows = [
        { segment_id: 1, translated_text: "你好" },
        { segment_id: 2, translated_text: "世界" },
      ];
      (window.capty.listTranslations as ReturnType<typeof vi.fn>).mockResolvedValue(mockRows);

      await useTranslationStore.getState().loadTranslations(10, "zh-CN");

      expect(useTranslationStore.getState().translations).toEqual({
        1: "你好",
        2: "世界",
      });
    });

    it("sets activeTranslationLang to the provided language on success", async () => {
      (window.capty.listTranslations as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await useTranslationStore.getState().loadTranslations(10, "ja");
      expect(useTranslationStore.getState().activeTranslationLang).toBe("ja");
    });

    it("sets translations to empty object on error", async () => {
      (window.capty.listTranslations as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("network error"),
      );
      useTranslationStore.setState({ translations: { 1: "stale" } });

      await useTranslationStore.getState().loadTranslations(10, "zh-CN");

      expect(useTranslationStore.getState().translations).toEqual({});
    });
  });

  describe("setProgress", () => {
    it("updates progress map for a specific session", () => {
      useTranslationStore.getState().setProgress(5, 42);
      expect(useTranslationStore.getState().translationProgressMap).toEqual({ 5: 42 });
    });

    it("preserves progress for other sessions", () => {
      useTranslationStore.setState({ translationProgressMap: { 1: 10, 2: 50 } });
      useTranslationStore.getState().setProgress(1, 75);
      const map = useTranslationStore.getState().translationProgressMap;
      expect(map[1]).toBe(75);
      expect(map[2]).toBe(50);
    });
  });

  describe("requestAbort / isAborted / clearAbort", () => {
    it("requestAbort sets abort flag for session", () => {
      useTranslationStore.getState().requestAbort(7);
      expect(useTranslationStore.getState().isAborted(7)).toBe(true);
    });

    it("isAborted returns false for session with no abort flag", () => {
      expect(useTranslationStore.getState().isAborted(99)).toBe(false);
    });

    it("clearAbort removes the abort flag", () => {
      useTranslationStore.getState().requestAbort(7);
      useTranslationStore.getState().clearAbort(7);
      expect(useTranslationStore.getState().isAborted(7)).toBe(false);
    });

    it("clearAbort does not affect other sessions", () => {
      useTranslationStore.getState().requestAbort(1);
      useTranslationStore.getState().requestAbort(2);
      useTranslationStore.getState().clearAbort(1);
      expect(useTranslationStore.getState().isAborted(1)).toBe(false);
      expect(useTranslationStore.getState().isAborted(2)).toBe(true);
    });
  });

  describe("reset", () => {
    it("clears all state back to empty", () => {
      useTranslationStore.setState({
        translationProgressMap: { 1: 50 },
        translations: { 2: "hello" },
        activeTranslationLang: "zh-CN",
        abortMap: { 3: true },
      });

      useTranslationStore.getState().reset();

      const state = useTranslationStore.getState();
      expect(state.translationProgressMap).toEqual({});
      expect(state.translations).toEqual({});
      expect(state.activeTranslationLang).toBeNull();
      expect(state.abortMap).toEqual({});
    });
  });
});
