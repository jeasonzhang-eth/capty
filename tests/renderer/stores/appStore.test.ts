import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore } from "../../../src/renderer/stores/appStore";

describe("appStore", () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
    vi.clearAllMocks();
  });

  it("has correct initial state", () => {
    const state = useAppStore.getState();
    expect(state.isRecording).toBe(false);
    expect(state.sidecarReady).toBe(false);
    expect(state.currentSessionId).toBeNull();
    expect(state.segments).toEqual([]);
    expect(state.sessions).toEqual([]);
  });

  it("setRecording updates recording state", () => {
    useAppStore.getState().setRecording(true);
    expect(useAppStore.getState().isRecording).toBe(true);
  });

  it("addSegment appends to segments array", () => {
    const seg = { id: 1, start_time: 0, end_time: 5, text: "hello" };
    useAppStore.getState().addSegment(seg);
    expect(useAppStore.getState().segments).toEqual([seg]);
  });

  it("setSegments replaces segments and clears partialText", () => {
    useAppStore.getState().setPartialText("partial");
    const segs = [{ id: 1, start_time: 0, end_time: 5, text: "hello" }];
    useAppStore.getState().setSegments(segs);
    expect(useAppStore.getState().segments).toEqual(segs);
    expect(useAppStore.getState().partialText).toBe("");
  });

  it("loadSessions calls window.capty.listSessions and updates state", async () => {
    const mockSessions = [
      { id: 1, title: "Test", started_at: "2026-01-01", duration_seconds: 60, model_name: "m", status: "done", category: "", sort_order: 0 },
    ];
    (window.capty.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue(mockSessions);

    await useAppStore.getState().loadSessions();

    expect(window.capty.listSessions).toHaveBeenCalledOnce();
    expect(useAppStore.getState().sessions).toEqual(mockSessions);
  });

  it("reset restores initial state", () => {
    useAppStore.getState().setRecording(true);
    useAppStore.getState().setCurrentSessionId(42);
    useAppStore.getState().reset();

    expect(useAppStore.getState().isRecording).toBe(false);
    expect(useAppStore.getState().currentSessionId).toBeNull();
  });
});
