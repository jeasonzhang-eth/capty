import { useCallback, useRef, useState } from "react";

interface TranscriptionCallbacks {
  readonly onFinal?: (
    text: string,
    segmentId: number,
    startTime: number,
    endTime: number,
  ) => void;
  readonly onError?: (message: string) => void;
}

interface AsrProvider {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

/**
 * Unified HTTP-based transcription hook.
 *
 * Buffers incoming PCM audio. When `sendSegmentEnd` is called (by VAD),
 * merges the buffer and POSTs it to the configured ASR provider via IPC.
 * Works with both the local sidecar and any external OpenAI-compatible API.
 */
export function useTranscription(callbacks: TranscriptionCallbacks = {}) {
  const [state, setState] = useState({
    isConnected: false,
    isReady: false,
  });

  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const providerRef = useRef<AsrProvider | null>(null);
  const bufferRef = useRef<Int16Array[]>([]);
  const segmentIdRef = useRef(0);
  const pendingRef = useRef(0);
  const readyRef = useRef(false);

  const setProvider = useCallback((provider: AsrProvider) => {
    providerRef.current = provider;
  }, []);

  const connect = useCallback(async () => {
    readyRef.current = true;
    setState({ isConnected: true, isReady: true });
    bufferRef.current = [];
    segmentIdRef.current = 0;
    pendingRef.current = 0;
  }, []);

  const sendAudio = useCallback((pcmBuffer: ArrayBuffer) => {
    if (!readyRef.current) return;
    bufferRef.current.push(new Int16Array(pcmBuffer));
  }, []);

  const sendSegmentEnd = useCallback((startTime: number, endTime: number) => {
    const provider = providerRef.current;
    if (!provider) return;

    const chunks = bufferRef.current;
    bufferRef.current = [];

    if (chunks.length === 0) return;

    // Merge buffered chunks into a single PCM buffer
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Int16Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const segId = ++segmentIdRef.current;
    pendingRef.current++;

    // Capture startTime/endTime at send time (not at callback time)
    // to avoid race conditions with subsequent speech events.
    const capturedStart = startTime;
    const capturedEnd = endTime;

    // Fire-and-forget HTTP POST via IPC
    window.capty
      .asrTranscribe(merged.buffer as ArrayBuffer, {
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
      })
      .then((result) => {
        pendingRef.current--;
        callbacksRef.current.onFinal?.(
          result.text,
          segId,
          capturedStart,
          capturedEnd,
        );
      })
      .catch((err: unknown) => {
        pendingRef.current--;
        const msg = err instanceof Error ? err.message : "Transcription failed";
        callbacksRef.current.onError?.(msg);
      });
  }, []);

  const disconnect = useCallback(() => {
    readyRef.current = false;
    bufferRef.current = [];
    setState({ isConnected: false, isReady: false });
  }, []);

  /** Flush remaining audio buffer, wait for result, then disconnect. */
  const gracefulDisconnect = useCallback(
    (startTime: number, endTime: number): Promise<void> => {
      const provider = providerRef.current;
      const chunks = bufferRef.current;
      bufferRef.current = [];

      if (!provider || chunks.length === 0) {
        readyRef.current = false;
        setState({ isConnected: false, isReady: false });
        return Promise.resolve();
      }

      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const merged = new Int16Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }

      const segId = ++segmentIdRef.current;
      pendingRef.current++;

      const capturedStart = startTime;
      const capturedEnd = endTime;

      return window.capty
        .asrTranscribe(merged.buffer as ArrayBuffer, {
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          model: provider.model,
        })
        .then((result) => {
          pendingRef.current--;
          callbacksRef.current.onFinal?.(
            result.text,
            segId,
            capturedStart,
            capturedEnd,
          );
        })
        .catch((err: unknown) => {
          pendingRef.current--;
          const msg =
            err instanceof Error ? err.message : "Transcription failed";
          callbacksRef.current.onError?.(msg);
        })
        .then(() => {
          // B2 fix: drain ALL in-flight requests before disconnecting
          if (pendingRef.current <= 0) return;
          return new Promise<void>((resolve) => {
            const check = () => {
              if (pendingRef.current <= 0) resolve();
              else setTimeout(check, 50);
            };
            check();
          });
        })
        .finally(() => {
          readyRef.current = false;
          setState({ isConnected: false, isReady: false });
        });
    },
    [],
  );

  return {
    ...state,
    connect,
    disconnect,
    gracefulDisconnect,
    sendAudio,
    sendSegmentEnd,
    setProvider,
  };
}
