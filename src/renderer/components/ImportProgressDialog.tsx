import React from "react";

export interface ImportItem {
  readonly file: string;
  readonly status: "pending" | "converting" | "done" | "failed";
  readonly error?: string;
}

interface ImportProgressDialogProps {
  readonly items: readonly ImportItem[];
  readonly finished: boolean;
  readonly onClose: () => void;
}

const STATUS_META: Record<
  ImportItem["status"],
  { icon: string; color: string; label: string }
> = {
  pending: { icon: "○", color: "var(--text-muted)", label: "Waiting" },
  converting: { icon: "◌", color: "var(--accent)", label: "Converting…" },
  done: { icon: "✓", color: "#4ade80", label: "Imported" },
  failed: { icon: "✕", color: "#f87171", label: "Failed" },
};

export function ImportProgressDialog({
  items,
  finished,
  onClose,
}: ImportProgressDialogProps): React.ReactElement {
  const completed = items.filter(
    (i) => i.status === "done" || i.status === "failed",
  ).length;
  const failedCount = items.filter((i) => i.status === "failed").length;
  const percent = items.length ? Math.round((completed / items.length) * 100) : 0;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 5000,
      }}
      onClick={(e) => {
        // Only allow dismissing via overlay once the batch has finished
        if (finished && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "480px",
          maxWidth: "90vw",
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-secondary, #1c1c1f)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          boxShadow: "0 12px 48px rgba(0,0,0,0.5)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px 12px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "10px",
            }}
          >
            <span
              style={{
                fontSize: "15px",
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              {finished
                ? failedCount > 0
                  ? `Import finished — ${failedCount} failed`
                  : "Import finished"
                : `Importing audio… (${completed}/${items.length})`}
            </span>
            {finished && (
              <button
                onClick={onClose}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-muted)",
                  fontSize: "16px",
                  cursor: "pointer",
                  padding: "2px 6px",
                }}
                title="Close"
              >
                ✕
              </button>
            )}
          </div>

          {/* Overall progress bar */}
          <div
            style={{
              height: "6px",
              borderRadius: "3px",
              background: "var(--bg-primary, rgba(255,255,255,0.06))",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${percent}%`,
                height: "100%",
                borderRadius: "3px",
                background:
                  finished && failedCount > 0 ? "#f87171" : "var(--accent)",
                transition: "width 0.25s ease",
              }}
            />
          </div>
        </div>

        {/* File list */}
        <div style={{ overflowY: "auto", padding: "8px 0" }}>
          {items.map((item, idx) => {
            const meta = STATUS_META[item.status];
            return (
              <div
                key={`${idx}-${item.file}`}
                style={{ padding: "8px 20px" }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                  }}
                >
                  <span
                    style={{
                      color: meta.color,
                      fontSize: "13px",
                      width: "16px",
                      flexShrink: 0,
                      textAlign: "center",
                    }}
                  >
                    {meta.icon}
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
                    title={item.file}
                  >
                    {item.file}
                  </span>
                  <span
                    style={{
                      fontSize: "12px",
                      color: meta.color,
                      flexShrink: 0,
                    }}
                  >
                    {meta.label}
                  </span>
                </div>
                {item.status === "failed" && item.error && (
                  <div
                    style={{
                      marginTop: "4px",
                      marginLeft: "26px",
                      fontSize: "12px",
                      lineHeight: 1.4,
                      color: "#f87171",
                      fontFamily: "'JetBrains Mono', monospace",
                      wordBreak: "break-word",
                    }}
                  >
                    {item.error}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        {finished && (
          <div
            style={{
              padding: "12px 20px",
              borderTop: "1px solid var(--border)",
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <button
              onClick={onClose}
              style={{
                background: "var(--accent)",
                border: "none",
                borderRadius: "6px",
                padding: "6px 18px",
                fontSize: "13px",
                fontWeight: 600,
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
