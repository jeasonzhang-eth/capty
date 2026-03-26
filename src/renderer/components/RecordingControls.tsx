import React, { useState, useCallback, useRef, useEffect } from "react";

interface RecordingControlsProps {
  readonly isRecording: boolean;
  readonly elapsedSeconds: number;
  readonly audioLevel: number;
  readonly sessionId: number | null;
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

interface ExportMenuProps {
  readonly sessionId: number;
  readonly onClose: () => void;
}

function ExportMenu({
  sessionId,
  onClose,
}: ExportMenuProps): React.ReactElement {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  const getDefaultPath = useCallback(
    async (ext: string): Promise<string> => {
      const audioDir = await window.capty.getAudioDir(sessionId);
      if (audioDir) {
        // Extract timestamp from the audio directory path (last segment)
        const dirName = audioDir.split("/").pop() ?? "transcript";
        return `${audioDir}/${dirName}.${ext}`;
      }
      return `transcript.${ext}`;
    },
    [sessionId],
  );

  const handleExportTxt = useCallback(async () => {
    const content = await window.capty.exportTxt(sessionId, {
      timestamps: true,
    });
    const defaultPath = await getDefaultPath("txt");
    await window.capty.saveFile(defaultPath, content as string);
    onClose();
  }, [sessionId, onClose, getDefaultPath]);

  const handleExportSrt = useCallback(async () => {
    const content = await window.capty.exportSrt(sessionId);
    const defaultPath = await getDefaultPath("srt");
    await window.capty.saveFile(defaultPath, content as string);
    onClose();
  }, [sessionId, onClose, getDefaultPath]);

  const handleExportMarkdown = useCallback(async () => {
    const content = await window.capty.exportMarkdown(sessionId);
    const defaultPath = await getDefaultPath("md");
    await window.capty.saveFile(defaultPath, content as string);
    onClose();
  }, [sessionId, onClose, getDefaultPath]);

  const menuItemStyle: React.CSSProperties = {
    display: "block",
    width: "100%",
    padding: "10px 16px",
    fontSize: "13px",
    color: "var(--text-primary)",
    backgroundColor: "transparent",
    border: "none",
    textAlign: "left",
    cursor: "pointer",
    transition: "background-color 0.15s, color 0.15s",
  };

  return (
    <div
      ref={menuRef}
      style={{
        position: "absolute",
        bottom: "100%",
        right: 0,
        marginBottom: "8px",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        background: "rgba(28, 28, 31, 0.88)",
        border: "1px solid var(--border)",
        borderRadius: "10px",
        boxShadow:
          "0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.04)",
        overflow: "hidden",
        minWidth: "180px",
        zIndex: 100,
      }}
    >
      <button
        onClick={handleExportTxt}
        style={menuItemStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "var(--accent-glow)";
          e.currentTarget.style.color = "var(--accent)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
          e.currentTarget.style.color = "var(--text-primary)";
        }}
      >
        Export as TXT
      </button>
      <button
        onClick={handleExportSrt}
        style={menuItemStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "var(--accent-glow)";
          e.currentTarget.style.color = "var(--accent)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
          e.currentTarget.style.color = "var(--text-primary)";
        }}
      >
        Export as SRT
      </button>
      <button
        onClick={handleExportMarkdown}
        style={menuItemStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "var(--accent-glow)";
          e.currentTarget.style.color = "var(--accent)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
          e.currentTarget.style.color = "var(--text-primary)";
        }}
      >
        Export as Markdown
      </button>
    </div>
  );
}

export function RecordingControls({
  isRecording,
  elapsedSeconds,
  audioLevel,
  sessionId,
  onStart,
  onStop,
  onExport,
  canExport,
}: RecordingControlsProps): React.ReactElement {
  const [showExportMenu, setShowExportMenu] = useState(false);

  const handleExportClick = useCallback(() => {
    if (sessionId !== null) {
      setShowExportMenu((prev) => !prev);
    } else {
      onExport();
    }
  }, [sessionId, onExport]);

  const handleCloseMenu = useCallback(() => {
    setShowExportMenu(false);
  }, []);

  return (
    <div
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

      {/* ── Right section: Export button ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          flex: "1 1 0",
          minWidth: 0,
        }}
      >
        <div style={{ position: "relative" }}>
          {showExportMenu && sessionId !== null && (
            <ExportMenu sessionId={sessionId} onClose={handleCloseMenu} />
          )}
          <button
            onClick={handleExportClick}
            disabled={!canExport}
            style={{
              backgroundColor: "transparent",
              color: canExport ? "var(--text-muted)" : "var(--text-muted)",
              border: "none",
              padding: "8px 4px",
              fontSize: "13px",
              fontWeight: 500,
              cursor: canExport ? "pointer" : "default",
              opacity: canExport ? 1 : 0.4,
              display: "flex",
              alignItems: "center",
              gap: "4px",
              transition: "color 0.15s, opacity 0.15s",
            }}
            onMouseEnter={(e) => {
              if (canExport) {
                e.currentTarget.style.color = "var(--text-primary)";
              }
            }}
            onMouseLeave={(e) => {
              if (canExport) {
                e.currentTarget.style.color = "var(--text-muted)";
              }
            }}
          >
            Export
            {/* Small arrow icon */}
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              style={{ marginTop: "-1px" }}
            >
              <path
                d="M3.5 2.5L8.5 2.5L8.5 7.5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M8.5 2.5L3 8"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
