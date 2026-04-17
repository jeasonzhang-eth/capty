import { useState, useCallback, useRef } from "react";

interface SessionState {
  readonly isRecording: boolean;
  readonly currentSessionId: number | null;
  readonly segmentCount: number;
}

/** How often to flush buffered audio to disk (ms). */
const FLUSH_INTERVAL_MS = 2000;

function toArrayBuffer(
  view: Int16Array | Uint8Array,
): ArrayBuffer {
  return view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength,
  ) as ArrayBuffer;
}

export function useSession() {
  const [state, setState] = useState<SessionState>({
    isRecording: false,
    currentSessionId: null,
    segmentCount: 0,
  });

  const sessionDirRef = useRef<string>("");
  const sessionTimestampRef = useRef<string>("");

  // In-memory buffer that accumulates between flushes
  const pendingChunksRef = useRef<Int16Array[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Merge pending chunks and send to main process for disk write. */
  const flushAudio = useCallback((): Promise<void> => {
    const chunks = pendingChunksRef.current;
    if (chunks.length === 0) return Promise.resolve();
    pendingChunksRef.current = [];

    const totalLength = chunks.reduce((sum, buf) => sum + buf.length, 0);
    const merged = new Int16Array(totalLength);
    let offset = 0;
    for (const buf of chunks) {
      merged.set(buf, offset);
      offset += buf.length;
    }

    return window.capty.appendAudioStream(toArrayBuffer(merged));
  }, []);

  const startSession = useCallback(
    async (model: string): Promise<number> => {
      const sessionId = await window.capty.createSession(model);
      const dataDir = await window.capty.getDataDir();
      // Use local time for directory/file naming so it matches user's timezone
      const now = new Date();
      const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;
      const sessionDir = `${dataDir}/audio/${timestamp}`;
      sessionDirRef.current = sessionDir;
      sessionTimestampRef.current = timestamp;
      pendingChunksRef.current = [];

      // Save audio path to DB so delete can find the audio files
      await window.capty.updateSession(sessionId, { audioPath: timestamp });

      // Open streaming WAV file on disk — audio is written incrementally
      await window.capty.openAudioStream(sessionDir, `${timestamp}.wav`);

      // Start periodic flush timer
      flushTimerRef.current = setInterval(flushAudio, FLUSH_INTERVAL_MS);

      setState({
        isRecording: true,
        currentSessionId: sessionId,
        segmentCount: 0,
      });

      return sessionId;
    },
    [flushAudio],
  );

  const feedAudio = useCallback((pcm: Int16Array) => {
    pendingChunksRef.current.push(new Int16Array(pcm));
  }, []);

  const addSegmentResult = useCallback(
    async (
      text: string,
      startTime: number,
      endTime: number,
      pcmData: Int16Array,
    ) => {
      if (!state.currentSessionId) return;

      const segmentIndex = state.segmentCount + 1;
      const audioPath = `segments/${String(segmentIndex).padStart(3, "0")}.wav`;

      await window.capty.addSegment({
        sessionId: state.currentSessionId,
        startTime,
        endTime,
        text,
        audioPath,
        isFinal: true,
      });

      await window.capty.saveSegmentAudio(
        sessionDirRef.current,
        segmentIndex,
        toArrayBuffer(pcmData),
      );

      setState((prev) => ({ ...prev, segmentCount: prev.segmentCount + 1 }));
    },
    [state.currentSessionId, state.segmentCount],
  );

  const stopSession = useCallback(
    async (durationSeconds?: number) => {
      if (!state.currentSessionId) return;

      // Stop flush timer
      if (flushTimerRef.current) {
        clearInterval(flushTimerRef.current);
        flushTimerRef.current = null;
      }

      // Final flush of any remaining buffered audio
      await flushAudio();

      // Finalize the WAV file (fix header sizes)
      await window.capty.closeAudioStream();

      // Update session status with duration
      await window.capty.updateSession(state.currentSessionId, {
        status: "completed",
        durationSeconds: durationSeconds ?? 0,
        endedAt: new Date().toLocaleString("sv-SE").replace(" ", "T"),
      });

      pendingChunksRef.current = [];
      setState({
        isRecording: false,
        currentSessionId: null,
        segmentCount: 0,
      });
    },
    [state.currentSessionId, flushAudio],
  );

  return {
    ...state,
    startSession,
    feedAudio,
    addSegmentResult,
    stopSession,
  };
}
