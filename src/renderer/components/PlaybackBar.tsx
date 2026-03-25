import React, { useCallback, useEffect } from "react";

const PLAYBACK_RATES = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0] as const;

interface PlaybackBarProps {
  readonly sessionTitle: string;
  readonly isPlaying: boolean;
  readonly currentTime: number;
  readonly duration: number;
  readonly playbackRate: number;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly onSeek: (time: number) => void;
  readonly onStop: () => void;
  readonly onSkipBackward: () => void;
  readonly onSkipForward: () => void;
  readonly onPlaybackRateChange: (rate: number) => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const controlBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--text-primary)",
  fontSize: "14px",
  cursor: "pointer",
  padding: "2px 6px",
  flexShrink: 0,
  borderRadius: "4px",
};

export function PlaybackBar({
  sessionTitle,
  isPlaying,
  currentTime,
  duration,
  playbackRate,
  onPause,
  onResume,
  onSeek,
  onStop,
  onSkipBackward,
  onSkipForward,
  onPlaybackRateChange,
}: PlaybackBarProps): React.ReactElement {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (duration <= 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      onSeek(Math.max(0, Math.min(duration, ratio * duration)));
    },
    [duration, onSeek],
  );

  const handleCycleRate = useCallback(() => {
    const currentIdx = PLAYBACK_RATES.indexOf(
      playbackRate as (typeof PLAYBACK_RATES)[number],
    );
    const nextIdx =
      currentIdx === -1 ? 2 : (currentIdx + 1) % PLAYBACK_RATES.length;
    onPlaybackRateChange(PLAYBACK_RATES[nextIdx]);
  }, [playbackRate, onPlaybackRateChange]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      if (e.key === " ") {
        e.preventDefault();
        if (isPlaying) {
          onPause();
        } else {
          onResume();
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        onSkipBackward();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onSkipForward();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPlaying, onPause, onResume, onSkipBackward, onSkipForward]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "8px 16px",
        backgroundColor: "var(--bg-secondary)",
        borderTop: "1px solid var(--border)",
        fontSize: "13px",
      }}
    >
      {/* Skip backward */}
      <button
        onClick={onSkipBackward}
        style={controlBtnStyle}
        title="Backward 10s (←)"
      >
        ⏪
      </button>

      {/* Play/Pause button */}
      <button
        onClick={isPlaying ? onPause : onResume}
        style={{ ...controlBtnStyle, fontSize: "16px" }}
        title={isPlaying ? "Pause (Space)" : "Resume (Space)"}
      >
        {isPlaying ? "\u23F8" : "\u25B6"}
      </button>

      {/* Skip forward */}
      <button
        onClick={onSkipForward}
        style={controlBtnStyle}
        title="Forward 10s (→)"
      >
        ⏩
      </button>

      {/* Session title */}
      <span
        style={{
          flexShrink: 0,
          maxWidth: "120px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "var(--text-secondary)",
        }}
      >
        {sessionTitle}
      </span>

      {/* Current time */}
      <span
        style={{
          flexShrink: 0,
          color: "var(--text-muted)",
          fontSize: "12px",
          minWidth: "36px",
          textAlign: "right",
        }}
      >
        {formatTime(currentTime)}
      </span>

      {/* Progress bar */}
      <div
        onClick={handleProgressClick}
        style={{
          flex: 1,
          height: "4px",
          backgroundColor: "var(--bg-tertiary)",
          borderRadius: "2px",
          cursor: "pointer",
          position: "relative",
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: "100%",
            backgroundColor: "var(--accent)",
            borderRadius: "2px",
            transition: "width 0.1s linear",
          }}
        />
      </div>

      {/* Duration */}
      <span
        style={{
          flexShrink: 0,
          color: "var(--text-muted)",
          fontSize: "12px",
          minWidth: "36px",
        }}
      >
        {formatTime(duration)}
      </span>

      {/* Playback rate button */}
      <button
        onClick={handleCycleRate}
        style={{
          ...controlBtnStyle,
          fontSize: "12px",
          minWidth: "40px",
          textAlign: "center",
          color: playbackRate !== 1.0 ? "var(--accent)" : "var(--text-muted)",
        }}
        title="Playback speed"
      >
        {playbackRate}x
      </button>

      {/* Close button */}
      <button
        onClick={onStop}
        style={{
          ...controlBtnStyle,
          color: "var(--text-muted)",
          fontSize: "14px",
        }}
        title="Stop"
      >
        ✕
      </button>
    </div>
  );
}
