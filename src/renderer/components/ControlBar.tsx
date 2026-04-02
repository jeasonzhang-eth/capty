import React from "react";

interface ControlBarProps {
  readonly isRecording: boolean;
  readonly sidecarReady: boolean;
  readonly activeProviderName: string | null;
  readonly isSidecarActive: boolean;
  readonly devices: readonly MediaDeviceInfo[];
  readonly selectedDeviceId: string | null;
  readonly onDeviceChange: (deviceId: string) => void;
  readonly models: readonly {
    id: string;
    name: string;
    type: string;
    downloaded: boolean;
    supported?: boolean;
    size_gb: number;
  }[];
  readonly selectedModelId: string;
  readonly onModelChange: (modelId: string) => void;
  readonly onSettings: () => void;
  readonly isDownloading: boolean;
  readonly downloadProgress: number;
  readonly onDownloadModel: () => void;
  readonly ttsProviderReady: boolean;
  readonly ttsProviderName: string | null;
  readonly onStartSidecar?: () => void;
  readonly onStopSidecar?: () => void;
  readonly sidecarStarting?: boolean;
}

export function ControlBar({
  isRecording,
  sidecarReady,
  activeProviderName,
  isSidecarActive,
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
  ttsProviderReady,
  ttsProviderName,
  onStartSidecar,
  onStopSidecar,
  sidecarStarting,
}: ControlBarProps): React.ReactElement {
  const selectedModel = models.find((m) => m.id === selectedModelId);
  const needsDownload = selectedModel && !selectedModel.downloaded;

  let statusColor: string;
  let statusLabel: string;
  let statusGlow: string;
  let statusAnimation: string | undefined;

  if (isRecording) {
    statusColor = "var(--danger)";
    statusLabel = "Recording";
    statusGlow = "0 0 6px rgba(239, 68, 68, 0.6)";
    statusAnimation = "breathe 1.5s ease-in-out infinite";
  } else if (!activeProviderName) {
    statusColor = "var(--text-muted)";
    statusLabel = "No Provider";
    statusGlow = "none";
    statusAnimation = undefined;
  } else if (isSidecarActive) {
    if (sidecarReady) {
      statusColor = "var(--accent)";
      statusLabel = "Ready";
      statusGlow = "0 0 6px rgba(245, 166, 35, 0.5)";
      statusAnimation = undefined;
    } else {
      statusColor = "var(--text-muted)";
      statusLabel = "Offline";
      statusGlow = "none";
      statusAnimation = undefined;
    }
  } else {
    statusColor = "#3b82f6";
    statusLabel = activeProviderName;
    statusGlow = "0 0 6px rgba(59, 130, 246, 0.5)";
    statusAnimation = undefined;
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "8px 16px",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        backgroundColor: "rgba(28, 28, 31, 0.85)",
        borderBottom: "1px solid var(--border)",
        gap: "16px",
        height: "48px",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontWeight: 700,
            fontSize: "16px",
            color: "var(--text-primary)",
          }}
        >
          Capty
        </span>
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            backgroundColor: statusColor,
            display: "inline-block",
            boxShadow: statusGlow,
            animation: statusAnimation,
          }}
          title={`ASR: ${activeProviderName ?? "None"} - ${statusLabel}`}
        />
        <span
          style={{ fontSize: "11px", color: "var(--text-muted)" }}
          title={`ASR: ${activeProviderName ?? "None"} - ${statusLabel}`}
        >
          ASR
        </span>
        {isSidecarActive &&
          !isRecording &&
          (sidecarStarting ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "14px",
                height: "14px",
                fontSize: "11px",
                color: "var(--text-muted)",
                animation: "spin 1s linear infinite",
              }}
              title="Starting sidecar..."
            >
              &#8635;
            </span>
          ) : sidecarReady ? (
            <button
              onClick={onStopSidecar}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "14px",
                height: "14px",
                padding: 0,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "var(--text-muted)",
                fontSize: "10px",
                lineHeight: 1,
                borderRadius: "2px",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--danger)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-muted)";
              }}
              title="Stop sidecar"
            >
              &#9632;
            </button>
          ) : (
            <button
              onClick={onStartSidecar}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "14px",
                height: "14px",
                padding: 0,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "var(--text-muted)",
                fontSize: "10px",
                lineHeight: 1,
                borderRadius: "2px",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#4ADE80";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-muted)";
              }}
              title="Start sidecar"
            >
              &#9654;
            </button>
          ))}
        {ttsProviderName && (
          <>
            <span
              style={{
                width: "1px",
                height: "14px",
                backgroundColor: "var(--border)",
                margin: "0 2px",
              }}
            />
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                backgroundColor: ttsProviderReady
                  ? "#4ADE80"
                  : "var(--text-muted)",
                display: "inline-block",
                boxShadow: ttsProviderReady
                  ? "0 0 4px rgba(74, 222, 128, 0.5)"
                  : "none",
              }}
              title={`TTS: ${ttsProviderName} - ${ttsProviderReady ? "Ready" : "Offline"}`}
            />
            <span
              style={{
                fontSize: "11px",
                color: "var(--text-muted)",
              }}
              title={`TTS: ${ttsProviderName} - ${ttsProviderReady ? "Ready" : "Offline"}`}
            >
              TTS
            </span>
          </>
        )}
      </div>

      <div style={{ flex: 1 }} />

      <select
        value={selectedDeviceId ?? ""}
        onChange={(e) => onDeviceChange(e.target.value)}
        disabled={isRecording}
        style={{
          backgroundColor: "var(--bg-surface)",
          color: "var(--text-primary)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          padding: "4px 8px",
          fontSize: "12px",
          maxWidth: "200px",
          outline: "none",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "var(--accent)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "var(--border)";
        }}
      >
        <option value="">Default Microphone</option>
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || d.deviceId}
          </option>
        ))}
      </select>

      {isSidecarActive && (
        <>
          <select
            value={selectedModelId}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={isRecording}
            style={{
              backgroundColor: "var(--bg-surface)",
              color: "var(--text-primary)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              padding: "4px 8px",
              fontSize: "12px",
              maxWidth: "200px",
              outline: "none",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "var(--accent)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "var(--border)";
            }}
          >
            {models.filter((m) => m.downloaded && m.supported !== false)
              .length === 0 && (
              <option value="" disabled>
                No models
              </option>
            )}
            {models
              .filter((m) => m.downloaded && m.supported !== false)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
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
                    background:
                      "linear-gradient(90deg, var(--accent), var(--accent-hover))",
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
                borderRadius: "6px",
                padding: "4px 10px",
                fontSize: "11px",
                cursor: isRecording ? "not-allowed" : "pointer",
                opacity: isRecording ? 0.5 : 1,
                whiteSpace: "nowrap",
              }}
              title={`Download ${selectedModel!.name} (${selectedModel!.size_gb}GB)`}
            >
              Download
            </button>
          ) : null}
        </>
      )}

      <button
        onClick={onSettings}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--text-primary)";
          e.currentTarget.style.textShadow = "0 0 8px rgba(245, 166, 35, 0.4)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--text-muted)";
          e.currentTarget.style.textShadow = "none";
        }}
        style={{
          backgroundColor: "transparent",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: "18px",
          padding: "4px 8px",
          transition: "color 0.2s, text-shadow 0.2s",
        }}
        title="Settings"
      >
        &#9881;
      </button>
    </div>
  );
}
