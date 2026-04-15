import React, { useEffect, useCallback, useRef, useState } from "react";
import { ControlBar } from "./components/ControlBar";
import { HistoryPanel } from "./components/HistoryPanel";
import { TranscriptArea } from "./components/TranscriptArea";
import { RecordingControls } from "./components/RecordingControls";
import { PlaybackBar } from "./components/PlaybackBar";
import { SetupWizard } from "./components/SetupWizard";
import { SettingsModal, TabId } from "./components/SettingsModal";
import { SummaryPanel } from "./components/SummaryPanel";
import type { TtsProviderConfig } from "./stores/ttsStore";
import { useAppStore } from "./stores/appStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useTtsStore } from "./stores/ttsStore";
import { useSummaryStore } from "./stores/summaryStore";
import { useTranslationStore } from "./stores/translationStore";
import { useDownloadStore } from "./stores/downloadStore";
import { useAudioCapture } from "./hooks/useAudioCapture";
import { useVAD } from "./hooks/useVAD";
import { useTranscription } from "./hooks/useTranscription";
import { useSession } from "./hooks/useSession";
import { useAudioPlayer } from "./hooks/useAudioPlayer";
import { DownloadManagerDialog } from "./components/DownloadManagerDialog";

function App(): React.JSX.Element {
  const store = useAppStore();
  const audioCapture = useAudioCapture();
  const session = useSession();
  const audioPlayer = useAudioPlayer();
  const audioPlayerRef = useRef(audioPlayer);
  audioPlayerRef.current = audioPlayer;

  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<
    TabId | undefined
  >(undefined);
  // Download store
  const downloads = useDownloadStore((s) => s.downloads);
  const audioDownloads = useDownloadStore((s) => s.audioDownloads);
  const showDownloadManager = useDownloadStore((s) => s.showDownloadManager);

  const handleStartSidecar = useCallback(async () => {
    store.setSidecarStarting(true);
    try {
      const result = (await window.capty.startSidecar()) as {
        ok: boolean;
        error?: string;
      };
      if (result.ok) {
        const health = await window.capty.checkSidecarHealth();
        store.setSidecarReady(health.online);
        try {
          const tts = await window.capty.checkTtsProvider();
          store.setTtsProviderReady(tts.ready);
        } catch {
          // TTS check is best-effort
        }
      } else {
        console.warn("[sidecar] start failed:", result.error);
      }
    } catch (err) {
      console.error("Failed to start sidecar:", err);
    } finally {
      store.setSidecarStarting(false);
    }
  }, [store]);

  const handleStopSidecar = useCallback(async () => {
    try {
      await window.capty.stopSidecar();
      store.setSidecarReady(false);
    } catch (err) {
      console.error("Failed to stop sidecar:", err);
    }
  }, [store]);

  // Monotonic counter for segment IDs (avoids Date.now() collisions)
  const segmentIdCounter = useRef(0);
  // B1 fix: capture sessionId at recording start so late callbacks use the correct value
  const recordingSessionIdRef = useRef<number | null>(null);

  // Precise audio time tracking (sample-based, not wall-clock)
  const audioSamplesRef = useRef(0); // total samples fed since recording start
  const segmentStartRef = useRef(0); // seconds (from audio samples)
  const segmentEndRef = useRef(0); // seconds (from audio samples)
  const SAMPLE_RATE = 16000;

  const getAudioSeconds = (): number =>
    Math.round(audioSamplesRef.current / SAMPLE_RATE);

  const onFinalCallback = useCallback(
    async (
      text: string,
      _segId: number,
      startTime: number,
      endTime: number,
    ) => {
      if (!text.trim()) return;
      // B1 fix: use ref-captured sessionId (set at recording start) so late
      // callbacks still save to the correct session even if store has been reset.
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
      store.addSegment({
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

  const transcription = useTranscription({
    onFinal: onFinalCallback,
    onError: onErrorCallback,
  });

  const sendSegmentEndRef = useRef(transcription.sendSegmentEnd);
  sendSegmentEndRef.current = transcription.sendSegmentEnd;

  const vad = useVAD({
    onSpeechStart: useCallback(() => {
      segmentStartRef.current = getAudioSeconds();
    }, []),
    onSpeechEnd: useCallback(() => {
      segmentEndRef.current = getAudioSeconds();
      // Speech ended - pass timestamps captured NOW (not later at callback time)
      sendSegmentEndRef.current(segmentStartRef.current, segmentEndRef.current);
    }, []),
  });

  // Regeneration state
  const [regeneratingSessionId, setRegeneratingSessionId] = useState<
    number | null
  >(null);
  const [regenerationProgress, setRegenerationProgress] = useState(0);
  const cancelRegenerationRef = useRef(false);

  // Derive ASR download state for backward compatibility
  const asrDownloadEntries = Object.values(downloads).filter(
    (d) =>
      d.category === "asr" &&
      (d.status === "downloading" || d.status === "paused"),
  );
  const isDownloading = asrDownloadEntries.some(
    (d) => d.status === "downloading",
  );
  const downloadProgress = asrDownloadEntries[0]?.percent ?? 0;

  // TTS store
  const ttsProviders = useTtsStore((s) => s.ttsProviders);
  const selectedTtsProviderId = useTtsStore((s) => s.selectedTtsProviderId);
  const selectedTtsModelId = useTtsStore((s) => s.selectedTtsModelId);
  // Settings from store
  const llmProviders = useSettingsStore((s) => s.llmProviders);
  const selectedSummaryModel = useSettingsStore((s) => s.selectedSummaryModel);
  const selectedTranslateModel = useSettingsStore(
    (s) => s.selectedTranslateModel,
  );
  const selectedRapidModel = useSettingsStore((s) => s.selectedRapidModel);

  // Translation store
  const translationProgressMap = useTranslationStore(
    (s) => s.translationProgressMap,
  );
  const translations = useTranslationStore((s) => s.translations);
  const activeTranslationLang = useTranslationStore(
    (s) => s.activeTranslationLang,
  );
  // Derived: is the *current* session translating?
  const isTranslating =
    store.currentSessionId != null &&
    store.currentSessionId in translationProgressMap;
  const translationProgress =
    store.currentSessionId != null
      ? (translationProgressMap[store.currentSessionId] ?? 0)
      : 0;

  const [aiRenamingSessionId, setAiRenamingSessionId] = useState<number | null>(
    null,
  );

  // Subscribe to unified download events (manages the `downloads` state via store)
  useEffect(() => {
    const unsubscribe = window.capty.onDownloadEvent((progress) => {
      const ds = useDownloadStore.getState();
      if (progress.status === "completed") {
        ds.removeDownload(progress.modelId);
      } else {
        ds.setDownload(progress.modelId, {
          modelId: progress.modelId,
          category: progress.category,
          percent: progress.percent,
          status: progress.status,
          error: progress.error,
        });
      }
    });
    return unsubscribe;
  }, []);

  // Check for incomplete downloads on startup
  useEffect(() => {
    if (!store.dataDir) return;
    window.capty.getIncompleteDownloads().then((incompletes) => {
      if (incompletes.length === 0) return;
      const ds = useDownloadStore.getState();
      for (const d of incompletes) {
        ds.setDownload(d.modelId, {
          modelId: d.modelId,
          category: d.category,
          percent: d.percent,
          status: d.status,
        });
      }
    });
  }, [store.dataDir]);

  const handleDownloadModel = useCallback(async () => {
    const model = store.models.find(
      (m: { id: string }) => m.id === store.selectedModelId,
    );
    if (!model || model.downloaded || isDownloading) return;

    const dataDir = store.dataDir;
    if (!dataDir) return;

    const ds = useDownloadStore.getState();
    ds.setDownload(model.id, {
      modelId: model.id,
      category: "asr" as const,
      percent: 0,
      status: "downloading",
    });

    try {
      const destDir = `${dataDir}/models/asr/${model.id}`;
      await window.capty.downloadModel(model.repo, destDir);

      // Refresh models list
      const models = await window.capty.listModels();
      store.setModels(models as Parameters<typeof store.setModels>[0]);
    } catch (err) {
      console.error("Failed to download model:", err);
    } finally {
      useDownloadStore.getState().removeDownload(model.id);
    }
  }, [store, isDownloading]);

  // Audio level for visualization
  const [audioLevel, setAudioLevel] = useState(0);

  // Timer for elapsed recording time
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);

  // Initialize app on mount
  useEffect(() => {
    const init = async (): Promise<void> => {
      try {
        const dataDir = await window.capty.getDataDir();
        if (!dataDir) {
          setNeedsSetup(true);
          return;
        }
        setNeedsSetup(false);
        store.setDataDir(dataDir);

        // Load all settings from config via the settings store
        await useSettingsStore.getState().loadConfig();

        await store.loadSessions();
        await audioCapture.loadDevices();

        // Restore saved config (non-settings fields still need the raw config)
        const config = await window.capty.getConfig();

        const savedDeviceId = config.selectedAudioDeviceId as string | null;
        if (savedDeviceId) {
          // Verify device still exists (may have been unplugged)
          const allDevices = await navigator.mediaDevices.enumerateDevices();
          const exists = allDevices.some(
            (d) => d.kind === "audioinput" && d.deviceId === savedDeviceId,
          );
          if (exists) {
            audioCapture.setSelectedDevice(savedDeviceId);
          }
          // If not found, stays on default — no need to clear config since
          // the device might be reconnected later
        }

        // Restore ASR providers
        const savedAsrProviders = config.asrProviders as
          | import("./stores/appStore").AsrProviderState[]
          | undefined;
        if (savedAsrProviders?.length) {
          store.setAsrProviders(savedAsrProviders);
        }
        const savedAsrProviderId = config.selectedAsrProviderId as
          | string
          | null
          | undefined;
        if (savedAsrProviderId !== undefined) {
          store.setSelectedAsrProviderId(savedAsrProviderId);
        }

        // Restore TTS providers
        const tts = useTtsStore.getState();
        const savedTtsProviders = config.ttsProviders as
          | TtsProviderConfig[]
          | undefined;
        if (savedTtsProviders?.length) {
          tts.setTtsProviders(savedTtsProviders);
        }
        const savedTtsProviderId = config.selectedTtsProviderId as
          | string
          | null
          | undefined;
        if (savedTtsProviderId !== undefined) {
          tts.setSelectedTtsProviderId(savedTtsProviderId);
        }
        const savedTtsModelId = config.selectedTtsModelId as string | null;
        if (savedTtsModelId) {
          tts.setSelectedTtsModel(savedTtsModelId);
        }
        const savedTtsVoice = config.selectedTtsVoice as string | undefined;
        if (savedTtsVoice) {
          tts.setSelectedTtsVoice(savedTtsVoice);
        }

        // Restore sidecar config (autoStartSidecar already loaded by settingsStore)
        const sidecarCfg = config.sidecar as
          | { port: number; autoStart: boolean }
          | undefined;
        if (sidecarCfg) {
          store.setSidecarPort(sidecarCfg.port ?? 8765);
        }

        // Check sidecar health
        let sidecarOnline = false;
        try {
          const health = await window.capty.checkSidecarHealth();
          sidecarOnline = health.online;
          store.setSidecarReady(health.online);
        } catch {
          store.setSidecarReady(false);
        }

        // Auto-start sidecar if configured and not already running
        if (sidecarCfg?.autoStart !== false && !sidecarOnline) {
          store.setSidecarStarting(true);
          try {
            const result = (await window.capty.startSidecar()) as {
              ok: boolean;
              error?: string;
            };
            if (result.ok) {
              const h = await window.capty.checkSidecarHealth();
              store.setSidecarReady(h.online);
              try {
                const tts = await window.capty.checkTtsProvider();
                store.setTtsProviderReady(tts.ready);
              } catch {
                /* best-effort */
              }
            } else {
              console.warn("[sidecar] auto-start failed:", result.error);
            }
          } catch {
            /* silent — IPC transport error */
          } finally {
            store.setSidecarStarting(false);
          }
        }

        // Load ASR models and restore selected model
        try {
          const models = await window.capty.listModels();
          store.setModels(models as Parameters<typeof store.setModels>[0]);

          const modelsList = models as Array<{
            id: string;
            downloaded: boolean;
            supported?: boolean;
          }>;
          const isUsable = (m: { downloaded: boolean; supported?: boolean }) =>
            m.downloaded && m.supported !== false;
          const savedModelId = config.selectedModelId as string | null;
          if (savedModelId) {
            const exists = modelsList.some(
              (m) => m.id === savedModelId && isUsable(m),
            );
            if (exists) {
              store.setSelectedModelId(savedModelId);
            } else {
              // Saved model no longer exists — auto-select first usable
              const first = modelsList.find(isUsable);
              if (first) store.setSelectedModelId(first.id);
            }
          } else {
            // No saved model — auto-select first usable
            const first = modelsList.find(isUsable);
            if (first) store.setSelectedModelId(first.id);
          }
        } catch {
          // Models not available yet
        }

        // Load TTS models
        try {
          const ttsInit = useTtsStore.getState();
          const ttsList = await window.capty.listTtsModels();
          ttsInit.setTtsModels(
            ttsList as Array<{
              id: string;
              name: string;
              type: string;
              repo: string;
              downloaded: boolean;
              size_gb: number;
              languages: readonly string[];
              description: string;
            }>,
          );
          // Auto-select first downloaded TTS model if none selected
          const effectiveTtsModelId =
            savedTtsModelId ??
            (ttsList as Array<{ id: string; downloaded: boolean }>).find(
              (m) => m.downloaded,
            )?.id;
          if (!savedTtsModelId && effectiveTtsModelId) {
            ttsInit.setSelectedTtsModel(effectiveTtsModelId);
          }

          // Fetch voice list for the selected TTS model
          if (effectiveTtsModelId) {
            try {
              const voiceResult = await window.capty.ttsListVoices();
              ttsInit.setTtsVoices(voiceResult.voices);
              // Validate saved voice — fall back to first voice if invalid
              const currentVoice = savedTtsVoice ?? "";
              if (
                voiceResult.voices.length > 0 &&
                !voiceResult.voices.some(
                  (v: { id: string }) => v.id === currentVoice,
                )
              ) {
                ttsInit.setSelectedTtsVoice(voiceResult.voices[0].id);
              }
            } catch {
              // Voice listing not available
            }
          }
        } catch {
          // TTS models not available yet
        }
      } catch (err) {
        console.error("Init error:", err);
      }
    };
    init();
  }, [needsSetup]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStart = useCallback(async () => {
    // Block recording during subtitle regeneration
    if (regeneratingSessionId !== null) return;

    // Stop any active playback before recording
    audioPlayer.stop();

    // Immediately show recording UI (optimistic)
    store.setRecording(true);
    store.clearSegments();
    store.setElapsedSeconds(0);
    elapsedRef.current = 0;
    audioSamplesRef.current = 0;

    // Start elapsed timer right away
    timerRef.current = setInterval(() => {
      elapsedRef.current = elapsedRef.current + 1;
      store.setElapsedSeconds(elapsedRef.current);
    }, 1000);

    try {
      const sessionId = await session.startSession(store.selectedModelId);
      store.setCurrentSessionId(sessionId);
      recordingSessionIdRef.current = sessionId;

      // Start audio capture (triggers mic permission prompt)
      await audioCapture.start((pcm: Int16Array) => {
        audioSamplesRef.current += pcm.length;
        session.feedAudio(pcm);
        vad.feedAudio(pcm);
        // Stream all audio to sidecar continuously (VAD triggers segment_end)
        transcription.sendAudio(pcm.buffer);
        // Compute audio level for visualization (RMS)
        let sum = 0;
        for (let i = 0; i < pcm.length; i++) {
          sum += (pcm[i] / 32768) * (pcm[i] / 32768);
        }
        const rms = Math.sqrt(sum / pcm.length);
        // Scale: typical speech RMS ~0.02-0.1, map to 0-1 range
        setAudioLevel(Math.min(1, rms * 20));
      });

      // Refresh history to show the new session
      store.loadSessions();

      // Configure transcription provider and connect
      const activeProvider = store.asrProviders.find(
        (p) => p.id === store.selectedAsrProviderId,
      );
      if (!activeProvider) {
        console.warn("No ASR provider selected");
        store.setRecording(false);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        return;
      }
      transcription.setProvider({
        baseUrl: activeProvider.baseUrl,
        apiKey: activeProvider.apiKey,
        model: activeProvider.isSidecar
          ? store.selectedModelId
          : activeProvider.model,
      });
      try {
        await transcription.connect();
      } catch (err) {
        console.error("ASR connection failed:", err);
        // Don't block recording — transcription will just be unavailable
      }
    } catch (err) {
      console.error("Failed to start recording:", err);
      store.setRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [session, store, transcription, audioCapture, vad, regeneratingSessionId]);

  const handleStop = useCallback(async () => {
    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Stop audio capture first (no more audio data)
    audioCapture.stop();

    // Record the end timestamp for any in-progress speech segment
    segmentEndRef.current = getAudioSeconds();

    // Gracefully disconnect: flush remaining audio with segment_end,
    // wait for final transcription result, then close
    await transcription.gracefulDisconnect(
      segmentStartRef.current,
      segmentEndRef.current,
    );

    await session.stopSession(elapsedRef.current);

    store.setRecording(false);
    store.setCurrentSessionId(null);
    recordingSessionIdRef.current = null;
    store.setPartialText("");

    await store.loadSessions();
  }, [session, store, transcription, audioCapture]);

  const handleWizardComplete = useCallback(
    (dataDir: string) => {
      store.setDataDir(dataDir);
      setNeedsSetup(false);
    },
    [store],
  );

  const handleSelectSession = useCallback(
    async (sessionId: number) => {
      try {
        // Stop playback if switching away from the playing session
        if (
          audioPlayer.playingSessionId !== null &&
          audioPlayer.playingSessionId !== sessionId
        ) {
          audioPlayer.stop();
        }
        store.setCurrentSessionId(sessionId);
        const segments = await window.capty.listSegments(sessionId);
        store.setSegments(
          segments.map((s) => ({
            id: s.id,
            start_time: s.start_time,
            end_time: s.end_time,
            text: s.text,
          })),
        );
        // Auto-load translations for the new session if a language was active
        const lang = useTranslationStore.getState().activeTranslationLang;
        if (lang) {
          await useTranslationStore
            .getState()
            .loadTranslations(sessionId, lang);
        } else {
          useTranslationStore.getState().setTranslation(sessionId, {});
        }
        // Load summaries for this session filtered by active prompt type
        const currentPromptType = useSummaryStore.getState().activePromptType;
        await useSummaryStore.getState().loadSummaries(sessionId);
        useSummaryStore.getState().clearError();
      } catch (err) {
        console.error("Failed to load session:", err);
      }
    },
    [store, audioPlayer],
  );

  const handlePlaySession = useCallback(
    (sessionId: number) => {
      if (!store.isRecording) {
        audioPlayer.play(sessionId);
        // Also select the session so transcript segments load for sync scrolling
        if (store.currentSessionId !== sessionId) {
          handleSelectSession(sessionId);
        }
      }
    },
    [
      store.isRecording,
      store.currentSessionId,
      audioPlayer,
      handleSelectSession,
    ],
  );

  const handleDeleteSession = useCallback(
    async (sessionId: number) => {
      try {
        // Stop playback if deleting the playing session
        if (audioPlayerRef.current.playingSessionId === sessionId) {
          audioPlayerRef.current.stop();
        }
        await window.capty.deleteSession(sessionId);
        // If deleting the currently viewed session, clear it
        if (store.currentSessionId === sessionId) {
          store.setCurrentSessionId(null);
          store.clearSegments();
          useSummaryStore.getState().setSummaries([]);
        }
        await store.loadSessions();
      } catch (err) {
        console.error("Failed to delete session:", err);
      }
    },
    [store],
  );

  const handleRenameSession = useCallback(
    async (sessionId: number, newTitle: string) => {
      try {
        await window.capty.renameSession(sessionId, newTitle);
        await store.loadSessions();
      } catch (err) {
        console.error("Failed to rename session:", err);
      }
    },
    [store],
  );

  const handleUpdateCategory = useCallback(
    async (sessionId: number, category: string) => {
      try {
        await window.capty.updateSessionCategory(sessionId, category);
        await store.loadSessions();
      } catch (err) {
        console.error("Failed to update session category:", err);
      }
    },
    [store],
  );

  const handleReorderSessions = useCallback(
    async (sessionIds: number[]) => {
      try {
        await window.capty.reorderSessions(sessionIds);
        await store.loadSessions();
      } catch (err) {
        console.error("Failed to reorder sessions:", err);
      }
    },
    [store],
  );

  const handleEditSession = useCallback(
    async (sessionId: number, newTitle: string, newStartedAt: string) => {
      try {
        const session = store.sessions.find((s) => s.id === sessionId);
        // 1. If title changed, use rename (handles filesystem rename)
        if (session && newTitle !== session.title) {
          await window.capty.renameSession(sessionId, newTitle);
        }
        // 2. Update started_at + auto-compute ended_at
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
        await store.loadSessions();
      } catch (err) {
        console.error("Failed to edit session:", err);
      }
    },
    [store],
  );

  const handleRegenerateSubtitles = useCallback(
    async (sessionId: number) => {
      if (regeneratingSessionId !== null || store.isRecording) return;

      // Switch to the session being regenerated
      if (store.currentSessionId !== sessionId) {
        await handleSelectSession(sessionId);
      }

      setRegeneratingSessionId(sessionId);
      setRegenerationProgress(0);
      cancelRegenerationRef.current = false;

      try {
        // 1. Get audio file path
        const audioFilePath = await window.capty.getAudioFilePath(sessionId);
        if (!audioFilePath) {
          console.error("No audio file found for session", sessionId);
          setRegeneratingSessionId(null);
          return;
        }

        // 2. Delete old segments and clear in-memory display
        await window.capty.deleteSegments(sessionId);
        store.clearSegments();

        // 3. Read WAV file (all audio is 16kHz mono WAV)
        setRegenerationProgress(2);
        const wavBuffer = await window.capty.readAudioFile(sessionId);
        if (!wavBuffer) {
          console.error("Could not read audio file for session", sessionId);
          setRegeneratingSessionId(null);
          return;
        }

        // PCM data (skip 44-byte WAV header)
        const pcmData = new Uint8Array(wavBuffer, 44);
        const totalBytes = pcmData.length;
        const bytesPerSecond = 32000; // 16kHz * 16bit * mono = 32000 bytes/sec
        const segmentSeconds = 15; // transcribe in 15-second segments
        const segmentBytes = bytesPerSecond * segmentSeconds;

        // Split audio into segments upfront
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

        // Determine provider from unified provider list
        const activeProvider = store.asrProviders.find(
          (p) => p.id === store.selectedAsrProviderId,
        );
        if (!activeProvider) {
          console.warn("No ASR provider selected");
          setRegeneratingSessionId(null);
          return;
        }
        const model = activeProvider.isSidecar
          ? store.selectedModelId || activeProvider.model
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

        // Sequential HTTP POST for each segment (unified for both backends)
        for (let i = 0; i < totalSegments; i++) {
          if (cancelRegenerationRef.current) break;

          const seg = audioSegments[i];
          const startTime = Math.round(seg.startByte / bytesPerSecond);
          const endTime = Math.round(
            Math.min(seg.startByte + segmentBytes, totalBytes) / bytesPerSecond,
          );

          try {
            const result = await window.capty.asrTranscribe(
              seg.data.buffer.slice(
                seg.data.byteOffset,
                seg.data.byteOffset + seg.data.byteLength,
              ),
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
              // Use getState() to avoid stale closure after session switch
              if (useAppStore.getState().currentSessionId === sessionId) {
                store.addSegment({
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
    [regeneratingSessionId, store, handleSelectSession],
  );

  const handleCancelRegeneration = useCallback(() => {
    cancelRegenerationRef.current = true;
  }, []);

  const handleUploadAudio = useCallback(async () => {
    if (store.isRecording || regeneratingSessionId !== null) return;

    const result = await window.capty.importAudio();
    if (!result) return; // user cancelled

    // Duration is already calculated by audio:import (ffmpeg converts to WAV)
    await store.loadSessions();
    await handleSelectSession(result.sessionId);
  }, [store, regeneratingSessionId, handleSelectSession]);

  const handleStartAudioDownload = useCallback(async (url: string) => {
    try {
      const result = await window.capty.downloadAudio(url);
      // Handler returned an error object instead of throwing
      if (
        result &&
        typeof result === "object" &&
        "ok" in result &&
        !result.ok
      ) {
        throw new Error(result.error ?? "Download failed");
      }
      await useDownloadStore.getState().loadAudioDownloads();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      // Strip Electron IPC prefix if present
      const message = raw.replace(
        /^Error invoking remote method '[^']+': Error: /,
        "",
      );
      const ds = useDownloadStore.getState();
      ds.setAudioDownloads([
        {
          id: -Date.now(),
          url,
          title: null,
          source: null,
          status: "failed",
          progress: 0,
          speed: null,
          eta: null,
          session_id: null,
          error: message,
          created_at: new Date().toISOString(),
          completed_at: null,
        },
        ...ds.audioDownloads,
      ]);
    }
  }, []);

  const handleCancelAudioDownload = useCallback(async (id: number) => {
    await window.capty.cancelAudioDownload(id);
    await useDownloadStore.getState().loadAudioDownloads();
  }, []);

  const handleRetryAudioDownload = useCallback(async (id: number) => {
    await window.capty.retryAudioDownload(id);
    await useDownloadStore.getState().loadAudioDownloads();
  }, []);

  const handleRemoveAudioDownload = useCallback(async (id: number) => {
    await window.capty.removeAudioDownload(id);
    await useDownloadStore.getState().loadAudioDownloads();
  }, []);

  const handleAudioDownloadSelectSession = useCallback(
    async (sessionId: number) => {
      useDownloadStore.getState().setShowDownloadManager(false);
      await store.loadSessions();
      await handleSelectSession(sessionId);
    },
    [store, handleSelectSession],
  );

  const handleDeviceChange = useCallback(
    async (deviceId: string) => {
      const effectiveId = deviceId || null;
      audioCapture.setSelectedDevice(effectiveId);
      // Persist to config
      const config = await window.capty.getConfig();
      await window.capty.setConfig({
        ...config,
        selectedAudioDeviceId: effectiveId,
      });
    },
    [audioCapture],
  );

  const handleSelectModel = useCallback(
    async (modelId: string) => {
      store.setSelectedModelId(modelId);
      // Persist to config
      const config = await window.capty.getConfig();
      await window.capty.setConfig({ ...config, selectedModelId: modelId });
    },
    [store],
  );

  const handleChangeTranslateModel = useCallback(
    async (selection: { providerId: string; model: string }) => {
      useSettingsStore.getState().setSelectedTranslateModel(selection);
      await useSettingsStore
        .getState()
        .saveConfig({ selectedTranslateModel: selection });
    },
    [],
  );

  const handleTranslate = useCallback(
    async (targetLanguage: string) => {
      if (store.segments.length === 0) return;
      const sessionId = store.currentSessionId;
      if (!sessionId) return;
      // Already translating this session
      if (sessionId in useTranslationStore.getState().translationProgressMap)
        return;

      // Resolve provider + model for translation (read from store to avoid stale closures)
      const settings = useSettingsStore.getState();
      const sel = settings.selectedTranslateModel;
      const providers = settings.llmProviders;
      const currentTranslatePrompt = settings.translatePrompt;
      const provider = sel
        ? providers.find((p) => p.id === sel.providerId)
        : providers.find((p) => (p.models?.length ?? 0) > 0);
      if (!provider) {
        console.warn("Translate: no LLM provider configured");
        return;
      }
      const modelToUse = sel?.model || provider.models[0] || provider.model;

      useTranslationStore.getState().clearAbort(sessionId);
      useTranslationStore.getState().setProgress(sessionId, 0);
      useTranslationStore.getState().setActiveTranslationLang(targetLanguage);

      const segments = [...store.segments];
      const total = segments.length;
      const newTranslations: Record<number, string> = {};
      useTranslationStore.getState().setTranslation(sessionId, {});
      let completed = 0;

      const CONCURRENCY = 3;

      const translateOne = async (
        seg: (typeof segments)[number],
      ): Promise<void> => {
        if (useTranslationStore.getState().isAborted(sessionId)) return;
        try {
          const result = await window.capty.translate(
            provider.id,
            modelToUse,
            seg.text,
            targetLanguage,
            currentTranslatePrompt,
          );
          if (useTranslationStore.getState().isAborted(sessionId)) return;

          newTranslations[seg.id] = result;
          // Only update displayed translations if still viewing this session
          if (useAppStore.getState().currentSessionId === sessionId) {
            useTranslationStore
              .getState()
              .setTranslation(sessionId, { ...newTranslations });
          }

          await window.capty.saveTranslation(
            seg.id,
            sessionId,
            targetLanguage,
            result,
          );
        } catch (err) {
          console.warn(`Translation skipped for segment ${seg.id}:`, err);
        }
        completed++;
        useTranslationStore
          .getState()
          .setProgress(sessionId, Math.round((completed / total) * 100));
      };

      // Process segments in batches of CONCURRENCY
      for (let i = 0; i < total; i += CONCURRENCY) {
        if (useTranslationStore.getState().isAborted(sessionId)) break;
        const batch = segments.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(translateOne));
      }

      // Cleanup finished session: remove abort flag and progress key
      useTranslationStore.getState().clearAbort(sessionId);
      // Remove session from progress map so `isTranslating` (`in` check) becomes false
      const cleanedMap = {
        ...useTranslationStore.getState().translationProgressMap,
      };
      delete cleanedMap[sessionId];
      useTranslationStore.setState({ translationProgressMap: cleanedMap });

      // If user switched back, reload translations from DB
      if (useAppStore.getState().currentSessionId === sessionId) {
        await useTranslationStore
          .getState()
          .loadTranslations(sessionId, targetLanguage);
      }
    },
    [store],
  );

  const handleStopTranslation = useCallback(() => {
    const sid = store.currentSessionId;
    if (sid != null) {
      useTranslationStore.getState().requestAbort(sid);
    }
  }, [store.currentSessionId]);

  // Load saved translations when switching language or session
  const handleLoadTranslations = useCallback(
    async (sessionId: number, targetLanguage: string) => {
      await useTranslationStore
        .getState()
        .loadTranslations(sessionId, targetLanguage);
    },
    [],
  );

  const handleAiRename = useCallback(
    async (sessionId: number) => {
      if (aiRenamingSessionId) return;
      // Read from store to avoid stale closures
      const settings = useSettingsStore.getState();
      const sel = settings.selectedRapidModel;
      const providers = settings.llmProviders;
      const currentRenamePrompt = settings.rapidRenamePrompt;
      const provider = sel
        ? providers.find((p) => p.id === sel.providerId)
        : providers.find((p) => (p.models?.length ?? 0) > 0);
      if (!provider) {
        console.warn("AI rename: no LLM provider configured");
        return;
      }
      const modelToUse = sel?.model || provider.models[0] || provider.model;
      setAiRenamingSessionId(sessionId);
      try {
        const rawTitle = await window.capty.generateTitle(
          sessionId,
          provider.id,
          modelToUse,
          currentRenamePrompt,
        );
        if (rawTitle) {
          const sess = store.sessions.find(
            (s: { id: number }) => s.id === sessionId,
          );
          let finalTitle = rawTitle;
          if (sess?.started_at) {
            const d = new Date(sess.started_at);
            const pad = (n: number): string => String(n).padStart(2, "0");
            const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
            finalTitle = `${ts}：${rawTitle}`;
          }
          await window.capty.renameSession(sessionId, finalTitle);
          await store.loadSessions();
        }
      } catch (err) {
        console.error("AI rename failed:", err);
      } finally {
        setAiRenamingSessionId(null);
      }
    },
    [aiRenamingSessionId, store],
  );

  // Zoom keyboard shortcuts: Cmd/Ctrl + =/- /0
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        const prev = useSettingsStore.getState().zoomFactor;
        const next = Math.min(3.0, Math.round((prev + 0.1) * 10) / 10);
        useSettingsStore.getState().setZoomFactor(next);
        window.capty.setZoomFactor(next);
      } else if (e.key === "-") {
        e.preventDefault();
        const prev = useSettingsStore.getState().zoomFactor;
        const next = Math.max(0.5, Math.round((prev - 0.1) * 10) / 10);
        useSettingsStore.getState().setZoomFactor(next);
        window.capty.setZoomFactor(next);
      } else if (e.key === "0") {
        e.preventDefault();
        useSettingsStore.getState().setZoomFactor(1.0);
        window.capty.setZoomFactor(1.0);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Sidecar health polling (every 10s, unconditional — sidecar is independent)
  useEffect(() => {
    let ignore = false;
    const poll = async (): Promise<void> => {
      try {
        const health = await window.capty.checkSidecarHealth();
        if (!ignore) store.setSidecarReady(health.online);
      } catch {
        if (!ignore) store.setSidecarReady(false);
      }
    };
    poll(); // check immediately on mount
    const timer = setInterval(poll, 10000);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // TTS provider health polling (every 10s when a TTS provider is selected)
  useEffect(() => {
    if (!selectedTtsProviderId || ttsProviders.length === 0) {
      store.setTtsProviderReady(false);
      return;
    }
    const poll = async (): Promise<void> => {
      try {
        const result = await window.capty.checkTtsProvider();
        store.setTtsProviderReady(result.ready);
      } catch {
        store.setTtsProviderReady(false);
      }
    };
    poll(); // Check immediately on mount/change
    const timer = setInterval(poll, 10000);
    return () => clearInterval(timer);
  }, [selectedTtsProviderId, ttsProviders]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh voice list when TTS provider changes
  useEffect(() => {
    if (!selectedTtsProviderId) return;
    const provider = ttsProviders.find(
      (p: { id: string }) => p.id === selectedTtsProviderId,
    );
    if (!provider?.isSidecar) {
      // External providers don't use voice selectors
      useTtsStore.getState().setTtsVoices([]);
      return;
    }
    (async () => {
      try {
        const result = await window.capty.ttsListVoices();
        const ts = useTtsStore.getState();
        ts.setTtsVoices(result.voices);
        // If saved voice not in list, default to first
        if (
          result.voices.length > 0 &&
          !result.voices.some(
            (v: { id: string }) => v.id === ts.selectedTtsVoice,
          )
        ) {
          const first = result.voices[0].id;
          ts.setSelectedTtsVoice(first);
          const config = await window.capty.getConfig();
          await window.capty.setConfig({ ...config, selectedTtsVoice: first });
        }
      } catch {
        useTtsStore.getState().setTtsVoices([]);
      }
    })();
  }, [selectedTtsProviderId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Validate model selections when providers change
  useEffect(() => {
    type ModelSelection = { providerId: string; model: string } | null;
    const validateSelection = (
      sel: ModelSelection,
      setSel: (s: ModelSelection) => void,
    ): void => {
      if (!sel) return;
      const provider = llmProviders.find((p) => p.id === sel.providerId);
      if (!provider) {
        setSel(null);
        return;
      }
      const models = provider.models?.length
        ? provider.models
        : provider.model
          ? [provider.model]
          : [];
      if (!models.includes(sel.model)) {
        if (models.length > 0) {
          setSel({ providerId: provider.id, model: models[0] });
        } else {
          setSel(null);
        }
      }
    };
    const s = useSettingsStore.getState();
    validateSelection(selectedSummaryModel, s.setSelectedSummaryModel);
    validateSelection(selectedTranslateModel, s.setSelectedTranslateModel);
    validateSelection(selectedRapidModel, s.setSelectedRapidModel);
  }, [llmProviders]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for LLM streaming chunks (routed per-tab by promptType)
  useEffect(() => {
    const unsub = window.capty.onSummaryChunk(
      ({ content, done, promptType }) => {
        if (done) return;
        useSummaryStore.getState().appendStreamContent(promptType, content);
      },
    );
    return unsub;
  }, []);

  // When a selected device is unplugged, clear the persisted config
  useEffect(() => {
    audioCapture.setOnDeviceRemoved(() => {
      window.capty.getConfig().then((config) => {
        window.capty.setConfig({ ...config, selectedAudioDeviceId: null });
      });
    });
    return () => audioCapture.setOnDeviceRemoved(null);
  }, [audioCapture]);

  // Listen for audio download progress events
  useEffect(() => {
    const cleanup = window.capty.onAudioDownloadProgress((event) => {
      // When download completes, refresh session list so new session appears in sidebar
      if (event.stage === "completed") {
        store.loadSessions();
      }

      const ds = useDownloadStore.getState();
      const prev = ds.audioDownloads;
      const idx = prev.findIndex((d) => d.id === event.id);
      if (idx === -1) {
        // New download — reload full list
        ds.loadAudioDownloads();
        return;
      }
      const updated = [...prev];
      const current = updated[idx];
      updated[idx] = {
        ...current,
        status:
          event.stage === "error"
            ? "failed"
            : event.stage === "progress"
              ? "downloading"
              : event.stage,
        progress: event.percent ?? current.progress,
        speed: event.speed ?? current.speed,
        eta: event.eta ?? current.eta,
        title: event.title ?? current.title,
        source: event.source ?? current.source,
        error: event.error ?? current.error,
        session_id: event.sessionId ?? current.session_id,
      };
      ds.setAudioDownloads(updated);
    });
    return cleanup;
  }, [store]);

  // Load download list on mount + crash recovery
  useEffect(() => {
    if (needsSetup !== false) return; // DB not ready during setup wizard
    window.capty.getAudioDownloads().then((list) => {
      const ds = useDownloadStore.getState();
      ds.setAudioDownloads(list);
      const hasInterrupted = list.some((d) =>
        ["pending", "downloading", "converting"].includes(d.status),
      );
      if (hasInterrupted) ds.setShowDownloadManager(true);
    });
  }, [needsSetup]);

  // Listen for retry trigger from main process
  useEffect(() => {
    const cleanup = window.capty.onAudioDownloadRetryTrigger(({ url }) => {
      window.capty.downloadAudio(url).then(() => {
        useDownloadStore.getState().loadAudioDownloads();
      });
    });
    return cleanup;
  }, []);

  // No streaming partial text with HTTP-based transcription

  // Show nothing while checking setup status
  if (needsSetup === null) {
    return <></>;
  }

  // Show setup wizard if dataDir is not configured
  if (needsSetup) {
    return <SetupWizard onComplete={handleWizardComplete} />;
  }

  return (
    <div
      className={store.isRecording ? "recording-mode" : ""}
      style={{ display: "flex", flexDirection: "column", height: "100vh" }}
    >
      <ControlBar
        isRecording={store.isRecording}
        sidecarReady={store.sidecarReady}
        activeProviderName={
          store.asrProviders.find((p) => p.id === store.selectedAsrProviderId)
            ?.name ?? null
        }
        isSidecarActive={
          store.asrProviders.find((p) => p.id === store.selectedAsrProviderId)
            ?.isSidecar ?? false
        }
        devices={audioCapture.devices}
        selectedDeviceId={audioCapture.selectedDeviceId}
        onDeviceChange={handleDeviceChange}
        models={store.models}
        selectedModelId={store.selectedModelId}
        onModelChange={handleSelectModel}
        onSettings={() => setShowSettings(true)}
        onOpenSettingsTab={(tab) => {
          setSettingsInitialTab(tab as TabId);
          setShowSettings(true);
        }}
        isDownloading={isDownloading}
        downloadProgress={downloadProgress}
        onDownloadModel={handleDownloadModel}
        ttsProviderReady={store.ttsProviderReady}
        ttsProviderName={
          ttsProviders.find((p) => p.id === selectedTtsProviderId)?.name ?? null
        }
        selectedTtsModelId={selectedTtsModelId}
        onStartSidecar={handleStartSidecar}
        onStopSidecar={handleStopSidecar}
        sidecarStarting={store.sidecarStarting}
        sidecarPort={store.sidecarPort}
      />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <HistoryPanel
          playingSessionId={audioPlayer.playingSessionId}
          regeneratingSessionId={regeneratingSessionId}
          regenerationProgress={regenerationProgress}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
          onPlaySession={handlePlaySession}
          onStopPlayback={audioPlayer.stop}
          onRegenerateSubtitles={handleRegenerateSubtitles}
          onCancelRegeneration={handleCancelRegeneration}
          onUploadAudio={handleUploadAudio}
          onAiRename={handleAiRename}
          aiRenamingSessionId={aiRenamingSessionId}
        />
        <TranscriptArea
          segments={store.segments}
          partialText={store.partialText}
          isRecording={store.isRecording}
          playbackTime={
            audioPlayer.playingSessionId !== null
              ? audioPlayer.currentTime
              : null
          }
          onSeekToTime={
            audioPlayer.playingSessionId !== null ? audioPlayer.seek : null
          }
          sessionId={store.currentSessionId}
          canExport={!store.isRecording && store.segments.length > 0}
          onTranslate={
            !store.isRecording &&
            store.segments.length > 0 &&
            (selectedTranslateModel ||
              llmProviders.some((p) => (p.models?.length ?? 0) > 0))
              ? handleTranslate
              : null
          }
          isTranslating={isTranslating}
          translationProgress={translationProgress}
          onStopTranslation={isTranslating ? handleStopTranslation : null}
          translations={translations}
          activeTranslationLang={activeTranslationLang}
          onLoadTranslations={
            store.currentSessionId
              ? (lang: string) =>
                  handleLoadTranslations(store.currentSessionId!, lang)
              : undefined
          }
          llmProviders={llmProviders}
          selectedTranslateModel={selectedTranslateModel}
          onChangeTranslateModel={handleChangeTranslateModel}
        />
        <SummaryPanel />
      </div>
      {/* ── Bottom bar: crossfade between RecordingControls and PlaybackBar ── */}
      <div
        style={{
          position: "relative",
          height: "100px",
          flexShrink: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            transition: "opacity 0.3s ease, transform 0.3s ease",
            opacity: audioPlayer.playingSessionId !== null ? 0 : 1,
            transform:
              audioPlayer.playingSessionId !== null
                ? "translateY(20px)"
                : "translateY(0)",
            pointerEvents:
              audioPlayer.playingSessionId !== null ? "none" : "auto",
          }}
        >
          <RecordingControls
            isRecording={store.isRecording}
            elapsedSeconds={store.elapsedSeconds}
            audioLevel={audioLevel}
            onStart={handleStart}
            onStop={handleStop}
          />
        </div>
        <div
          style={{
            position: "absolute",
            inset: 0,
            transition: "opacity 0.3s ease, transform 0.3s ease",
            opacity: audioPlayer.playingSessionId !== null ? 1 : 0,
            transform:
              audioPlayer.playingSessionId !== null
                ? "translateY(0)"
                : "translateY(20px)",
            pointerEvents:
              audioPlayer.playingSessionId !== null ? "auto" : "none",
          }}
        >
          <PlaybackBar
            isPlaying={audioPlayer.isPlaying}
            currentTime={audioPlayer.currentTime}
            duration={audioPlayer.duration}
            playbackRate={audioPlayer.playbackRate}
            audioRef={audioPlayer.audioRef}
            segments={store.segments}
            onPause={audioPlayer.pause}
            onResume={audioPlayer.resume}
            onSeek={audioPlayer.seek}
            onStop={audioPlayer.stop}
            onSkipBackward={() => audioPlayer.skipBackward(15)}
            onSkipForward={() => audioPlayer.skipForward(15)}
            onPlaybackRateChange={audioPlayer.setPlaybackRate}
          />
        </div>
      </div>
      {showSettings && (
        <SettingsModal
          initialTab={settingsInitialTab}
          onTabChange={setSettingsInitialTab}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showDownloadManager && (
        <DownloadManagerDialog
          downloads={audioDownloads}
          onStartDownload={handleStartAudioDownload}
          onCancelDownload={handleCancelAudioDownload}
          onRetryDownload={handleRetryAudioDownload}
          onRemoveDownload={handleRemoveAudioDownload}
          onSelectSession={handleAudioDownloadSelectSession}
          onClose={() =>
            useDownloadStore.getState().setShowDownloadManager(false)
          }
        />
      )}
    </div>
  );
}

export default App;
