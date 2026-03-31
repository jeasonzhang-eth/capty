import React, { useState, useCallback } from "react";
import { createPortal } from "react-dom";

export interface DownloadItem {
  readonly id: number;
  readonly url: string;
  readonly title: string | null;
  readonly source: string | null;
  readonly status: string;
  readonly progress: number;
  readonly speed: string | null;
  readonly eta: string | null;
  readonly session_id: number | null;
  readonly error: string | null;
  readonly created_at: string;
  readonly completed_at: string | null;
}

interface DownloadManagerDialogProps {
  readonly downloads: readonly DownloadItem[];
  readonly onStartDownload: (url: string) => void;
  readonly onCancelDownload: (id: number) => void;
  readonly onRetryDownload: (id: number) => void;
  readonly onRemoveDownload: (id: number) => void;
  readonly onSelectSession: (sessionId: number) => void;
  readonly onClose: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "#5ac8fa",
  "fetching-info": "#5ac8fa",
  downloading: "#f5a623",
  converting: "#f5a623",
  completed: "#4cd964",
  failed: "#ff3b30",
  cancelled: "#888",
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DownloadManagerDialog({
  downloads,
  onStartDownload,
  onCancelDownload,
  onRetryDownload,
  onRemoveDownload,
  onSelectSession,
  onClose,
}: DownloadManagerDialogProps): React.ReactElement {
  const [url, setUrl] = useState("");

  const handleSubmit = useCallback(() => {
    const trimmed = url.trim();
    if (!trimmed) return;
    onStartDownload(trimmed);
    setUrl("");
  }, [url, onStartDownload]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleSubmit();
    },
    [handleSubmit],
  );

  // Sort: active downloads first, then by created_at DESC
  const sorted = [...downloads].sort((a, b) => {
    const activeStatuses = [
      "pending",
      "fetching-info",
      "downloading",
      "converting",
    ];
    const aActive = activeStatuses.includes(a.status) ? 0 : 1;
    const bActive = activeStatuses.includes(b.status) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return b.created_at.localeCompare(a.created_at);
  });

