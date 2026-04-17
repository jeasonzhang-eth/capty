import { useState, useCallback, useRef, useEffect } from "react";
import type { TtsProviderConfig } from "../components/SettingsModal";
import type { DownloadInfo } from "./useModelDownloads";

export interface TtsModelInfo {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly repo: string;
  readonly downloaded: boolean;
  readonly size_gb: number;
  readonly languages: readonly string[];
  readonly description: string;
}

interface TtsVoice {
  readonly id: string;
  readonly name: string;
  readonly lang: string;
  readonly gender: string;
}

interface UseTtsSettingsParams {
  readonly store: {
    readonly dataDir: string | null;
    readonly setTtsProviderReady: (v: boolean) => void;
  };
  readonly downloads: Readonly<Record<string, DownloadInfo>>;
  readonly setDownloads: React.Dispatch<
    React.SetStateAction<Record<string, DownloadInfo>>
  >;
}

export function useTtsSettings({
  store,
  downloads,
  setDownloads,
}: UseTtsSettingsParams) {
  const [ttsProviders, setTtsProviders] = useState<TtsProviderConfig[]>([]);
  const [selectedTtsProviderId, setSelectedTtsProviderId] = useState<
    string | null
  >(null);
  const [ttsModels, setTtsModels] = useState<TtsModelInfo[]>([]);
  const [selectedTtsModelId, setSelectedTtsModelId] = useState("");
  const [selectedTtsVoice, setSelectedTtsVoice] = useState("");
  const [ttsVoices, setTtsVoices] = useState<TtsVoice[]>([]);

  // Keep store ref fresh for callbacks
  const storeRef = useRef(store);
  storeRef.current = store;

  // Keep downloads ref fresh for callbacks that depend on it
  const downloadsRef = useRef(downloads);
  downloadsRef.current = downloads;

  // Keep TTS state refs fresh for callbacks
  const ttsProvidersRef = useRef(ttsProviders);
  ttsProvidersRef.current = ttsProviders;
  const selectedTtsProviderIdRef = useRef(selectedTtsProviderId);
  selectedTtsProviderIdRef.current = selectedTtsProviderId;
  const selectedTtsModelIdRef = useRef(selectedTtsModelId);
  selectedTtsModelIdRef.current = selectedTtsModelId;

  // Derive TTS download state from unified downloads map
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

  // Refresh TTS models list (exposed for useModelDownloads resume handler)
  const refreshTtsModels = useCallback(async () => {
    const ttsList = await window.capty.listTtsModels();
    setTtsModels(ttsList as TtsModelInfo[]);
  }, []);

  const handleSaveTtsSettings = useCallback(
    async (settings: {
      ttsProviders: TtsProviderConfig[];
      selectedTtsProviderId: string | null;
    }) => {
      setTtsProviders(settings.ttsProviders);
      setSelectedTtsProviderId(settings.selectedTtsProviderId);
      await window.capty.saveTtsSettings({
        ...settings,
        selectedTtsModelId: selectedTtsModelIdRef.current,
      });
    },
    [],
  );

  const handleSelectTtsModel = useCallback(async (modelId: string) => {
    setSelectedTtsModelId(modelId);
    await window.capty.saveTtsSettings({
      ttsProviders: ttsProvidersRef.current,
      selectedTtsProviderId: selectedTtsProviderIdRef.current,
      selectedTtsModelId: modelId,
    });
  }, []);

  const handleChangeTtsVoice = useCallback(async (voice: string) => {
    setSelectedTtsVoice(voice);
    const config = await window.capty.getConfig();
    await window.capty.setConfig({ ...config, selectedTtsVoice: voice });
  }, []);

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
      if (downloadsRef.current[model.id]?.status === "downloading") return;
      const dataDir = storeRef.current.dataDir;
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
        setTtsModels(ttsList as TtsModelInfo[]);
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
    [setDownloads],
  );

  const handleDeleteTtsModel = useCallback(async (modelId: string) => {
    try {
      await window.capty.deleteTtsModel(modelId);
      const ttsList = await window.capty.listTtsModels();
      setTtsModels(ttsList as TtsModelInfo[]);
      if (selectedTtsModelIdRef.current === modelId) {
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
  }, []);

  const handleSearchTtsModels = useCallback(async (query: string) => {
    const results = await window.capty.searchTtsModels(query);
    return results as TtsModelInfo[];
  }, []);

  // TTS provider health polling (every 10s when a TTS provider is selected)
  useEffect(() => {
    if (!selectedTtsProviderId || ttsProviders.length === 0) {
      storeRef.current.setTtsProviderReady(false);
      return;
    }
    const poll = async (): Promise<void> => {
      try {
        const result = await window.capty.checkTtsProvider();
        storeRef.current.setTtsProviderReady(result.ready);
      } catch {
        storeRef.current.setTtsProviderReady(false);
      }
    };
    poll(); // Check immediately on mount/change
    const timer = setInterval(poll, 10000);
    return () => clearInterval(timer);
  }, [selectedTtsProviderId, ttsProviders]);

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
          !result.voices.some(
            (v: { id: string }) => v.id === selectedTtsVoice,
          )
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

  // Init: restore TTS providers/model/voice from config + load TTS models + voices
  const initTts = useCallback(async (config: Record<string, unknown>) => {
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

    // Load TTS models
    try {
      const ttsList = await window.capty.listTtsModels();
      setTtsModels(ttsList as TtsModelInfo[]);
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
          // Validate saved voice -- fall back to first voice if invalid
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
  }, []);

  return {
    ttsProviders,
    selectedTtsProviderId,
    ttsModels,
    selectedTtsModelId,
    selectedTtsVoice,
    ttsVoices,
    ttsDownloadEntries,
    isTtsDownloading,
    ttsDownloadingModelId,
    ttsDownloadProgress,
    ttsDownloadError,
    refreshTtsModels,
    handleSaveTtsSettings,
    handleSelectTtsModel,
    handleChangeTtsVoice,
    handleChangeTtsModelForPlay,
    handleDownloadTtsModel,
    handleDeleteTtsModel,
    handleSearchTtsModels,
    initTts,
  };
}
