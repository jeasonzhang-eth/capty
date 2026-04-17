import { useState, useCallback, useRef } from "react";
import { SessionCategory } from "../components/HistoryPanel";
import { Summary } from "../components/SummaryPanel";
import { useAppStore } from "../stores/appStore";

// ── Param types ──────────────────────────────────────────────────────────

interface UseSessionManagementParams {
  readonly store: {
    readonly isRecording: boolean;
    readonly currentSessionId: number | null;
    readonly selectedModelId: string;
    readonly asrProviders: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly baseUrl: string;
      readonly apiKey: string;
      readonly model: string;
      readonly isSidecar: boolean;
    }>;
    readonly selectedAsrProviderId: string | null;
    readonly sessions: ReadonlyArray<{
      readonly id: number;
      readonly title: string;
      readonly started_at: string;
      readonly duration_seconds: number | null;
    }>;
    readonly setRecording: (v: boolean) => void;
    readonly clearSegments: () => void;
    readonly setElapsedSeconds: (v: number) => void;
    readonly setCurrentSessionId: (id: number | null) => void;
    readonly setPartialText: (t: string) => void;
    readonly setSegments: (
      segs: ReadonlyArray<{
        id: number;
        start_time: number;
        end_time: number;
        text: string;
      }>,
    ) => void;
    readonly addSegment: (seg: {
      id: number;
      start_time: number;
      end_time: number;
      text: string;
    }) => void;
    readonly loadSessions: () => Promise<void>;
    readonly setDataDir: (dir: string) => void;
    readonly setAsrProviders: (
      providers: import("../stores/appStore").AsrProviderState[],
    ) => void;
    readonly setSelectedAsrProviderId: (id: string | null) => void;
  };
  readonly session: {
    readonly startSession: (model: string) => Promise<number>;
    readonly feedAudio: (pcm: Int16Array) => void;
    readonly stopSession: (duration?: number) => Promise<void>;
  };
  readonly audioCapture: {
    readonly start: (onData: (pcm: Int16Array) => void) => Promise<void>;
    readonly stop: () => void;
    readonly setSelectedDevice: (id: string | null) => void;
  };
  readonly audioPlayer: {
    readonly playingSessionId: number | null;
    readonly stop: () => void;
    readonly play: (sessionId: number) => void;
  };
  readonly transcription: {
    readonly sendAudio: (buf: ArrayBuffer) => void;
    readonly sendSegmentEnd: (start: number, end: number) => void;
    readonly setProvider: (p: {
      baseUrl: string;
      apiKey: string;
      model: string;
    }) => void;
    readonly connect: () => Promise<void>;
    readonly gracefulDisconnect: (start: number, end: number) => Promise<void>;
  };
  readonly vad: {
    readonly feedAudio: (pcm: Int16Array) => void;
  };
  readonly summary: {
    readonly setSummaries: (s: Summary[]) => void;
    readonly setGenerateError: (e: string | null) => void;
    readonly activePromptType: string;
  };
  readonly translation: {
    readonly activeTranslationLang: string | null;
    readonly setTranslations: (t: Record<number, string>) => void;
    readonly handleLoadTranslations: (
      sessionId: number,
      lang: string,
    ) => Promise<void>;
  };
  readonly setNeedsSetup: (v: boolean | null) => void;
}

// ── Constants ────────────────────────────────────────────────────────────

const SAMPLE_RATE = 16000;

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength,
  ) as ArrayBuffer;
}

// ── Hook ─────────────────────────────────────────────────────────────────

