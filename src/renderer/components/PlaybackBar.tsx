import React, { useCallback, useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/dist/plugins/regions";

const PLAYBACK_RATES = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0] as const;

interface Segment {
  readonly id: number;
  readonly start_time: number;
  readonly end_time: number;
  readonly text: string;
}

interface PlaybackBarProps {
  readonly isPlaying: boolean;
  readonly currentTime: number;
  readonly duration: number;
  readonly playbackRate: number;
  readonly audioRef: React.RefObject<HTMLAudioElement | null>;
  readonly segments: readonly Segment[];
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

const topBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--text-muted)",
  fontSize: "12px",
  cursor: "pointer",
  padding: "2px 6px",
  flexShrink: 0,
  borderRadius: "6px",
  transition: "color 0.2s ease",
};

const transportBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--text-secondary)",
  cursor: "pointer",
  padding: "4px 8px",
  borderRadius: "8px",
  transition: "color 0.15s ease, background-color 0.15s ease",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export function PlaybackBar({
  isPlaying,
  currentTime,
  duration,
  playbackRate,
  audioRef,
  segments,
  onPause,
  onResume,
  onSeek,
  onStop,
  onSkipBackward,
  onSkipForward,
  onPlaybackRateChange,
}: PlaybackBarProps): React.ReactElement {
  const waveformRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);

  // Create / destroy wavesurfer instance when audio element changes
  useEffect(() => {
    const container = waveformRef.current;
    const audioEl = audioRef.current;
    if (!container || !audioEl) return;

    const regions = RegionsPlugin.create();
    regionsRef.current = regions;

    const ws = WaveSurfer.create({
      container,
      media: audioEl,
      height: 32,
      waveColor: "#3a3a3e",
      progressColor: "#F5A623",
      cursorColor: "#F5A623",
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      plugins: [regions],
    });

    wsRef.current = ws;

    // Region click -> seek to region start
    regions.on("region-clicked", (region: Region, e: MouseEvent) => {
      e.stopPropagation();
      onSeek(region.start);
    });

    return () => {
      ws.destroy();
      wsRef.current = null;
      regionsRef.current = null;
    };
  }, [audioRef.current]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync regions when segments change
  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions) return;

    regions.clearRegions();

    segments.forEach((seg) => {
      regions.addRegion({
        start: seg.start_time,
        end: seg.end_time,
        color: "rgba(245, 166, 35, 0.08)",
        drag: false,
        resize: false,
      });
    });
  }, [segments]);

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
        flexDirection: "column",
        justifyContent: "center",
        gap: "6px",
        padding: "12px 16px",
        height: "100px",
        boxSizing: "border-box",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        backgroundColor: "rgba(28, 28, 31, 0.92)",
        borderTop: "1px solid var(--border)",
      }}
    >
      {/* ── Top row: time | waveform | duration | rate | close ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        {/* Current time */}
        <span
          style={{
            flexShrink: 0,
            color: "var(--text-muted)",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "11px",
            minWidth: "36px",
            textAlign: "right",
          }}
        >
          {formatTime(currentTime)}
        </span>

        {/* Waveform */}
        <div
          ref={waveformRef}
          style={{
            flex: 1,
            minWidth: 0,
            height: "32px",
            cursor: "pointer",
          }}
        />

        {/* Duration */}
        <span
          style={{
            flexShrink: 0,
            color: "var(--text-muted)",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "11px",
            minWidth: "36px",
          }}
        >
          {formatTime(duration)}
        </span>

        {/* Playback rate */}
        <button
          onClick={handleCycleRate}
          style={{
            ...topBtnStyle,
            fontSize: "11px",
            minWidth: "36px",
            textAlign: "center",
            borderRadius: "10px",
            padding: "2px 8px",
            background:
              playbackRate !== 1.0 ? "var(--accent-glow)" : "transparent",
            color: playbackRate !== 1.0 ? "var(--accent)" : "var(--text-muted)",
            border:
              playbackRate !== 1.0
                ? "1px solid var(--border-accent)"
                : "1px solid transparent",
          }}
          title="Playback speed"
        >
          {playbackRate}x
        </button>

        {/* Close */}
        <button
          onClick={onStop}
          style={{
            ...topBtnStyle,
            fontSize: "13px",
          }}
          title="Stop"
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--danger)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-muted)";
          }}
        >
          ✕
        </button>
      </div>

      {/* ── Bottom row: skip back | play/pause | skip forward ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
        }}
      >
        {/* Skip backward 15s */}
        <button
          onClick={onSkipBackward}
          style={{
            ...transportBtnStyle,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "12px",
            fontWeight: 500,
            gap: "2px",
          }}
          title="Backward 15s (←)"
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--text-primary)";
            e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.06)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-secondary)";
            e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          <span style={{ fontSize: "11px" }}>{"\u25C0\u25C0"}</span>
          <span>15</span>
        </button>

        {/* Play / Pause */}
        <button
          onClick={isPlaying ? onPause : onResume}
          style={{
            ...transportBtnStyle,
            width: "36px",
            height: "36px",
            borderRadius: "50%",
            backgroundColor: "var(--accent)",
            color: "#000",
          }}
          title={isPlaying ? "Pause (Space)" : "Resume (Space)"}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--accent-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "var(--accent)";
          }}
        >
          {isPlaying ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Skip forward 15s */}
        <button
          onClick={onSkipForward}
          style={{
            ...transportBtnStyle,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "12px",
            fontWeight: 500,
            gap: "2px",
          }}
          title="Forward 15s (→)"
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--text-primary)";
            e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.06)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-secondary)";
            e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          <span>15</span>
          <span style={{ fontSize: "11px" }}>{"\u25B6\u25B6"}</span>
        </button>
      </div>
    </div>
  );
}
