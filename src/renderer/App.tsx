import React, { useEffect, useCallback, useRef, useState } from "react";
import { ControlBar } from "./components/ControlBar";
import { HistoryPanel } from "./components/HistoryPanel";
import { TranscriptArea } from "./components/TranscriptArea";
import { RecordingControls } from "./components/RecordingControls";
import { SetupWizard } from "./components/SetupWizard";
import { useAppStore } from "./stores/appStore";
import { useAudioCapture } from "./hooks/useAudioCapture";
import { useVAD } from "./hooks/useVAD";
import { useTranscription } from "./hooks/useTranscription";
import { useSession } from "./hooks/useSession";

function App(): React.JSX.Element {
  const store = useAppStore();
  const audioCapture = useAudioCapture();
  const session = useSession();
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  const transcription = useTranscription({
    onFinal: useCallback(
      async (text: string) => {
        // Update store with finalized segment
        store.addSegment({
          id: Date.now(),
          start_time: store.elapsedSeconds,
          end_time: store.elapsedSeconds,
          text,
        });
      },
      [store.elapsedSeconds],
    ),
    onError: useCallback((msg: string) => {
      console.error("Transcription error:", msg);
    }, []),
  });

  const vad = useVAD({
    onSpeechStart: useCallback(() => {
      // Speech started - could stream audio in real-time in future
    }, []),
    onSpeechEnd: useCallback(
      (audio: Float32Array) => {
        // Convert float32 to int16 and send via WebSocket
        const int16 = new Int16Array(audio.length);
        for (let i = 0; i < audio.length; i++) {
          const s = Math.max(-1, Math.min(1, audio[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        transcription.sendAudio(int16.buffer);
        transcription.sendSegmentEnd();
      },
      [transcription],
    ),
  });

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
        audioCapture.loadDevices();

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

  const handleStart = useCallback(async () => {
    try {
      const sessionId = await session.startSession(store.selectedModelId);
      store.setRecording(true);
      store.setCurrentSessionId(sessionId);
      store.clearSegments();
      store.setElapsedSeconds(0);
      elapsedRef.current = 0;

      // Connect to sidecar WebSocket
      const sidecarUrl = await window.capty.getSidecarUrl();
      await transcription.connect(sidecarUrl, store.selectedModelId);

      // Start audio capture - pipe audio through VAD
      await audioCapture.start((pcm: Int16Array) => {
        vad.feedAudio(pcm);
        // Compute audio level for visualization (RMS)
        let sum = 0;
        for (let i = 0; i < pcm.length; i++) {
          sum += (pcm[i] / 32768) * (pcm[i] / 32768);
        }
        const rms = Math.sqrt(sum / pcm.length);
        setAudioLevel(Math.min(1, rms * 5));
      });

      // Start elapsed timer using ref to track seconds
      timerRef.current = setInterval(() => {
        elapsedRef.current = elapsedRef.current + 1;
        store.setElapsedSeconds(elapsedRef.current);
      }, 1000);

      await store.loadSessions();
    } catch (err) {
      console.error("Failed to start recording:", err);
      store.setRecording(false);
    }
  }, [session, store, transcription, audioCapture, vad]);

  const handleStop = useCallback(async () => {
    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    audioCapture.stop();
    transcription.disconnect();
    await session.stopSession();

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
        await window.capty.getSession(sessionId);
        store.setCurrentSessionId(sessionId);
        // TODO: Load segments for the selected session
      } catch (err) {
        console.error("Failed to load session:", err);
      }
    },
    [store],
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
        onDeviceChange={audioCapture.setSelectedDevice}
        models={store.models}
        selectedModelId={store.selectedModelId}
        onModelChange={store.setSelectedModelId}
        onSettings={() => console.log("Settings not yet implemented")}
      />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <HistoryPanel
          sessions={store.sessions}
          currentSessionId={store.currentSessionId}
          onSelectSession={handleSelectSession}
        />
        <TranscriptArea
          segments={store.segments}
          partialText={store.partialText}
          isRecording={store.isRecording}
        />
      </div>
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
    </>
  );
}

export default App;
