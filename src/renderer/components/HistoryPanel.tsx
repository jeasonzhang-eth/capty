import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from "react";
import { createPortal } from "react-dom";

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
  readonly onRenameSession: (id: number, newTitle: string) => void;
  readonly onRegenerateSubtitles: (id: number) => void;
  readonly onCancelRegeneration: () => void;
  readonly onOpenFolder: (id: number) => void;
  readonly onUploadAudio: () => void;
  readonly onAiRename?: (id: number) => void;
  readonly aiRenamingSessionId?: number | null;
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

interface SessionGroup {
  readonly label: string;
  readonly sessions: readonly SessionSummary[];
}

function groupSessionsByDate(
  sessions: readonly SessionSummary[],
): SessionGroup[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  const prev7Start = new Date(todayStart.getTime() - 7 * 86400000);
  const prev30Start = new Date(todayStart.getTime() - 30 * 86400000);

  const buckets: Record<string, SessionSummary[]> = {
    Today: [],
    Yesterday: [],
    "Previous 7 Days": [],
    "Previous 30 Days": [],
    Older: [],
  };
  const order = [
    "Today",
    "Yesterday",
    "Previous 7 Days",
    "Previous 30 Days",
    "Older",
  ];

  for (const session of sessions) {
    const d = new Date(session.started_at);
    if (d >= todayStart) {
      buckets["Today"].push(session);
    } else if (d >= yesterdayStart) {
      buckets["Yesterday"].push(session);
    } else if (d >= prev7Start) {
      buckets["Previous 7 Days"].push(session);
    } else if (d >= prev30Start) {
      buckets["Previous 30 Days"].push(session);
    } else {
      buckets["Older"].push(session);
    }
  }

  return order
    .filter((label) => buckets[label].length > 0)
    .map((label) => ({ label, sessions: buckets[label] }));
}

