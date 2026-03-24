import { useState, useCallback, useRef } from "react";

interface TranscriptionState {
  readonly isConnected: boolean;
  readonly isReady: boolean;
  readonly partialText: string;
}

interface TranscriptionCallbacks {
  readonly onFinal?: (text: string, segmentId: number) => void;
  readonly onError?: (message: string) => void;
}

export function useTranscription(callbacks: TranscriptionCallbacks = {}) {
  const [state, setState] = useState<TranscriptionState>({
    isConnected: false,
    isReady: false,
    partialText: "",
  });

  const wsRef = useRef<WebSocket | null>(null);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const connect = useCallback(
    async (sidecarUrl: string, model: string, language: string = "auto") => {
      const wsUrl = sidecarUrl.replace(/^http/, "ws") + "/ws/transcribe";
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Connection timeout")),
          10000,
        );

        ws.onopen = () => {
          setState((prev) => ({ ...prev, isConnected: true }));
          ws.send(JSON.stringify({ type: "start", model, language }));
        };

        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            text?: string;
            segment_id?: number;
            message?: string;
          };

          if (msg.type === "ready") {
            clearTimeout(timeout);
            setState((prev) => ({ ...prev, isReady: true }));
            resolve();
          } else if (msg.type === "partial") {
            setState((prev) => ({
              ...prev,
              partialText: prev.partialText + (msg.text ?? ""),
            }));
          } else if (msg.type === "final") {
            setState((prev) => ({ ...prev, partialText: "" }));
            callbacksRef.current.onFinal?.(msg.text ?? "", msg.segment_id ?? 0);
          } else if (msg.type === "error") {
            callbacksRef.current.onError?.(msg.message ?? "Unknown error");
          }
        };

        ws.onclose = () => {
          setState({ isConnected: false, isReady: false, partialText: "" });
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("WebSocket connection failed"));
        };
      });
    },
    [],
  );

  const sendAudio = useCallback((pcmBuffer: ArrayBuffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(pcmBuffer);
    }
  }, []);

  const sendSegmentEnd = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "segment_end" }));
    }
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "stop" }));
      wsRef.current.close();
    }
    wsRef.current = null;
    setState({ isConnected: false, isReady: false, partialText: "" });
  }, []);

  /**
   * Gracefully disconnect: send segment_end to flush remaining audio,
   * wait for the final response, then close the WebSocket.
   * Returns a promise that resolves when the last final is received
   * or times out after a few seconds.
   */
  const gracefulDisconnect = useCallback((): Promise<void> => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      wsRef.current = null;
      setState({ isConnected: false, isReady: false, partialText: "" });
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        // Timeout — force close
        ws.send(JSON.stringify({ type: "stop" }));
        ws.close();
        wsRef.current = null;
        setState({ isConnected: false, isReady: false, partialText: "" });
        resolve();
      }, 10000);

      // Replace onmessage to intercept the final response
      const originalOnMessage = ws.onmessage;
      ws.onmessage = (event) => {
        // Delegate to original handler first (updates state, calls callbacks)
        if (originalOnMessage) {
          originalOnMessage.call(ws, event);
        }
        const msg = JSON.parse(event.data as string) as { type: string };
        if (msg.type === "final" || msg.type === "error") {
          clearTimeout(timeout);
          ws.send(JSON.stringify({ type: "stop" }));
          ws.close();
          wsRef.current = null;
          setState({ isConnected: false, isReady: false, partialText: "" });
          resolve();
        }
      };

      // Send segment_end to flush remaining audio
      ws.send(JSON.stringify({ type: "segment_end" }));
    });
  }, []);

  return {
    ...state,
    connect,
    disconnect,
    gracefulDisconnect,
    sendAudio,
    sendSegmentEnd,
  };
}
