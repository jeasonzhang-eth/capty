import * as ort from "onnxruntime-web";

const STATE_DIMS = [2, 1, 128] as const;
const STATE_SIZE = 2 * 1 * 128;
const WINDOW = 512;
const SR = 16000n;

export interface SileroVad {
  /** Feed one 512-sample float32 window; returns speech probability in [0,1]. */
  process(window: Float32Array): Promise<number>;
  /** Reset internal recurrent state (call at the start of a new recording). */
  reset(): void;
}

/**
 * Load the Silero v5 ONNX model and return a stateful VAD.
 * Throws if the model/wasm fail to load (caller handles fallback).
 */
export async function createSileroVad(modelUrl: string): Promise<SileroVad> {
  const session = await ort.InferenceSession.create(modelUrl);
  let state = new Float32Array(STATE_SIZE);
  const sr = new ort.Tensor("int64", BigInt64Array.from([SR]), []);

  return {
    async process(window: Float32Array): Promise<number> {
      if (window.length !== WINDOW) {
        throw new Error(
          `Silero window must be ${WINDOW} samples, got ${window.length}`,
        );
      }
      const input = new ort.Tensor("float32", window, [1, WINDOW]);
      const stateTensor = new ort.Tensor("float32", state, [...STATE_DIMS]);
      const out = await session.run({ input, state: stateTensor, sr });
      state = Float32Array.from(out.stateN.data as Float32Array);
      return (out.output.data as Float32Array)[0];
    },
    reset(): void {
      state = new Float32Array(STATE_SIZE);
    },
  };
}