/* Inject keyframe animations for Studio Noir theme */
const styleTagId = "studio-noir-history-keyframes";
if (typeof document !== "undefined" && !document.getElementById(styleTagId)) {
  const style = document.createElement("style");
  style.id = styleTagId;
  style.textContent = `
    @keyframes breathe {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .session-row:hover .ai-rename-btn {
      opacity: 1 !important;
    }
  `;
  document.head.appendChild(style);
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
  onRenameSession,
  onRegenerateSubtitles,
  onCancelRegeneration,
  onOpenFolder,
  onUploadAudio,
  onAiRename,
  aiRenamingSessionId,
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

  // Group sessions by date
  const groups = useMemo(() => groupSessionsByDate(sessions), [sessions]);

  // Collapsed state: all groups except "Today" start collapsed
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () =>
      new Set(groups.filter((g) => g.label !== "Today").map((g) => g.label)),
  );

  // When groups change (new sessions added), ensure new non-Today groups start collapsed
  useEffect(() => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      for (const g of groups) {
        // Only auto-collapse groups the user hasn't interacted with yet
        // If a group is new and not "Today", collapse it
        if (g.label !== "Today" && !prev.has(g.label)) {
          // Check if this is truly a new group - don't re-collapse if user expanded it
          // We skip this to avoid fighting user intent
        }
      }
      // Remove labels for groups that no longer exist
      for (const label of prev) {
        if (!groups.some((g) => g.label === label)) {
          next.delete(label);
        }
      }
      return next;
    });
  }, [groups]);

  // Auto-expand the group containing the current session
  useEffect(() => {
    if (currentSessionId === null) return;
    for (const group of groups) {
      if (group.sessions.some((s) => s.id === currentSessionId)) {
        setCollapsedGroups((prev) => {
          if (!prev.has(group.label)) return prev;
          const next = new Set(prev);
          next.delete(group.label);
          return next;
        });
        break;
      }
    }
  }, [currentSessionId, groups]);

  const toggleGroup = useCallback((label: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  }, []);

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

  // Inline rename state
  const [renamingSessionId, setRenamingSessionId] = useState<number | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const handleRenameClick = useCallback(() => {
    if (contextMenu.sessionId !== null) {
      const target = sessions.find((s) => s.id === contextMenu.sessionId);
      if (target) {
        setRenamingSessionId(target.id);
        setRenameValue(target.title);
      }
    }
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, [contextMenu.sessionId, sessions]);

  const handleRenameConfirm = useCallback(() => {
    if (renamingSessionId !== null && renameValue.trim()) {
      onRenameSession(renamingSessionId, renameValue.trim());
    }
    setRenamingSessionId(null);
  }, [renamingSessionId, renameValue, onRenameSession]);

  const handleRenameCancel = useCallback(() => {
    setRenamingSessionId(null);
  }, []);

  // Auto-focus rename input
  useEffect(() => {
    if (renamingSessionId !== null && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingSessionId]);

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

  const handleAiRenameClick = useCallback(() => {
    if (contextMenu.sessionId !== null && onAiRename) {
      onAiRename(contextMenu.sessionId);
    }
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, [contextMenu.sessionId, onAiRename]);

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
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        backgroundColor: "rgba(28, 28, 31, 0.85)",
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

      {/* Upload Audio button */}
      <div
        style={{
          padding: "8px 16px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <button
          onClick={onUploadAudio}
          style={{
            width: "100%",
            padding: "6px 12px",
            fontSize: "12px",
            fontWeight: 500,
            color: "var(--text-muted)",
            backgroundColor: "transparent",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            transition:
              "color 0.15s, border-color 0.15s, background-color 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--text-primary)";
            e.currentTarget.style.borderColor = "var(--accent)";
            e.currentTarget.style.backgroundColor = "rgba(245, 166, 35, 0.06)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-muted)";
            e.currentTarget.style.borderColor = "var(--border)";
            e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          {/* Upload icon */}
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M7 10V3M7 3L4 6M7 3L10 6"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M2 11H12"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
          Upload Audio
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {groups.map((group) => {
          const isCollapsed = collapsedGroups.has(group.label);
          return (
            <div key={group.label}>
              {/* Group header */}
              <div
                onClick={() => toggleGroup(group.label)}
                style={{
                  padding: "8px 16px 8px 14px",
                  cursor: "pointer",
                  backgroundColor: "transparent",
                  borderLeft: "2px solid var(--accent)",
                  marginTop: "8px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  userSelect: "none",
                }}
              >
                <span
                  style={{
                    fontSize: "10px",
                    color: "var(--text-muted)",
                    display: "inline-block",
                    width: "10px",
                    textAlign: "center",
                  }}
                >
                  {isCollapsed ? "\u25B6" : "\u25BC"}
                </span>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 600,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  {group.label}
                </span>
                <span
                  style={{
                    fontSize: "10px",
                    color: "var(--text-muted)",
                    letterSpacing: "0.08em",
                  }}
                >
                  ({group.sessions.length})
                </span>
              </div>
              {/* Session items */}
              {!isCollapsed &&
                group.sessions.map((session) => {
                  const isSelected = session.id === currentSessionId;
                  const isPlaying = playingSessionId === session.id;
                  return (
                    <div
                      key={session.id}
                      className="session-row"
                      onClick={() => onSelectSession(session.id)}
                      onContextMenu={(e) => handleContextMenu(e, session.id)}
                      onMouseEnter={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.backgroundColor =
                            "rgba(255,255,255,0.03)";
                          e.currentTarget.style.borderLeft =
                            "3px solid var(--text-muted)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.backgroundColor = "transparent";
                          e.currentTarget.style.borderLeft =
                            "3px solid transparent";
                        }
                      }}
                      style={{
                        padding: "10px 16px",
                        cursor: "pointer",
                        marginBottom: "2px",
                        borderLeft: isSelected
                          ? "3px solid var(--accent)"
                          : "3px solid transparent",
                        backgroundColor: isSelected
                          ? "rgba(245, 166, 35, 0.06)"
                          : "transparent",
                        transition:
                          "background-color 0.15s ease, border-left 0.15s ease",
                      }}
                    >
                      {renamingSessionId === session.id ? (
                        <input
                          ref={renameInputRef}
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleRenameConfirm();
                            } else if (e.key === "Escape") {
                              handleRenameCancel();
                            }
                            e.stopPropagation();
                          }}
                          onBlur={handleRenameConfirm}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            fontSize: "13px",
                            fontWeight: 500,
                            marginBottom: "4px",
                            width: "100%",
                            padding: "2px 4px",
                            border: "1px solid var(--accent)",
                            borderRadius: "3px",
                            backgroundColor: "var(--bg-primary)",
                            color: "var(--text-primary)",
                            outline: "none",
                            boxSizing: "border-box",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            fontSize: "13px",
                            fontWeight: 500,
                            color: "var(--text-primary)",
                            marginBottom: "4px",
                            display: "flex",
                            alignItems: "flex-start",
                            justifyContent: "space-between",
                            gap: "4px",
                          }}
                        >
                          <span
                            style={{
                              overflow: "hidden",
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              lineHeight: "1.4",
                              flex: 1,
                              minWidth: 0,
                              wordBreak: "break-all",
                            }}
                          >
                            {session.title}
                          </span>
                          {onAiRename &&
                            session.status === "completed" &&
                            (aiRenamingSessionId === session.id ? (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  width: "18px",
                                  height: "18px",
                                  flexShrink: 0,
                                  animation: "spin 1s linear infinite",
                                }}
                              >
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 14 14"
                                  fill="none"
                                >
                                  <circle
                                    cx="7"
                                    cy="7"
                                    r="5.5"
                                    stroke="var(--accent)"
                                    strokeWidth="1.5"
                                    strokeDasharray="8 6"
                                    strokeLinecap="round"
                                  />
                                </svg>
                              </span>
                            ) : (
                              <button
                                className="ai-rename-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onAiRename(session.id);
                                }}
                                title="AI Rename"
                                style={{
                                  background: "none",
                                  border: "none",
                                  cursor: "pointer",
                                  padding: "0 2px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  width: "18px",
                                  height: "18px",
                                  flexShrink: 0,
                                  opacity: 0,
                                  transition: "opacity 0.15s",
                                  color: "var(--text-muted)",
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.color = "var(--accent)";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.color =
                                    "var(--text-muted)";
                                }}
                              >
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 16 16"
                                  fill="currentColor"
                                >
                                  <path d="M8 0a1 1 0 0 1 .867.5l1.292 2.244 2.244 1.292a1 1 0 0 1 0 1.732L10.16 7.06 8.867 9.3a1 1 0 0 1-1.734 0L5.841 7.06 3.597 5.768a1 1 0 0 1 0-1.732L5.84 2.744 7.133.5A1 1 0 0 1 8 0zM3 9a1 1 0 0 1 .867.5l.575 1 1 .575a1 1 0 0 1 0 1.732l-1 .575-.575 1a1 1 0 0 1-1.734 0l-.575-1-1-.575a1 1 0 0 1 0-1.732l1-.575.575-1A1 1 0 0 1 3 9zm9 2a1 1 0 0 1 .867.5l.575 1 1 .575a1 1 0 0 1 0 1.732l-1 .575-.575 1a1 1 0 0 1-1.734 0l-.575-1-1-.575a1 1 0 0 1 0-1.732l1-.575.575-1A1 1 0 0 1 12 11z" />
                                </svg>
                              </button>
                            ))}
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: "11px",
                          color: "var(--text-muted)",
                          fontFamily: "'JetBrains Mono', monospace",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span>{formatDate(session.started_at)}</span>
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <span>
                            {formatDuration(session.duration_seconds)}
                          </span>
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
                              disabled={
                                isRecording && playingSessionId !== session.id
                              }
                              style={{
                                background: "none",
                                border: "none",
                                color: isPlaying
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
                                animation: isPlaying
                                  ? "breathe 1.5s ease-in-out infinite"
                                  : "none",
                              }}
                              title={
                                playingSessionId === session.id
                                  ? "Stop"
                                  : isRecording
                                    ? "Cannot play while recording"
                                    : "Play"
                              }
                            >
                              {playingSessionId === session.id
                                ? "\u25A0"
                                : "\u25B6"}
                            </button>
                          )}
                        </span>
                      </div>
                      {session.status === "recording" && (
                        <span
                          style={{
                            display: "inline-block",
                            marginTop: "4px",
                            fontSize: "10px",
                            color: "var(--danger)",
                            fontWeight: 600,
                            backgroundColor: "rgba(239, 68, 68, 0.15)",
                            borderRadius: "10px",
                            padding: "1px 8px",
                            animation: "breathe 2s ease-in-out infinite",
                          }}
                        >
                          RECORDING
                        </span>
                      )}
                      {regeneratingSessionId === session.id && (
                        <div style={{ marginTop: "4px" }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              marginBottom: "3px",
                            }}
                          >
                            <span
                              style={{
                                fontSize: "10px",
                                color: "var(--accent)",
                                fontWeight: 600,
                                fontFamily: "'JetBrains Mono', monospace",
                              }}
                            >
                              Regenerating... {regenerationProgress}%
                            </span>
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                onCancelRegeneration();
                              }}
                              style={{
                                fontSize: "10px",
                                color: "var(--danger)",
                                cursor: "pointer",
                                fontWeight: 600,
                                padding: "0 4px",
                              }}
                              onMouseEnter={(e) =>
                                (e.currentTarget.style.opacity = "0.7")
                              }
                              onMouseLeave={(e) =>
                                (e.currentTarget.style.opacity = "1")
                              }
                            >
                              Cancel
                            </span>
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
                                background:
                                  "linear-gradient(90deg, var(--accent), var(--accent-hover))",
                                borderRadius: "2px",
                                transition: "width 0.2s ease",
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          );
        })}
        {sessions.length === 0 && (
          <div
            style={{
              padding: "40px 16px",
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: "13px",
              opacity: 0.7,
            }}
          >
            No sessions yet
          </div>
        )}
      </div>

      {/* Context menu — portal to body to avoid overflow clipping */}
      {contextMenu.visible &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top: contextMenu.y,
              left: contextMenu.x,
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              backgroundColor: "rgba(28, 28, 31, 0.92)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              zIndex: 9000,
              minWidth: "160px",
              padding: "4px 0",
            }}
          >
            {(() => {
              const targetSession = sessions.find(
                (s) => s.id === contextMenu.sessionId,
              );
              const isCompleted = targetSession?.status === "completed";
              const canRegenerate =
                isCompleted && regeneratingSessionId === null;
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
                          "var(--accent-glow)")
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
                          "var(--accent-glow)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor = "transparent")
                      }
                    >
                      Open Folder
                    </div>
                  )}
                  {isCompleted && onAiRename && (
                    <div
                      onClick={handleAiRenameClick}
                      style={{
                        padding: "8px 16px",
                        fontSize: "13px",
                        cursor: "pointer",
                        color: "var(--text-primary)",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor =
                          "var(--accent-glow)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor = "transparent")
                      }
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        style={{ opacity: 0.7 }}
                      >
                        <path d="M8 0a1 1 0 0 1 .867.5l1.292 2.244 2.244 1.292a1 1 0 0 1 0 1.732L10.16 7.06 8.867 9.3a1 1 0 0 1-1.734 0L5.841 7.06 3.597 5.768a1 1 0 0 1 0-1.732L5.84 2.744 7.133.5A1 1 0 0 1 8 0zM3 9a1 1 0 0 1 .867.5l.575 1 1 .575a1 1 0 0 1 0 1.732l-1 .575-.575 1a1 1 0 0 1-1.734 0l-.575-1-1-.575a1 1 0 0 1 0-1.732l1-.575.575-1A1 1 0 0 1 3 9zm9 2a1 1 0 0 1 .867.5l.575 1 1 .575a1 1 0 0 1 0 1.732l-1 .575-.575 1a1 1 0 0 1-1.734 0l-.575-1-1-.575a1 1 0 0 1 0-1.732l1-.575.575-1A1 1 0 0 1 12 11z" />
                      </svg>
                      AI Rename
                    </div>
                  )}
                </>
              );
            })()}
            <div
              onClick={handleRenameClick}
              style={{
                padding: "8px 16px",
                fontSize: "13px",
                cursor: "pointer",
                color: "var(--text-primary)",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = "var(--accent-glow)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "transparent")
              }
            >
              Rename
            </div>
            <div
              onClick={handleDeleteClick}
              style={{
                padding: "8px 16px",
                fontSize: "13px",
                cursor: "pointer",
                color: "var(--danger)",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor =
                  "rgba(239, 68, 68, 0.1)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "transparent")
              }
            >
              Delete
            </div>
          </div>,
          document.body,
        )}

      {/* Confirmation dialog */}
      {confirmDeleteId !== null &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0,0,0,0.7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 2000,
            }}
            onClick={handleCancelDelete}
          >
            <div
              style={{
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                backgroundColor: "rgba(28, 28, 31, 0.92)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                padding: "20px 24px",
                maxWidth: "340px",
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  fontSize: "15px",
                  fontWeight: 600,
                  marginBottom: "8px",
                  color: "var(--text-primary)",
                }}
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
          </div>,
          document.body,
        )}
    </div>
  );
}
