import React, { useEffect, useCallback, useRef, useState } from "react";
import { ControlBar } from "./components/ControlBar";
import { HistoryPanel, SessionCategory } from "./components/HistoryPanel";
import { TranscriptArea } from "./components/TranscriptArea";
import { RecordingControls } from "./components/RecordingControls";
import { PlaybackBar } from "./components/PlaybackBar";
import { SetupWizard } from "./components/SetupWizard";
import {
  SettingsModal,
  LlmProvider,
  TtsProviderConfig,
  TabId,
} from "./components/SettingsModal";
import { SummaryPanel, Summary, PromptType } from "./components/SummaryPanel";
import { useAppStore } from "./stores/appStore";
import { useAudioCapture } from "./hooks/useAudioCapture";
import { useVAD } from "./hooks/useVAD";
import { useTranscription } from "./hooks/useTranscription";
import { useSession } from "./hooks/useSession";
import { useAudioPlayer } from "./hooks/useAudioPlayer";
import { DownloadManagerDialog } from "./components/DownloadManagerDialog";
import { useAudioDownloads } from "./hooks/useAudioDownloads";
import { useSettings } from "./hooks/useSettings";
import { useModelDownloads } from "./hooks/useModelDownloads";

const DEFAULT_RAPID_RENAME_PROMPT =
  "Based on the following meeting transcript, generate a concise and descriptive Chinese title (max 10 words). Return ONLY the title text, no quotes, no timestamp, no extra text.";

const DEFAULT_TRANSLATE_PROMPT =
  "You are a professional translator. Translate the following text to {{target_language}}. Rules:\n1. Translate ONLY the text content, preserving the exact number of lines\n2. Each line in the output corresponds to the same line in the input\n3. Do NOT add, remove, or merge lines\n4. Do NOT add any explanations, notes, or extra text\n5. Maintain the original tone and meaning\n\n{{text}}";