export function useSessionManagement(params: UseSessionManagementParams) {
  // Keep params fresh via ref to avoid stale closures
  const p = useRef(params);
  p.current = params;

  // ── State ────────────────────────────────────────────────────────────

  const [regeneratingSessionId, setRegeneratingSessionId] = useState<
    number | null
  >(null);
  const [regenerationProgress, setRegenerationProgress] = useState(0);
  const cancelRegenerationRef = useRef(false);

  const [audioLevel, setAudioLevel] = useState(0);
  const [sessionCategories, setSessionCategories] = useState<SessionCategory[]>(
    [],
  );

  // ── Refs ─────────────────────────────────────────────────────────────

  // Monotonic counter for segment IDs (avoids Date.now() collisions)
  const segmentIdCounter = useRef(0);
  // B1 fix: capture sessionId at recording start so late callbacks use the correct value
  const recordingSessionIdRef = useRef<number | null>(null);

  // Precise audio time tracking (sample-based, not wall-clock)
  const audioSamplesRef = useRef(0);
  const segmentStartRef = useRef(0);
  const segmentEndRef = useRef(0);

  // Keep sendSegmentEnd fresh for speech-end handler
  const sendSegmentEndRef = useRef(p.current.transcription.sendSegmentEnd);
  sendSegmentEndRef.current = p.current.transcription.sendSegmentEnd;

  // Timer for elapsed recording time
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);

  // Keep audioPlayer fresh for callbacks (avoids stale closure)
  const audioPlayerRef = useRef(p.current.audioPlayer);
  audioPlayerRef.current = p.current.audioPlayer;

  // ── Helpers ──────────────────────────────────────────────────────────

  const getAudioSeconds = (): number =>
    Math.round(audioSamplesRef.current / SAMPLE_RATE);

  // ── Transcription callbacks (passed to useTranscription via ref bridge) ──

  const onFinalCallback = useCallback(
    async (
      text: string,
      _segId: number,
      startTime: number,
      endTime: number,
    ) => {
      if (!text.trim()) return;
      const sessionId = recordingSessionIdRef.current;
      if (sessionId) {
        await window.capty.addSegment({
          sessionId,
          startTime,
          endTime,
          text,
          audioPath: "",
          isFinal: true,
        });
      }
      p.current.store.addSegment({
        id: ++segmentIdCounter.current,
        start_time: startTime,
        end_time: endTime,
        text,
      });
    },
    [],
  );

  const onErrorCallback = useCallback((msg: string) => {
    console.error("Transcription error:", msg);
  }, []);

  // ── VAD speech callbacks (passed to useVAD via ref bridge) ───────────

  const onSpeechStart = useCallback(() => {
    segmentStartRef.current = getAudioSeconds();
  }, []);

  const onSpeechEnd = useCallback(() => {
    segmentEndRef.current = getAudioSeconds();
    sendSegmentEndRef.current(segmentStartRef.current, segmentEndRef.current);
  }, []);

  // ── Recording flow ───────────────────────────────────────────────────

  const handleStart = useCallback(async () => {
    if (p.current.store.isRecording) return;
    // Block recording during subtitle regeneration
    if (regeneratingSessionId !== null) return;

    // Stop any active playback before recording
    p.current.audioPlayer.stop();

    // Immediately show recording UI (optimistic)
    p.current.store.setRecording(true);
    p.current.store.clearSegments();
    p.current.store.setElapsedSeconds(0);
    elapsedRef.current = 0;
    audioSamplesRef.current = 0;

    // Start elapsed timer right away
    timerRef.current = setInterval(() => {
      elapsedRef.current = elapsedRef.current + 1;
      p.current.store.setElapsedSeconds(elapsedRef.current);
    }, 1000);

    try {
      const sessionId = await p.current.session.startSession(
        p.current.store.selectedModelId,
      );
      p.current.store.setCurrentSessionId(sessionId);
      recordingSessionIdRef.current = sessionId;

      // Start audio capture (triggers mic permission prompt)
      await p.current.audioCapture.start((pcm: Int16Array) => {
        audioSamplesRef.current += pcm.length;
        p.current.session.feedAudio(pcm);
        p.current.vad.feedAudio(pcm);
        // Stream all audio to sidecar continuously (VAD triggers segment_end)
        p.current.transcription.sendAudio(pcm.buffer);
        // Compute audio level for visualization (RMS)
        let sum = 0;
        for (let i = 0; i < pcm.length; i++) {
          sum += (pcm[i] / 32768) * (pcm[i] / 32768);
        }
        const rms = Math.sqrt(sum / pcm.length);
        setAudioLevel(Math.min(1, rms * 20));
      });

      // Refresh history to show the new session
      p.current.store.loadSessions();

      // Configure transcription provider and connect
      const activeProvider = p.current.store.asrProviders.find(
        (pr) => pr.id === p.current.store.selectedAsrProviderId,
      );
      if (!activeProvider) {
        console.warn("No ASR provider selected");
        p.current.store.setRecording(false);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        return;
      }
      p.current.transcription.setProvider({
        baseUrl: activeProvider.baseUrl,
        apiKey: activeProvider.apiKey,
        model: activeProvider.isSidecar
          ? p.current.store.selectedModelId
          : activeProvider.model,
      });
      try {
        await p.current.transcription.connect();
      } catch (err) {
        console.error("ASR connection failed:", err);
      }
    } catch (err) {
      console.error("Failed to start recording:", err);
      p.current.store.setRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [regeneratingSessionId]);

  const handleStop = useCallback(async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    p.current.audioCapture.stop();
    segmentEndRef.current = getAudioSeconds();

    await p.current.transcription.gracefulDisconnect(
      segmentStartRef.current,
      segmentEndRef.current,
    );

    await p.current.session.stopSession(elapsedRef.current);

    p.current.store.setRecording(false);
    p.current.store.setCurrentSessionId(null);
    recordingSessionIdRef.current = null;
    p.current.store.setPartialText("");

    await p.current.store.loadSessions();
  }, []);

  // ── Wizard completion ────────────────────────────────────────────────

  const handleWizardComplete = useCallback((dataDir: string) => {
    p.current.store.setDataDir(dataDir);
    p.current.setNeedsSetup(false);
  }, []);

  // ── Session CRUD ─────────────────────────────────────────────────────

  const handleSelectSession = useCallback(async (sessionId: number) => {
    try {
      if (
        audioPlayerRef.current.playingSessionId !== null &&
        audioPlayerRef.current.playingSessionId !== sessionId
      ) {
        audioPlayerRef.current.stop();
      }
      p.current.store.setCurrentSessionId(sessionId);
      p.current.summary.setGenerateError(null);
      const segments = await window.capty.listSegments(sessionId);
      p.current.store.setSegments(
        segments.map((s: { id: number; start_time: number; end_time: number; text: string }) => ({
          id: s.id,
          start_time: s.start_time,
          end_time: s.end_time,
          text: s.text,
        })),
      );
      // Auto-load translations for the new session if a language was active
      if (p.current.translation.activeTranslationLang) {
        try {
          const rows = await window.capty.listTranslations(
            sessionId,
            p.current.translation.activeTranslationLang,
          );
          const map: Record<number, string> = {};
          for (const row of rows) {
            map[row.segment_id] = row.translated_text;
          }
          p.current.translation.setTranslations(map);
        } catch {
          p.current.translation.setTranslations({});
        }
      } else {
        p.current.translation.setTranslations({});
      }
      // Load summaries for this session filtered by active prompt type
      const sessionSummaries = await window.capty.listSummaries(
        sessionId,
        p.current.summary.activePromptType,
      );
      p.current.summary.setSummaries(sessionSummaries as Summary[]);
      p.current.summary.setGenerateError(null);
    } catch (err) {
      console.error("Failed to load session:", err);
    }
  }, []);

  const handlePlaySession = useCallback(
    (sessionId: number) => {
      if (!p.current.store.isRecording) {
        p.current.audioPlayer.play(sessionId);
        if (p.current.store.currentSessionId !== sessionId) {
          handleSelectSession(sessionId);
        }
      }
    },
    [handleSelectSession],
  );

  const handleDeleteSession = useCallback(async (sessionId: number) => {
    try {
      if (audioPlayerRef.current.playingSessionId === sessionId) {
        audioPlayerRef.current.stop();
      }
      await window.capty.deleteSession(sessionId);
      if (p.current.store.currentSessionId === sessionId) {
        p.current.store.setCurrentSessionId(null);
        p.current.store.clearSegments();
        p.current.summary.setSummaries([]);
      }
      await p.current.store.loadSessions();
    } catch (err) {
      console.error("Failed to delete session:", err);
    }
  }, []);

  const handleRenameSession = useCallback(
    async (sessionId: number, newTitle: string) => {
      try {
        await window.capty.renameSession(sessionId, newTitle);
        await p.current.store.loadSessions();
      } catch (err) {
        console.error("Failed to rename session:", err);
      }
    },
    [],
  );

  const handleUpdateCategory = useCallback(
    async (sessionId: number, category: string) => {
      try {
        await window.capty.updateSessionCategory(sessionId, category);
        await p.current.store.loadSessions();
      } catch (err) {
        console.error("Failed to update session category:", err);
      }
    },
    [],
  );

  const handleReorderSessions = useCallback(async (sessionIds: number[]) => {
    try {
      await window.capty.reorderSessions(sessionIds);
      await p.current.store.loadSessions();
    } catch (err) {
      console.error("Failed to reorder sessions:", err);
    }
  }, []);

  const handleEditSession = useCallback(
    async (sessionId: number, newTitle: string, newStartedAt: string) => {
      try {
        const session = p.current.store.sessions.find(
          (s) => s.id === sessionId,
        );
        if (session && newTitle !== session.title) {
          await window.capty.renameSession(sessionId, newTitle);
        }
        const startedAtDb = newStartedAt.replace("T", " ");
        const durationSeconds = session?.duration_seconds ?? 0;
        const endedAtDate = new Date(newStartedAt);
        endedAtDate.setSeconds(endedAtDate.getSeconds() + durationSeconds);
        const endedAt = endedAtDate
          .toLocaleString("sv-SE")
          .replace("T", " ")
          .slice(0, 19);
        await window.capty.updateSession(sessionId, {
          startedAt: startedAtDb,
          endedAt,
        });
        await p.current.store.loadSessions();
      } catch (err) {
        console.error("Failed to edit session:", err);
      }
    },
    [],
  );

  // ── Category management ──────────────────────────────────────────────

  const handleAddCategory = useCallback(
    async (cat: { label: string; icon: string }) => {
      try {
        const id = `custom-${Date.now()}`;
        const newCat: SessionCategory = {
          id,
          label: cat.label,
          icon: cat.icon,
          isBuiltin: false,
        };
        // Read current categories from ref to avoid stale closure
        const current = await window.capty.listSessionCategories();
        const updated = [...(current as SessionCategory[]), newCat];
        await window.capty.saveSessionCategories(updated);
        const cats = await window.capty.listSessionCategories();
        setSessionCategories(cats as SessionCategory[]);
      } catch (err) {
        console.error("Failed to add category:", err);
      }
    },
    [],
  );

  const handleDeleteCategory = useCallback(async (categoryId: string) => {
    try {
      await window.capty.deleteSessionCategory(categoryId);
      const cats = await window.capty.listSessionCategories();
      setSessionCategories(cats as SessionCategory[]);
      await p.current.store.loadSessions();
    } catch (err) {
      console.error("Failed to delete category:", err);
    }
  }, []);

  const handleReorderCategories = useCallback(async (categoryIds: string[]) => {
    try {
      // Read current from DB to avoid stale closure
      const current =
        (await window.capty.listSessionCategories()) as SessionCategory[];
      const reordered = categoryIds
        .map((id) => current.find((c) => c.id === id))
        .filter(Boolean) as SessionCategory[];
      setSessionCategories(reordered);
      await window.capty.saveSessionCategories(reordered);
    } catch (err) {
      console.error("Failed to reorder categories:", err);
    }
  }, []);

  // ── Regeneration ─────────────────────────────────────────────────────

  const handleRegenerateSubtitles = useCallback(
    async (sessionId: number) => {
      if (regeneratingSessionId !== null || p.current.store.isRecording) return;

      if (p.current.store.currentSessionId !== sessionId) {
        await handleSelectSession(sessionId);
      }

      setRegeneratingSessionId(sessionId);
      setRegenerationProgress(0);
      cancelRegenerationRef.current = false;

      try {
        const audioFilePath = await window.capty.getAudioFilePath(sessionId);
        if (!audioFilePath) {
          console.error("No audio file found for session", sessionId);
          setRegeneratingSessionId(null);
          return;
        }

        await window.capty.deleteSegments(sessionId);
        p.current.store.clearSegments();

        setRegenerationProgress(2);
        const wavBuffer = await window.capty.readAudioFile(sessionId);
        if (!wavBuffer) {
          console.error("Could not read audio file for session", sessionId);
          setRegeneratingSessionId(null);
          return;
        }

        const pcmData = new Uint8Array(wavBuffer, 44);
        const totalBytes = pcmData.length;
        const bytesPerSecond = 32000;
        const segmentSeconds = 15;
        const segmentBytes = bytesPerSecond * segmentSeconds;

        const audioSegments: Array<{
          data: Uint8Array;
          startByte: number;
        }> = [];
        for (let off = 0; off < totalBytes; off += segmentBytes) {
          audioSegments.push({
            data: pcmData.slice(off, Math.min(off + segmentBytes, totalBytes)),
            startByte: off,
          });
        }
        const totalSegments = audioSegments.length;

        const activeProvider = p.current.store.asrProviders.find(
          (pr) => pr.id === p.current.store.selectedAsrProviderId,
        );
        if (!activeProvider) {
          console.warn("No ASR provider selected");
          setRegeneratingSessionId(null);
          return;
        }
        const model = activeProvider.isSidecar
          ? p.current.store.selectedModelId || activeProvider.model
          : activeProvider.model;
        if (!model) {
          console.error("No ASR model selected");
          setRegeneratingSessionId(null);
          return;
        }
        const provider = {
          baseUrl: activeProvider.baseUrl,
          apiKey: activeProvider.apiKey,
          model,
        };

        for (let i = 0; i < totalSegments; i++) {
          if (cancelRegenerationRef.current) break;

          const seg = audioSegments[i];
          const startTime = Math.round(seg.startByte / bytesPerSecond);
          const endTime = Math.round(
            Math.min(seg.startByte + segmentBytes, totalBytes) / bytesPerSecond,
          );

          try {
            const result = await window.capty.asrTranscribe(
              toArrayBuffer(seg.data),
              provider,
            );

            if (cancelRegenerationRef.current) break;

            const text = result.text;
            if (text.trim()) {
              await window.capty.addSegment({
                sessionId,
                startTime,
                endTime,
                text,
                audioPath: "",
                isFinal: true,
              });
              if (useAppStore.getState().currentSessionId === sessionId) {
                p.current.store.addSegment({
                  id: ++segmentIdCounter.current,
                  start_time: startTime,
                  end_time: endTime,
                  text,
                });
              }
            }
          } catch (err) {
            if (cancelRegenerationRef.current) break;
            console.error("Regeneration segment error:", err);
          }

          setRegenerationProgress(Math.round(((i + 1) / totalSegments) * 100));
        }
      } catch (err) {
        console.error("Failed to regenerate subtitles:", err);
      } finally {
        setRegeneratingSessionId(null);
        setRegenerationProgress(0);
      }
    },
    [regeneratingSessionId, handleSelectSession],
  );

  const handleCancelRegeneration = useCallback(() => {
    cancelRegenerationRef.current = true;
  }, []);

  // ── Audio upload ─────────────────────────────────────────────────────

  const handleUploadAudio = useCallback(async () => {
    if (p.current.store.isRecording || regeneratingSessionId !== null) return;

    const result = await window.capty.importAudio();
    if (!result) return;

    await p.current.store.loadSessions();
    await handleSelectSession(result.sessionId);
  }, [regeneratingSessionId, handleSelectSession]);

  // ── Init (called from App.tsx init effect) ───────────────────────────

  const initFromConfig = useCallback(
    async (config: Record<string, unknown>) => {
      // Load session categories
      try {
        const cats = await window.capty.listSessionCategories();
        setSessionCategories(cats as SessionCategory[]);
      } catch {
        // Session categories not available
      }

      // Restore audio device selection from config
      const savedDeviceId = config.selectedAudioDeviceId as string | null;
      if (savedDeviceId) {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const exists = allDevices.some(
          (d) => d.kind === "audioinput" && d.deviceId === savedDeviceId,
        );
        if (exists) {
          p.current.audioCapture.setSelectedDevice(savedDeviceId);
        }
      }

      // Restore ASR providers
      const savedAsrProviders = config.asrProviders as
        | import("../stores/appStore").AsrProviderState[]
        | undefined;
      if (savedAsrProviders?.length) {
        p.current.store.setAsrProviders(savedAsrProviders);
      }
      const savedAsrProviderId = config.selectedAsrProviderId as
        | string
        | null
        | undefined;
      if (savedAsrProviderId !== undefined) {
        p.current.store.setSelectedAsrProviderId(savedAsrProviderId);
      }
    },
    [],
  );

  // ── Return ───────────────────────────────────────────────────────────

  return {
    // State
    regeneratingSessionId,
    regenerationProgress,
    audioLevel,
    sessionCategories,

    // Transcription/VAD callbacks (for ref bridge in App.tsx)
    onFinalCallback,
    onErrorCallback,
    onSpeechStart,
    onSpeechEnd,

    // Recording
    handleStart,
    handleStop,

    // Wizard
    handleWizardComplete,

    // Session CRUD
    handleSelectSession,
    handlePlaySession,
    handleDeleteSession,
    handleRenameSession,
    handleUpdateCategory,
    handleReorderSessions,
    handleEditSession,

    // Categories
    handleAddCategory,
    handleDeleteCategory,
    handleReorderCategories,

    // Regeneration
    handleRegenerateSubtitles,
    handleCancelRegeneration,

    // Upload
    handleUploadAudio,

    // Init
    initFromConfig,
  } as const;
}
