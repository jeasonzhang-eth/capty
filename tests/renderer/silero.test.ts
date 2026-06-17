import { describe, it, expect } from "vitest";
import "./vitest-ort-setup";
import { resolve } from "path";
import { createSileroVad } from "../../src/renderer/vad/silero";

const MODEL = resolve(__dirname, "../../src/renderer/assets/silero_vad.onnx");

function silenceWindow(): Float32Array {
  return new Float32Array(512); // all zeros
}

describe("createSileroVad", () => {
  it("returns a probability in [0,1] for a window", async () => {
    const vad = await createSileroVad(MODEL);
    const p = await vad.process(silenceWindow());
    expect(typeof p).toBe("number");
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });

  it("scores silence as low speech probability", async () => {
    const vad = await createSileroVad(MODEL);
    let last = 1;
    for (let i = 0; i < 10; i++) last = await vad.process(silenceWindow());
    expect(last).toBeLessThan(0.5);
  });

  it("reset() makes the output sequence reproducible", async () => {
    const vad = await createSileroVad(MODEL);
    const noise = new Float32Array(512).map((_, i) => Math.sin(i) * 0.3);
    const a = await vad.process(noise);
    await vad.process(noise);
    vad.reset();
    const b = await vad.process(noise);
    expect(b).toBeCloseTo(a, 5); // same state (zero) → same first output
  });
});