  return createPortal(
    <div
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
        style={{
          width: "520px",
          maxHeight: "70vh",
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
            borderBottom: "1px solid var(--border)",
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
            Download Audio
          </span>
          <button
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

        {/* URL Input */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Paste YouTube or Bilibili URL..."
            style={{
              flex: 1,
              padding: "8px 12px",
              backgroundColor: "var(--bg-secondary, #1c1c1f)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              color: "var(--text-primary)",
              fontSize: "13px",
              outline: "none",
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={!url.trim()}
            style={{
              padding: "8px 16px",
              backgroundColor: url.trim() ? "#f5a623" : "var(--border)",
              color: url.trim() ? "#000" : "var(--text-muted)",
              border: "none",
              borderRadius: "8px",
              fontWeight: 600,
              fontSize: "13px",
              cursor: url.trim() ? "pointer" : "default",
              whiteSpace: "nowrap",
            }}
          >
            Download
          </button>
        </div>

        {/* Download List */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "12px 20px",
          }}
        >
          {sorted.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "32px",
                color: "var(--text-muted)",
              }}
            >
              <div style={{ fontSize: "24px", marginBottom: "8px" }}>↓</div>
              <div>No download history</div>
            </div>
          ) : (
            sorted.map((dl) => (
              <DownloadItemRow
                key={dl.id}
                item={dl}
                onCancel={() => onCancelDownload(dl.id)}
                onRetry={() => onRetryDownload(dl.id)}
                onRemove={() => onRemoveDownload(dl.id)}
                onSelectSession={
                  dl.session_id
                    ? () => onSelectSession(dl.session_id!)
                    : undefined
                }
              />
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function DownloadItemRow({
  item,
  onCancel,
  onRetry,
  onRemove,
  onSelectSession,
}: {
  readonly item: DownloadItem;
  readonly onCancel: () => void;
  readonly onRetry: () => void;
  readonly onRemove: () => void;
  readonly onSelectSession?: () => void;
}): React.ReactElement {
  const borderColor = STATUS_COLORS[item.status] || "#888";
  const displayName = item.title || item.url;
  const isActive = [
    "pending",
    "fetching-info",
    "downloading",
    "converting",
  ].includes(item.status);

  return (
    <div
      style={{
        padding: "12px",
        backgroundColor: "var(--bg-secondary, #1c1c1f)",
        borderRadius: "8px",
        borderLeft: `3px solid ${borderColor}`,
        marginBottom: "8px",
        cursor:
          item.status === "completed" && onSelectSession
            ? "pointer"
            : "default",
      }}
      onClick={
        item.status === "completed" && onSelectSession
          ? onSelectSession
          : undefined
      }
    >
      {/* Title row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "4px",
        }}
      >
        <span
          style={{
            fontWeight: 500,
            fontSize: "13px",
            color: "var(--text-primary)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginRight: "8px",
          }}
        >
          {displayName}
        </span>

        {/* Status / Actions */}
        {item.status === "completed" && (
          <span style={{ color: "#4cd964", fontSize: "12px", flexShrink: 0 }}>
            ✓
          </span>
        )}
        {isActive && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            style={{
              background: "none",
              border: "none",
              color: "#5ac8fa",
              fontSize: "11px",
              cursor: "pointer",
              padding: 0,
              flexShrink: 0,
            }}
          >
            Cancel
          </button>
        )}
      </div>

      {/* Fetching info state */}
      {(item.status === "pending" || item.status === "fetching-info") && (
        <div style={{ color: "var(--text-muted)", fontSize: "11px" }}>
          Fetching video info...
        </div>
      )}

      {/* Downloading progress */}
      {item.status === "downloading" && (
        <>
          {item.source && (
            <div
              style={{
                color: "var(--text-muted)",
                fontSize: "11px",
                marginBottom: "6px",
              }}
            >
              {item.source}
            </div>
          )}
          <div
            style={{
              background: "var(--border)",
              borderRadius: "4px",
              height: "6px",
              marginBottom: "6px",
            }}
          >
            <div
              style={{
                background: "linear-gradient(90deg, #f5a623, #f7c948)",
                borderRadius: "4px",
                height: "6px",
                width: `${item.progress}%`,
                transition: "width 0.3s",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              color: "var(--text-muted)",
              fontSize: "11px",
            }}
          >
            <span>{item.progress.toFixed(1)}%</span>
            {item.speed && <span>{item.speed}</span>}
            {item.eta && <span>ETA {item.eta}</span>}
          </div>
        </>
      )}

      {/* Converting state */}
      {item.status === "converting" && (
        <div style={{ color: "var(--text-muted)", fontSize: "11px" }}>
          Converting to WAV...
        </div>
      )}

      {/* Completed info */}
      {item.status === "completed" && (
        <div style={{ color: "var(--text-muted)", fontSize: "11px" }}>
          {item.source && `${item.source} · `}
          {item.completed_at && formatDate(item.completed_at)}
        </div>
      )}

      {/* Failed state */}
      {item.status === "failed" && (
        <>
          <div
            style={{
              color: "#ff6b6b",
              fontSize: "11px",
              marginBottom: "6px",
              wordBreak: "break-word",
            }}
          >
            {item.error || "Unknown error"}
          </div>
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRetry();
              }}
              style={{
                background: "none",
                border: "none",
                color: "#5ac8fa",
                fontSize: "11px",
                cursor: "pointer",
                padding: 0,
              }}
            >
              ↻ Retry
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                fontSize: "11px",
                cursor: "pointer",
                padding: 0,
              }}
            >
              ✕ Remove
            </button>
          </div>
        </>
      )}

      {/* Cancelled state */}
      {item.status === "cancelled" && (
        <>
          <div
            style={{
              color: "var(--text-muted)",
              fontSize: "11px",
              marginBottom: "6px",
            }}
          >
            Cancelled
          </div>
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRetry();
              }}
              style={{
                background: "none",
                border: "none",
                color: "#5ac8fa",
                fontSize: "11px",
                cursor: "pointer",
                padding: 0,
              }}
            >
              ↻ Retry
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                fontSize: "11px",
                cursor: "pointer",
                padding: 0,
              }}
            >
              ✕ Remove
            </button>
          </div>
        </>
      )}
    </div>
  );
}
