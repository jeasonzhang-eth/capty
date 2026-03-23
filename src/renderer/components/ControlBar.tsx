import React from "react";

interface ControlBarProps {
  readonly isRecording: boolean;
  readonly sidecarReady: boolean;
  readonly devices: readonly MediaDeviceInfo[];
  readonly selectedDeviceId: string | null;
  readonly onDeviceChange: (deviceId: string) => void;
  readonly models: readonly { id: string; name: string; downloaded: boolean }[];
  readonly selectedModelId: string;
  readonly onModelChange: (modelId: string) => void;
  readonly onSettings: () => void;
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
}: ControlBarProps): React.ReactElement {
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
            {m.name}
            {!m.downloaded ? " (not downloaded)" : ""}
          </option>
        ))}
      </select>

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
