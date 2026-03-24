import React, { useCallback } from "react";

interface PlaybackBarProps {
  readonly sessionTitle: string;
  readonly isPlaying: boolean;
  readonly currentTime: number;
  readonly duration: number;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly onSeek: (time: number) => void;
  readonly onStop: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PlaybackBar({
  sessionTitle,
  isPlaying,
  currentTime,
  duration,
  onPause,
  onResume,
  onSeek,
  onStop,
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

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "8px 16px",
        backgroundColor: "var(--bg-secondary)",
        borderTop: "1px solid var(--border)",
        fontSize: "13px",
      }}
    >
      {/* Play/Pause button */}
      <button
        onClick={isPlaying ? onPause : onResume}
        style={{
          background: "none",
          border: "none",
          color: "var(--text-primary)",
          fontSize: "16px",
          cursor: "pointer",
          padding: "2px 6px",
          flexShrink: 0,
        }}
        title={isPlaying ? "Pause" : "Resume"}
      >
        {isPlaying ? "\u23F8" : "\u25B6"}
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

      {/* Close button */}
      <button
        onClick={onStop}
        style={{
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          fontSize: "14px",
          cursor: "pointer",
          padding: "2px 6px",
          flexShrink: 0,
        }}
        title="Stop"
      >
        ✕
      </button>
    </div>
  );
}
