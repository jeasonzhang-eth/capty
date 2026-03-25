import React, { useState, useCallback, useEffect, useRef } from "react";

interface SessionSummary {
  readonly id: number;
  readonly title: string;
  readonly started_at: string;
  readonly duration_seconds: number | null;
  readonly status: string;
}

const HISTORY_MIN_WIDTH = 160;
const HISTORY_MAX_WIDTH = 400;

interface HistoryPanelProps {
  readonly sessions: readonly SessionSummary[];
  readonly currentSessionId: number | null;
  readonly playingSessionId: number | null;
  readonly regeneratingSessionId: number | null;
  readonly regenerationProgress: number;
  readonly isRecording: boolean;
  readonly width: number;
  readonly onWidthChange: (width: number) => void;
  readonly onSelectSession: (id: number) => void;
  readonly onDeleteSession: (id: number) => void;
  readonly onPlaySession: (id: number) => void;
  readonly onStopPlayback: () => void;
  readonly onRegenerateSubtitles: (id: number) => void;
  readonly onOpenFolder: (id: number) => void;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ContextMenuState {
  readonly visible: boolean;
  readonly x: number;
  readonly y: number;
  readonly sessionId: number | null;
}

export function HistoryPanel({
  sessions,
  currentSessionId,
  playingSessionId,
  regeneratingSessionId,
  regenerationProgress,
  isRecording,
  width,
  onWidthChange,
  onSelectSession,
  onDeleteSession,
  onPlaySession,
  onStopPlayback,
  onRegenerateSubtitles,
  onOpenFolder,
}: HistoryPanelProps): React.ReactElement {
  // Drag handle for resizing
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(width);

  const handleDragMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true;
      startX.current = e.clientX;
      startWidth.current = width;
      e.preventDefault();
    },
    [width],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent): void => {
      if (!isDragging.current) return;
      const delta = e.clientX - startX.current;
      const newWidth = Math.min(
        HISTORY_MAX_WIDTH,
        Math.max(HISTORY_MIN_WIDTH, startWidth.current + delta),
      );
      onWidthChange(newWidth);
    };

    const handleMouseUp = (): void => {
      isDragging.current = false;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onWidthChange]);

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    sessionId: null,
  });
  const menuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, sessionId: number) => {
      e.preventDefault();
      setContextMenu({ visible: true, x: e.clientX, y: e.clientY, sessionId });
    },
    [],
  );

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const handleRegenerateClick = useCallback(() => {
    if (contextMenu.sessionId !== null) {
      onRegenerateSubtitles(contextMenu.sessionId);
    }
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, [contextMenu.sessionId, onRegenerateSubtitles]);

  const handleOpenFolderClick = useCallback(() => {
    if (contextMenu.sessionId !== null) {
      onOpenFolder(contextMenu.sessionId);
    }
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, [contextMenu.sessionId, onOpenFolder]);

  const handleDeleteClick = useCallback(() => {
    setConfirmDeleteId(contextMenu.sessionId);
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, [contextMenu.sessionId]);

  const handleConfirmDelete = useCallback(() => {
    if (confirmDeleteId !== null) {
      onDeleteSession(confirmDeleteId);
    }
    setConfirmDeleteId(null);
  }, [confirmDeleteId, onDeleteSession]);

  const handleCancelDelete = useCallback(() => {
    setConfirmDeleteId(null);
  }, []);

  // Close context menu on click outside or Escape
  useEffect(() => {
    if (!contextMenu.visible) return;

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu.visible]);

  return (
    <div
      style={{
        width: `${width}px`,
        minWidth: `${HISTORY_MIN_WIDTH}px`,
        maxWidth: `${HISTORY_MAX_WIDTH}px`,
        backgroundColor: "var(--bg-secondary)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Right-edge drag handle */}
      <div
        onMouseDown={handleDragMouseDown}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: "4px",
          cursor: "col-resize",
          zIndex: 10,
        }}
      />
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: "13px",
          color: "var(--text-secondary)",
        }}
      >
        History ({sessions.length})
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {sessions.map((session) => (
          <div
            key={session.id}
            onClick={() => onSelectSession(session.id)}
            onContextMenu={(e) => handleContextMenu(e, session.id)}
            style={{
              padding: "10px 16px",
              cursor: "pointer",
              borderBottom: "1px solid var(--border)",
              borderLeft:
                session.id === currentSessionId
                  ? "3px solid var(--accent)"
                  : "3px solid transparent",
              backgroundColor:
                session.id === currentSessionId
                  ? "var(--bg-tertiary)"
                  : "transparent",
            }}
          >
            <div
              style={{ fontSize: "13px", fontWeight: 500, marginBottom: "4px" }}
            >
              {session.title}
            </div>
            <div
              style={{
                fontSize: "11px",
                color: "var(--text-muted)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>{formatDate(session.started_at)}</span>
              <span
                style={{ display: "flex", alignItems: "center", gap: "6px" }}
              >
                <span>{formatDuration(session.duration_seconds)}</span>
                {session.status === "completed" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (playingSessionId === session.id) {
                        onStopPlayback();
                      } else if (!isRecording) {
                        onPlaySession(session.id);
                      }
                    }}
                    disabled={isRecording && playingSessionId !== session.id}
                    style={{
                      background: "none",
                      border: "none",
                      color:
                        playingSessionId === session.id
                          ? "var(--accent)"
                          : "var(--text-muted)",
                      fontSize: "12px",
                      cursor:
                        isRecording && playingSessionId !== session.id
                          ? "not-allowed"
                          : "pointer",
                      padding: "0 2px",
                      opacity:
                        isRecording && playingSessionId !== session.id
                          ? 0.4
                          : 1,
                    }}
                    title={
                      playingSessionId === session.id
                        ? "Stop"
                        : isRecording
                          ? "Cannot play while recording"
                          : "Play"
                    }
                  >
                    {playingSessionId === session.id ? "\u25A0" : "\u25B6"}
                  </button>
                )}
              </span>
            </div>
            {session.status === "recording" && (
              <span
                style={{
                  fontSize: "10px",
                  color: "var(--danger)",
                  fontWeight: 600,
                }}
              >
                RECORDING
              </span>
            )}
            {regeneratingSessionId === session.id && (
              <div style={{ marginTop: "4px" }}>
                <div
                  style={{
                    fontSize: "10px",
                    color: "var(--accent)",
                    fontWeight: 600,
                    marginBottom: "3px",
                  }}
                >
                  Regenerating... {regenerationProgress}%
                </div>
                <div
                  style={{
                    height: "3px",
                    backgroundColor: "var(--border)",
                    borderRadius: "2px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${regenerationProgress}%`,
                      backgroundColor: "var(--accent)",
                      borderRadius: "2px",
                      transition: "width 0.2s ease",
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
        {sessions.length === 0 && (
          <div
            style={{
              padding: "20px 16px",
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: "13px",
            }}
          >
            No sessions yet
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu.visible && (
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            zIndex: 1000,
            minWidth: "160px",
            padding: "4px 0",
          }}
        >
          {(() => {
            const targetSession = sessions.find(
              (s) => s.id === contextMenu.sessionId,
            );
            const isCompleted = targetSession?.status === "completed";
            const canRegenerate = isCompleted && regeneratingSessionId === null;
            return (
              <>
                {canRegenerate && (
                  <div
                    onClick={handleRegenerateClick}
                    style={{
                      padding: "8px 16px",
                      fontSize: "13px",
                      cursor: "pointer",
                      color: "var(--text-primary)",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor =
                        "var(--bg-tertiary)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = "transparent")
                    }
                  >
                    Regenerate Subtitles
                  </div>
                )}
                {isCompleted && (
                  <div
                    onClick={handleOpenFolderClick}
                    style={{
                      padding: "8px 16px",
                      fontSize: "13px",
                      cursor: "pointer",
                      color: "var(--text-primary)",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor =
                        "var(--bg-tertiary)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = "transparent")
                    }
                  >
                    Open Folder
                  </div>
                )}
              </>
            );
          })()}
          <div
            onClick={handleDeleteClick}
            style={{
              padding: "8px 16px",
              fontSize: "13px",
              cursor: "pointer",
              color: "var(--danger)",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = "var(--bg-tertiary)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = "transparent")
            }
          >
            Delete
          </div>
        </div>
      )}

      {/* Confirmation dialog */}
      {confirmDeleteId !== null && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
          }}
          onClick={handleCancelDelete}
        >
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: "10px",
              padding: "20px 24px",
              maxWidth: "340px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{ fontSize: "15px", fontWeight: 600, marginBottom: "8px" }}
            >
              确认删除
            </div>
            <div
              style={{
                fontSize: "13px",
                color: "var(--text-secondary)",
                marginBottom: "20px",
                lineHeight: 1.5,
              }}
            >
              此操作将同时删除录音记录和原始音频文件，且无法恢复。确定要删除吗？
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "8px",
              }}
            >
              <button
                onClick={handleCancelDelete}
                style={{
                  padding: "6px 16px",
                  fontSize: "13px",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                  backgroundColor: "transparent",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                }}
              >
                取消
              </button>
              <button
                onClick={handleConfirmDelete}
                style={{
                  padding: "6px 16px",
                  fontSize: "13px",
                  borderRadius: "6px",
                  border: "none",
                  backgroundColor: "var(--danger)",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
