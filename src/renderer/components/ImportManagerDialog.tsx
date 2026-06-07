import React from "react";
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
  readonly onSelectSession: (sessionId: number) => void;
  readonly onClose: () => void;
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
      onClick={
        clickable ? () => onSelectSession(record.sessionId!) : undefined
      }
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
  onSelectSession,
  onClose,
}: ImportManagerDialogProps): React.ReactElement {
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

        {/* Upload button */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <button
            data-testid="import-manager-upload"
            onClick={onUpload}
            disabled={isImporting}
            style={{
              width: "100%",
              padding: "10px 0",
              backgroundColor: isImporting
                ? "var(--bg-secondary, #1c1c1f)"
                : "var(--accent)",
              border: "none",
              borderRadius: "8px",
              color: isImporting ? "var(--text-muted)" : "#fff",
              fontSize: "13px",
              fontWeight: 600,
              cursor: isImporting ? "default" : "pointer",
            }}
          >
            {isImporting
              ? "Importing..."
              : "⬆ Upload Audio Files (multi-select supported)"}
          </button>
        </div>

        {/* Records list */}
        <div
          data-testid="import-manager-list"
          style={{ overflowY: "auto", padding: "16px 20px", flex: 1 }}
        >
          {records.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                color: "var(--text-muted)",
                fontSize: "12px",
                padding: "24px 0",
              }}
            >
              No uploads yet. Click the button above to import audio files.
            </div>
          ) : (
            records.map((record) => (
              <ImportRecordRow
                key={record.id}
                record={record}
                onSelectSession={onSelectSession}
              />
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
