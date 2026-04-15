import { useState, useCallback, useEffect, useRef } from "react";
import { DownloadItem } from "../components/DownloadManagerDialog";

interface UseAudioDownloadsParams {
  readonly loadSessions: () => Promise<void>;
  readonly onSelectSession: (sessionId: number) => Promise<void>;
  readonly needsSetup: boolean | null;
}

export function useAudioDownloads({
  loadSessions,
  onSelectSession,
  needsSetup,
}: UseAudioDownloadsParams) {
  const [showDownloadManager, setShowDownloadManager] = useState(false);
  const [audioDownloads, setAudioDownloads] = useState<DownloadItem[]>([]);
  const [downloadBadge, setDownloadBadge] = useState<
    "active" | "failed" | null
  >(null);

  // Keep callbacks fresh via refs to avoid effect re-subscriptions
  const loadSessionsRef = useRef(loadSessions);
  loadSessionsRef.current = loadSessions;
  const onSelectSessionRef = useRef(onSelectSession);
  onSelectSessionRef.current = onSelectSession;

  const computeDownloadBadge = useCallback(
    (list: readonly DownloadItem[]): "active" | "failed" | null => {
      const hasActive = list.some((d) =>
        ["pending", "fetching-info", "downloading", "converting"].includes(
          d.status,
        ),
      );
      if (hasActive) return "active";
      const hasFailed = list.some((d) => d.status === "failed");
      if (hasFailed) return "failed";
      return null;
    },
    [],
  );

  const handleStartAudioDownload = useCallback(
    async (url: string) => {
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
        const list = await window.capty.getAudioDownloads();
        setAudioDownloads(list);
        setDownloadBadge(computeDownloadBadge(list));
      } catch (err: unknown) {
        const raw = err instanceof Error ? err.message : String(err);
        // Strip Electron IPC prefix if present
        const message = raw.replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        );
        setAudioDownloads((prev) => [
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
          ...prev,
        ]);
      }
    },
    [computeDownloadBadge],
  );

  const handleCancelAudioDownload = useCallback(
    async (id: number) => {
      await window.capty.cancelAudioDownload(id);
      const list = await window.capty.getAudioDownloads();
      setAudioDownloads(list);
      setDownloadBadge(computeDownloadBadge(list));
    },
    [computeDownloadBadge],
  );

  const handleRetryAudioDownload = useCallback(
    async (id: number) => {
      await window.capty.retryAudioDownload(id);
      const list = await window.capty.getAudioDownloads();
      setAudioDownloads(list);
      setDownloadBadge(computeDownloadBadge(list));
    },
    [computeDownloadBadge],
  );

  const handleRemoveAudioDownload = useCallback(
    async (id: number) => {
      await window.capty.removeAudioDownload(id);
      const list = await window.capty.getAudioDownloads();
      setAudioDownloads(list);
      setDownloadBadge(computeDownloadBadge(list));
    },
    [computeDownloadBadge],
  );

  const handleAudioDownloadSelectSession = useCallback(
    async (sessionId: number) => {
      setShowDownloadManager(false);
      await loadSessionsRef.current();
      await onSelectSessionRef.current(sessionId);
    },
    [],
  );

  // Listen for audio download progress events
  useEffect(() => {
    const cleanup = window.capty.onAudioDownloadProgress((event) => {
      // When download completes, refresh session list so new session appears in sidebar
      if (event.stage === "completed") {
        loadSessionsRef.current();
      }

      setAudioDownloads((prev) => {
        const idx = prev.findIndex((d) => d.id === event.id);
        if (idx === -1) {
          // New download — reload full list
          window.capty.getAudioDownloads().then((list) => {
            setAudioDownloads(list);
            setDownloadBadge(computeDownloadBadge(list));
          });
          return prev;
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
        setDownloadBadge(computeDownloadBadge(updated));
        return updated;
      });
    });
    return cleanup;
  }, [computeDownloadBadge]);

  // Load download list on mount + crash recovery
  useEffect(() => {
    if (needsSetup !== false) return; // DB not ready during setup wizard
    window.capty.getAudioDownloads().then((list) => {
      setAudioDownloads(list);
      setDownloadBadge(computeDownloadBadge(list));
      const hasInterrupted = list.some((d) =>
        ["pending", "downloading", "converting"].includes(d.status),
      );
      if (hasInterrupted) setShowDownloadManager(true);
    });
  }, [computeDownloadBadge, needsSetup]);

  // Listen for retry trigger from main process
  useEffect(() => {
    const cleanup = window.capty.onAudioDownloadRetryTrigger(({ url }) => {
      window.capty.downloadAudio(url).then(() => {
        window.capty.getAudioDownloads().then((list) => {
          setAudioDownloads(list);
          setDownloadBadge(computeDownloadBadge(list));
        });
      });
    });
    return cleanup;
  }, [computeDownloadBadge]);

  return {
    showDownloadManager,
    setShowDownloadManager,
    audioDownloads,
    downloadBadge,
    handleStartAudioDownload,
    handleCancelAudioDownload,
    handleRetryAudioDownload,
    handleRemoveAudioDownload,
    handleAudioDownloadSelectSession,
  };
}
