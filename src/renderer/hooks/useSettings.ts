import { useState, useCallback, useRef, useEffect } from "react";
import type { TabId } from "../components/SettingsModal";

const DEFAULT_HF_URL = "https://huggingface.co";
const DEFAULT_HISTORY_WIDTH = 240;
const DEFAULT_SUMMARY_WIDTH = 320;

interface UseSettingsParams {
  readonly store: {
    readonly setSidecarReady: (v: boolean) => void;
    readonly setSidecarStarting: (v: boolean) => void;
    readonly setTtsProviderReady: (v: boolean) => void;
    readonly setSidecarPort: (port: number) => void;
    readonly setDataDir: (dir: string) => void;
    readonly sidecarReady: boolean;
    readonly sidecarStarting: boolean;
  };
  readonly audioCapture: {
    readonly setSelectedDevice: (id: string | null) => void;
    readonly setOnDeviceRemoved: (cb: (() => void) | null) => void;
  };
}

export function useSettings({ store, audioCapture }: UseSettingsParams) {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<
    TabId | undefined
  >(undefined);
  const [autoStartSidecar, setAutoStartSidecar] = useState(true);
  const [configDir, setConfigDir] = useState<string | null>(null);
  const [hfMirrorUrl, setHfMirrorUrl] = useState(DEFAULT_HF_URL);
  const [historyPanelWidth, setHistoryPanelWidth] = useState(
    DEFAULT_HISTORY_WIDTH,
  );
  const [summaryPanelWidth, setSummaryPanelWidth] = useState(
    DEFAULT_SUMMARY_WIDTH,
  );
  const [zoomFactor, setZoomFactor] = useState(1.0);
  const layoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep store ref fresh for effects
  const storeRef = useRef(store);
  storeRef.current = store;

  const handleStartSidecar = useCallback(async () => {
    storeRef.current.setSidecarStarting(true);
    try {
      const result = (await window.capty.startSidecar()) as {
        ok: boolean;
        error?: string;
      };
      if (result.ok) {
        const health = await window.capty.checkSidecarHealth();
        storeRef.current.setSidecarReady(health.online);
        try {
          const tts = await window.capty.checkTtsProvider();
          storeRef.current.setTtsProviderReady(tts.ready);
        } catch {
          // TTS check is best-effort
        }
      } else {
        console.warn("[sidecar] start failed:", result.error);
      }
    } catch (err) {
      console.error("Failed to start sidecar:", err);
    } finally {
      storeRef.current.setSidecarStarting(false);
    }
  }, []);

  const handleStopSidecar = useCallback(async () => {
    try {
      await window.capty.stopSidecar();
      storeRef.current.setSidecarReady(false);
    } catch (err) {
      console.error("Failed to stop sidecar:", err);
    }
  }, []);

  const handleDeviceChange = useCallback(
    async (deviceId: string) => {
      const effectiveId = deviceId || null;
      audioCapture.setSelectedDevice(effectiveId);
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
      storeRef.current.setDataDir(dir);
    }
  }, []);

  const handleChangeAutoStartSidecar = useCallback(async (value: boolean) => {
    setAutoStartSidecar(value);
    const config = await window.capty.getConfig();
    await window.capty.setConfig({
      ...config,
      sidecar: { ...config.sidecar, autoStart: value },
    });
  }, []);

  const handleChangeHfMirrorUrl = useCallback(async (url: string) => {
    setHfMirrorUrl(url);
    const config = await window.capty.getConfig();
    await window.capty.setConfig({
      ...config,
      hfMirrorUrl: url || null,
    });
  }, []);

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

  // Init: restore layout, zoom, hfMirror, configDir from config
  const initFromConfig = useCallback(
    async (config: Record<string, unknown>) => {
      setConfigDir(await window.capty.getConfigDir());

      const savedHistoryWidth = config.historyPanelWidth as number | null;
      if (savedHistoryWidth !== null) {
        setHistoryPanelWidth(savedHistoryWidth);
      }
      const savedSummaryWidth = config.summaryPanelWidth as number | null;
      if (savedSummaryWidth !== null) {
        setSummaryPanelWidth(savedSummaryWidth);
      }

      const savedZoom = await window.capty.getZoomFactor();
      if (savedZoom && savedZoom !== 1.0) {
        setZoomFactor(savedZoom);
      }

      const savedHfUrl = config.hfMirrorUrl as string | null;
      if (savedHfUrl) {
        setHfMirrorUrl(savedHfUrl);
      }
    },
    [],
  );

  // Init: sidecar config + health check + auto-start
  const initSidecar = useCallback(
    async (config: Record<string, unknown>) => {
      const sidecarCfg = config.sidecar as
        | { port: number; autoStart: boolean }
        | undefined;
      if (sidecarCfg) {
        storeRef.current.setSidecarPort(sidecarCfg.port ?? 8765);
        setAutoStartSidecar(sidecarCfg.autoStart !== false);
      }

      let sidecarOnline = false;
      try {
        const health = await window.capty.checkSidecarHealth();
        sidecarOnline = health.online;
        storeRef.current.setSidecarReady(health.online);
      } catch {
        storeRef.current.setSidecarReady(false);
      }

      if (sidecarCfg?.autoStart !== false && !sidecarOnline) {
        storeRef.current.setSidecarStarting(true);
        try {
          const result = (await window.capty.startSidecar()) as {
            ok: boolean;
            error?: string;
          };
          if (result.ok) {
            const h = await window.capty.checkSidecarHealth();
            storeRef.current.setSidecarReady(h.online);
            try {
              const tts = await window.capty.checkTtsProvider();
              storeRef.current.setTtsProviderReady(tts.ready);
            } catch {
              /* best-effort */
            }
          } else {
            console.warn("[sidecar] auto-start failed:", result.error);
          }
        } catch {
          /* silent — IPC transport error */
        } finally {
          storeRef.current.setSidecarStarting(false);
        }
      }
    },
    [],
  );

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

  // Sidecar health polling (every 10s, unconditional)
  useEffect(() => {
    let ignore = false;
    const poll = async (): Promise<void> => {
      try {
        const health = await window.capty.checkSidecarHealth();
        if (!ignore) storeRef.current.setSidecarReady(health.online);
      } catch {
        if (!ignore) storeRef.current.setSidecarReady(false);
      }
    };
    poll();
    const timer = setInterval(poll, 10000);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
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

  return {
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
    zoomFactor,
    handleStartSidecar,
    handleStopSidecar,
    handleDeviceChange,
    handleChangeDataDir,
    handleChangeAutoStartSidecar,
    handleChangeHfMirrorUrl,
    handleHistoryWidthChange,
    handleSummaryWidthChange,
    initFromConfig,
    initSidecar,
  };
}
