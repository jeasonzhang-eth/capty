import React from "react";

interface ControlBarProps {
  readonly isRecording: boolean;
  readonly sidecarReady: boolean;
  readonly devices: readonly MediaDeviceInfo[];
  readonly selectedDeviceId: string | null;
  readonly onDeviceChange: (deviceId: string) => void;
  readonly models: readonly {
    id: string;
    name: string;
    type: string;
    downloaded: boolean;
    size_gb: number;
  }[];
  readonly selectedModelId: string;
  readonly onModelChange: (modelId: string) => void;
  readonly onSettings: () => void;
  readonly isDownloading: boolean;
  readonly downloadProgress: number;
  readonly onDownloadModel: () => void;
}

export function ControlBar({
  isRecording,
  sidecarReady,
  devices,
  selectedDeviceId,
  onDeviceChange,
  models,
  selectedModelId,
  onModelChange,
  onSettings,
  isDownloading,
  downloadProgress,
  onDownloadModel,
}: ControlBarProps): React.ReactElement {
  const selectedModel = models.find((m) => m.id === selectedModelId);
  const needsDownload = selectedModel && !selectedModel.downloaded;
  const statusColor = isRecording
    ? "var(--danger)"
    : sidecarReady
      ? "var(--success)"
      : "var(--text-muted)";
  const statusLabel = isRecording
    ? "Recording"
    : sidecarReady
      ? "Ready"
      : "Offline";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "8px 16px",
        backgroundColor: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border)",
        gap: "16px",
        height: "48px",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ fontWeight: "bold", fontSize: "16px" }}>Capty</span>
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            backgroundColor: statusColor,
            display: "inline-block",
          }}
        />
        <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
          {statusLabel}
        </span>
      </div>

      <div style={{ flex: 1 }} />

      <select
        value={selectedDeviceId ?? ""}
        onChange={(e) => onDeviceChange(e.target.value)}
        disabled={isRecording}
        style={{
          backgroundColor: "var(--bg-tertiary)",
          color: "var(--text-primary)",
          border: "1px solid var(--border)",
          borderRadius: "4px",
          padding: "4px 8px",
          fontSize: "12px",
          maxWidth: "200px",
        }}
      >
        <option value="">Default Microphone</option>
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || d.deviceId}
          </option>
        ))}
      </select>

      <select
        value={selectedModelId}
        onChange={(e) => onModelChange(e.target.value)}
        disabled={isRecording}
        style={{
          backgroundColor: "var(--bg-tertiary)",
          color: "var(--text-primary)",
          border: "1px solid var(--border)",
          borderRadius: "4px",
          padding: "4px 8px",
          fontSize: "12px",
          maxWidth: "200px",
        }}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id} disabled={!m.downloaded}>
            [{m.type === "whisper" ? "Whisper" : "Qwen"}] {m.name}
            {!m.downloaded ? " (not downloaded)" : ""}
          </option>
        ))}
      </select>

      {isDownloading ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "11px",
            color: "var(--text-secondary)",
          }}
        >
          <div
            style={{
              width: "60px",
              height: "4px",
              backgroundColor: "var(--bg-tertiary)",
              borderRadius: "2px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${downloadProgress}%`,
                height: "100%",
                backgroundColor: "var(--accent)",
                transition: "width 0.3s",
              }}
            />
          </div>
          <span>{Math.round(downloadProgress)}%</span>
        </div>
      ) : needsDownload ? (
        <button
          onClick={onDownloadModel}
          disabled={isRecording}
          style={{
            backgroundColor: "var(--accent)",
            color: "white",
            border: "none",
            borderRadius: "4px",
            padding: "4px 10px",
            fontSize: "11px",
            cursor: isRecording ? "not-allowed" : "pointer",
            opacity: isRecording ? 0.5 : 1,
            whiteSpace: "nowrap",
          }}
          title={`Download ${selectedModel.name} (${selectedModel.size_gb}GB)`}
        >
          Download
        </button>
      ) : null}

      <button
        onClick={onSettings}
        style={{
          backgroundColor: "transparent",
          border: "none",
          color: "var(--text-secondary)",
          cursor: "pointer",
          fontSize: "16px",
          padding: "4px 8px",
        }}
        title="Settings"
      >
        &#9881;
      </button>
    </div>
  );
}