function App(): React.JSX.Element {
  const store = useAppStore();
  const audioCapture = useAudioCapture();
  const session = useSession();
  const audioPlayer = useAudioPlayer();
  const audioPlayerRef = useRef(audioPlayer);
  audioPlayerRef.current = audioPlayer;

  const settings = useSettings({ store, audioCapture });
  const {
    needsSetup,
    setNeedsSetup,
    showSettings,
    setShowSettings,
    settingsInitialTab,
    setSettingsInitialTab,
    autoStartSidecar,
    configDir,
    hfMirrorUrl,
    DEFAULT_HF_URL,
    historyPanelWidth,
    summaryPanelWidth,
    handleStartSidecar,
    handleStopSidecar,
    handleDeviceChange,
    handleChangeDataDir,
    handleChangeAutoStartSidecar,
    handleChangeHfMirrorUrl,
    handleHistoryWidthChange,
    handleSummaryWidthChange,
  } = settings;

  // Forward-declare ref so useAudioDownloads can call handleSelectSession
  // which is defined further down (circular dependency broken via ref)
  const handleSelectSessionRef = useRef<(id: number) => Promise<void>>(
    async () => undefined,
  );

  const audioDownloadsHook = useAudioDownloads({
    loadSessions: store.loadSessions,
    onSelectSession: (id) => handleSelectSessionRef.current(id),
    needsSetup,
  });
  const {
    showDownloadManager,
    setShowDownloadManager,
    audioDownloads,
    downloadBadge,
    handleStartAudioDownload,
    handleCancelAudioDownload,
    handleRetryAudioDownload,
    handleRemoveAudioDownload,
    handleAudioDownloadSelectSession,
  } = audioDownloadsHook;

  // Forward-declare ref for TTS model refresh (used by useModelDownloads resume)
  const refreshTtsModelsRef = useRef<() => Promise<void>>(
    async () => undefined,
  );

  const modelDownloadsHook = useModelDownloads({
    store,
    onRefreshTtsModels: () => refreshTtsModelsRef.current(),
  });
  const {
    downloads,
    setDownloads,
    isDownloading,
    downloadingModelId,
    downloadProgress,
    downloadError,
    handleDownloadModel,
    handleSelectModel,
    handleSettingsDownloadModel,
    handleDeleteModel,
    handleSearchModels,
    handlePauseDownload,
    handleResumeDownload,
    handleCancelDownload,
  } = modelDownloadsHook;

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
  const [selectedTtsVoice, setSelectedTtsVoice] = useState("");
  const [ttsVoices, setTtsVoices] = useState<
    Array<{ id: string; name: string; lang: string; gender: string }>
  >([]);
  // Wire up refreshTtsModels for useModelDownloads resume handler
  refreshTtsModelsRef.current = async () => {
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
  };

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

  // LLM provider state
  const [llmProviders, setLlmProviders] = useState<LlmProvider[]>([]);
  // Provider + model pair per feature
  type ModelSelection = { providerId: string; model: string } | null;
  const [selectedSummaryModel, setSelectedSummaryModel] =
    useState<ModelSelection>(null);
  const [selectedTranslateModel, setSelectedTranslateModel] =
    useState<ModelSelection>(null);
  const [selectedRapidModel, setSelectedRapidModel] =
    useState<ModelSelection>(null);
  const [rapidRenamePrompt, setRapidRenamePrompt] = useState(
    DEFAULT_RAPID_RENAME_PROMPT,
  );
  const [translatePrompt, setTranslatePrompt] = useState(
    DEFAULT_TRANSLATE_PROMPT,
  );
  // Per-session translation tracking: sessionId → progress%
  const [translationProgressMap, setTranslationProgressMap] = useState<
    Record<number, number>
  >({});
  const translateAbortMapRef = useRef<Record<number, boolean>>({});
  // Derived: is the *current* session translating?
  const isTranslating =
    store.currentSessionId != null &&
    store.currentSessionId in translationProgressMap;
  const translationProgress =
    store.currentSessionId != null
      ? (translationProgressMap[store.currentSessionId] ?? 0)
      : 0;
  // Map: segmentId → translated text (for current session + language)
  const [translations, setTranslations] = useState<Record<number, string>>({});
  const [activeTranslationLang, setActiveTranslationLangRaw] = useState<
    string | null
  >(() => localStorage.getItem("capty:activeTranslationLang"));
  const setActiveTranslationLang = useCallback((lang: string | null) => {
    setActiveTranslationLangRaw(lang);
    if (lang) {
      localStorage.setItem("capty:activeTranslationLang", lang);
    } else {
      localStorage.removeItem("capty:activeTranslationLang");
    }
  }, []);

  const [aiRenamingSessionId, setAiRenamingSessionId] = useState<number | null>(
    null,
  );

  // Summary state (per-session × per-tab generation support).
  // Keys are `${sessionId}:${promptType}` so multiple sessions can generate
  // simultaneously without leaking into each other.
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [generatingTabs, setGeneratingTabs] = useState<Set<string>>(new Set());
  const generatingTabsRef = useRef(generatingTabs);
  generatingTabsRef.current = generatingTabs;
  const [streamingContentMap, setStreamingContentMap] = useState<
    Record<string, string>
  >({});
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Prompt type state
  const [promptTypes, setPromptTypes] = useState<PromptType[]>([]);
  const [activePromptType, setActivePromptType] = useState("summarize");
  const activePromptTypeRef = useRef(activePromptType);
  activePromptTypeRef.current = activePromptType;

  // Session categories state
  const [sessionCategories, setSessionCategories] = useState<SessionCategory[]>(
    [],
  );

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
        await store.loadSessions();
        await audioCapture.loadDevices();

        // Restore saved config
        const config = await window.capty.getConfig();

        // Restore settings (layout, zoom, hfMirror, configDir)
        await settings.initFromConfig(config);

        // Restore LLM providers
        const savedProviders = config.llmProviders as LlmProvider[] | undefined;
        if (savedProviders?.length) {
          setLlmProviders(savedProviders);
        }
        // Restore model selections (new format)
        if (config.selectedSummaryModel) {
          setSelectedSummaryModel(
            config.selectedSummaryModel as ModelSelection,
          );
        }
        if (config.selectedTranslateModel) {
          setSelectedTranslateModel(
            config.selectedTranslateModel as ModelSelection,
          );
        }
        if (config.selectedRapidModel) {
          setSelectedRapidModel(config.selectedRapidModel as ModelSelection);
        }
        const savedRenamePrompt = config.rapidRenamePrompt as
          | string
          | undefined;
        if (savedRenamePrompt) {
          setRapidRenamePrompt(savedRenamePrompt);
        }
        const savedTranslatePrompt = config.translatePrompt as
          | string
          | undefined;
        if (savedTranslatePrompt) {
          setTranslatePrompt(savedTranslatePrompt);
        }

        // Load prompt types
        try {
          const types = await window.capty.listPromptTypes();
          setPromptTypes(types as PromptType[]);
        } catch {
          // Prompt types not available
        }

        // Load session categories
        try {
          const cats = await window.capty.listSessionCategories();
          setSessionCategories(cats as SessionCategory[]);
        } catch {
          // Session categories not available
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

        // Restore sidecar config + health check + auto-start
        await settings.initSidecar(config);

        // Load ASR models and restore selected model
        await modelDownloadsHook.initModels(config);

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
          if (effectiveTtsModelId) {
            try {
              const voiceResult = await window.capty.ttsListVoices();
              setTtsVoices(voiceResult.voices);
              // Validate saved voice — fall back to first voice if invalid
              const currentVoice = savedTtsVoice ?? "";
              if (
                voiceResult.voices.length > 0 &&
                !voiceResult.voices.some(
                  (v: { id: string }) => v.id === currentVoice,
                )
              ) {
                setSelectedTtsVoice(voiceResult.voices[0].id);
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
        setGenerateError(null);
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
        if (activeTranslationLang) {
          try {
            const rows = await window.capty.listTranslations(
              sessionId,
              activeTranslationLang,
            );
            const map: Record<number, string> = {};
            for (const row of rows) {
              map[row.segment_id] = row.translated_text;
            }
            setTranslations(map);
          } catch {
            setTranslations({});
          }
        } else {
          setTranslations({});
        }
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
    [store, activePromptType, audioPlayer, activeTranslationLang],
  );
  handleSelectSessionRef.current = handleSelectSession;

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
        const updated = [...sessionCategories, newCat];
        await window.capty.saveSessionCategories(updated);
        const cats = await window.capty.listSessionCategories();
        setSessionCategories(cats as SessionCategory[]);
      } catch (err) {
        console.error("Failed to add category:", err);
      }
    },
    [sessionCategories],
  );

  const handleDeleteCategory = useCallback(
    async (categoryId: string) => {
      try {
        await window.capty.deleteSessionCategory(categoryId);
        const cats = await window.capty.listSessionCategories();
        setSessionCategories(cats as SessionCategory[]);
        await store.loadSessions(); // refresh since sessions moved to "recording"
      } catch (err) {
        console.error("Failed to delete category:", err);
      }
    },
    [store],
  );

  const handleReorderCategories = useCallback(
    async (categoryIds: string[]) => {
      try {
        // Reorder categories array to match the new order
        const reordered = categoryIds
          .map((id) => sessionCategories.find((c) => c.id === id))
          .filter(Boolean) as SessionCategory[];
        setSessionCategories(reordered);
        await window.capty.saveSessionCategories(reordered);
      } catch (err) {
        console.error("Failed to reorder categories:", err);
      }
    },
    [sessionCategories],
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
      // Always re-check sidecar health (sidecar is independent of provider list)
      try {
        const health = await window.capty.checkSidecarHealth();
        store.setSidecarReady(health.online);
      } catch {
        store.setSidecarReady(false);
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

  const handleChangeSummaryModel = useCallback(
    async (selection: { providerId: string; model: string }) => {
      setSelectedSummaryModel(selection);
      const config = await window.capty.getConfig();
      await window.capty.setConfig({
        ...config,
        selectedSummaryModel: selection,
      });
    },
    [],
  );

  const handleChangeRapidModel = useCallback(
    async (selection: { providerId: string; model: string }) => {
      setSelectedRapidModel(selection);
      const config = await window.capty.getConfig();
      await window.capty.setConfig({
        ...config,
        selectedRapidModel: selection,
      });
    },
    [],
  );

  const handleChangeTranslateModel = useCallback(
    async (selection: { providerId: string; model: string }) => {
      setSelectedTranslateModel(selection);
      const config = await window.capty.getConfig();
      await window.capty.setConfig({
        ...config,
        selectedTranslateModel: selection,
      });
    },
    [],
  );

  const handleChangeRapidRenamePrompt = useCallback(async (prompt: string) => {
    setRapidRenamePrompt(prompt);
    const config = await window.capty.getConfig();
    await window.capty.setConfig({
      ...config,
      rapidRenamePrompt: prompt,
    });
  }, []);

  const handleChangeTranslatePrompt = useCallback(async (prompt: string) => {
    setTranslatePrompt(prompt);
    const config = await window.capty.getConfig();
    await window.capty.setConfig({
      ...config,
      translatePrompt: prompt,
    });
  }, []);

  const handleTranslate = useCallback(
    async (targetLanguage: string) => {
      if (store.segments.length === 0) return;
      const sessionId = store.currentSessionId;
      if (!sessionId) return;
      // Already translating this session
      if (sessionId in translateAbortMapRef.current) return;

      // Resolve provider + model for translation
      const sel = selectedTranslateModel;
      const provider = sel
        ? llmProviders.find((p) => p.id === sel.providerId)
        : llmProviders.find((p) => (p.models?.length ?? 0) > 0);
      if (!provider) {
        console.warn("Translate: no LLM provider configured");
        return;
      }
      const modelToUse = sel?.model || provider.models[0] || provider.model;

      translateAbortMapRef.current[sessionId] = false;
      setTranslationProgressMap((prev) => ({ ...prev, [sessionId]: 0 }));
      setActiveTranslationLang(targetLanguage);

      const segments = [...store.segments];
      const total = segments.length;
      const newTranslations: Record<number, string> = {};
      setTranslations({});
      let completed = 0;

      const CONCURRENCY = 3;

      const translateOne = async (
        seg: (typeof segments)[number],
      ): Promise<void> => {
        if (translateAbortMapRef.current[sessionId]) return;
        try {
          const result = await window.capty.translate(
            provider.id,
            modelToUse,
            seg.text,
            targetLanguage,
            translatePrompt,
          );
          if (translateAbortMapRef.current[sessionId]) return;

          newTranslations[seg.id] = result;
          // Only update displayed translations if still viewing this session
          if (useAppStore.getState().currentSessionId === sessionId) {
            setTranslations({ ...newTranslations });
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
        setTranslationProgressMap((prev) => ({
          ...prev,
          [sessionId]: Math.round((completed / total) * 100),
        }));
      };

      // Process segments in batches of CONCURRENCY
      for (let i = 0; i < total; i += CONCURRENCY) {
        if (translateAbortMapRef.current[sessionId]) break;
        const batch = segments.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(translateOne));
      }

      // Cleanup finished session
      delete translateAbortMapRef.current[sessionId];
      setTranslationProgressMap((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
      // If user switched back, reload translations from DB
      if (useAppStore.getState().currentSessionId === sessionId) {
        try {
          const rows = await window.capty.listTranslations(
            sessionId,
            targetLanguage,
          );
          const map: Record<number, string> = {};
          for (const row of rows) {
            map[row.segment_id] = row.translated_text;
          }
          setTranslations(map);
        } catch {
          // keep newTranslations as-is
        }
      }
    },
    [store, selectedTranslateModel, llmProviders, translatePrompt],
  );

  const handleStopTranslation = useCallback(() => {
    const sid = store.currentSessionId;
    if (sid != null) {
      translateAbortMapRef.current[sid] = true;
    }
  }, [store.currentSessionId]);

  // Load saved translations when switching language or session
  const handleLoadTranslations = useCallback(
    async (sessionId: number, targetLanguage: string) => {
      try {
        const rows = await window.capty.listTranslations(
          sessionId,
          targetLanguage,
        );
        const map: Record<number, string> = {};
        for (const row of rows) {
          map[row.segment_id] = row.translated_text;
        }
        setTranslations(map);
        setActiveTranslationLang(targetLanguage);
      } catch {
        setTranslations({});
      }
    },
    [],
  );

  const handleAiRename = useCallback(
    async (sessionId: number) => {
      if (aiRenamingSessionId) return;
      const sel = selectedRapidModel;
      const provider = sel
        ? llmProviders.find((p) => p.id === sel.providerId)
        : llmProviders.find((p) => (p.models?.length ?? 0) > 0);
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
          rapidRenamePrompt,
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
    [
      selectedRapidModel,
      llmProviders,
      rapidRenamePrompt,
      aiRenamingSessionId,
      store,
    ],
  );

  const handleChangeTtsModelForPlay = useCallback(async (modelId: string) => {
    // Immediately reset voice to "auto" to avoid stale voice for new model
    setSelectedTtsModelId(modelId);
    setSelectedTtsVoice("");
    setTtsVoices([]);

    const config = await window.capty.getConfig();
    await window.capty.setConfig({
      ...config,
      selectedTtsModelId: modelId,
      selectedTtsVoice: "",
    });

    // Fetch voice list for the new model and default to first voice
    try {
      const result = await window.capty.ttsListVoices();
      setTtsVoices(result.voices);
      if (result.voices.length > 0) {
        const firstVoice = result.voices[0].id;
        setSelectedTtsVoice(firstVoice);
        const cfg = await window.capty.getConfig();
        await window.capty.setConfig({ ...cfg, selectedTtsVoice: firstVoice });
      }
    } catch {
      setTtsVoices([]);
    }
  }, []);

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
          const newId = firstDownloaded ? firstDownloaded.id : "";
          setSelectedTtsModelId(newId);
          await window.capty.setConfig({
            ...(await window.capty.getConfig()),
            selectedTtsModelId: newId || null,
          });
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
    async (providerId: string, model: string, promptType: string) => {
      const originSessionId = store.currentSessionId;
      if (!originSessionId) return;
      const key = `${originSessionId}:${promptType}`;
      if (generatingTabsRef.current.has(key)) return;
      setStreamingContentMap((prev) => ({ ...prev, [key]: "" }));
      setGeneratingTabs((prev) => new Set(prev).add(key));
      setGenerateError(null);
      try {
        await window.capty.summarize(
          originSessionId,
          providerId,
          model,
          promptType,
        );
        // Clear streaming content for this session:tab
        setStreamingContentMap((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        // Reload summaries if still viewing the origin session
        const currentId = useAppStore.getState().currentSessionId;
        if (currentId === originSessionId) {
          const currentTab = activePromptTypeRef.current;
          const freshSummaries = await window.capty.listSummaries(
            originSessionId,
            currentTab,
          );
          setSummaries(freshSummaries as Summary[]);
        }
        // Remember last used model selection (always, regardless of session switch)
        setSelectedSummaryModel({ providerId, model });
        const config = await window.capty.getConfig();
        await window.capty.setConfig({
          ...config,
          selectedSummaryModel: { providerId, model },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to generate";
        console.error("Summarize error:", err);
        if (useAppStore.getState().currentSessionId === originSessionId) {
          setGenerateError(msg);
        }
      } finally {
        setGeneratingTabs((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        setStreamingContentMap((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [store.currentSessionId],
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
    const provider = ttsProviders.find((p) => p.id === selectedTtsProviderId);
    if (!provider?.isSidecar) {
      // External providers don't use voice selectors
      setTtsVoices([]);
      return;
    }
    (async () => {
      try {
        const result = await window.capty.ttsListVoices();
        setTtsVoices(result.voices);
        // If saved voice not in list, default to first
        if (
          result.voices.length > 0 &&
          !result.voices.some((v) => v.id === selectedTtsVoice)
        ) {
          const first = result.voices[0].id;
          setSelectedTtsVoice(first);
          const config = await window.capty.getConfig();
          await window.capty.setConfig({ ...config, selectedTtsVoice: first });
        }
      } catch {
        setTtsVoices([]);
      }
    })();
  }, [selectedTtsProviderId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Validate model selections when providers change
  useEffect(() => {
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
    validateSelection(selectedSummaryModel, setSelectedSummaryModel);
    validateSelection(selectedTranslateModel, setSelectedTranslateModel);
    validateSelection(selectedRapidModel, setSelectedRapidModel);
  }, [llmProviders]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for LLM streaming chunks. Each chunk is keyed by (sessionId, promptType)
  // so background generation for a different session accumulates into its own
  // buffer without affecting what the user currently sees.
  useEffect(() => {
    const unsub = window.capty.onSummaryChunk(
      ({ content, done, promptType, sessionId }) => {
        if (done) return;
        const key = `${sessionId}:${promptType}`;
        setStreamingContentMap((prev) => ({
          ...prev,
          [key]: (prev[key] || "") + content,
        }));
      },
    );
    return unsub;
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
          onDownloadAudio={() => setShowDownloadManager(true)}
          downloadBadge={downloadBadge}
          onAiRename={
            llmProviders.some((p) => (p.models?.length ?? 0) > 0)
              ? handleAiRename
              : undefined
          }
          aiRenamingSessionId={aiRenamingSessionId}
          onUpdateCategory={handleUpdateCategory}
          onReorderSessions={handleReorderSessions}
          categories={sessionCategories}
          onAddCategory={handleAddCategory}
          onDeleteCategory={handleDeleteCategory}
          onReorderCategories={handleReorderCategories}
          onEditSession={handleEditSession}
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
        <SummaryPanel
          summaries={summaries}
          isGenerating={
            store.currentSessionId !== null &&
            generatingTabs.has(`${store.currentSessionId}:${activePromptType}`)
          }
          generatingPromptType={
            store.currentSessionId !== null &&
            generatingTabs.has(`${store.currentSessionId}:${activePromptType}`)
              ? activePromptType
              : null
          }
          streamingContent={
            store.currentSessionId !== null
              ? (streamingContentMap[
                  `${store.currentSessionId}:${activePromptType}`
                ] ?? "")
              : ""
          }
          generateError={generateError}
          currentSessionId={store.currentSessionId}
          hasSegments={store.segments.length > 0}
          llmProviders={llmProviders}
          selectedSummaryModel={selectedSummaryModel}
          promptTypes={promptTypes}
          activePromptType={activePromptType}
          initialWidth={summaryPanelWidth}
          ttsModels={ttsModels.filter((m) => m.downloaded)}
          selectedTtsModelId={selectedTtsModelId}
          selectedTtsVoice={selectedTtsVoice}
          ttsVoices={ttsVoices}
          ttsProviderReady={store.ttsProviderReady}
          isSidecarTts={
            ttsProviders.find((p) => p.id === selectedTtsProviderId)
              ?.isSidecar ?? false
          }
          ttsProviderName={
            ttsProviders.find((p) => p.id === selectedTtsProviderId)?.name ??
            null
          }
          ttsProviderModel={
            ttsProviders.find((p) => p.id === selectedTtsProviderId)?.model ??
            ""
          }
          ttsProviderVoice={
            ttsProviders.find((p) => p.id === selectedTtsProviderId)?.voice ??
            ""
          }
          onWidthChange={handleSummaryWidthChange}
          onSummarize={handleSummarize}
          onChangePromptType={handleChangePromptType}
          onSavePromptTypes={handleSavePromptTypes}
          onChangeTtsModel={handleChangeTtsModelForPlay}
          onChangeTtsVoice={handleChangeTtsVoice}
        />
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
          selectedTtsVoice={selectedTtsVoice}
          ttsVoices={ttsVoices}
          onChangeTtsVoice={handleChangeTtsVoice}
          onChangeTtsModel={handleChangeTtsModelForPlay}
          selectedSummaryModel={selectedSummaryModel}
          onChangeSummaryModel={handleChangeSummaryModel}
          selectedRapidModel={selectedRapidModel}
          onChangeRapidModel={handleChangeRapidModel}
          rapidRenamePrompt={rapidRenamePrompt}
          onChangeRapidRenamePrompt={handleChangeRapidRenamePrompt}
          selectedTranslateModel={selectedTranslateModel}
          onChangeTranslateModel={handleChangeTranslateModel}
          translatePrompt={translatePrompt}
          onChangeTranslatePrompt={handleChangeTranslatePrompt}
          autoStartSidecar={autoStartSidecar}
          onChangeAutoStartSidecar={handleChangeAutoStartSidecar}
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
          onClose={() => setShowDownloadManager(false)}
        />
      )}
    </div>
  );
}

export default App;
