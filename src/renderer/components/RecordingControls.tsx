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
    padding: "8px 16px",
    fontSize: "13px",
    color: "var(--text-primary)",
    backgroundColor: "transparent",
    border: "none",
    textAlign: "left",
    cursor: "pointer",
  };

  return (
    <div
      ref={menuRef}
      style={{
        position: "absolute",
        bottom: "100%",
        right: 0,
        marginBottom: "4px",
        backgroundColor: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
        overflow: "hidden",
        minWidth: "180px",
        zIndex: 100,
      }}
    >
      <button
        onClick={handleExportTxt}
        style={menuItemStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "var(--bg-tertiary)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        Export as TXT
      </button>
      <button
        onClick={handleExportSrt}
        style={menuItemStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "var(--bg-tertiary)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        Export as SRT
      </button>
      <button
        onClick={handleExportMarkdown}
        style={menuItemStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "var(--bg-tertiary)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
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

        <div style={{ position: "relative" }}>
          {showExportMenu && sessionId !== null && (
            <ExportMenu sessionId={sessionId} onClose={handleCloseMenu} />
          )}
          <button
            onClick={handleExportClick}
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
    </div>
  );
}
