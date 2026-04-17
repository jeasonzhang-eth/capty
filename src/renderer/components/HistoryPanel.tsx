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
  readonly category: string;
}

const HISTORY_MIN_WIDTH = 160;
const HISTORY_MAX_WIDTH = 400;

export interface SessionCategory {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly isBuiltin: boolean;
}

const ICON_CHOICES = [
  "📁",
  "📝",
  "🎵",
  "🎤",
  "📞",
  "💼",
  "🏠",
  "🎯",
  "📌",
  "⭐",
];

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
  readonly onDownloadAudio: () => void;
  readonly downloadBadge: "active" | "failed" | null;
  readonly onAiRename?: (id: number) => void;
  readonly aiRenamingSessionId?: number | null;
  readonly onUpdateCategory?: (id: number, category: string) => void;
  readonly onReorderSessions?: (sessionIds: number[]) => void;
  readonly categories?: readonly SessionCategory[];
  readonly onAddCategory?: (category: { label: string; icon: string }) => void;
  readonly onDeleteCategory?: (categoryId: string) => void;
  readonly onReorderCategories?: (categoryIds: string[]) => void;
  readonly onEditSession?: (
    id: number,
    title: string,
    startedAt: string,
  ) => void;
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
    weekday: "short",
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

interface CategoryGroup {
  readonly category: SessionCategory;
  readonly dateGroups: SessionGroup[];
  readonly totalCount: number;
}

