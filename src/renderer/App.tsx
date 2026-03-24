import React, { useEffect, useCallback, useRef, useState } from "react";
import { ControlBar } from "./components/ControlBar";
import { HistoryPanel } from "./components/HistoryPanel";
import { TranscriptArea } from "./components/TranscriptArea";
import { RecordingControls } from "./components/RecordingControls";
import { PlaybackBar } from "./components/PlaybackBar";
import { SetupWizard } from "./components/SetupWizard";
import { SettingsModal } from "./components/SettingsModal";
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

  const transcription = useTranscription({
    onFinal: useCallback(
      async (text: string) => {
        if (!text.trim()) return;
        const now = store.elapsedSeconds;
        // Persist to database
        if (store.currentSessionId) {
          await window.capty.addSegment({
            sessionId: store.currentSessionId,
            startTime: now,
            endTime: now,
            text,
            audioPath: "",
            isFinal: true,
          });
        }
        // Update in-memory store
        store.addSegment({
          id: Date.now(),
          start_time: now,
          end_time: now,
          text,
        });
      },
      [store.elapsedSeconds, store.currentSessionId],
    ),
    onError: useCallback((msg: string) => {
      console.error("Transcription error:", msg);
    }, []),
  });

  const vad = useVAD({
    onSpeechStart: useCallback(() => {
      // Speech started
    }, []),
    onSpeechEnd: useCallback(() => {
      // Speech ended - signal the sidecar to transcribe accumulated audio
      transcription.sendSegmentEnd();
    }, [transcription]),
  });

  // Regeneration state
  const [regeneratingSessionId, setRegeneratingSessionId] = useState<
    number | null
  >(null);
  const [regenerationProgress, setRegenerationProgress] = useState(0);

  // Model download state
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  const handleDownloadModel = useCallback(async () => {
    const model = store.models.find(
      (m: { id: string }) => m.id === store.selectedModelId,
    );
    if (!model || model.downloaded || isDownloading) return;

    const dataDir = store.dataDir;
    if (!dataDir) return;

    setIsDownloading(true);
    setDownloadProgress(0);

    const unsubscribe = window.capty.onDownloadProgress((progress) => {
      setDownloadProgress(progress.percent);
    });

    try {
      const destDir = `${dataDir}/models/${model.id}`;
      await window.capty.downloadModel(model.repo, destDir);

      // Refresh models list
      const models = await window.capty.listModels();
      store.setModels(
        models as {
          id: string;
          name: string;
          repo: string;
          downloaded: boolean;
          size_gb: number;
        }[],
      );
    } catch (err) {
      console.error("Failed to download model:", err);
    } finally {
      unsubscribe();
      setIsDownloading(false);
      setDownloadProgress(0);
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
        await store.loadSessions();
        await audioCapture.loadDevices();

        // Restore saved microphone device
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

        // Check sidecar
        try {
          const url = await window.capty.getSidecarUrl();
          if (url) store.setSidecarReady(true);
        } catch {
          // Sidecar not ready yet
        }

        // Load models
        try {
          const models = await window.capty.listModels();
          store.setModels(
            models as {
              id: string;
              name: string;
              repo: string;
              downloaded: boolean;
              size_gb: number;
            }[],
          );
        } catch {
          // Models not available yet
        }
      } catch (err) {
        console.error("Init error:", err);
      }
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePlaySession = useCallback(
    (sessionId: number) => {
      if (!store.isRecording) {
        audioPlayer.play(sessionId);
      }
    },
    [store.isRecording, audioPlayer],
  );

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

      // Connect to sidecar WebSocket in background (don't block recording)
      window.capty
        .getSidecarUrl()
        .then((sidecarUrl) =>
          transcription.connect(sidecarUrl, store.selectedModelId),
        )
        .catch((err: unknown) =>
          console.warn(
            "Sidecar not available, recording without transcription:",
            err,
          ),
        );
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

    audioCapture.stop();
    transcription.disconnect();
    await session.stopSession(elapsedRef.current);

    store.setRecording(false);
    store.setCurrentSessionId(null);
    store.setPartialText("");

    await store.loadSessions();
  }, [session, store, transcription, audioCapture]);

  const handleExport = useCallback(() => {
    // Export is now handled by the ExportMenu inside RecordingControls
  }, []);

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
      } catch (err) {
        console.error("Failed to load session:", err);
      }
    },
    [store],
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
        }
        await store.loadSessions();
      } catch (err) {
        console.error("Failed to delete session:", err);
      }
    },
    [store],
  );

  const handleRegenerateSubtitles = useCallback(
    async (sessionId: number) => {
      if (regeneratingSessionId !== null || store.isRecording) return;

      setRegeneratingSessionId(sessionId);
      setRegenerationProgress(0);

      try {
        // 1. Read audio file
        const audioBuffer = await window.capty.readAudioFile(sessionId);
        if (!audioBuffer) {
          console.error("No audio file found for session", sessionId);
          setRegeneratingSessionId(null);
          return;
        }

        // 2. Delete old segments
        await window.capty.deleteSegments(sessionId);

        // 3. Clear in-memory segments if this session is currently viewed
        if (store.currentSessionId === sessionId) {
          store.clearSegments();
        }

        // 4. Connect to sidecar and re-transcribe
        const sidecarUrl = await window.capty.getSidecarUrl();
        const wsUrl = sidecarUrl.replace(/^http/, "ws") + "/ws/transcribe";
        const ws = new WebSocket(wsUrl);

        // PCM data (skip 44-byte WAV header)
        const pcmData = new Uint8Array(audioBuffer, 44);
        const totalBytes = pcmData.length;
        const chunkSize = 32000; // 1 second of 16kHz/16bit/mono
        let sendDone = false;

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Connection timeout")),
            15000,
          );

          const cleanup = () => {
            setRegeneratingSessionId(null);
            setRegenerationProgress(0);
          };

          ws.onopen = () => {
            ws.send(
              JSON.stringify({
                type: "start",
                model: store.selectedModelId,
                language: "auto",
              }),
            );
          };

          ws.onmessage = (event) => {
            const msg = JSON.parse(event.data as string) as {
              type: string;
              text?: string;
              segment_id?: number;
              message?: string;
            };

            if (msg.type === "ready") {
              clearTimeout(timeout);

              let offset = 0;
              const sendInterval = setInterval(() => {
                if (offset >= totalBytes) {
                  clearInterval(sendInterval);
                  sendDone = true;
                  setRegenerationProgress(90); // 90% = audio sent, waiting for transcription
                  ws.send(JSON.stringify({ type: "segment_end" }));
                  return;
                }

                const end = Math.min(offset + chunkSize, totalBytes);
                // Use slice() which copies data into a new ArrayBuffer
                const chunk = pcmData.slice(offset, end);
                ws.send(chunk);
                offset = end;
                // Progress: 0-90% for sending audio
                setRegenerationProgress(Math.round((offset / totalBytes) * 90));
              }, 100); // ~10x real-time speed
            } else if (msg.type === "partial") {
              if (store.currentSessionId === sessionId) {
                store.setPartialText(msg.text ?? "");
              }
            } else if (msg.type === "final") {
              if (store.currentSessionId === sessionId) {
                store.setPartialText("");
              }
              const text = msg.text ?? "";
              if (text.trim()) {
                // Save to DB and update in-memory store
                window.capty
                  .addSegment({
                    sessionId,
                    startTime: 0,
                    endTime: 0,
                    text,
                    audioPath: "",
                    isFinal: true,
                  })
                  .then(() => {
                    if (store.currentSessionId === sessionId) {
                      store.addSegment({
                        id: Date.now(),
                        start_time: 0,
                        end_time: 0,
                        text,
                      });
                    }
                  });
              }

              // After final result, close connection if all audio was sent
              if (sendDone) {
                setRegenerationProgress(100);
                ws.send(JSON.stringify({ type: "stop" }));
                ws.close();
              }
            } else if (msg.type === "error") {
              console.error("Regeneration transcription error:", msg.message);
              if (sendDone) {
                // Error after all audio sent — close and finish
                ws.close();
              }
            }
          };

          ws.onclose = () => {
            cleanup();
            resolve();
          };

          ws.onerror = () => {
            clearTimeout(timeout);
            cleanup();
            reject(new Error("WebSocket connection failed"));
          };
        });
      } catch (err) {
        console.error("Failed to regenerate subtitles:", err);
        setRegeneratingSessionId(null);
        setRegenerationProgress(0);
      }
    },
    [regeneratingSessionId, store],
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

  const handleChangeDataDir = useCallback(async () => {
    const dir = await window.capty.selectDirectory();
    if (dir) {
      const config = await window.capty.getConfig();
      await window.capty.setConfig({ ...config, dataDir: dir });
      store.setDataDir(dir);
    }
  }, [store]);

  const handleSettingsSelectModel = useCallback(
    (modelId: string) => {
      store.setSelectedModelId(modelId);
    },
    [store],
  );

  const handleSettingsDownloadModel = useCallback(
    async (modelId: string) => {
      const model = store.models.find((m: { id: string }) => m.id === modelId);
      if (!model || model.downloaded || isDownloading) return;

      const dataDir = store.dataDir;
      if (!dataDir) return;

      // Select the model being downloaded
      store.setSelectedModelId(modelId);

      setIsDownloading(true);
      setDownloadProgress(0);

      const unsubscribe = window.capty.onDownloadProgress((progress) => {
        setDownloadProgress(progress.percent);
      });

      try {
        const destDir = `${dataDir}/models/${model.id}`;
        await window.capty.downloadModel(model.repo, destDir);

        const models = await window.capty.listModels();
        store.setModels(
          models as {
            id: string;
            name: string;
            repo: string;
            downloaded: boolean;
            size_gb: number;
          }[],
        );
      } catch (err) {
        console.error("Failed to download model:", err);
      } finally {
        unsubscribe();
        setIsDownloading(false);
        setDownloadProgress(0);
      }
    },
    [store, isDownloading],
  );

  // Sync transcription partial text to store
  useEffect(() => {
    store.setPartialText(transcription.partialText);
  }, [transcription.partialText]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show nothing while checking setup status
  if (needsSetup === null) {
    return <></>;
  }

  // Show setup wizard if dataDir is not configured
  if (needsSetup) {
    return <SetupWizard onComplete={handleWizardComplete} />;
  }

  return (
    <>
      <ControlBar
        isRecording={store.isRecording}
        sidecarReady={store.sidecarReady}
        devices={audioCapture.devices}
        selectedDeviceId={audioCapture.selectedDeviceId}
        onDeviceChange={handleDeviceChange}
        models={store.models}
        selectedModelId={store.selectedModelId}
        onModelChange={store.setSelectedModelId}
        onSettings={() => setShowSettings(true)}
        isDownloading={isDownloading}
        downloadProgress={downloadProgress}
        onDownloadModel={handleDownloadModel}
      />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <HistoryPanel
          sessions={store.sessions}
          currentSessionId={store.currentSessionId}
          playingSessionId={audioPlayer.playingSessionId}
          regeneratingSessionId={regeneratingSessionId}
          regenerationProgress={regenerationProgress}
          isRecording={store.isRecording}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
          onPlaySession={handlePlaySession}
          onStopPlayback={audioPlayer.stop}
          onRegenerateSubtitles={handleRegenerateSubtitles}
        />
        <TranscriptArea
          segments={store.segments}
          partialText={store.partialText}
          isRecording={store.isRecording}
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
          onPause={audioPlayer.pause}
          onResume={audioPlayer.resume}
          onSeek={audioPlayer.seek}
          onStop={audioPlayer.stop}
        />
      )}
      <RecordingControls
        isRecording={store.isRecording}
        elapsedSeconds={store.elapsedSeconds}
        audioLevel={audioLevel}
        sessionId={store.currentSessionId}
        onStart={handleStart}
        onStop={handleStop}
        onExport={handleExport}
        canExport={!store.isRecording && store.segments.length > 0}
      />
      {showSettings && (
        <SettingsModal
          dataDir={store.dataDir}
          models={store.models}
          selectedModelId={store.selectedModelId}
          isDownloading={isDownloading}
          downloadProgress={downloadProgress}
          isRecording={store.isRecording}
          onChangeDataDir={handleChangeDataDir}
          onSelectModel={handleSettingsSelectModel}
          onDownloadModel={handleSettingsDownloadModel}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  );
}

export default App;
