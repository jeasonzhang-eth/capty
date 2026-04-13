import React from "react";

interface RecordingControlsProps {
  readonly isRecording: boolean;
  readonly elapsedSeconds: number;
  readonly audioLevel: number;
  readonly onStart: () => void;
  readonly onStop: () => void;
}

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function VUMeter({ level }: { level: number }): React.ReactElement {
  const fillWidth = Math.max(5, level * 100);
  return (
    <div
      style={{
        width: "120px",
        height: "6px",
        backgroundColor: "var(--bg-surface)",
        borderRadius: "3px",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: `${fillWidth}%`,
          height: "100%",
          background: "linear-gradient(90deg, #4ADE80, #F5A623, #EF4444)",
          borderRadius: "3px",
          transition: "width 0.15s ease-out",
        }}
      />
    </div>
  );
}

export function RecordingControls({
  isRecording,
  elapsedSeconds,
  audioLevel,
  onStart,
  onStop,
}: RecordingControlsProps): React.ReactElement {
  return (
    <div
      data-testid="recording-controls"
      style={{
        display: "flex",
        alignItems: "center",
        padding: "0 24px",
        background: isRecording
          ? "linear-gradient(180deg, rgba(239, 68, 68, 0.05), var(--bg-secondary))"
          : "var(--bg-secondary)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderTop: "1px solid var(--border)",
        height: "100px",
        flexShrink: 0,
        position: "relative",
      }}
    >
      {/* ── Left section: VU meter + REC dot + Timer ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          flex: "1 1 0",
          minWidth: 0,
        }}
      >
        {isRecording && (
          <>
            <VUMeter level={audioLevel} />
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: "var(--danger)",
                display: "inline-block",
                animation: "breathe 1.5s ease-in-out infinite",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "16px",
                color: "var(--text-primary)",
                letterSpacing: "0.02em",
                flexShrink: 0,
              }}
            >
              {formatTimer(elapsedSeconds)}
            </span>
          </>
        )}
      </div>

      {/* ── Center section: Hero record button ── */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "56px",
            height: "56px",
          }}
        >
          {/* Pulse rings when recording */}
          {isRecording && (
            <>
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  border: "2px solid var(--danger)",
                  animation: "pulse-ring 2s ease-out infinite",
                  animationDelay: "0s",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  border: "2px solid var(--danger)",
                  animation: "pulse-ring 2s ease-out infinite",
                  animationDelay: "0.5s",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  border: "2px solid var(--danger)",
                  animation: "pulse-ring 2s ease-out infinite",
                  animationDelay: "1s",
                }}
              />
            </>
          )}

          {/* Main button */}
          <button
            onClick={isRecording ? onStop : onStart}
            style={{
              position: "relative",
              width: "56px",
              height: "56px",
              borderRadius: "50%",
              backgroundColor: isRecording
                ? "var(--danger)"
                : "var(--bg-surface)",
              border: isRecording ? "none" : "2px solid var(--accent)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition:
                "background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease",
              boxShadow: isRecording
                ? "0 0 20px rgba(239, 68, 68, 0.3)"
                : "none",
              zIndex: 1,
              outline: "none",
            }}
            onMouseEnter={(e) => {
              if (!isRecording) {
                e.currentTarget.style.boxShadow =
                  "0 0 16px rgba(245, 166, 35, 0.3)";
                e.currentTarget.style.borderColor = "var(--accent-hover)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isRecording) {
                e.currentTarget.style.boxShadow = "none";
                e.currentTarget.style.borderColor = "var(--accent)";
              }
            }}
          >
            {isRecording ? (
              /* Stop icon: rounded square */
              <div
                style={{
                  width: "18px",
                  height: "18px",
                  borderRadius: "3px",
                  backgroundColor: "white",
                }}
              />
            ) : (
              /* Inner circle for idle state */
              <div
                style={{
                  width: "20px",
                  height: "20px",
                  borderRadius: "50%",
                  backgroundColor: "var(--accent)",
                  opacity: 0.8,
                }}
              />
            )}
          </button>
        </div>

        {/* Label below the button */}
        {!isRecording && (
          <span
            style={{
              fontSize: "10px",
              fontWeight: 600,
              color: "var(--text-muted)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            REC
          </span>
        )}
      </div>

      {/* ── Right section: empty (balanced layout) ── */}
      <div
        style={{
          flex: "1 1 0",
          minWidth: 0,
        }}
      />
    </div>
  );
}
