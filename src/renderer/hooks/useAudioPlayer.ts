import { useState, useRef, useCallback, useEffect } from "react";

interface AudioPlayerState {
  readonly playingSessionId: number | null;
  readonly isPlaying: boolean;
  readonly currentTime: number;
  readonly duration: number;
}

export function useAudioPlayer() {
  const [state, setState] = useState<AudioPlayerState>({
    playingSessionId: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    cleanup();
    setState({
      playingSessionId: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
    });
  }, [cleanup]);

  const play = useCallback(
    async (sessionId: number) => {
      // Stop current playback first
      cleanup();

      const buffer = await window.capty.readAudioFile(sessionId);
      if (!buffer) return;

      const blob = new Blob([buffer], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;

      audio.addEventListener("loadedmetadata", () => {
        setState((prev) => ({ ...prev, duration: audio.duration }));
      });

      audio.addEventListener("timeupdate", () => {
        setState((prev) => ({ ...prev, currentTime: audio.currentTime }));
      });

      audio.addEventListener("ended", () => {
        stop();
      });

      setState({
        playingSessionId: sessionId,
        isPlaying: true,
        currentTime: 0,
        duration: 0,
      });

      await audio.play();
    },
    [cleanup, stop],
  );

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setState((prev) => ({ ...prev, isPlaying: false }));
  }, []);

  const resume = useCallback(async () => {
    if (audioRef.current) {
      await audioRef.current.play();
      setState((prev) => ({ ...prev, isPlaying: true }));
    }
  }, []);

  const seek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setState((prev) => ({ ...prev, currentTime: time }));
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    ...state,
    play,
    pause,
    resume,
    seek,
    stop,
  };
}
