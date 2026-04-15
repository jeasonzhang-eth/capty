import { useState, useCallback, useEffect, useRef } from "react";

export interface DownloadInfo {
  readonly modelId: string;
  readonly category: "asr" | "tts";
  readonly percent: number;
  readonly status: string;
  readonly error?: string;
}

interface UseModelDownloadsParams {
  readonly store: {
    readonly dataDir: string | null;
    readonly models: ReadonlyArray<{
      id: string;
      downloaded: boolean;
      supported?: boolean;
      repo: string;
    }>;
    readonly setModels: (
      models: Array<{
        id: string;
        name: string;
        type: string;
        repo: string;
        downloaded: boolean;
        supported?: boolean;
        size_gb: number;
        languages: readonly string[];
        description: string;
      }>,
    ) => void;
    readonly selectedModelId: string;
    readonly setSelectedModelId: (id: string) => void;
  };
  readonly onRefreshTtsModels: () => Promise<void>;
}

export function useModelDownloads({
  store,
  onRefreshTtsModels,
}: UseModelDownloadsParams) {
  const [downloads, setDownloads] = useState<Record<string, DownloadInfo>>({});

  const storeRef = useRef(store);
  storeRef.current = store;
  const onRefreshTtsModelsRef = useRef(onRefreshTtsModels);
  onRefreshTtsModelsRef.current = onRefreshTtsModels;

  // Derive ASR download state
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

  // Subscribe to unified download events
  useEffect(() => {
    const unsubscribe = window.capty.onDownloadEvent((progress) => {
      setDownloads((prev) => {
        if (progress.status === "completed") {
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
    const model = storeRef.current.models.find(
      (m: { id: string }) => m.id === storeRef.current.selectedModelId,
    );
    if (!model || model.downloaded || isDownloading) return;

    const dataDir = storeRef.current.dataDir;
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

      const models = await window.capty.listModels();
      storeRef.current.setModels(
        models as Parameters<typeof storeRef.current.setModels>[0],
      );
    } catch (err) {
      console.error("Failed to download model:", err);
    } finally {
      setDownloads((prev) => {
        const next = { ...prev };
        delete next[model.id];
        return next;
      });
    }
  }, [isDownloading]);

  const handleSelectModel = useCallback(async (modelId: string) => {
    storeRef.current.setSelectedModelId(modelId);
    const config = await window.capty.getConfig();
    await window.capty.setConfig({ ...config, selectedModelId: modelId });
  }, []);

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

      const dataDir = storeRef.current.dataDir;
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

        await window.capty.saveModelMeta(model.id, {
          id: model.id,
          name: model.name,
          type: model.type,
          repo: model.repo,
          size_gb: model.size_gb,
          languages: [...model.languages],
          description: model.description,
        });

        const models = await window.capty.listModels();
        storeRef.current.setModels(
          models as Parameters<typeof storeRef.current.setModels>[0],
        );
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
        return;
      }
      setDownloads((prev) => {
        const next = { ...prev };
        delete next[model.id];
        return next;
      });
    },
    [downloads],
  );

  const handleDeleteModel = useCallback(async (modelId: string) => {
    try {
      await window.capty.deleteModel(modelId);

      const models = await window.capty.listModels();
      storeRef.current.setModels(
        models as Parameters<typeof storeRef.current.setModels>[0],
      );

      if (storeRef.current.selectedModelId === modelId) {
        const firstUsable = (
          models as { id: string; downloaded: boolean; supported?: boolean }[]
        ).find((m) => m.downloaded && m.supported !== false);
        storeRef.current.setSelectedModelId(firstUsable ? firstUsable.id : "");
      }
    } catch (err) {
      console.error("Failed to delete model:", err);
    }
  }, []);

  const handleSearchModels = useCallback(async (query: string) => {
    const results = await window.capty.searchModels(query);
    return results as Parameters<typeof storeRef.current.setModels>[0];
  }, []);

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
        const models = await window.capty.listModels();
        storeRef.current.setModels(
          models as Parameters<typeof storeRef.current.setModels>[0],
        );
        await onRefreshTtsModelsRef.current();
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
    [downloads],
  );

  const handleCancelDownload = useCallback(async (modelId: string) => {
    await window.capty.cancelDownload(modelId);
    setDownloads((prev) => {
      const next = { ...prev };
      delete next[modelId];
      return next;
    });
  }, []);

  // Init: load ASR models and restore selected model
  const initModels = useCallback(
    async (config: Record<string, unknown>) => {
      try {
        const models = await window.capty.listModels();
        storeRef.current.setModels(
          models as Parameters<typeof storeRef.current.setModels>[0],
        );

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
            storeRef.current.setSelectedModelId(savedModelId);
          } else {
            const first = modelsList.find(isUsable);
            if (first) storeRef.current.setSelectedModelId(first.id);
          }
        } else {
          const first = modelsList.find(isUsable);
          if (first) storeRef.current.setSelectedModelId(first.id);
        }
      } catch {
        // Models not available yet
      }
    },
    [],
  );

  return {
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
    initModels,
  };
}
