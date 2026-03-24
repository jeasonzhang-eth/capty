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
      listModels: () => Promise<unknown[]>;
      searchModels: (query: string) => Promise<unknown[]>;
      deleteModel: (modelId: string) => Promise<void>;
      saveModelMeta: (
        modelId: string,
        meta: Record<string, unknown>,
      ) => Promise<void>;
      deleteSegments: (sessionId: number) => Promise<void>;
      readAudioFile: (sessionId: number) => Promise<ArrayBuffer | null>;
      getAudioDir: (sessionId: number) => Promise<string | null>;
      getDataDir: () => Promise<string | null>;
      getConfigDir: () => Promise<string>;
      selectDirectory: () => Promise<string | null>;
      openConfigDir: () => Promise<void>;
      openAudioFolder: (sessionId: number) => Promise<void>;
    };
  }
}

interface SessionState {
  readonly isRecording: boolean;
  readonly currentSessionId: number | null;
  readonly segmentCount: number;
}

export function useSession() {
  const [state, setState] = useState<SessionState>({
    isRecording: false,
    currentSessionId: null,
    segmentCount: 0,
  });

  const sessionDirRef = useRef<string>("");
  const sessionTimestampRef = useRef<string>("");
  const fullAudioBufferRef = useRef<Int16Array[]>([]);

  const startSession = useCallback(async (model: string): Promise<number> => {
    const sessionId = await window.capty.createSession(model);
    const dataDir = await window.capty.getDataDir();
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    sessionDirRef.current = `${dataDir}/audio/${timestamp}`;
    sessionTimestampRef.current = timestamp;
    fullAudioBufferRef.current = [];

    // Save audio path to DB so delete can find the audio files
    await window.capty.updateSession(sessionId, { audioPath: timestamp });

    setState({
      isRecording: true,
      currentSessionId: sessionId,
      segmentCount: 0,
    });

    return sessionId;
  }, []);

  const feedAudio = useCallback((pcm: Int16Array) => {
    fullAudioBufferRef.current.push(new Int16Array(pcm));
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

      // Accumulate audio for full session
      fullAudioBufferRef.current.push(new Int16Array(pcmData));

      setState((prev) => ({ ...prev, segmentCount: prev.segmentCount + 1 }));
    },
    [state.currentSessionId, state.segmentCount],
  );

  const stopSession = useCallback(
    async (durationSeconds?: number) => {
      if (!state.currentSessionId) return;

      // Concatenate all audio buffers
      const totalLength = fullAudioBufferRef.current.reduce(
        (sum, buf) => sum + buf.length,
        0,
      );
      const fullAudio = new Int16Array(totalLength);
      let offset = 0;
      for (const buf of fullAudioBufferRef.current) {
        fullAudio.set(buf, offset);
        offset += buf.length;
      }

      // Save full audio with timestamp-based filename
      await window.capty.saveFullAudio(
        sessionDirRef.current,
        fullAudio.buffer as ArrayBuffer,
        `${sessionTimestampRef.current}.wav`,
      );

      // Update session status with duration
      await window.capty.updateSession(state.currentSessionId, {
        status: "completed",
        durationSeconds: durationSeconds ?? 0,
        endedAt: new Date().toISOString(),
      });

      fullAudioBufferRef.current = [];
      setState({
        isRecording: false,
        currentSessionId: null,
        segmentCount: 0,
      });
    },
    [state.currentSessionId],
  );

  return {
    ...state,
    startSession,
    feedAudio,
    addSegmentResult,
    stopSession,
  };
}
