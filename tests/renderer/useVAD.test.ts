// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useVAD } from "../../src/renderer/hooks/useVAD";
import type { SileroVad } from "../../src/renderer/vad/silero";

// A fake Silero whose probability we control via a queue of values.
function fakeVadFactory(probs: number[]) {
  let i = 0;
  const vad: SileroVad = {
    async process() {
      const p = probs[Math.min(i, probs.length - 1)];
      i++;
      return p;
    },
    reset() {
      i = 0;
    },
  };
  return () => Promise.resolve(vad);
}

// 4096-sample int16 buffer = 8 Silero windows.
function buffer4096(): Int16Array {
  return new Int16Array(4096);
}

describe("useVAD with Silero", () => {
  it("fires onSpeechStart once enough speech windows accumulate", async () => {
    const onSpeechStart = vi.fn();
    const { result } = renderHook(() =>
      useVAD({ onSpeechStart }, { createVad: fakeVadFactory([0.9]) }),
    );
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    await act(async () => {
      result.current.feedAudio(buffer4096());
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    expect(result.current.degraded).toBe(false);
  });

  it("falls back to energy VAD and sets degraded when Silero fails to load", async () => {
    const onSpeechStart = vi.fn();
    const failing = () => Promise.reject(new Error("wasm boom"));
    const { result } = renderHook(() =>
      useVAD({ onSpeechStart }, { createVad: failing }),
    );
    await waitFor(() => expect(result.current.degraded).toBe(true));
    const loud = new Int16Array(4096).fill(8000);
    await act(async () => {
      result.current.feedAudio(loud);
      result.current.feedAudio(loud);
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
  });
});
