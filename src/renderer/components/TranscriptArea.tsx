import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Lrc, type LrcLine } from "react-lrc";
import { segmentsToLrc } from "../utils/lrcConverter";

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

  const isPlayback = playbackTime !== null;

  const lrcString = useMemo(() => segmentsToLrc(segments), [segments]);
  const currentMillisecond = playbackTime !== null ? playbackTime * 1000 : -1;

  const lineRenderer = useCallback(
    ({ index, active }: { index: number; active: boolean; line: LrcLine }) => {
      const segment = segments[index];
      if (!segment) return null;
      return (
        <div
          onClick={
            onSeekToTime ? () => onSeekToTime(segment.start_time) : undefined
          }
          style={{
            marginBottom: "2px",
            padding: "10px 16px",
            borderRadius: "8px",
            borderBottom: "1px solid var(--border)",
            borderLeft: active
              ? "3px solid var(--accent)"
              : "3px solid transparent",
            backgroundColor: active
              ? "rgba(245, 166, 35, 0.06)"
              : "transparent",
            cursor: "pointer",
            transition:
              "background-color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease",
            opacity: active ? 1 : 0.7,
          }}
        >
          <span
            style={{
              fontSize: "11px",
              color: "var(--accent)",
              marginRight: "8px",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {formatTime(segment.start_time)}
          </span>
          <span
            style={{
              fontSize: "15px",
              lineHeight: 1.7,
              fontFamily: "'DM Sans', sans-serif",
              color: "var(--text-primary)",
            }}
          >
            {segment.text}
          </span>
        </div>
      );
    },
    [segments, onSeekToTime],
  );

  // Auto-scroll to bottom during recording
  useEffect(() => {
    if (isRecording) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [segments, partialText, isRecording]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, background: "transparent" }}>
      {isPlayback && segments.length > 0 ? (
        <Lrc
          lrc={lrcString}
          currentMillisecond={currentMillisecond}
          lineRenderer={lineRenderer}
          verticalSpace
          recoverAutoScrollInterval={5000}
          style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}
        />
      ) : (
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px 28px",
          }}
        >
          {segments.map((seg) => (
            <div
              key={seg.id}
              className="fade-in-up"
              style={{
                marginBottom: "2px",
                padding: "10px 16px",
                borderRadius: "8px",
                borderBottom: "1px solid var(--border)",
                borderLeft: "3px solid transparent",
                opacity: 0.7,
              }}
            >
              <span
                style={{
                  fontSize: "11px",
                  color: "var(--accent)",
                  marginRight: "8px",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {formatTime(seg.start_time)}
              </span>
              <span
                style={{
                  fontSize: "15px",
                  lineHeight: 1.7,
                  fontFamily: "'DM Sans', sans-serif",
                  color: "var(--text-primary)",
                }}
              >
                {seg.text}
              </span>
            </div>
          ))}

          {isRecording && partialText && (
            <div
              style={{ marginBottom: "12px", padding: "10px 16px", opacity: 0.7 }}
            >
              <span
                style={{
                  fontSize: "15px",
                  lineHeight: 1.7,
                  fontFamily: "'DM Sans', sans-serif",
                  color: "var(--text-primary)",
                }}
              >
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
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              Click <span style={{ color: "var(--accent)", margin: "0 5px", fontWeight: 600 }}>Start</span> to begin transcription
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
