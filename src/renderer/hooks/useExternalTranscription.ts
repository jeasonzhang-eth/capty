import { useState, useCallback, useRef } from "react";

interface ExternalTranscriptionCallbacks {
  readonly onFinal?: (text: string, segmentId: number) => void;
  readonly onError?: (message: string) => void;
}

interface AsrProviderConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

export function useExternalTranscription(
  callbacks: ExternalTranscriptionCallbacks = {},
) {
  const [state, setState] = useState({
    isConnected: false,
    isReady: false,
    partialText: "",
  });

  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const providerRef = useRef<AsrProviderConfig | null>(null);
  const bufferRef = useRef<Int16Array[]>([]);
  const segmentIdRef = useRef(0);
  const pendingRef = useRef(0);
  const readyRef = useRef(false);

  const setProvider = useCallback((provider: AsrProviderConfig) => {
    providerRef.current = provider;
  }, []);

  const connect = useCallback(async () => {
    // No network operation for HTTP mode — immediately ready
    readyRef.current = true;
    setState({ isConnected: true, isReady: true, partialText: "" });
    bufferRef.current = [];
    segmentIdRef.current = 0;
    pendingRef.current = 0;
  }, []);

  const sendAudio = useCallback((pcmBuffer: ArrayBuffer) => {
    if (!readyRef.current) return;
    bufferRef.current.push(new Int16Array(pcmBuffer));
  }, []);

  const sendSegmentEnd = useCallback(() => {
    const provider = providerRef.current;
    if (!provider) return;

    const chunks = bufferRef.current;
    bufferRef.current = [];

    if (chunks.length === 0) return;

    // Merge chunks into single buffer
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Int16Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const segId = ++segmentIdRef.current;
    pendingRef.current++;

    // Fire-and-forget: POST via IPC, callback on result
    window.capty
      .asrTranscribe(merged.buffer as ArrayBuffer, {
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
      })
      .then((result) => {
        pendingRef.current--;
        callbacksRef.current.onFinal?.(result.text, segId);
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
    setState({ isConnected: false, isReady: false, partialText: "" });
  }, []);

  const gracefulDisconnect = useCallback((): Promise<void> => {
    // Flush any remaining buffer
    const provider = providerRef.current;
    const chunks = bufferRef.current;
    bufferRef.current = [];

    if (!provider || chunks.length === 0) {
      setState({ isConnected: false, isReady: false, partialText: "" });
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

    return window.capty
      .asrTranscribe(merged.buffer as ArrayBuffer, {
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
      })
      .then((result) => {
        pendingRef.current--;
        callbacksRef.current.onFinal?.(result.text, segId);
      })
      .catch((err: unknown) => {
        pendingRef.current--;
        const msg = err instanceof Error ? err.message : "Transcription failed";
        callbacksRef.current.onError?.(msg);
      })
      .finally(() => {
        readyRef.current = false;
        setState({ isConnected: false, isReady: false, partialText: "" });
      });
  }, []);

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
