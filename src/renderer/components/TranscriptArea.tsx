import React, { useEffect, useRef, useState } from "react";

interface Segment {
  readonly id: number;
  readonly start_time: number;
  readonly end_time: number;
  readonly text: string;
}

interface TranscriptAreaProps {
  readonly segments: readonly Segment[];
  readonly partialText: string;
  readonly isRecording: boolean;
  readonly playbackTime: number | null;
  readonly onSeekToTime: ((time: number) => void) | null;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function TranscriptArea({
  segments,
  partialText,
  isRecording,
  playbackTime,
  onSeekToTime,
}: TranscriptAreaProps): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const lastActiveIdRef = useRef<number | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  const isPlayback = playbackTime !== null;

  // Find active segment index
  const activeSegmentId = isPlayback
    ? (segments.find(
        (seg, index) =>
          seg.start_time <= playbackTime &&
          (playbackTime < seg.end_time ||
            (index === segments.length - 1 &&
              playbackTime >= seg.start_time)),
      )?.id ?? null)
    : null;

  // Auto-scroll to bottom during recording
  useEffect(() => {
    if (isRecording) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [segments, partialText, isRecording]);

  // Auto-scroll to active segment during playback
  useEffect(() => {
    if (activeSegmentId !== null && activeSegmentId !== lastActiveIdRef.current) {
      lastActiveIdRef.current = activeSegmentId;
      activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeSegmentId]);

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "16px 24px",
      }}
    >
      {segments.map((seg) => {
        const isActive = activeSegmentId === seg.id;
        const isHovered = hoveredId === seg.id;

        return (
          <div
            key={seg.id}
            ref={isActive ? activeRef : undefined}
            onClick={
              isPlayback && onSeekToTime
                ? () => onSeekToTime(seg.start_time)
                : undefined
            }
            onMouseEnter={isPlayback ? () => setHoveredId(seg.id) : undefined}
            onMouseLeave={isPlayback ? () => setHoveredId(null) : undefined}
            style={{
              marginBottom: "4px",
              padding: "8px 12px",
              borderRadius: "6px",
              borderLeft: isActive
                ? "3px solid var(--accent)"
                : "3px solid transparent",
              backgroundColor: isActive
                ? "rgba(96, 165, 250, 0.12)"
                : isPlayback && isHovered
                  ? "rgba(96, 165, 250, 0.06)"
                  : "transparent",
              cursor: isPlayback ? "pointer" : "default",
              transition:
                "background-color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease",
              opacity: isPlayback && !isActive ? 0.7 : 1,
            }}
          >
            <span
              style={{
                fontSize: "11px",
                color: isActive ? "var(--accent)" : "var(--text-muted)",
                marginRight: "8px",
                fontFamily: "monospace",
              }}
            >
              {formatTime(seg.start_time)}
            </span>
            <span
              style={{
                fontSize: "14px",
                lineHeight: 1.6,
                color: isActive
                  ? "var(--text-primary)"
                  : "var(--text-secondary)",
              }}
            >
              {seg.text}
            </span>
          </div>
        );
      })}

      {isRecording && partialText && (
        <div style={{ marginBottom: "12px", padding: "8px 12px", opacity: 0.7 }}>
          <span style={{ fontSize: "14px", lineHeight: 1.6 }}>
            {partialText}
          </span>
          <span
            className="cursor-blink"
            style={{
              display: "inline-block",
              width: "2px",
              height: "16px",
              backgroundColor: "var(--accent)",
              marginLeft: "2px",
              verticalAlign: "text-bottom",
            }}
          />
        </div>
      )}

      {!isRecording && segments.length === 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "var(--text-muted)",
            fontSize: "14px",
          }}
        >
          Click Start to begin transcription
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
