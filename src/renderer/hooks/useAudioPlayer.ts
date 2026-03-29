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
  const playbackRateRef = useRef(1.0);
  const playingSessionIdRef = useRef<number | null>(null);

  /** Save current playback position to database for the given session. */
  const savePlaybackPosition = useCallback(
    (sessionId: number | null, time?: number) => {
      const id = sessionId ?? playingSessionIdRef.current;
      if (!id) return;
      const pos = time ?? audioRef.current?.currentTime ?? 0;
      window.capty.updateSession(id, { playbackPosition: pos }).catch(() => {});
    },
    [],
  );

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load(); // forces resource release
      audioRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    // Save position before stopping
    savePlaybackPosition(playingSessionIdRef.current);
    cleanup();
    playingSessionIdRef.current = null;
    setState((prev) => ({
      playingSessionId: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      playbackRate: prev.playbackRate,
    }));
  }, [cleanup, savePlaybackPosition]);

  const play = useCallback(
    async (sessionId: number) => {
      // Save position of previous session before switching
      if (
        playingSessionIdRef.current &&
        playingSessionIdRef.current !== sessionId
      ) {
        savePlaybackPosition(playingSessionIdRef.current);
      }

      // Stop current playback first
      cleanup();

      const buffer = await window.capty.readAudioFile(sessionId);
      if (!buffer) return;

      // Fetch saved playback position
      const session = await window.capty.getSession(sessionId);
      const savedPosition = (session as any)?.playback_position ?? 0;

      const blob = new Blob([buffer], { type: "audio/*" });
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;
      playingSessionIdRef.current = sessionId;

      audio.addEventListener("loadedmetadata", () => {
        // Restore saved position
        if (savedPosition > 0 && savedPosition < audio.duration) {
          audio.currentTime = savedPosition;
        }
        setState((prev) => ({
          ...prev,
          duration: audio.duration,
          currentTime:
            savedPosition > 0 && savedPosition < audio.duration
              ? savedPosition
              : 0,
        }));
      });

      audio.addEventListener("timeupdate", () => {
        setState((prev) => ({ ...prev, currentTime: audio.currentTime }));
      });

      audio.addEventListener(
        "ended",
        () => {
          // Reset position to 0 when playback completes
          window.capty
            .updateSession(sessionId, { playbackPosition: 0 })
            .catch(() => {});
          playingSessionIdRef.current = null;
          cleanup();
          setState((prev) => ({
            playingSessionId: null,
            isPlaying: false,
            currentTime: 0,
            duration: 0,
            playbackRate: prev.playbackRate,
          }));
        },
        { once: true },
      );

      setState((prev) => ({
        playingSessionId: sessionId,
        isPlaying: true,
        currentTime: savedPosition,
        duration: 0,
        playbackRate: prev.playbackRate,
      }));

      // Apply preserved playback rate
      audio.playbackRate = playbackRateRef.current;

      await audio.play();
    },
    [cleanup, savePlaybackPosition],
  );

  const pause = useCallback(() => {
    audioRef.current?.pause();
    savePlaybackPosition(playingSessionIdRef.current);
    setState((prev) => ({ ...prev, isPlaying: false }));
  }, [savePlaybackPosition]);

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
    playbackRateRef.current = rate;
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

  // Cleanup on unmount — save position before exit
  useEffect(() => {
    return () => {
      savePlaybackPosition(playingSessionIdRef.current);
      cleanup();
    };
  }, [cleanup, savePlaybackPosition]);

  return {
    ...state,
    audioRef,
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
