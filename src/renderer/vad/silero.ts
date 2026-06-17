import * as ort from "onnxruntime-web";

const STATE_DIMS = [2, 1, 128] as const;
const STATE_SIZE = 2 * 1 * 128;
const WINDOW = 512;
// Silero v5 prepends the last 64 samples of the previous chunk as context, so
// the tensor actually fed to the model is 64 + 512 = 576 samples. Without this
// context the model sees a discontinuity and returns ~0 for all input.
const CONTEXT = 64;
const SR = 16000n;

export interface SileroVad {
  /** Feed one 512-sample float32 window; returns speech probability in [0,1]. */
  process(window: Float32Array): Promise<number>;
  /** Reset internal recurrent state + context (call at the start of a new recording). */
  reset(): void;
}

/**
 * Load the Silero v5 ONNX model and return a stateful VAD.
 * Throws if the model/wasm fail to load (caller handles fallback).
 */
export async function createSileroVad(modelUrl: string): Promise<SileroVad> {
  const session = await ort.InferenceSession.create(modelUrl);
  let state = new Float32Array(STATE_SIZE);
  let context = new Float32Array(CONTEXT);
  const sr = new ort.Tensor("int64", BigInt64Array.from([SR]), []);

  return {
    async process(window: Float32Array): Promise<number> {
      if (window.length !== WINDOW) {
        throw new Error(
          `Silero window must be ${WINDOW} samples, got ${window.length}`,
        );
      }
      // Build the [context | window] tensor the v5 model expects.
      const buf = new Float32Array(CONTEXT + WINDOW);
      buf.set(context, 0);
      buf.set(window, CONTEXT);

      const input = new ort.Tensor("float32", buf, [1, CONTEXT + WINDOW]);
      const stateTensor = new ort.Tensor("float32", state, [...STATE_DIMS]);
      const out = await session.run({ input, state: stateTensor, sr });
      state = Float32Array.from(out.stateN.data as Float32Array);
      // Carry the last CONTEXT samples (tail of this chunk) into the next call.
      context = buf.slice(CONTEXT + WINDOW - CONTEXT);
      return (out.output.data as Float32Array)[0];
    },
    reset(): void {
      state = new Float32Array(STATE_SIZE);
      context = new Float32Array(CONTEXT);
    },
  };
}
