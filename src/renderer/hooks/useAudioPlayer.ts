import { useState, useRef, useCallback, useEffect } from "react";

interface AudioPlayerState {
  readonly playingSessionId: number | null;
  readonly isPlaying: boolean;
  readonly currentTime: number;
  readonly duration: number;
  readonly playbackRate: number;
}

export function useAudioPlayer() {
  const [state, setState] = useState<AudioPlayerState>({
    playingSessionId: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    playbackRate: 1.0,
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
    setState((prev) => ({
      playingSessionId: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      playbackRate: prev.playbackRate,
    }));
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

      setState((prev) => ({
        playingSessionId: sessionId,
        isPlaying: true,
        currentTime: 0,
        duration: 0,
        playbackRate: prev.playbackRate,
      }));

      // Apply preserved playback rate
      audio.playbackRate = state.playbackRate;

      await audio.play();
    },
    [cleanup, stop, state.playbackRate],
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

  const setPlaybackRate = useCallback((rate: number) => {
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
    setState((prev) => ({ ...prev, playbackRate: rate }));
  }, []);

  const skipForward = useCallback((seconds: number) => {
    if (audioRef.current) {
      const newTime = Math.min(
        audioRef.current.currentTime + seconds,
        audioRef.current.duration || Infinity,
      );
      audioRef.current.currentTime = newTime;
      setState((prev) => ({ ...prev, currentTime: newTime }));
    }
  }, []);

  const skipBackward = useCallback((seconds: number) => {
    if (audioRef.current) {
      const newTime = Math.max(audioRef.current.currentTime - seconds, 0);
      audioRef.current.currentTime = newTime;
      setState((prev) => ({ ...prev, currentTime: newTime }));
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
    setPlaybackRate,
    skipForward,
    skipBackward,
  };
}
