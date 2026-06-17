import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

export interface ImportRecord {
  readonly id: number;
  readonly file: string;
  readonly status: "pending" | "converting" | "done" | "failed";
  readonly error?: string;
  readonly sessionId?: number;
  readonly createdAt: string;
}

interface ImportManagerDialogProps {
  readonly records: readonly ImportRecord[];
  readonly isImporting: boolean;
  readonly onUpload: () => void;
  readonly onDropFiles: (files: File[]) => void;
  readonly onSelectSession: (sessionId: number) => void;
  readonly onClose: () => void;
  // Staging: when non-empty (>=2), show the reorder+merge view instead of the dropzone.
  readonly stagingPaths?: readonly string[];
  readonly onConfirmMerge?: (orderedPaths: string[], title: string) => void;
  readonly onConfirmSeparate?: (orderedPaths: string[]) => void;
  readonly onCancelStaging?: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ImportRecordRow({
  record,
  onSelectSession,
}: {
  readonly record: ImportRecord;
  readonly onSelectSession: (sessionId: number) => void;
}): React.ReactElement {
  const borderColor =
    record.status === "done"
      ? "#4cd964"
      : record.status === "failed"
        ? "#ff6b6b"
        : "var(--accent)";
  const clickable = record.status === "done" && record.sessionId !== undefined;

  return (
    <div
      style={{
        padding: "12px",
        backgroundColor: "var(--bg-secondary, #1c1c1f)",
        borderRadius: "8px",
        borderLeft: `3px solid ${borderColor}`,
        marginBottom: "8px",
        cursor: clickable ? "pointer" : "default",
      }}
      onClick={clickable ? () => onSelectSession(record.sessionId!) : undefined}
    >
      {/* Title row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "4px",
          gap: "8px",
        }}
      >
        <span
          style={{
            fontWeight: 500,
            fontSize: "13px",
            color: "var(--text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
          title={record.file}
        >
          {record.file}
        </span>
        {record.status === "done" && (
          <span style={{ color: "#4cd964", fontSize: "12px", flexShrink: 0 }}>
            ✓
          </span>
        )}
      </div>

      {/* Status line */}
      {record.status === "pending" && (
        <div style={{ color: "var(--text-muted)", fontSize: "11px" }}>
          Waiting...
        </div>
      )}
      {record.status === "converting" && (
        <div style={{ color: "var(--accent)", fontSize: "11px" }}>
          Converting to WAV...
        </div>
      )}
      {record.status === "done" && (
        <div style={{ color: "var(--text-muted)", fontSize: "11px" }}>
          {formatDate(record.createdAt)}
        </div>
      )}
      {record.status === "failed" && (
        <div
          style={{
            color: "#ff6b6b",
            fontSize: "11px",
            wordBreak: "break-word",
            whiteSpace: "pre-wrap",
          }}
        >
          {record.error || "Unknown error"}
        </div>
      )}
    </div>
  );
}

export function ImportManagerDialog({
  records,
  isImporting,
  onUpload,
  onDropFiles,
  onSelectSession,
  onClose,
  stagingPaths,
  onConfirmMerge,
  onConfirmSeparate,
  onCancelStaging,
}: ImportManagerDialogProps): React.ReactElement {
  const [isDragOver, setIsDragOver] = useState(false);

  // Close on ESC
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const [order, setOrder] = useState<string[]>([]);
  const [mergeTitle, setMergeTitle] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const staging = (stagingPaths?.length ?? 0) >= 2;

  useEffect(() => {
    if (staging) {
      const sorted = [...(stagingPaths as string[])];
      setOrder(sorted);
      const first = sorted[0].split(/[/\\]/).pop() ?? "";
      setMergeTitle(first.replace(/\.[^.]+$/, ""));
    }
  }, [staging, stagingPaths]);

  const baseName = (p: string): string => p.split(/[/\\]/).pop() ?? p;

  function moveItem(from: number, to: number): void {
    setOrder((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function removeItem(i: number): void {
    const next = order.filter((_, idx) => idx !== i);
    // Removing the last item leaves nothing to import — exit the staging view.
    if (next.length === 0) {
      onCancelStaging?.();
      return;
    }
    setOrder(next);
  }

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isImporting) setIsDragOver(true);
    },
    [isImporting],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      if (isImporting) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onDropFiles(files);
    },
    [isImporting, onDropFiles],
  );

  const dropBorder = isDragOver
    ? "2px dashed var(--accent)"
    : "2px dashed var(--border)";

