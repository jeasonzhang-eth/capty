import React, { useCallback, useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, {
  type Region,
} from "wavesurfer.js/dist/plugins/regions";

const PLAYBACK_RATES = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0] as const;

interface Segment {
  readonly id: number;
  readonly start_time: number;
  readonly end_time: number;
  readonly text: string;
}

interface PlaybackBarProps {
  readonly sessionTitle: string;
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

const controlBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--text-secondary)",
  fontSize: "14px",
  cursor: "pointer",
  padding: "2px 6px",
  flexShrink: 0,
  borderRadius: "6px",
  transition: "text-shadow 0.2s ease",
};

export function PlaybackBar({
  sessionTitle,
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

    // Clear existing regions
    regions.clearRegions();

    // Add new regions for each segment
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
        alignItems: "center",
        gap: "6px",
        padding: "8px 16px",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        backgroundColor: "rgba(28, 28, 31, 0.92)",
        borderTop: "1px solid var(--border)",
        fontSize: "13px",
      }}
    >
      {/* Skip backward */}
      <button
        onClick={onSkipBackward}
        style={controlBtnStyle}
        title="Backward 10s (←)"
        onMouseEnter={(e) => {
          e.currentTarget.style.textShadow = "0 0 8px rgba(245, 166, 35, 0.5)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.textShadow = "none";
        }}
      >
        {"\u27EA"}
      </button>

      {/* Play/Pause button */}
      <button
        onClick={isPlaying ? onPause : onResume}
        style={{ ...controlBtnStyle, fontSize: "16px" }}
        title={isPlaying ? "Pause (Space)" : "Resume (Space)"}
        onMouseEnter={(e) => {
          e.currentTarget.style.textShadow = "0 0 8px rgba(245, 166, 35, 0.5)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.textShadow = "none";
        }}
      >
        {isPlaying ? "\u23F8" : "\u25B6"}
      </button>

      {/* Skip forward */}
      <button
        onClick={onSkipForward}
        style={controlBtnStyle}
        title="Forward 10s (→)"
        onMouseEnter={(e) => {
          e.currentTarget.style.textShadow = "0 0 8px rgba(245, 166, 35, 0.5)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.textShadow = "none";
        }}
      >
        {"\u27EB"}
      </button>

      {/* Session title */}
      <span
        style={{
          flexShrink: 0,
          maxWidth: "120px",
          overflow: "hidden",
          whiteSpace: "nowrap",
          color: "var(--text-secondary)",
          maskImage:
            "linear-gradient(to right, black 70%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to right, black 70%, transparent 100%)",
        }}
      >
        {sessionTitle}
      </span>

      {/* Current time */}
      <span
        style={{
          flexShrink: 0,
          color: "var(--text-muted)",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "12px",
          minWidth: "36px",
          textAlign: "right",
        }}
      >
        {formatTime(currentTime)}
      </span>

      {/* Waveform container */}
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
          borderRadius: "12px",
          padding: "2px 10px",
          background:
            playbackRate !== 1.0 ? "var(--accent-glow)" : "transparent",
          color:
            playbackRate !== 1.0 ? "var(--accent)" : "var(--text-muted)",
          border:
            playbackRate !== 1.0
              ? "1px solid var(--border-accent)"
              : "1px solid transparent",
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
  );
}
