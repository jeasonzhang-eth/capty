import { describe, it, expect } from "vitest";
import "./vitest-ort-setup";
import { resolve } from "path";
import { readFileSync } from "fs";
import { createSileroVad } from "../../src/renderer/vad/silero";

const MODEL = resolve(__dirname, "../../src/renderer/assets/silero_vad.onnx");
const SPEECH = resolve(__dirname, "../fixtures/speech-16k.wav");

function silenceWindow(): Float32Array {
  return new Float32Array(512); // all zeros
}

/** Read a 16kHz mono 16-bit PCM WAV into float32 [-1,1]. */
function readWavPcm16(path: string): Float32Array {
  const buf = readFileSync(path);
  let off = 12;
  let dataOff = -1;
  let dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "data") {
      dataOff = off + 8;
      dataLen = size;
      break;
    }
    off += 8 + size + (size % 2);
  }
  if (dataOff < 0) throw new Error("no data chunk in WAV");
  const n = Math.floor(dataLen / 2);
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = buf.readInt16LE(dataOff + i * 2) / 32768.0;
  return f;
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
    const tone = new Float32Array(512).map((_, i) => Math.sin(i) * 0.3);
    const a = await vad.process(tone);
    await vad.process(tone);
    vad.reset();
    const b = await vad.process(tone);
    expect(b).toBeCloseTo(a, 5); // same reset state → same first output
  });

  it("rejects a window that is not 512 samples", async () => {
    const vad = await createSileroVad(MODEL);
    await expect(vad.process(new Float32Array(256))).rejects.toThrow();
  });

  // Regression guard: Silero v5 needs the 64-sample context prepended to each
  // 512-sample window (576 total). Without it the model returns ~0 for ALL
  // input, including clear speech. This feeds a real speech clip and asserts
  // the model fires.
  it("scores clear speech as high probability", async () => {
    const samples = readWavPcm16(SPEECH);
    const vad = await createSileroVad(MODEL);
    let max = 0;
    let over = 0;
    let total = 0;
    for (let off = 0; off + 512 <= samples.length; off += 512) {
      const p = await vad.process(samples.slice(off, off + 512));
      if (p > max) max = p;
      if (p > 0.5) over++;
      total++;
    }
    expect(max).toBeGreaterThan(0.8);
    expect(over).toBeGreaterThan(0); // at least some windows detected as speech
    expect(total).toBeGreaterThan(0);
  });
});
