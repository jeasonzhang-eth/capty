import React, { useEffect, useCallback, useRef, useState } from "react";
import { ControlBar } from "./components/ControlBar";
import { HistoryPanel } from "./components/HistoryPanel";
import { TranscriptArea } from "./components/TranscriptArea";
import { RecordingControls } from "./components/RecordingControls";
import { PlaybackBar } from "./components/PlaybackBar";
import { SetupWizard } from "./components/SetupWizard";
import {
  SettingsModal,
  LlmProvider,
  TtsProviderConfig,
} from "./components/SettingsModal";
import { SummaryPanel, Summary, PromptType } from "./components/SummaryPanel";
import { useAppStore } from "./stores/appStore";
import { useAudioCapture } from "./hooks/useAudioCapture";
import { useVAD } from "./hooks/useVAD";
import { useTranscription } from "./hooks/useTranscription";
import { useSession } from "./hooks/useSession";
import { useAudioPlayer } from "./hooks/useAudioPlayer";

function App(): React.JSX.Element {
  const store = useAppStore();
  const audioCapture = useAudioCapture();
  const session = useSession();
  const audioPlayer = useAudioPlayer();
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Precise audio time tracking (sample-based, not wall-clock)
  const audioSamplesRef = useRef(0); // total samples fed since recording start
  const segmentStartRef = useRef(0); // seconds (from audio samples)
  const segmentEndRef = useRef(0); // seconds (from audio samples)
  const SAMPLE_RATE = 16000;

  const getAudioSeconds = (): number =>
    Math.round(audioSamplesRef.current / SAMPLE_RATE);

  const onFinalCallback = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      const startTime = segmentStartRef.current;
      const endTime = segmentEndRef.current;
      // Persist to database
      if (store.currentSessionId) {
        await window.capty.addSegment({
          sessionId: store.currentSessionId,
          startTime,
          endTime,
          text,
          audioPath: "",
          isFinal: true,
        });
      }
      // Update in-memory store
      store.addSegment({
        id: Date.now(),
        start_time: startTime,
        end_time: endTime,
        text,
      });
    },
    [store.currentSessionId],
  );

  const onErrorCallback = useCallback((msg: string) => {
    console.error("Transcription error:", msg);
  }, []);

  const transcription = useTranscription({
    onFinal: onFinalCallback,
    onError: onErrorCallback,
  });

  const vad = useVAD({
    onSpeechStart: useCallback(() => {
      segmentStartRef.current = getAudioSeconds();
    }, []),
    onSpeechEnd: useCallback(() => {
      segmentEndRef.current = getAudioSeconds();
      // Speech ended - signal the sidecar to transcribe accumulated audio
      transcription.sendSegmentEnd();
    }, [transcription]),
  });

  // Regeneration state
  const [regeneratingSessionId, setRegeneratingSessionId] = useState<
    number | null
  >(null);
  const [regenerationProgress, setRegenerationProgress] = useState(0);
  const cancelRegenerationRef = useRef(false);

  // Unified download tracking (supports multi-model, pause/cancel)
  interface DownloadInfo {
    readonly modelId: string;
    readonly category: "asr" | "tts";
    readonly percent: number;
    readonly status: string; // downloading | paused | failed | completed | pending
    readonly error?: string;
  }
  const [downloads, setDownloads] = useState<Record<string, DownloadInfo>>({});

  // Derive ASR download state for backward compatibility
  const asrDownloadEntries = Object.values(downloads).filter(
    (d) =>
      d.category === "asr" &&
      (d.status === "downloading" || d.status === "paused"),
  );
  const isDownloading = asrDownloadEntries.some(
    (d) => d.status === "downloading",
  );
  const downloadingModelId = asrDownloadEntries[0]?.modelId ?? null;
  const downloadProgress = asrDownloadEntries[0]?.percent ?? 0;
  const downloadError =
    Object.values(downloads).find(
      (d) => d.category === "asr" && d.status === "failed",
    )?.error ?? null;

  // TTS state
  const [ttsProviders, setTtsProviders] = useState<TtsProviderConfig[]>([]);
  const [selectedTtsProviderId, setSelectedTtsProviderId] = useState<
    string | null
  >(null);
  const [ttsModels, setTtsModels] = useState<
    Array<{
      id: string;
      name: string;
      type: string;
      repo: string;
      downloaded: boolean;
      size_gb: number;
      languages: readonly string[];
      description: string;
    }>
  >([]);
  const [selectedTtsModelId, setSelectedTtsModelId] = useState("");
  const [selectedTtsVoice, setSelectedTtsVoice] = useState("auto");
  const [ttsVoices, setTtsVoices] = useState<
    Array<{ id: string; name: string; lang: string; gender: string }>
  >([]);
  // Derive TTS download state for backward compatibility
  const ttsDownloadEntries = Object.values(downloads).filter(
    (d) =>
      d.category === "tts" &&
      (d.status === "downloading" || d.status === "paused"),
  );
  const isTtsDownloading = ttsDownloadEntries.some(
    (d) => d.status === "downloading",
  );
  const ttsDownloadingModelId = ttsDownloadEntries[0]?.modelId ?? null;
  const ttsDownloadProgress = ttsDownloadEntries[0]?.percent ?? 0;
  const ttsDownloadError =
    Object.values(downloads).find(
      (d) => d.category === "tts" && d.status === "failed",
    )?.error ?? null;

  // Config directory path
  const [configDir, setConfigDir] = useState<string | null>(null);

  // HuggingFace mirror URL
  const DEFAULT_HF_URL = "https://huggingface.co";
  const [hfMirrorUrl, setHfMirrorUrl] = useState(DEFAULT_HF_URL);

  // LLM provider state
  const [llmProviders, setLlmProviders] = useState<LlmProvider[]>([]);
  const [selectedLlmProviderId, setSelectedLlmProviderId] = useState<
    string | null
  >(null);

  // Summary state
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState("");

  // Prompt type state
  const [promptTypes, setPromptTypes] = useState<PromptType[]>([]);
  const [activePromptType, setActivePromptType] = useState("summarize");

  // Layout persistence state
  const DEFAULT_HISTORY_WIDTH = 240;
  const DEFAULT_SUMMARY_WIDTH = 320;
  const [historyPanelWidth, setHistoryPanelWidth] = useState(
    DEFAULT_HISTORY_WIDTH,
  );
  const [summaryPanelWidth, setSummaryPanelWidth] = useState(
    DEFAULT_SUMMARY_WIDTH,
  );
  const [zoomFactor, setZoomFactor] = useState(1.0);
  const layoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subscribe to unified download events (manages the `downloads` state)
  useEffect(() => {
    const unsubscribe = window.capty.onDownloadEvent((progress) => {
      setDownloads((prev) => {
        if (progress.status === "completed") {
          // Remove completed downloads from tracking
          const next = { ...prev };
          delete next[progress.modelId];
          return next;
        }
        return {
          ...prev,
          [progress.modelId]: {
            modelId: progress.modelId,
            category: progress.category,
            percent: progress.percent,
            status: progress.status,
            error: progress.error,
          },
        };
      });
    });
    return unsubscribe;
  }, []);

  // Check for incomplete downloads on startup
  useEffect(() => {
    if (!store.dataDir) return;
    window.capty.getIncompleteDownloads().then((incompletes) => {
      if (incompletes.length === 0) return;
      const initial: Record<string, DownloadInfo> = {};
      for (const d of incompletes) {
        initial[d.modelId] = {
          modelId: d.modelId,
          category: d.category,
          percent: d.percent,
          status: d.status,
        };
      }
      setDownloads((prev) => ({ ...prev, ...initial }));
    });
  }, [store.dataDir]);

  const handleDownloadModel = useCallback(async () => {
    const model = store.models.find(
      (m: { id: string }) => m.id === store.selectedModelId,
    );
    if (!model || model.downloaded || isDownloading) return;

    const dataDir = store.dataDir;
    if (!dataDir) return;

    setDownloads((prev) => ({
      ...prev,
      [model.id]: {
        modelId: model.id,
        category: "asr" as const,
        percent: 0,
        status: "downloading",
      },
    }));

    try {
      const destDir = `${dataDir}/models/asr/${model.id}`;
      await window.capty.downloadModel(model.repo, destDir);

      // Refresh models list
      const models = await window.capty.listModels();
      store.setModels(models as Parameters<typeof store.setModels>[0]);
    } catch (err) {
      console.error("Failed to download model:", err);
    } finally {
      setDownloads((prev) => {
        const next = { ...prev };
        delete next[model.id];
        return next;
      });
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
        setConfigDir(await window.capty.getConfigDir());
        await store.loadSessions();
        await audioCapture.loadDevices();

        // Restore saved config
        const config = await window.capty.getConfig();

        // Restore layout settings
        const savedHistoryWidth = config.historyPanelWidth as number | null;
        if (savedHistoryWidth !== null) {
          setHistoryPanelWidth(savedHistoryWidth);
        }
        const savedSummaryWidth = config.summaryPanelWidth as number | null;
        if (savedSummaryWidth !== null) {
          setSummaryPanelWidth(savedSummaryWidth);
        }

        // Restore zoom factor
        const savedZoom = await window.capty.getZoomFactor();
        if (savedZoom && savedZoom !== 1.0) {
          setZoomFactor(savedZoom);
        }

        // Restore HuggingFace mirror URL
        const savedHfUrl = config.hfMirrorUrl as string | null;
        if (savedHfUrl) {
          setHfMirrorUrl(savedHfUrl);
        }

        // Restore LLM providers
        const savedProviders = config.llmProviders as LlmProvider[] | undefined;
        if (savedProviders?.length) {
          setLlmProviders(savedProviders);
        }
        const savedLlmId = config.selectedLlmProviderId as string | null;
        if (savedLlmId) {
          setSelectedLlmProviderId(savedLlmId);
        }

        // Load prompt types
        try {
          const types = await window.capty.listPromptTypes();
          setPromptTypes(types as PromptType[]);
        } catch {
          // Prompt types not available
        }

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
        const savedTtsProviders = config.ttsProviders as
          | TtsProviderConfig[]
          | undefined;
        if (savedTtsProviders?.length) {
          setTtsProviders(savedTtsProviders);
        }
        const savedTtsProviderId = config.selectedTtsProviderId as
          | string
          | null
          | undefined;
        if (savedTtsProviderId !== undefined) {
          setSelectedTtsProviderId(savedTtsProviderId);
        }
        const savedTtsModelId = config.selectedTtsModelId as string | null;
        if (savedTtsModelId) {
          setSelectedTtsModelId(savedTtsModelId);
        }
        const savedTtsVoice = config.selectedTtsVoice as string | undefined;
        if (savedTtsVoice) {
          setSelectedTtsVoice(savedTtsVoice);
        }

        // Check sidecar health
        try {
          const health = await window.capty.checkSidecarHealth();
          store.setSidecarReady(health.online);
        } catch {
          store.setSidecarReady(false);
        }

        // Load ASR models and restore selected model
        try {
          const models = await window.capty.listModels();
          store.setModels(models as Parameters<typeof store.setModels>[0]);

          const modelsList = models as Array<{
            id: string;
            downloaded: boolean;
          }>;
          const savedModelId = config.selectedModelId as string | null;
          if (savedModelId) {
            const exists = modelsList.some(
              (m) => m.id === savedModelId && m.downloaded,
            );
            if (exists) {
              store.setSelectedModelId(savedModelId);
            } else {
              // Saved model no longer exists — auto-select first downloaded
              const first = modelsList.find((m) => m.downloaded);
              if (first) store.setSelectedModelId(first.id);
            }
          } else {
            // No saved model — auto-select first downloaded
            const first = modelsList.find((m) => m.downloaded);
            if (first) store.setSelectedModelId(first.id);
          }
        } catch {
          // Models not available yet
        }

        // Load TTS models
        try {
          const ttsList = await window.capty.listTtsModels();
          setTtsModels(
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
            setSelectedTtsModelId(effectiveTtsModelId);
          }

          // Fetch voice list for the selected TTS model
          if (effectiveTtsModelId && dataDir) {
            try {
              const voiceResult = await window.capty.ttsListVoices(
                `${dataDir}/models/tts/${effectiveTtsModelId}`,
              );
              setTtsVoices(voiceResult.voices);
              // Validate saved voice — reset to "auto" if not in this model's list
              const currentVoice = savedTtsVoice ?? "auto";
              if (
                voiceResult.voices.length > 0 &&
                !voiceResult.voices.some(
                  (v: { id: string }) => v.id === currentVoice,
                )
              ) {
                setSelectedTtsVoice("auto");
              } else if (
                voiceResult.voices.length === 0 &&
                currentVoice !== "auto"
              ) {
                // Model has no voices dir — force auto
                setSelectedTtsVoice("auto");
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      transcription
        .connect()
        .catch((err: unknown) => console.warn("ASR connect failed:", err));
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
    await transcription.gracefulDisconnect();

    await session.stopSession(elapsedRef.current);

    store.setRecording(false);
    store.setCurrentSessionId(null);
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
        // Load summaries for this session filtered by active prompt type
        const sessionSummaries = await window.capty.listSummaries(
          sessionId,
          activePromptType,
        );
        setSummaries(sessionSummaries as Summary[]);
        setGenerateError(null);
      } catch (err) {
        console.error("Failed to load session:", err);
      }
    },
    [store, activePromptType, audioPlayer],
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
        if (audioPlayer.playingSessionId === sessionId) {
          audioPlayer.stop();
        }
        await window.capty.deleteSession(sessionId);
        // If deleting the currently viewed session, clear it
        if (store.currentSessionId === sessionId) {
          store.setCurrentSessionId(null);
          store.clearSegments();
          setSummaries([]);
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
        // 1. Read audio file
        const audioBuffer = await window.capty.readAudioFile(sessionId);
        if (!audioBuffer) {
          console.error("No audio file found for session", sessionId);
          setRegeneratingSessionId(null);
          return;
        }

        // 2. Delete old segments and clear in-memory display
        await window.capty.deleteSegments(sessionId);
        store.clearSegments();

        // PCM data (skip 44-byte WAV header)
        const pcmData = new Uint8Array(audioBuffer, 44);
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
                  id: Date.now(),
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

    // Refresh session list
    await store.loadSessions();
    await handleSelectSession(result.sessionId);

    // Determine ASR provider for file-based transcription
    const activeProvider = store.asrProviders.find(
      (p) => p.id === store.selectedAsrProviderId,
    );
    if (!activeProvider) {
      console.warn("No ASR provider selected for import transcription");
      return;
    }

    const model = activeProvider.isSidecar
      ? store.selectedModelId || activeProvider.model
      : activeProvider.model;
    if (!model) {
      console.error("No ASR model selected");
      return;
    }

    // Use file-based transcription via sidecar (supports any audio format)
    setRegeneratingSessionId(result.sessionId);
    setRegenerationProgress(0);
    try {
      const provider = {
        baseUrl: activeProvider.baseUrl,
        apiKey: activeProvider.apiKey,
        model,
      };

      // For sidecar: use file-path-based transcription (no ffmpeg needed)
      // For external: fall back to PCM-based regeneration flow
      if (activeProvider.isSidecar && result.audioPath) {
        setRegenerationProgress(10);
        const transcribeResult = await window.capty.transcribeFile(
          result.audioPath,
          provider,
        );
        setRegenerationProgress(90);

        const text = transcribeResult.text?.trim();
        if (text) {
          await window.capty.addSegment({
            sessionId: result.sessionId,
            startTime: 0,
            endTime: 0,
            text,
            audioPath: "",
            isFinal: true,
          });
          if (useAppStore.getState().currentSessionId === result.sessionId) {
            store.addSegment({
              id: Date.now(),
              start_time: 0,
              end_time: 0,
              text,
            });
          }
        }
        setRegenerationProgress(100);
      } else {
        // External provider: use regeneration flow (requires WAV)
        handleRegenerateSubtitles(result.sessionId);
        return; // regeneration manages its own state
      }
    } catch (err) {
      console.error("Failed to transcribe imported audio:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      // Show error as a segment so user sees feedback in the UI
      await window.capty.addSegment({
        sessionId: result.sessionId,
        startTime: 0,
        endTime: 0,
        text: `[Transcription failed] ${errMsg}`,
        audioPath: "",
        isFinal: true,
      });
      if (useAppStore.getState().currentSessionId === result.sessionId) {
        store.addSegment({
          id: Date.now(),
          start_time: 0,
          end_time: 0,
          text: `[Transcription failed] ${errMsg}`,
        });
      }
    } finally {
      setRegeneratingSessionId(null);
      setRegenerationProgress(0);
    }
  }, [
    store,
    regeneratingSessionId,
    handleSelectSession,
    handleRegenerateSubtitles,
  ]);

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

  const handleChangeDataDir = useCallback(async () => {
    const dir = await window.capty.selectDirectory();
    if (dir) {
      const config = await window.capty.getConfig();
      await window.capty.setConfig({ ...config, dataDir: dir });
      store.setDataDir(dir);
    }
  }, [store]);

  const handleSelectModel = useCallback(
    async (modelId: string) => {
      store.setSelectedModelId(modelId);
      // Persist to config
      const config = await window.capty.getConfig();
      await window.capty.setConfig({ ...config, selectedModelId: modelId });
    },
    [store],
  );

  const handleSettingsDownloadModel = useCallback(
    async (model: {
      readonly id: string;
      readonly name: string;
      readonly type: string;
      readonly repo: string;
      readonly size_gb: number;
      readonly languages: readonly string[];
      readonly description: string;
    }) => {
      if (downloads[model.id]?.status === "downloading") return;

      const dataDir = store.dataDir;
      if (!dataDir) return;

      setDownloads((prev) => ({
        ...prev,
        [model.id]: {
          modelId: model.id,
          category: "asr" as const,
          percent: 0,
          status: "downloading",
        },
      }));

      try {
        const destDir = `${dataDir}/models/asr/${model.id}`;
        await window.capty.downloadModel(model.repo, destDir);

        // Save model metadata so it's discoverable by models:list
        await window.capty.saveModelMeta(model.id, {
          id: model.id,
          name: model.name,
          type: model.type,
          repo: model.repo,
          size_gb: model.size_gb,
          languages: [...model.languages],
          description: model.description,
        });

        // Refresh models list (now includes both builtin + user-downloaded)
        const models = await window.capty.listModels();
        store.setModels(models as Parameters<typeof store.setModels>[0]);
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Download failed. Check network.";
        console.error("Failed to download model:", err);
        setDownloads((prev) => ({
          ...prev,
          [model.id]: {
            ...prev[model.id],
            status: "failed",
            error: msg,
          },
        }));
        return; // Don't clean up so error shows in UI
      }
      // Clean up on success
      setDownloads((prev) => {
        const next = { ...prev };
        delete next[model.id];
        return next;
      });
    },
    [store, downloads],
  );

  const handleDeleteModel = useCallback(
    async (modelId: string) => {
      try {
        await window.capty.deleteModel(modelId);

        // Refresh models list
        const models = await window.capty.listModels();
        store.setModels(models as Parameters<typeof store.setModels>[0]);

        // If deleted model was selected, switch to first downloaded model
        if (store.selectedModelId === modelId) {
          const firstDownloaded = (
            models as { id: string; downloaded: boolean }[]
          ).find((m) => m.downloaded);
          if (firstDownloaded) {
            store.setSelectedModelId(firstDownloaded.id);
          }
        }
      } catch (err) {
        console.error("Failed to delete model:", err);
      }
    },
    [store],
  );

  const handleSearchModels = useCallback(async (query: string) => {
    const results = await window.capty.searchModels(query);
    return results as Parameters<typeof store.setModels>[0];
  }, []);

  const handleChangeHfMirrorUrl = useCallback(async (url: string) => {
    setHfMirrorUrl(url);
    const config = await window.capty.getConfig();
    await window.capty.setConfig({
      ...config,
      hfMirrorUrl: url || null,
    });
  }, []);

  const handleSaveAsrSettings = useCallback(
    async (settings: {
      asrProviders: import("./stores/appStore").AsrProviderState[];
      selectedAsrProviderId: string | null;
    }) => {
      store.setAsrProviders(settings.asrProviders);
      store.setSelectedAsrProviderId(settings.selectedAsrProviderId);
      const config = await window.capty.getConfig();
      await window.capty.setConfig({
        ...config,
        asrProviders: settings.asrProviders,
        selectedAsrProviderId: settings.selectedAsrProviderId,
      });
      // Re-check sidecar health if a sidecar provider exists
      const hasSidecar = settings.asrProviders.some((p) => p.isSidecar);
      if (hasSidecar) {
        try {
          const health = await window.capty.checkSidecarHealth();
          store.setSidecarReady(health.online);
        } catch {
          store.setSidecarReady(false);
        }
      }
    },
    [store],
  );

  const handleSaveTtsSettings = useCallback(
    async (settings: {
      ttsProviders: TtsProviderConfig[];
      selectedTtsProviderId: string | null;
    }) => {
      setTtsProviders(settings.ttsProviders);
      setSelectedTtsProviderId(settings.selectedTtsProviderId);
      await window.capty.saveTtsSettings({
        ...settings,
        selectedTtsModelId,
      });
    },
    [selectedTtsModelId],
  );

  const handleSelectTtsModel = useCallback(
    async (modelId: string) => {
      setSelectedTtsModelId(modelId);
      await window.capty.saveTtsSettings({
        ttsProviders,
        selectedTtsProviderId,
        selectedTtsModelId: modelId,
      });
    },
    [ttsProviders, selectedTtsProviderId],
  );

  const handleChangeTtsVoice = useCallback(async (voice: string) => {
    setSelectedTtsVoice(voice);
    const config = await window.capty.getConfig();
    await window.capty.setConfig({ ...config, selectedTtsVoice: voice });
  }, []);

  const handleChangeTtsModelForPlay = useCallback(
    async (modelId: string) => {
      // Immediately reset voice to "auto" to avoid stale voice for new model
      setSelectedTtsModelId(modelId);
      setSelectedTtsVoice("auto");
      setTtsVoices([]);

      const config = await window.capty.getConfig();
      await window.capty.setConfig({
        ...config,
        selectedTtsModelId: modelId,
        selectedTtsVoice: "auto",
      });

      // Fetch voice list for the new model
      const dataDir = store.dataDir;
      if (!dataDir) return;
      try {
        const result = await window.capty.ttsListVoices(
          `${dataDir}/models/tts/${modelId}`,
        );
        setTtsVoices(result.voices);
      } catch {
        setTtsVoices([]);
      }
    },
    [store.dataDir],
  );

  const handleDownloadTtsModel = useCallback(
    async (model: {
      readonly id: string;
      readonly name: string;
      readonly type: string;
      readonly repo: string;
      readonly size_gb: number;
      readonly languages: readonly string[];
      readonly description: string;
    }) => {
      if (downloads[model.id]?.status === "downloading") return;
      const dataDir = store.dataDir;
      if (!dataDir) return;

      setDownloads((prev) => ({
        ...prev,
        [model.id]: {
          modelId: model.id,
          category: "tts" as const,
          percent: 0,
          status: "downloading",
        },
      }));

      try {
        const destDir = `${dataDir}/models/tts/${model.id}`;
        await window.capty.downloadTtsModel(model.repo, destDir);

        // Save model metadata
        await window.capty.saveTtsModelMeta(model.id, {
          id: model.id,
          name: model.name,
          type: model.type,
          repo: model.repo,
          size_gb: model.size_gb,
          languages: [...model.languages],
          description: model.description,
        });

        // Refresh TTS models list
        const ttsList = await window.capty.listTtsModels();
        setTtsModels(
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
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Download failed. Check network.";
        console.error("Failed to download TTS model:", err);
        setDownloads((prev) => ({
          ...prev,
          [model.id]: {
            ...prev[model.id],
            status: "failed",
            error: msg,
          },
        }));
        return;
      }
      // Clean up on success
      setDownloads((prev) => {
        const next = { ...prev };
        delete next[model.id];
        return next;
      });
    },
    [store, downloads],
  );

  // Download control handlers (pause / resume / cancel)
  const handlePauseDownload = useCallback(async (modelId: string) => {
    await window.capty.pauseDownload(modelId);
    setDownloads((prev) => ({
      ...prev,
      [modelId]: { ...prev[modelId], status: "paused" },
    }));
  }, []);

  const handleResumeDownload = useCallback(
    async (modelId: string) => {
      const dl = downloads[modelId];
      if (!dl) return;
      setDownloads((prev) => ({
        ...prev,
        [modelId]: { ...prev[modelId], status: "downloading" },
      }));
      try {
        await window.capty.resumeDownload(modelId);
        // On success, refresh model lists
        const models = await window.capty.listModels();
        store.setModels(models as Parameters<typeof store.setModels>[0]);
        const ttsList = await window.capty.listTtsModels();
        setTtsModels(
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
      } catch (err) {
        console.error("Failed to resume download:", err);
      } finally {
        setDownloads((prev) => {
          const next = { ...prev };
          delete next[modelId];
          return next;
        });
      }
    },
    [store, downloads],
  );

  const handleCancelDownload = useCallback(async (modelId: string) => {
    await window.capty.cancelDownload(modelId);
    setDownloads((prev) => {
      const next = { ...prev };
      delete next[modelId];
      return next;
    });
  }, []);

  const handleDeleteTtsModel = useCallback(
    async (modelId: string) => {
      try {
        await window.capty.deleteTtsModel(modelId);
        const ttsList = await window.capty.listTtsModels();
        setTtsModels(
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
        if (selectedTtsModelId === modelId) {
          const firstDownloaded = (
            ttsList as Array<{ id: string; downloaded: boolean }>
          ).find((m) => m.downloaded);
          if (firstDownloaded) setSelectedTtsModelId(firstDownloaded.id);
        }
      } catch (err) {
        console.error("Failed to delete TTS model:", err);
      }
    },
    [selectedTtsModelId],
  );

  const handleSearchTtsModels = useCallback(async (query: string) => {
    const results = await window.capty.searchTtsModels(query);
    return results as Array<{
      id: string;
      name: string;
      type: string;
      repo: string;
      downloaded: boolean;
      size_gb: number;
      languages: readonly string[];
      description: string;
    }>;
  }, []);

  const handleSaveLlmProviders = useCallback(
    async (providers: LlmProvider[]) => {
      setLlmProviders(providers);
      const config = await window.capty.getConfig();
      await window.capty.setConfig({
        ...config,
        llmProviders: providers,
      });
    },
    [],
  );

  const handleSummarize = useCallback(
    async (providerId: string, promptType: string) => {
      if (!store.currentSessionId || isGeneratingSummary) return;
      setStreamingContent("");
      setIsGeneratingSummary(true);
      setGenerateError(null);
      try {
        const result = await window.capty.summarize(
          store.currentSessionId,
          providerId,
          promptType,
        );
        setSummaries((prev) => [...prev, result as Summary]);
        setStreamingContent("");
        // Remember last used provider
        setSelectedLlmProviderId(providerId);
        const config = await window.capty.getConfig();
        await window.capty.setConfig({
          ...config,
          selectedLlmProviderId: providerId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to generate";
        console.error("Summarize error:", err);
        setGenerateError(msg);
        setStreamingContent("");
      } finally {
        setIsGeneratingSummary(false);
      }
    },
    [store.currentSessionId, isGeneratingSummary],
  );

  const handleChangePromptType = useCallback(
    async (promptType: string) => {
      setActivePromptType(promptType);
      setGenerateError(null);
      // Reload summaries for new prompt type
      if (store.currentSessionId) {
        try {
          const sessionSummaries = await window.capty.listSummaries(
            store.currentSessionId,
            promptType,
          );
          setSummaries(sessionSummaries as Summary[]);
        } catch {
          setSummaries([]);
        }
      }
    },
    [store.currentSessionId],
  );

  const handleSavePromptTypes = useCallback(async (types: PromptType[]) => {
    await window.capty.savePromptTypes(types);
    // Reload effective prompt types from backend
    const effective = await window.capty.listPromptTypes();
    setPromptTypes(effective as PromptType[]);
  }, []);

  // Layout width change handlers (debounced save)
  const handleHistoryWidthChange = useCallback((newWidth: number) => {
    setHistoryPanelWidth(newWidth);
    if (layoutTimerRef.current) clearTimeout(layoutTimerRef.current);
    layoutTimerRef.current = setTimeout(() => {
      window.capty.saveLayout({ historyPanelWidth: newWidth });
    }, 500);
  }, []);

  const handleSummaryWidthChange = useCallback((newWidth: number) => {
    setSummaryPanelWidth(newWidth);
    if (layoutTimerRef.current) clearTimeout(layoutTimerRef.current);
    layoutTimerRef.current = setTimeout(() => {
      window.capty.saveLayout({ summaryPanelWidth: newWidth });
    }, 500);
  }, []);

  // Zoom keyboard shortcuts: Cmd/Ctrl + =/- /0
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        setZoomFactor((prev) => {
          const next = Math.min(3.0, Math.round((prev + 0.1) * 10) / 10);
          window.capty.setZoomFactor(next);
          return next;
        });
      } else if (e.key === "-") {
        e.preventDefault();
        setZoomFactor((prev) => {
          const next = Math.max(0.5, Math.round((prev - 0.1) * 10) / 10);
          window.capty.setZoomFactor(next);
          return next;
        });
      } else if (e.key === "0") {
        e.preventDefault();
        setZoomFactor(1.0);
        window.capty.setZoomFactor(1.0);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Sidecar health polling (every 10s when a sidecar provider exists)
  useEffect(() => {
    const hasSidecar = store.asrProviders.some((p) => p.isSidecar);
    if (!hasSidecar) return;
    const poll = async (): Promise<void> => {
      try {
        const health = await window.capty.checkSidecarHealth();
        store.setSidecarReady(health.online);
      } catch {
        store.setSidecarReady(false);
      }
    };
    const timer = setInterval(poll, 10000);
    return () => clearInterval(timer);
  }, [store.asrProviders]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Listen for LLM streaming chunks
  useEffect(() => {
    const unsub = window.capty.onSummaryChunk(({ content, done }) => {
      if (done) return;
      setStreamingContent((prev) => prev + content);
    });
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
        isDownloading={isDownloading}
        downloadProgress={downloadProgress}
        onDownloadModel={handleDownloadModel}
        ttsProviderReady={store.ttsProviderReady}
        ttsProviderName={
          ttsProviders.find((p) => p.id === selectedTtsProviderId)?.name ?? null
        }
      />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <HistoryPanel
          sessions={store.sessions}
          currentSessionId={store.currentSessionId}
          playingSessionId={audioPlayer.playingSessionId}
          regeneratingSessionId={regeneratingSessionId}
          regenerationProgress={regenerationProgress}
          isRecording={store.isRecording}
          width={historyPanelWidth}
          onWidthChange={handleHistoryWidthChange}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
          onPlaySession={handlePlaySession}
          onStopPlayback={audioPlayer.stop}
          onRenameSession={handleRenameSession}
          onRegenerateSubtitles={handleRegenerateSubtitles}
          onCancelRegeneration={handleCancelRegeneration}
          onOpenFolder={(id) => window.capty.openAudioFolder(id)}
          onUploadAudio={handleUploadAudio}
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
        />
        <SummaryPanel
          summaries={summaries}
          isGenerating={isGeneratingSummary}
          streamingContent={streamingContent}
          generateError={generateError}
          currentSessionId={store.currentSessionId}
          hasSegments={store.segments.length > 0}
          llmProviders={llmProviders}
          selectedLlmProviderId={selectedLlmProviderId}
          promptTypes={promptTypes}
          activePromptType={activePromptType}
          initialWidth={summaryPanelWidth}
          ttsModels={ttsModels.filter((m) => m.downloaded)}
          selectedTtsModelId={selectedTtsModelId}
          selectedTtsVoice={selectedTtsVoice}
          ttsVoices={ttsVoices}
          ttsProviderReady={store.ttsProviderReady}
          onWidthChange={handleSummaryWidthChange}
          onSummarize={handleSummarize}
          onChangePromptType={handleChangePromptType}
          onSavePromptTypes={handleSavePromptTypes}
          onChangeTtsModel={handleChangeTtsModelForPlay}
          onChangeTtsVoice={handleChangeTtsVoice}
        />
      </div>
      {audioPlayer.playingSessionId !== null && (
        <PlaybackBar
          sessionTitle={
            store.sessions.find(
              (s: { id: number }) => s.id === audioPlayer.playingSessionId,
            )?.title ?? "Unknown"
          }
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
          onSkipBackward={() => audioPlayer.skipBackward(10)}
          onSkipForward={() => audioPlayer.skipForward(10)}
          onPlaybackRateChange={audioPlayer.setPlaybackRate}
        />
      )}
      <RecordingControls
        isRecording={store.isRecording}
        elapsedSeconds={store.elapsedSeconds}
        audioLevel={audioLevel}
        onStart={handleStart}
        onStop={handleStop}
      />
      {showSettings && (
        <SettingsModal
          dataDir={store.dataDir}
          configDir={configDir}
          models={store.models}
          selectedModelId={store.selectedModelId}
          isDownloading={isDownloading}
          downloadingModelId={downloadingModelId}
          downloadProgress={downloadProgress}
          downloadError={downloadError}
          isRecording={store.isRecording}
          hfMirrorUrl={hfMirrorUrl}
          defaultHfUrl={DEFAULT_HF_URL}
          llmProviders={llmProviders}
          asrProviders={store.asrProviders}
          selectedAsrProviderId={store.selectedAsrProviderId}
          sidecarReady={store.sidecarReady}
          downloads={downloads}
          onChangeDataDir={handleChangeDataDir}
          onSelectModel={handleSelectModel}
          onDownloadModel={handleSettingsDownloadModel}
          onDeleteModel={handleDeleteModel}
          onSearchModels={handleSearchModels}
          onChangeHfMirrorUrl={handleChangeHfMirrorUrl}
          onSaveLlmProviders={handleSaveLlmProviders}
          onSaveAsrSettings={handleSaveAsrSettings}
          onPauseDownload={handlePauseDownload}
          onResumeDownload={handleResumeDownload}
          onCancelDownload={handleCancelDownload}
          ttsProviders={ttsProviders}
          selectedTtsProviderId={selectedTtsProviderId}
          ttsModels={ttsModels}
          selectedTtsModelId={selectedTtsModelId}
          isTtsDownloading={isTtsDownloading}
          ttsDownloadingModelId={ttsDownloadingModelId}
          ttsDownloadProgress={ttsDownloadProgress}
          ttsDownloadError={ttsDownloadError}
          onSaveTtsSettings={handleSaveTtsSettings}
          onSelectTtsModel={handleSelectTtsModel}
          onDownloadTtsModel={handleDownloadTtsModel}
          onDeleteTtsModel={handleDeleteTtsModel}
          onSearchTtsModels={handleSearchTtsModels}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

export default App;