function groupByCategory(
  sessions: readonly SessionSummary[],
  categories: readonly SessionCategory[],
): CategoryGroup[] {
  return categories.map((cat) => {
    const filtered = sessions.filter(
      (s) => (s.category || "recording") === cat.id,
    );
    return {
      category: cat,
      dateGroups: groupSessionsByDate(filtered),
      totalCount: filtered.length,
    };
  });
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
    .session-row.dragging {
      opacity: 0.4;
    }
    .drop-indicator-line {
      height: 2px;
      background: var(--accent);
      border-radius: 1px;
      margin: 0 16px;
      pointer-events: none;
    }
    .category-drop-highlight {
      background: rgba(245,166,35,0.12) !important;
      outline: 1px dashed var(--accent);
      outline-offset: -1px;
    }
    .category-header.dragging-cat {
      opacity: 0.4;
    }
    .cat-drop-indicator-line {
      height: 2px;
      background: var(--accent);
      border-radius: 1px;
      margin: 0 8px;
      pointer-events: none;
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
  onDownloadAudio,
  downloadBadge,
  onAiRename,
  aiRenamingSessionId,
  onUpdateCategory,
  onReorderSessions,
  categories,
  onAddCategory,
  onDeleteCategory,
  onReorderCategories,
  onEditSession,
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

  // ── Drag & Drop state ──
  const [dragSessionId, setDragSessionId] = useState<number | null>(null);
  const [dragOverCategoryId, setDragOverCategoryId] = useState<string | null>(
    null,
  );
  const [dropIndicator, setDropIndicator] = useState<{
    categoryId: string;
    insertBeforeSessionId: number | null; // null = append at end
  } | null>(null);

  // Category reorder DnD
  const [dragCategoryId, setDragCategoryId] = useState<string | null>(null);
  const [catDropIndicator, setCatDropIndicator] = useState<{
    beforeCategoryId: string | null; // null = append at end
  } | null>(null);

  const clearDndState = useCallback(() => {
    setDragSessionId(null);
    setDragOverCategoryId(null);
    setDropIndicator(null);
    setDragCategoryId(null);
    setCatDropIndicator(null);
  }, []);

  // Recompute "today" string so grouping refreshes when the date rolls over
  const todayDateKey = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }, [sessions]); // re-evaluate at least whenever sessions changes

  // Also set up a timer to refresh at midnight
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const now = new Date();
    const tomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );
    const msUntilMidnight = tomorrow.getTime() - now.getTime();
    const timer = setTimeout(
      () => forceUpdate((n) => n + 1),
      msUntilMidnight + 100,
    );
    return () => clearTimeout(timer);
  });

  // Fallback builtin categories when prop not provided
  const effectiveCategories: readonly SessionCategory[] = useMemo(
    () =>
      categories && categories.length > 0
        ? categories
        : [
            { id: "download", label: "下载内容", icon: "↓", isBuiltin: true },
            { id: "recording", label: "个人录音", icon: "●", isBuiltin: true },
            { id: "meeting", label: "会议", icon: "◎", isBuiltin: true },
            { id: "phone", label: "电话", icon: "☏", isBuiltin: true },
          ],
    [categories],
  );

  // Group sessions by category then by date
  const categoryGroups = useMemo(
    () => groupByCategory(sessions, effectiveCategories),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, todayDateKey, effectiveCategories],
  );

  // Collapsed state for categories — all start collapsed
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const categoriesInitialised = useRef(false);
  useEffect(() => {
    if (categoriesInitialised.current) return;
    if (effectiveCategories.length === 0) return;
    categoriesInitialised.current = true;
    setCollapsedCategories(new Set(effectiveCategories.map((c) => c.id)));
  }, [effectiveCategories]);

  // Collapsed state for date groups within categories
  // Key format: "categoryId:dateLabel"
  const [collapsedDateGroups, setCollapsedDateGroups] = useState<Set<string>>(
    () => new Set<string>(),
  );

  // Auto-expand the category and date group containing the current session
  useEffect(() => {
    if (currentSessionId === null) return;
    for (const catGroup of categoryGroups) {
      for (const dateGroup of catGroup.dateGroups) {
        if (dateGroup.sessions.some((s) => s.id === currentSessionId)) {
          // Expand category
          setCollapsedCategories((prev) => {
            if (!prev.has(catGroup.category.id)) return prev;
            const next = new Set(prev);
            next.delete(catGroup.category.id);
            return next;
          });
          // Expand date group
          const dateKey = `${catGroup.category.id}:${dateGroup.label}`;
          setCollapsedDateGroups((prev) => {
            if (!prev.has(dateKey)) return prev;
            const next = new Set(prev);
            next.delete(dateKey);
            return next;
          });
          return;
        }
      }
    }
  }, [currentSessionId, categoryGroups]);

  const toggleCategory = useCallback((categoryId: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  }, []);

  const toggleDateGroup = useCallback((key: string) => {
    setCollapsedDateGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
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

  // ── Edit Info modal state ──
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editStartedAt, setEditStartedAt] = useState(""); // datetime-local: "2025-04-06T14:30"

  const handleEditInfoClick = useCallback(() => {
    if (contextMenu.sessionId !== null) {
      const target = sessions.find((s) => s.id === contextMenu.sessionId);
      if (target) {
        setEditingSessionId(target.id);
        setEditTitle(target.title);
        setEditStartedAt(target.started_at.replace(" ", "T"));
      }
    }
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, [contextMenu.sessionId, sessions]);

  const handleEditInfoSave = useCallback(() => {
    if (editingSessionId !== null && onEditSession && editTitle.trim()) {
      onEditSession(editingSessionId, editTitle.trim(), editStartedAt);
    }
    setEditingSessionId(null);
  }, [editingSessionId, editTitle, editStartedAt, onEditSession]);

  const handleEditInfoCancel = useCallback(() => {
    setEditingSessionId(null);
  }, []);

  // ESC to dismiss edit info modal
  useEffect(() => {
    if (editingSessionId === null) return;
    const h = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setEditingSessionId(null);
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [editingSessionId]);

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

  // ESC to dismiss delete confirmation dialogs
  useEffect(() => {
    if (confirmDeleteId === null) return;
    const h = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setConfirmDeleteId(null);
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [confirmDeleteId]);

  // ── Inline category creation state ──
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryIcon, setNewCategoryIcon] = useState(ICON_CHOICES[0]);
  const newCategoryInputRef = useRef<HTMLInputElement>(null);

  const handleStartCreateCategory = useCallback(() => {
    setIsCreatingCategory(true);
    setNewCategoryName("");
    setNewCategoryIcon(ICON_CHOICES[0]);
  }, []);

  const handleConfirmCreateCategory = useCallback(() => {
    const trimmed = newCategoryName.trim();
    if (trimmed && onAddCategory) {
      onAddCategory({ label: trimmed, icon: newCategoryIcon });
    }
    setIsCreatingCategory(false);
  }, [newCategoryName, newCategoryIcon, onAddCategory]);

  const handleCancelCreateCategory = useCallback(() => {
    setIsCreatingCategory(false);
  }, []);

  useEffect(() => {
    if (isCreatingCategory && newCategoryInputRef.current) {
      newCategoryInputRef.current.focus();
    }
  }, [isCreatingCategory]);

  // ── Category header context menu state ──
  const [catContextMenu, setCatContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    categoryId: string | null;
    categoryLabel: string;
  }>({ visible: false, x: 0, y: 0, categoryId: null, categoryLabel: "" });
  const catMenuRef = useRef<HTMLDivElement>(null);

  const [confirmDeleteCategoryId, setConfirmDeleteCategoryId] = useState<
    string | null
  >(null);
  const confirmDeleteCategoryLabel = useMemo(() => {
    if (!confirmDeleteCategoryId) return "";
    return (
      effectiveCategories.find((c) => c.id === confirmDeleteCategoryId)
        ?.label ?? ""
    );
  }, [confirmDeleteCategoryId, effectiveCategories]);

  // ESC to dismiss category delete confirmation
  useEffect(() => {
    if (confirmDeleteCategoryId === null) return;
    const h = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setConfirmDeleteCategoryId(null);
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [confirmDeleteCategoryId]);

  const handleCategoryContextMenu = useCallback(
    (
      e: React.MouseEvent,
      catId: string,
      catLabel: string,
      isBuiltin: boolean,
    ) => {
      if (isBuiltin) return; // builtin categories cannot be deleted
      e.preventDefault();
      e.stopPropagation();
      setCatContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        categoryId: catId,
        categoryLabel: catLabel,
      });
    },
    [],
  );

  // Close category context menu on outside click
  useEffect(() => {
    if (!catContextMenu.visible) return;
    const handler = (e: MouseEvent) => {
      if (
        catMenuRef.current &&
        !catMenuRef.current.contains(e.target as Node)
      ) {
        setCatContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [catContextMenu.visible]);

  const handleMoveTo = useCallback(
    (categoryId: string) => {
      if (contextMenu.sessionId !== null && onUpdateCategory) {
        onUpdateCategory(contextMenu.sessionId, categoryId);
      }
      setContextMenu((prev) => ({ ...prev, visible: false }));
    },
    [contextMenu.sessionId, onUpdateCategory],
  );

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

  // Helper: get all sessions within a category, in the order currently displayed
  const getSessionsInCategory = useCallback(
    (catId: string): SessionSummary[] => {
      const catGroup = categoryGroups.find((cg) => cg.category.id === catId);
      if (!catGroup) return [];
      return catGroup.dateGroups.flatMap((dg) => [...dg.sessions]);
    },
    [categoryGroups],
  );

  // Render a single session row
  const renderSessionRow = (session: SessionSummary, categoryId: string) => {
    const isSelected = session.id === currentSessionId;
    const isPlaying = playingSessionId === session.id;
    const isDragged = dragSessionId === session.id;
    const showDropBefore =
      dropIndicator !== null &&
      dropIndicator.categoryId === categoryId &&
      dropIndicator.insertBeforeSessionId === session.id;
    return (
      <React.Fragment key={session.id}>
        {showDropBefore && <div className="drop-indicator-line" />}
        <div
          className={`session-row${isDragged ? " dragging" : ""}`}
          data-testid={`session-row-${session.id}`}
          draggable
          onDragStart={(e) => {
            setDragSessionId(session.id);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData(
              "application/x-capty-session",
              JSON.stringify({ id: session.id, category: categoryId }),
            );
          }}
          onDragEnd={clearDndState}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (dragSessionId === null || dragSessionId === session.id) return;
            // Only show drop indicator for same-category reorder
            const draggedSession = sessions.find((s) => s.id === dragSessionId);
            const dragFromCat = draggedSession?.category || "recording";
            if (dragFromCat !== categoryId) return;
            // Determine if cursor is in upper or lower half
            const rect = e.currentTarget.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            if (e.clientY < midY) {
              // Insert before this session
              setDropIndicator({
                categoryId,
                insertBeforeSessionId: session.id,
              });
            } else {
              // Insert after this session — find the next session in category
              const catSessions = getSessionsInCategory(categoryId);
              const idx = catSessions.findIndex((s) => s.id === session.id);
              const nextSession = catSessions[idx + 1];
              setDropIndicator({
                categoryId,
                insertBeforeSessionId: nextSession?.id ?? null,
              });
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragSessionId === null) return;
            const raw = e.dataTransfer.getData("application/x-capty-session");
            if (!raw) return;
            const { id: draggedId, category: fromCat } = JSON.parse(raw) as {
              id: number;
              category: string;
            };
            if (fromCat !== categoryId) {
              // Cross-category move
              onUpdateCategory?.(draggedId, categoryId);
            } else if (onReorderSessions && dropIndicator) {
              // Same-category reorder
              const catSessions = getSessionsInCategory(categoryId);
              const orderedIds = catSessions.map((s) => s.id);
              // Remove dragged session from list
              const filtered = orderedIds.filter((id) => id !== draggedId);
              // Find insert position
              const insertIdx =
                dropIndicator.insertBeforeSessionId === null
                  ? filtered.length
                  : filtered.indexOf(dropIndicator.insertBeforeSessionId);
              filtered.splice(
                insertIdx === -1 ? filtered.length : insertIdx,
                0,
                draggedId,
              );
              onReorderSessions(filtered);
            }
            clearDndState();
          }}
          onClick={() => onSelectSession(session.id)}
          onDoubleClick={() => {
            if (playingSessionId === session.id) {
              onStopPlayback();
            } else if (!isRecording && session.status === "completed") {
              onPlaySession(session.id);
            }
          }}
          onContextMenu={(e) => handleContextMenu(e, session.id)}
          onMouseEnter={(e) => {
            if (!isSelected) {
              e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.03)";
              e.currentTarget.style.borderLeft = "3px solid var(--text-muted)";
            }
          }}
          onMouseLeave={(e) => {
            if (!isSelected) {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.borderLeft = "3px solid transparent";
            }
          }}
          style={{
            padding: "10px 16px 10px 28px",
            cursor: "pointer",
            marginBottom: "2px",
            borderLeft: isSelected
              ? "3px solid var(--accent)"
              : "3px solid transparent",
            backgroundColor: isSelected
              ? "rgba(245, 166, 35, 0.06)"
              : "transparent",
            transition: "background-color 0.15s ease, border-left 0.15s ease",
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
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
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
                      e.currentTarget.style.color = "var(--text-muted)";
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
              <span>{formatDuration(session.duration_seconds)}</span>
              {session.status === "completed" && (
                <button
                  data-testid={`session-play-toggle-${session.id}`}
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
                    color: isPlaying ? "var(--accent)" : "var(--text-muted)",
                    fontSize: "12px",
                    cursor:
                      isRecording && playingSessionId !== session.id
                        ? "not-allowed"
                        : "pointer",
                    padding: "0 2px",
                    opacity:
                      isRecording && playingSessionId !== session.id ? 0.4 : 1,
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
                  {playingSessionId === session.id ? "\u25A0" : "\u25B6"}
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
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
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
      </React.Fragment>
    );
  };

  return (
    <div
      data-testid="history-panel"
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
          data-testid="history-upload-audio"
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

      {/* Download Audio button */}
      <div
        style={{
          padding: "0 16px 8px",
          flexShrink: 0,
        }}
      >
        <button
          data-testid="history-download-audio"
          onClick={onDownloadAudio}
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
            position: "relative",
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
          {/* Download icon */}
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M7 3V10M7 10L4 7M7 10L10 7"
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
          Download Audio
          {/* Badge dot */}
          {downloadBadge && (
            <span
              style={{
                position: "absolute",
                right: "8px",
                top: "50%",
                transform: "translateY(-50%)",
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                backgroundColor:
                  downloadBadge === "active" ? "#f5a623" : "#ff3b30",
              }}
            />
          )}
        </button>
      </div>

      {/* Session list with two-level grouping: category → date */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {categoryGroups.map((catGroup, catIdx) => {
          const isCatCollapsed = collapsedCategories.has(catGroup.category.id);
          return (
            <div key={catGroup.category.id}>
              {/* Category drop indicator (before this category) */}
              {catDropIndicator &&
                catDropIndicator.beforeCategoryId === catGroup.category.id && (
                  <div className="cat-drop-indicator-line" />
                )}
              {/* Category header */}
              <div
                data-testid={`category-header-${catGroup.category.id}`}
                draggable
                onDragStart={(e) => {
                  // Only allow category drag when not already dragging a session
                  if (dragSessionId !== null) {
                    e.preventDefault();
                    return;
                  }
                  setDragCategoryId(catGroup.category.id);
                  e.dataTransfer.setData(
                    "application/x-capty-category",
                    catGroup.category.id,
                  );
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => clearDndState()}
                onClick={() => toggleCategory(catGroup.category.id)}
                onContextMenu={(e) =>
                  handleCategoryContextMenu(
                    e,
                    catGroup.category.id,
                    catGroup.category.label,
                    catGroup.category.isBuiltin,
                  )
                }
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";

                  // Category reorder drag
                  if (dragCategoryId !== null) {
                    if (dragCategoryId === catGroup.category.id) {
                      setCatDropIndicator(null);
                      return;
                    }
                    const rect = e.currentTarget.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    if (e.clientY < midY) {
                      setCatDropIndicator({
                        beforeCategoryId: catGroup.category.id,
                      });
                    } else {
                      // Insert after this category = before the next one
                      const nextCat = categoryGroups[catIdx + 1];
                      setCatDropIndicator({
                        beforeCategoryId: nextCat?.category.id ?? null,
                      });
                    }
                    return;
                  }

                  // Session → category drop
                  if (dragSessionId === null) return;
                  const draggedSession = sessions.find(
                    (s) => s.id === dragSessionId,
                  );
                  const dragFromCat = draggedSession?.category || "recording";
                  if (dragFromCat === catGroup.category.id) return;
                  setDragOverCategoryId(catGroup.category.id);
                }}
                onDragLeave={(e) => {
                  if (
                    dragOverCategoryId === catGroup.category.id &&
                    !e.currentTarget.contains(e.relatedTarget as Node)
                  ) {
                    setDragOverCategoryId(null);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();

                  // Handle category reorder drop
                  const catData = e.dataTransfer.getData(
                    "application/x-capty-category",
                  );
                  if (catData && onReorderCategories) {
                    const ids = categoryGroups.map((g) => g.category.id);
                    const fromIdx = ids.indexOf(catData);
                    if (fromIdx === -1) {
                      clearDndState();
                      return;
                    }
                    const filtered = ids.filter((id) => id !== catData);
                    const targetId = catDropIndicator?.beforeCategoryId;
                    if (targetId === null || targetId === undefined) {
                      filtered.push(catData);
                    } else {
                      const toIdx = filtered.indexOf(targetId);
                      if (toIdx === -1) {
                        filtered.push(catData);
                      } else {
                        filtered.splice(toIdx, 0, catData);
                      }
                    }
                    onReorderCategories(filtered);
                    clearDndState();
                    return;
                  }

                  // Handle session → category drop
                  const raw = e.dataTransfer.getData(
                    "application/x-capty-session",
                  );
                  if (!raw) return;
                  const { id: draggedId, category: fromCat } = JSON.parse(
                    raw,
                  ) as { id: number; category: string };
                  if (fromCat !== catGroup.category.id) {
                    onUpdateCategory?.(draggedId, catGroup.category.id);
                  }
                  clearDndState();
                }}
                onMouseEnter={(e) => {
                  if (dragOverCategoryId !== catGroup.category.id) {
                    e.currentTarget.style.backgroundColor =
                      "rgba(255,255,255,0.03)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (dragOverCategoryId !== catGroup.category.id) {
                    e.currentTarget.style.backgroundColor = "transparent";
                  }
                }}
                className={
                  [
                    dragOverCategoryId === catGroup.category.id
                      ? "category-drop-highlight"
                      : "",
                    dragCategoryId === catGroup.category.id
                      ? "category-header dragging-cat"
                      : "category-header",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                style={{
                  padding: "8px 16px 8px 10px",
                  cursor: "pointer",
                  backgroundColor: "transparent",
                  marginTop: "4px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  userSelect: "none",
                  transition: "background-color 0.15s",
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
                  {isCatCollapsed ? "\u25B6" : "\u25BC"}
                </span>
                <span
                  style={{
                    fontSize: "13px",
                    color: "var(--text-muted)",
                    width: "14px",
                    textAlign: "center",
                    flexShrink: 0,
                  }}
                >
                  {catGroup.category.icon}
                </span>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    flex: 1,
                  }}
                >
                  {catGroup.category.label}
                </span>
                <span
                  style={{
                    fontSize: "10px",
                    color: "var(--text-muted)",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {catGroup.totalCount}
                </span>
              </div>
              {/* Category content */}
              {!isCatCollapsed && (
                <>
                  {catGroup.dateGroups.length === 0 ? (
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (dragSessionId !== null) {
                          setDragOverCategoryId(catGroup.category.id);
                        }
                      }}
                      onDragLeave={() => {
                        if (dragOverCategoryId === catGroup.category.id) {
                          setDragOverCategoryId(null);
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const raw = e.dataTransfer.getData(
                          "application/x-capty-session",
                        );
                        if (!raw) return;
                        const { id: draggedId, category: fromCat } = JSON.parse(
                          raw,
                        ) as {
                          id: number;
                          category: string;
                        };
                        if (fromCat !== catGroup.category.id) {
                          onUpdateCategory?.(draggedId, catGroup.category.id);
                        }
                        clearDndState();
                      }}
                      className={
                        dragOverCategoryId === catGroup.category.id
                          ? "category-drop-highlight"
                          : undefined
                      }
                      style={{
                        padding: "8px 16px 8px 40px",
                        fontSize: "11px",
                        color: "var(--text-muted)",
                        opacity: 0.6,
                        fontStyle: "italic",
                      }}
                    >
                      No sessions
                    </div>
                  ) : (
                    catGroup.dateGroups.map((dateGroup) => {
                      const dateKey = `${catGroup.category.id}:${dateGroup.label}`;
                      const isDateCollapsed = collapsedDateGroups.has(dateKey);
                      return (
                        <div key={dateKey}>
                          {/* Date group header */}
                          <div
                            onClick={() => toggleDateGroup(dateKey)}
                            style={{
                              padding: "6px 16px 6px 20px",
                              cursor: "pointer",
                              backgroundColor: "transparent",
                              borderLeft: "2px solid var(--accent)",
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                              userSelect: "none",
                            }}
                          >
                            <span
                              style={{
                                fontSize: "9px",
                                color: "var(--text-muted)",
                                display: "inline-block",
                                width: "8px",
                                textAlign: "center",
                              }}
                            >
                              {isDateCollapsed ? "\u25B6" : "\u25BC"}
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
                              {dateGroup.label}
                            </span>
                            <span
                              style={{
                                fontSize: "10px",
                                color: "var(--text-muted)",
                                letterSpacing: "0.08em",
                              }}
                            >
                              ({dateGroup.sessions.length})
                            </span>
                          </div>
                          {/* Session items */}
                          {!isDateCollapsed && (
                            <>
                              {dateGroup.sessions.map((s) =>
                                renderSessionRow(s, catGroup.category.id),
                              )}
                              {/* Drop indicator at end of last date group */}
                              {dropIndicator !== null &&
                                dropIndicator.categoryId ===
                                  catGroup.category.id &&
                                dropIndicator.insertBeforeSessionId === null &&
                                dateKey ===
                                  `${catGroup.category.id}:${catGroup.dateGroups[catGroup.dateGroups.length - 1]?.label}` && (
                                  <div className="drop-indicator-line" />
                                )}
                            </>
                          )}
                        </div>
                      );
                    })
                  )}
                </>
              )}
            </div>
          );
        })}
        {/* Trailing drop indicator when dropping category at the end */}
        {catDropIndicator && catDropIndicator.beforeCategoryId === null && (
          <div className="cat-drop-indicator-line" />
        )}
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

        {/* Inline category creation */}
        {isCreatingCategory ? (
          <div
            style={{
              padding: "8px 10px",
              marginTop: "4px",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            {/* Icon picker */}
            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
              {ICON_CHOICES.map((icon) => (
                <button
                  key={icon}
                  onClick={() => setNewCategoryIcon(icon)}
                  style={{
                    width: "28px",
                    height: "28px",
                    border:
                      newCategoryIcon === icon
                        ? "1px solid var(--accent)"
                        : "1px solid var(--border)",
                    borderRadius: "4px",
                    background:
                      newCategoryIcon === icon
                        ? "rgba(245,166,35,0.12)"
                        : "transparent",
                    cursor: "pointer",
                    fontSize: "14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {icon}
                </button>
              ))}
            </div>
            {/* Name input + confirm/cancel */}
            <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
              <span style={{ fontSize: "14px", flexShrink: 0 }}>
                {newCategoryIcon}
              </span>
              <input
                ref={newCategoryInputRef}
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleConfirmCreateCategory();
                  if (e.key === "Escape") handleCancelCreateCategory();
                }}
                placeholder="分类名称"
                style={{
                  flex: 1,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  padding: "4px 8px",
                  fontSize: "12px",
                  color: "var(--text-primary)",
                  outline: "none",
                }}
              />
              <button
                onClick={handleConfirmCreateCategory}
                disabled={!newCategoryName.trim()}
                style={{
                  background: "var(--accent)",
                  border: "none",
                  borderRadius: "4px",
                  color: "#000",
                  padding: "4px 8px",
                  fontSize: "11px",
                  cursor: newCategoryName.trim() ? "pointer" : "not-allowed",
                  opacity: newCategoryName.trim() ? 1 : 0.5,
                }}
              >
                OK
              </button>
              <button
                onClick={handleCancelCreateCategory}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  color: "var(--text-muted)",
                  padding: "4px 8px",
                  fontSize: "11px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          onAddCategory && (
            <button
              onClick={handleStartCreateCategory}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 10px",
                margin: "4px 0",
                width: "100%",
                background: "transparent",
                border: "none",
                color: "var(--text-muted)",
                fontSize: "12px",
                cursor: "pointer",
                textAlign: "left",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.color = "var(--text-primary)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = "var(--text-muted)")
              }
            >
              <span style={{ fontSize: "14px" }}>+</span>
              新增分类
            </button>
          )
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
              const currentCategory = targetSession?.category || "recording";
              return (
                <>
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
                  <div
                    onClick={handleRenameClick}
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
                    Rename
                  </div>
                  {isCompleted && onEditSession && (
                    <div
                      onClick={handleEditInfoClick}
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
                      Edit Info
                    </div>
                  )}
                  {/* Move to... submenu */}
                  {onUpdateCategory && (
                    <>
                      <div
                        style={{
                          height: "1px",
                          backgroundColor: "var(--border)",
                          margin: "4px 0",
                        }}
                      />
                      <div
                        style={{
                          padding: "4px 16px",
                          fontSize: "10px",
                          color: "var(--text-muted)",
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                          userSelect: "none",
                        }}
                      >
                        Move to...
                      </div>
                      {effectiveCategories
                        .filter((cat) => cat.id !== currentCategory)
                        .map((cat) => (
                          <div
                            key={cat.id}
                            onClick={() => handleMoveTo(cat.id)}
                            style={{
                              padding: "6px 16px 6px 24px",
                              fontSize: "13px",
                              cursor: "pointer",
                              color: "var(--text-primary)",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                            }}
                            onMouseEnter={(e) =>
                              (e.currentTarget.style.backgroundColor =
                                "var(--accent-glow)")
                            }
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.backgroundColor =
                                "transparent")
                            }
                          >
                            <span
                              style={{
                                fontSize: "12px",
                                color: "var(--text-muted)",
                                width: "14px",
                                textAlign: "center",
                              }}
                            >
                              {cat.icon}
                            </span>
                            {cat.label}
                          </div>
                        ))}
                      <div
                        style={{
                          height: "1px",
                          backgroundColor: "var(--border)",
                          margin: "4px 0",
                        }}
                      />
                    </>
                  )}
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
                </>
              );
            })()}
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
                {"\u786e\u8ba4\u5220\u9664"}
              </div>
              <div
                style={{
                  fontSize: "13px",
                  color: "var(--text-secondary)",
                  marginBottom: "20px",
                  lineHeight: 1.5,
                }}
              >
                {
                  "\u6b64\u64cd\u4f5c\u5c06\u540c\u65f6\u5220\u9664\u5f55\u97f3\u8bb0\u5f55\u548c\u539f\u59cb\u97f3\u9891\u6587\u4ef6\uff0c\u4e14\u65e0\u6cd5\u6062\u590d\u3002\u786e\u5b9a\u8981\u5220\u9664\u5417\uff1f"
                }
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
                  {"\u53d6\u6d88"}
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
                  {"\u5220\u9664"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Edit Info modal */}
      {editingSessionId !== null &&
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
            onClick={handleEditInfoCancel}
          >
            <div
              style={{
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                backgroundColor: "rgba(28, 28, 31, 0.92)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                padding: "20px 24px",
                maxWidth: "380px",
                width: "100%",
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  fontSize: "15px",
                  fontWeight: 600,
                  marginBottom: "16px",
                  color: "var(--text-primary)",
                }}
              >
                Edit Session Info
              </div>
              {/* Title field */}
              <div style={{ marginBottom: "12px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    color: "var(--text-muted)",
                    marginBottom: "4px",
                  }}
                >
                  Title
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleEditInfoSave();
                  }}
                  autoFocus
                  style={{
                    width: "100%",
                    padding: "6px 10px",
                    fontSize: "13px",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    backgroundColor: "rgba(255,255,255,0.05)",
                    color: "var(--text-primary)",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              {/* Recorded At field */}
              <div style={{ marginBottom: "20px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    color: "var(--text-muted)",
                    marginBottom: "4px",
                  }}
                >
                  Recorded At
                </label>
                <input
                  type="datetime-local"
                  value={editStartedAt}
                  onChange={(e) => setEditStartedAt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleEditInfoSave();
                  }}
                  style={{
                    width: "100%",
                    padding: "6px 10px",
                    fontSize: "13px",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    backgroundColor: "rgba(255,255,255,0.05)",
                    color: "var(--text-primary)",
                    outline: "none",
                    boxSizing: "border-box",
                    colorScheme: "dark",
                  }}
                />
              </div>
              {/* Buttons */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "8px",
                }}
              >
                <button
                  onClick={handleEditInfoCancel}
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
                  Cancel
                </button>
                <button
                  onClick={handleEditInfoSave}
                  disabled={!editTitle.trim()}
                  style={{
                    padding: "6px 16px",
                    fontSize: "13px",
                    borderRadius: "6px",
                    border: "none",
                    backgroundColor: "var(--accent)",
                    color: "#000",
                    cursor: editTitle.trim() ? "pointer" : "not-allowed",
                    opacity: editTitle.trim() ? 1 : 0.5,
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Category context menu (delete custom category) */}
      {catContextMenu.visible &&
        createPortal(
          <div
            ref={catMenuRef}
            style={{
              position: "fixed",
              top: catContextMenu.y,
              left: catContextMenu.x,
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              backgroundColor: "rgba(28, 28, 31, 0.92)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              zIndex: 9000,
              minWidth: "140px",
              padding: "4px 0",
            }}
          >
            <div
              onClick={() => {
                setConfirmDeleteCategoryId(catContextMenu.categoryId);
                setCatContextMenu((prev) => ({ ...prev, visible: false }));
              }}
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
              删除分类
            </div>
          </div>,
          document.body,
        )}

      {/* Confirm delete category dialog */}
      {confirmDeleteCategoryId !== null &&
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
            onClick={() => setConfirmDeleteCategoryId(null)}
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
                删除分类
              </div>
              <div
                style={{
                  fontSize: "13px",
                  color: "var(--text-secondary)",
                  marginBottom: "20px",
                  lineHeight: 1.5,
                }}
              >
                确定删除分类「{confirmDeleteCategoryLabel}
                」吗？该分类下的录音将移至「个人录音」。
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "8px",
                }}
              >
                <button
                  onClick={() => setConfirmDeleteCategoryId(null)}
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
                  onClick={() => {
                    if (confirmDeleteCategoryId && onDeleteCategory) {
                      onDeleteCategory(confirmDeleteCategoryId);
                    }
                    setConfirmDeleteCategoryId(null);
                  }}
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
