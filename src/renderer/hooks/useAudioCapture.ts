import { useState, useCallback, useRef } from "react";

interface AudioCaptureState {
  readonly isCapturing: boolean;
  readonly devices: MediaDeviceInfo[];
  readonly selectedDeviceId: string | null;
}

export function useAudioCapture() {
  const [state, setState] = useState<AudioCaptureState>({
    isCapturing: false,
    devices: [],
    selectedDeviceId: null,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const onAudioDataRef = useRef<((pcm: Int16Array) => void) | null>(null);

  const loadDevices = useCallback(async () => {
    // Request mic access first so enumerateDevices returns labels
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      // Permission denied — enumerateDevices may return empty/unlabeled
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(
      (d) =>
        d.kind === "audioinput" &&
        d.deviceId !== "default" &&
        d.deviceId !== "communications",
    );
    setState((prev) => ({ ...prev, devices: audioInputs }));
  }, []);

  const setSelectedDevice = useCallback((deviceId: string | null) => {
    setState((prev) => ({ ...prev, selectedDeviceId: deviceId }));
  }, []);

  const start = useCallback(
    async (onAudioData: (pcm: Int16Array) => void) => {
      onAudioDataRef.current = onAudioData;

      const constraints: MediaStreamConstraints = {
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          ...(state.selectedDeviceId
            ? { deviceId: { exact: state.selectedDeviceId } }
            : {}),
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      // Use ScriptProcessor for simplicity (AudioWorklet would be better for production)
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        const float32Data = event.inputBuffer.getChannelData(0);
        // Convert float32 [-1, 1] to int16
        const int16Data = new Int16Array(float32Data.length);
        for (let i = 0; i < float32Data.length; i++) {
          const s = Math.max(-1, Math.min(1, float32Data[i]));
          int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        onAudioDataRef.current?.(int16Data);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      setState((prev) => ({ ...prev, isCapturing: true }));
    },
    [state.selectedDeviceId],
  );

  const stop = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    onAudioDataRef.current = null;
    setState((prev) => ({ ...prev, isCapturing: false }));
  }, []);

  return {
    ...state,
    start,
    stop,
    loadDevices,
    setSelectedDevice,
  };
}
