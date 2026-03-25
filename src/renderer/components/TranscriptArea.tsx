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
            marginBottom: "4px",
            padding: "8px 12px",
            borderRadius: "6px",
            borderLeft: active
              ? "3px solid var(--accent)"
              : "3px solid transparent",
            backgroundColor: active
              ? "rgba(96, 165, 250, 0.12)"
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
              color: active ? "var(--accent)" : "var(--text-muted)",
              marginRight: "8px",
              fontFamily: "monospace",
            }}
          >
            {formatTime(segment.start_time)}
          </span>
          <span
            style={{
              fontSize: "14px",
              lineHeight: 1.6,
              color: active
                ? "var(--text-primary)"
                : "var(--text-secondary)",
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
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {isPlayback && segments.length > 0 ? (
        <Lrc
          lrc={lrcString}
          currentMillisecond={currentMillisecond}
          lineRenderer={lineRenderer}
          verticalSpace
          recoverAutoScrollInterval={5000}
          style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}
        />
      ) : (
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 24px",
          }}
        >
          {segments.map((seg) => (
            <div
              key={seg.id}
              style={{
                marginBottom: "4px",
                padding: "8px 12px",
                borderRadius: "6px",
                borderLeft: "3px solid transparent",
              }}
            >
              <span
                style={{
                  fontSize: "11px",
                  color: "var(--text-muted)",
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
                  color: "var(--text-secondary)",
                }}
              >
                {seg.text}
              </span>
            </div>
          ))}

          {isRecording && partialText && (
            <div
              style={{ marginBottom: "12px", padding: "8px 12px", opacity: 0.7 }}
            >
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
      )}
    </div>
  );
}
