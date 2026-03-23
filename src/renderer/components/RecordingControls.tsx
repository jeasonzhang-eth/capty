import React from "react";

interface RecordingControlsProps {
  readonly isRecording: boolean;
  readonly elapsedSeconds: number;
  readonly audioLevel: number;
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly onExport: () => void;
  readonly canExport: boolean;
}

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function AudioLevelBars({ level }: { level: number }): React.ReactElement {
  const barCount = 5;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: "2px",
        height: "20px",
      }}
    >
      {Array.from({ length: barCount }, (_, i) => {
        const threshold = (i + 1) / barCount;
        const active = level >= threshold;
        return (
          <div
            key={i}
            style={{
              width: "3px",
              height: `${4 + i * 4}px`,
              backgroundColor: active ? "var(--accent)" : "var(--bg-tertiary)",
              borderRadius: "1px",
              transition: "background-color 0.1s",
            }}
          />
        );
      })}
    </div>
  );
}

export function RecordingControls({
  isRecording,
  elapsedSeconds,
  audioLevel,
  onStart,
  onStop,
  onExport,
  canExport,
}: RecordingControlsProps): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 24px",
        backgroundColor: "var(--bg-secondary)",
        borderTop: "1px solid var(--border)",
        height: "56px",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {isRecording && (
          <>
            <AudioLevelBars level={audioLevel} />
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: "var(--danger)",
                display: "inline-block",
              }}
            />
            <span
              style={{
                fontFamily: "monospace",
                fontSize: "14px",
                color: "var(--text-primary)",
              }}
            >
              {formatTimer(elapsedSeconds)}
            </span>
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={isRecording ? onStop : onStart}
          style={{
            backgroundColor: isRecording ? "var(--danger)" : "var(--accent)",
            color: "white",
            border: "none",
            borderRadius: "6px",
            padding: "8px 20px",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {isRecording ? "Stop" : "Start"}
        </button>

        <button
          onClick={onExport}
          disabled={!canExport}
          style={{
            backgroundColor: "var(--bg-tertiary)",
            color: canExport ? "var(--text-primary)" : "var(--text-muted)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            padding: "8px 16px",
            fontSize: "13px",
            cursor: canExport ? "pointer" : "default",
            opacity: canExport ? 1 : 0.5,
          }}
        >
          Export
        </button>
      </div>
    </div>
  );
}