  return createPortal(
    <div
      data-testid="import-manager-overlay"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
      }}
      onClick={onClose}
    >
      <div
        data-testid="import-manager-dialog"
        style={{
          width: "560px",
          maxHeight: "75vh",
          display: "flex",
          flexDirection: "column",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          backgroundColor: "rgba(28, 28, 31, 0.95)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 20px",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontWeight: 600,
              fontSize: "15px",
              color: "var(--text-primary)",
            }}
          >
            Upload Audio
          </span>
          <button
            data-testid="import-manager-close"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: "18px",
              padding: "0 4px",
            }}
          >
            ✕
          </button>
        </div>

        {staging && (
          <div
            data-testid="merge-staging"
            style={{
              padding: "0 20px 16px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
              拖拽调整顺序、✕ 移除不需要的段，合并为一个 session（共{" "}
              {order.length} 段）
            </div>

            <div
              style={{ display: "flex", flexDirection: "column", gap: "6px" }}
            >
              {order.map((p, i) => (
                <div
                  key={p}
                  data-testid={`merge-item-${i}`}
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIdx !== null && dragIdx !== i) moveItem(dragIdx, i);
                    setDragIdx(null);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px 10px",
                    backgroundColor: "var(--bg-secondary, #1c1c1f)",
                    borderRadius: "8px",
                    cursor: "grab",
                  }}
                >
                  <span
                    style={{
                      color: "var(--text-muted)",
                      fontSize: "12px",
                      width: "18px",
                    }}
                  >
                    {i + 1}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      fontSize: "13px",
                      color: "var(--text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={baseName(p)}
                  >
                    {baseName(p)}
                  </span>
                  <button
                    onClick={() => moveItem(i, i - 1)}
                    disabled={i === 0}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--text-muted)",
                      cursor: i === 0 ? "default" : "pointer",
                    }}
                    title="上移"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveItem(i, i + 1)}
                    disabled={i === order.length - 1}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--text-muted)",
                      cursor: i === order.length - 1 ? "default" : "pointer",
                    }}
                    title="下移"
                  >
                    ↓
                  </button>
                  <button
                    data-testid={`merge-remove-${i}`}
                    onClick={() => removeItem(i)}
                    disabled={isImporting}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--text-muted)",
                      cursor: isImporting ? "default" : "pointer",
                      fontSize: "14px",
                    }}
                    title="移除"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <input
              data-testid="merge-title"
              value={mergeTitle}
              onChange={(e) => setMergeTitle(e.target.value)}
              placeholder="合并后的 session 名称"
              style={{
                fontSize: "13px",
                padding: "8px 10px",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                backgroundColor: "var(--bg-primary)",
                color: "var(--text-primary)",
                outline: "none",
              }}
            />

            <div
              style={{
                display: "flex",
                gap: "8px",
                justifyContent: "flex-end",
              }}
            >
              <button
                data-testid="merge-cancel"
                onClick={() => onCancelStaging?.()}
                disabled={isImporting}
                style={{
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  background: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                取消
              </button>
              <button
                data-testid="merge-separate"
                onClick={() => onConfirmSeparate?.([...order])}
                disabled={isImporting}
                style={{
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  background: "none",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                }}
              >
                分别导入
              </button>
              <button
                data-testid="merge-confirm"
                onClick={() => onConfirmMerge?.([...order], mergeTitle.trim())}
                disabled={isImporting || order.length < 2}
                style={{
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: "none",
                  background: "var(--accent)",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                合并为一个 session
              </button>
            </div>
          </div>
        )}

        {!staging && (
          <>
            {/* Drop zone */}
            <div
              data-testid="import-manager-dropzone"
              onClick={isImporting ? undefined : onUpload}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              style={{
                margin: "0 20px 16px",
                minHeight: records.length > 0 ? "140px" : "240px",
                border: dropBorder,
                borderRadius: "12px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "10px",
                cursor: isImporting ? "default" : "pointer",
                backgroundColor: isDragOver
                  ? "rgba(139,139,240,0.08)"
                  : "transparent",
                transition: "background-color 0.15s, border-color 0.15s",
                flexShrink: 0,
              }}
            >
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke={isDragOver ? "var(--accent)" : "var(--text-muted)"}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 500,
                  color: isDragOver ? "var(--accent)" : "var(--text-primary)",
                }}
              >
                {isImporting
                  ? "Importing..."
                  : isDragOver
                    ? "Release to import"
                    : "Drag audio files here"}
              </div>
              {!isImporting && !isDragOver && (
                <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  or click to browse (multi-select supported)
                </div>
              )}
            </div>

            {/* Records list */}
            {records.length > 0 && (
              <div
                data-testid="import-manager-list"
                style={{
                  overflowY: "auto",
                  padding: "0 20px 16px",
                  flex: 1,
                }}
              >
                {records.map((record) => (
                  <ImportRecordRow
                    key={record.id}
                    record={record}
                    onSelectSession={onSelectSession}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
