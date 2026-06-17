import { useState, useCallback, useRef, useEffect } from "react";
import { createSileroVad, type SileroVad } from "../vad/silero";
import { createSpeechDebouncer, type SpeechDebouncer } from "../vad/debounce";
// Bundled model URL (vite resolves to the hashed asset path at build time).
import sileroModelUrl from "../assets/silero_vad.onnx?url";

interface VADState {
  readonly isSpeaking: boolean;
  readonly isLoaded: boolean;
  /** True when Silero is unavailable and the energy fallback is active. */
  readonly degraded: boolean;
}

interface VADCallbacks {
  readonly onSpeechStart?: () => void;
  readonly onSpeechEnd?: () => void;
}

interface VADOptions {
  readonly modelUrl?: string;
  readonly createVad?: (url: string) => Promise<SileroVad>;
}

// Silero window granularity (512 samples @16kHz ≈ 32ms).
const WINDOW = 512;
const THRESHOLD = 0.5;
const SPEECH_WINDOWS = 8; // ~0.25s
const SILENCE_WINDOWS = 32; // ~1.0s
const MAX_SPEECH_WINDOWS = 938; // ~30s

// Energy fallback granularity (4096-sample buffers ≈ 256ms).
const ENERGY_THRESHOLD = 0.002;
const ENERGY_SPEECH_FRAMES = 2;
const ENERGY_SILENCE_FRAMES = 6;
const ENERGY_MAX_SPEECH_FRAMES = 120;

const MAX_BACKLOG = 64; // drop oldest windows beyond this (should never trigger)

export function useVAD(callbacks: VADCallbacks = {}, options: VADOptions = {}) {
  const [state, setState] = useState<VADState>({
    isSpeaking: false,
    isLoaded: false,
    degraded: false,
  });

  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const setSpeaking = useCallback((speaking: boolean) => {
    setState((prev) =>
      prev.isSpeaking === speaking ? prev : { ...prev, isSpeaking: speaking },
    );
  }, []);

  // Debouncers share the same speech start/end handlers.
  const makeDebouncer = useCallback(
    (speechFrames: number, silenceFrames: number, maxSpeechFrames: number) =>
      createSpeechDebouncer({
        speechFrames,
        silenceFrames,
        maxSpeechFrames,
        onSpeechStart: () => {
          setSpeaking(true);
          callbacksRef.current.onSpeechStart?.();
        },
        onSpeechEnd: () => {
          setSpeaking(false);
          callbacksRef.current.onSpeechEnd?.();
        },
      }),
    [setSpeaking],
  );

  const sileroRef = useRef<SileroVad | null>(null);
  const sileroDebouncerRef = useRef<SpeechDebouncer | null>(null);
  const energyDebouncerRef = useRef<SpeechDebouncer | null>(null);
  const degradedRef = useRef(false);

  // Async inference queue (preserves window order).
  const queueRef = useRef<Float32Array[]>([]);
  const pumpingRef = useRef(false);
  const remainderRef = useRef<Float32Array>(new Float32Array(0));

  if (sileroDebouncerRef.current === null) {
    sileroDebouncerRef.current = makeDebouncer(
      SPEECH_WINDOWS,
      SILENCE_WINDOWS,
      MAX_SPEECH_WINDOWS,
    );
  }
  if (energyDebouncerRef.current === null) {
    energyDebouncerRef.current = makeDebouncer(
      ENERGY_SPEECH_FRAMES,
      ENERGY_SILENCE_FRAMES,
      ENERGY_MAX_SPEECH_FRAMES,
    );
  }

  // Load Silero on mount.
  useEffect(() => {
    let cancelled = false;
    const create = options.createVad ?? createSileroVad;
    const url = options.modelUrl ?? sileroModelUrl;
    create(url)
      .then((vad) => {
        if (cancelled) return;
        sileroRef.current = vad;
        degradedRef.current = false;
        setState((prev) => ({ ...prev, isLoaded: true, degraded: false }));
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("Silero VAD unavailable, falling back to energy VAD:", err);
        degradedRef.current = true;
        setState((prev) => ({ ...prev, isLoaded: true, degraded: true }));
      });
    return () => {
      cancelled = true;
    };
    // options is intentionally read once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pump = useCallback(async () => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const win = queueRef.current.shift()!;
        const silero = sileroRef.current;
        if (!silero) break;
        let isSpeech = false;
        try {
          const prob = await silero.process(win);
          isSpeech = prob > THRESHOLD;
        } catch (err) {
          // Conservative: treat inference errors as silence.
          console.warn("Silero inference error, treating window as silence:", err);
          isSpeech = false;
        }
        sileroDebouncerRef.current!.push(isSpeech);
      }
    } finally {
      pumpingRef.current = false;
    }
  }, []);

  const feedAudioEnergy = useCallback((int16: Int16Array) => {
    let energy = 0;
    for (let i = 0; i < int16.length; i++) {
      const s = int16[i] / 32768.0;
      energy += s * s;
    }
    energy /= int16.length;
    energyDebouncerRef.current!.push(energy > ENERGY_THRESHOLD);
  }, []);

  const feedAudio = useCallback(
    (int16: Int16Array) => {
      if (degradedRef.current || !sileroRef.current) {
        if (degradedRef.current) feedAudioEnergy(int16);
        // If Silero not loaded yet (and not degraded), drop this buffer.
        return;
      }
      // int16 → float32
      const f = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) f[i] = int16[i] / 32768.0;

      // Concatenate remainder + new samples, slice into 512 windows.
      const prev = remainderRef.current;
      const data = new Float32Array(prev.length + f.length);
      data.set(prev);
      data.set(f, prev.length);

      let offset = 0;
      while (offset + WINDOW <= data.length) {
        queueRef.current.push(data.slice(offset, offset + WINDOW));
        offset += WINDOW;
      }
      remainderRef.current = data.slice(offset);

      // Drop oldest windows if backlog grows unexpectedly.
      if (queueRef.current.length > MAX_BACKLOG) {
        const drop = queueRef.current.length - MAX_BACKLOG;
        queueRef.current.splice(0, drop);
        console.warn(`VAD backlog overflow, dropped ${drop} windows`);
      }
      void pump();
    },
    [feedAudioEnergy, pump],
  );

  const reset = useCallback(() => {
    sileroRef.current?.reset();
    sileroDebouncerRef.current!.reset();
    energyDebouncerRef.current!.reset();
    queueRef.current = [];
    remainderRef.current = new Float32Array(0);
    setSpeaking(false);
  }, [setSpeaking]);

  // Retained for backward compatibility; loading is now driven by the model.
  const markLoaded = useCallback(() => {}, []);

  return {
    ...state,
    feedAudio,
    reset,
    markLoaded,
  };
}
