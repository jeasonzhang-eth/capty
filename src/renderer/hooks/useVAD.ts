import { useState, useCallback, useRef } from "react";

interface VADState {
  readonly isSpeaking: boolean;
  readonly isLoaded: boolean;
}

interface VADCallbacks {
  readonly onSpeechStart?: () => void;
  readonly onSpeechEnd?: () => void;
}

export function useVAD(callbacks: VADCallbacks = {}) {
  const [state, setState] = useState<VADState>({
    isSpeaking: false,
    isLoaded: false,
  });

  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const isSpeakingRef = useRef(false);

  const processSample = useCallback((isSpeech: boolean) => {
    if (isSpeech && !isSpeakingRef.current) {
      // Speech started
      isSpeakingRef.current = true;
      setState((prev) => ({ ...prev, isSpeaking: true }));
      callbacksRef.current.onSpeechStart?.();
    } else if (!isSpeech && isSpeakingRef.current) {
      // Speech ended
      isSpeakingRef.current = false;
      setState((prev) => ({ ...prev, isSpeaking: false }));
      callbacksRef.current.onSpeechEnd?.();
    }
  }, []);

  // Debounce counter to avoid rapid speech/silence switching
  const silenceCountRef = useRef(0);
  const speechCountRef = useRef(0);
  // Track consecutive speech frames for max segment duration
  const continuousSpeechFramesRef = useRef(0);

  // Require N consecutive frames before toggling state
  const SPEECH_FRAMES = 2;
  const SILENCE_FRAMES = 6; // ~1.5 seconds at 4096-sample buffer / 16kHz

  // Maximum segment duration: force segment_end after ~30 seconds of continuous speech
  // At 16kHz with 4096-sample buffer, each frame ≈ 256ms → 120 frames ≈ 30.7 seconds
  const MAX_SPEECH_FRAMES = 120;

  // Simple energy-based VAD
  const feedAudio = useCallback(
    (int16Audio: Int16Array) => {
      // Compute RMS energy directly from int16
      let energy = 0;
      for (let i = 0; i < int16Audio.length; i++) {
        const sample = int16Audio[i] / 32768.0;
        energy += sample * sample;
      }
      energy = energy / int16Audio.length;
      const frameIsSpeech = energy > 0.002;

      // Debounced state transitions
      if (frameIsSpeech) {
        silenceCountRef.current = 0;
        speechCountRef.current++;

        if (isSpeakingRef.current) {
          // Already speaking — track continuous duration
          continuousSpeechFramesRef.current++;

          // Force segment break at max duration to keep segments manageable
          if (continuousSpeechFramesRef.current >= MAX_SPEECH_FRAMES) {
            continuousSpeechFramesRef.current = 0;
            // Force end → immediate restart cycle
            processSample(false); // triggers onSpeechEnd
            processSample(true); // triggers onSpeechStart
          }
        } else if (speechCountRef.current >= SPEECH_FRAMES) {
          continuousSpeechFramesRef.current = 0;
          processSample(true);
        }
      } else {
        speechCountRef.current = 0;
        silenceCountRef.current++;
        if (
          isSpeakingRef.current &&
          silenceCountRef.current >= SILENCE_FRAMES
        ) {
          continuousSpeechFramesRef.current = 0;
          processSample(false);
        }
      }
    },
    [processSample],
  );

  const markLoaded = useCallback(() => {
    setState((prev) => ({ ...prev, isLoaded: true }));
  }, []);

  return {
    ...state,
    feedAudio,
    markLoaded,
  };
}
