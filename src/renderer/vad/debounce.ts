export interface SpeechDebouncerOptions {
  /** Consecutive speech frames required to confirm speech start. */
  readonly speechFrames: number;
  /** Consecutive silence frames required to confirm speech end. */
  readonly silenceFrames: number;
  /**
   * Max consecutive speech frames AFTER a confirmed start before forcing a
   * segment break. (Counting begins once speaking is confirmed, mirroring the
   * original energy-VAD behavior; the ~speechFrames before confirmation are
   * not counted.)
   */
  readonly maxSpeechFrames: number;
  readonly onSpeechStart?: () => void;
  readonly onSpeechEnd?: () => void;
}

export interface SpeechDebouncer {
  /** Push one frame's speech/silence decision. */
  push(isSpeech: boolean): void;
  /** Reset all counters and speaking state. */
  reset(): void;
}

/**
 * Frame-count debouncer extracted from the original energy VAD, parameterized
 * by frame thresholds so it works at any frame rate (256ms energy frames or
 * 32ms Silero windows).
 */
export function createSpeechDebouncer(
  opts: SpeechDebouncerOptions,
): SpeechDebouncer {
  let isSpeaking = false;
  let speechCount = 0;
  let silenceCount = 0;
  let continuousSpeech = 0;

  const start = () => {
    isSpeaking = true;
    opts.onSpeechStart?.();
  };
  const end = () => {
    isSpeaking = false;
    opts.onSpeechEnd?.();
  };

  return {
    push(isSpeech: boolean): void {
      if (isSpeech) {
        silenceCount = 0;
        speechCount++;
        if (isSpeaking) {
          continuousSpeech++;
          if (continuousSpeech >= opts.maxSpeechFrames) {
            continuousSpeech = 0;
            end();
            start();
          }
        } else if (speechCount >= opts.speechFrames) {
          continuousSpeech = 0;
          start();
        }
      } else {
        speechCount = 0;
        silenceCount++;
        if (isSpeaking && silenceCount >= opts.silenceFrames) {
          continuousSpeech = 0;
          end();
        }
      }
    },
    reset(): void {
      isSpeaking = false;
      speechCount = 0;
      silenceCount = 0;
      continuousSpeech = 0;
    },
  };
}
