import { describe, it, expect } from "vitest";
import "./vitest-ort-setup";
import * as ort from "onnxruntime-web";
import { resolve } from "path";

describe("silero_vad.onnx", () => {
  it("loads and exposes the Silero v5 tensor IO", async () => {
    const modelPath = resolve(
      __dirname,
      "../../src/renderer/assets/silero_vad.onnx",
    );
    const session = await ort.InferenceSession.create(modelPath);
    // v5 inputs: input, state, sr (NOT v4's h/c)
    expect(session.inputNames).toEqual(
      expect.arrayContaining(["input", "state", "sr"]),
    );
    expect(session.outputNames).toEqual(
      expect.arrayContaining(["output", "stateN"]),
    );
  });
});
