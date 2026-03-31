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

interface PlatformInfo {
  readonly label: string;
  readonly color: string;
  readonly bg: string;
}

const PLATFORM_MAP: readonly { pattern: RegExp; info: PlatformInfo }[] = [
  {
    pattern: /youtu\.?be/i,
    info: { label: "YouTube", color: "#ff0000", bg: "rgba(255,0,0,0.12)" },
  },
  {
    pattern: /bilibili\.com|b23\.tv/i,
    info: { label: "Bilibili", color: "#00a1d6", bg: "rgba(0,161,214,0.12)" },
  },
  {
    pattern: /twitter\.com|x\.com/i,
    info: { label: "X", color: "#a0a0a0", bg: "rgba(160,160,160,0.12)" },
  },
  {
    pattern: /tiktok\.com|douyin\.com/i,
    info: { label: "TikTok", color: "#ee1d52", bg: "rgba(238,29,82,0.12)" },
  },
  {
    pattern: /soundcloud\.com/i,
    info: { label: "SoundCloud", color: "#ff5500", bg: "rgba(255,85,0,0.12)" },
  },
  {
    pattern: /instagram\.com/i,
    info: { label: "Instagram", color: "#c13584", bg: "rgba(193,53,132,0.12)" },
  },
  {
    pattern: /facebook\.com|fb\.watch/i,
    info: { label: "Facebook", color: "#1877f2", bg: "rgba(24,119,242,0.12)" },
  },
  {
    pattern: /vimeo\.com/i,
    info: { label: "Vimeo", color: "#1ab7ea", bg: "rgba(26,183,234,0.12)" },
  },
  {
    pattern: /twitch\.tv/i,
    info: { label: "Twitch", color: "#9146ff", bg: "rgba(145,70,255,0.12)" },
  },
  {
    pattern: /reddit\.com/i,
    info: { label: "Reddit", color: "#ff4500", bg: "rgba(255,69,0,0.12)" },
  },
  {
    pattern: /spotify\.com/i,
    info: { label: "Spotify", color: "#1db954", bg: "rgba(29,185,84,0.12)" },
  },
  {
    pattern: /bandcamp\.com/i,
    info: { label: "Bandcamp", color: "#629aa9", bg: "rgba(98,154,169,0.12)" },
  },
  {
    pattern: /dailymotion\.com/i,
    info: {
      label: "Dailymotion",
      color: "#00d2f3",
      bg: "rgba(0,210,243,0.12)",
    },
  },
  {
    pattern: /podcasts\.apple\.com/i,
    info: {
      label: "Apple Podcasts",
      color: "#9933cc",
      bg: "rgba(153,51,204,0.12)",
    },
  },
  {
    pattern: /music\.163\.com/i,
    info: { label: "NetEase", color: "#c20c0c", bg: "rgba(194,12,12,0.12)" },
  },
  {
    pattern: /qq\.com/i,
    info: { label: "QQ", color: "#12b7f5", bg: "rgba(18,183,245,0.12)" },
  },
  {
    pattern: /xiaoyuzhoufm\.com/i,
    info: {
      label: "小宇宙",
      color: "#ee6723",
      bg: "rgba(238,103,35,0.12)",
    },
  },
];

const FALLBACK_PLATFORM: PlatformInfo = {
  label: "Web",
  color: "#888",
  bg: "rgba(136,136,136,0.12)",
};

function getPlatform(url: string): PlatformInfo {
  for (const { pattern, info } of PLATFORM_MAP) {
    if (pattern.test(url)) return info;
  }
  return FALLBACK_PLATFORM;
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
            placeholder="Paste URL (YouTube, Bilibili, 小宇宙, TikTok, ...)"
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
  const platform = getPlatform(item.url);
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
            display: "flex",
            alignItems: "center",
            gap: "6px",
            flex: 1,
            overflow: "hidden",
            marginRight: "8px",
          }}
        >
          <span
            style={{
              fontSize: "10px",
              fontWeight: 600,
              padding: "1px 6px",
              borderRadius: "3px",
              backgroundColor: platform.bg,
              color: platform.color,
              flexShrink: 0,
              lineHeight: "16px",
            }}
          >
            {platform.label}
          </span>
          <span
            style={{
              fontWeight: 500,
              fontSize: "13px",
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {displayName}
          </span>
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

      {/* Source URL — always visible, clickable to open in browser */}
      <div
        style={{
          fontSize: "11px",
          marginBottom: "6px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            window.open(item.url, "_blank");
          }}
          style={{
            color: "#5ac8fa",
            textDecoration: "none",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.textDecoration =
              "underline";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.textDecoration =
              "none";
          }}
        >
          ↗ {item.url}
        </a>
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
          {formatDate(item.completed_at || item.created_at)}
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
