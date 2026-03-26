import { useState, useCallback, useRef } from "react";

declare global {
  interface Window {
    capty: {
      createSession: (modelName: string) => Promise<number>;
      listSessions: () => Promise<unknown[]>;
      getSession: (id: number) => Promise<unknown>;
      updateSession: (
        id: number,
        fields: Record<string, unknown>,
      ) => Promise<void>;
      deleteSession: (id: number) => Promise<void>;
      addSegment: (opts: Record<string, unknown>) => Promise<number>;
      listSegments: (sessionId: number) => Promise<
        {
          id: number;
          session_id: number;
          start_time: number;
          end_time: number;
          text: string;
        }[]
      >;
      saveSegmentAudio: (
        sessionDir: string,
        segmentIndex: number,
        pcmData: ArrayBuffer,
      ) => Promise<void>;
      saveFullAudio: (
        sessionDir: string,
        pcmData: ArrayBuffer,
        fileName?: string,
      ) => Promise<void>;
      openAudioStream: (sessionDir: string, fileName: string) => Promise<void>;
      appendAudioStream: (pcmData: ArrayBuffer) => Promise<void>;
      closeAudioStream: () => Promise<void>;
      exportTxt: (
        sessionId: number,
        opts: Record<string, unknown>,
      ) => Promise<string>;
      exportSrt: (sessionId: number) => Promise<string>;
      exportMarkdown: (sessionId: number) => Promise<string>;
      downloadModel: (repo: string, destDir: string) => Promise<void>;
      onDownloadProgress: (
        callback: (progress: {
          downloaded: number;
          total: number;
          percent: number;
        }) => void,
      ) => () => void;
      getConfig: () => Promise<Record<string, unknown>>;
      setConfig: (config: Record<string, unknown>) => Promise<void>;
      getSidecarUrl: () => Promise<string>;
      checkSidecarHealth: () => Promise<{
        online: boolean;
        [key: string]: unknown;
      }>;
      asrTranscribe: (
        pcmData: ArrayBuffer,
        provider: { baseUrl: string; apiKey: string; model: string },
      ) => Promise<{ text: string }>;
      asrTest: (provider: {
        baseUrl: string;
        apiKey: string;
        model: string;
      }) => Promise<{ success: boolean }>;
      asrFetchModels: (provider: {
        baseUrl: string;
        apiKey: string;
      }) => Promise<Array<{ id: string; name: string }>>;
      listModels: () => Promise<unknown[]>;
      searchModels: (query: string) => Promise<unknown[]>;
      deleteModel: (modelId: string) => Promise<void>;
      saveModelMeta: (
        modelId: string,
        meta: Record<string, unknown>,
      ) => Promise<void>;
      deleteSegments: (sessionId: number) => Promise<void>;
      setZoomFactor: (factor: number) => Promise<void>;
      getZoomFactor: () => Promise<number>;
      saveLayout: (opts: {
        historyPanelWidth?: number;
        summaryPanelWidth?: number;
      }) => Promise<void>;
      readAudioFile: (sessionId: number) => Promise<ArrayBuffer | null>;
      getAudioDir: (sessionId: number) => Promise<string | null>;
      getDataDir: () => Promise<string | null>;
      getConfigDir: () => Promise<string>;
      selectDirectory: () => Promise<string | null>;
      openConfigDir: () => Promise<void>;
      openAudioFolder: (sessionId: number) => Promise<void>;
      testLlmProvider: (provider: {
        baseUrl: string;
        apiKey: string;
        model: string;
      }) => Promise<{ success: boolean; model: string }>;
      summarize: (
        sessionId: number,
        providerId: string,
        promptType: string,
      ) => Promise<{
        id: number;
        session_id: number;
        content: string;
        model_name: string;
        provider_id: string;
        prompt_type: string;
        created_at: string;
      }>;
      onSummaryChunk: (
        callback: (data: { content: string; done: boolean }) => void,
      ) => () => void;
      listSummaries: (
        sessionId: number,
        promptType?: string,
      ) => Promise<
        {
          id: number;
          session_id: number;
          content: string;
          model_name: string;
          provider_id: string;
          prompt_type: string;
          created_at: string;
        }[]
      >;
      deleteSummary: (summaryId: number) => Promise<void>;
      listPromptTypes: () => Promise<
        {
          id: string;
          label: string;
          systemPrompt: string;
          isBuiltin: boolean;
        }[]
      >;
      savePromptTypes: (
        types: {
          id: string;
          label: string;
          systemPrompt: string;
          isBuiltin: boolean;
        }[],
      ) => Promise<void>;
    };
  }
}

interface SessionState {
  readonly isRecording: boolean;
  readonly currentSessionId: number | null;
  readonly segmentCount: number;
}

/** How often to flush buffered audio to disk (ms). */
const FLUSH_INTERVAL_MS = 2000;

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
  const flushAudio = useCallback(() => {
    const chunks = pendingChunksRef.current;
    if (chunks.length === 0) return;
    pendingChunksRef.current = [];

    const totalLength = chunks.reduce((sum, buf) => sum + buf.length, 0);
    const merged = new Int16Array(totalLength);
    let offset = 0;
    for (const buf of chunks) {
      merged.set(buf, offset);
      offset += buf.length;
    }

    // Fire-and-forget — don't await to avoid blocking audio callback
    window.capty.appendAudioStream(merged.buffer as ArrayBuffer);
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
        pcmData.buffer as ArrayBuffer,
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
      flushAudio();

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
