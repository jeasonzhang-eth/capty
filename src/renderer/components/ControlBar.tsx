import React, { useState, useEffect, useRef } from "react";

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
  readonly sidecarPort?: number;
}

function SidecarPopover({
  sidecarReady,
  sidecarStarting,
  ttsProviderReady,
  ttsProviderName,
  sidecarPort,
  onStartSidecar,
  onStopSidecar,
  onClose,
}: {
  readonly sidecarReady: boolean;
  readonly sidecarStarting?: boolean;
  readonly ttsProviderReady: boolean;
  readonly ttsProviderName: string | null;
  readonly sidecarPort?: number;
  readonly onStartSidecar?: () => void;
  readonly onStopSidecar?: () => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const isRunning = sidecarReady && !sidecarStarting;
  const toggleOn = sidecarReady || (sidecarStarting ?? false);

  const handleToggle = (): void => {
    if (sidecarStarting) return;
    if (isRunning) {
      onStopSidecar?.();
    } else {
      onStartSidecar?.();
    }
  };

  return (
    <div
      ref={popoverRef}
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        zIndex: 100,
        backgroundColor: "rgba(38, 38, 42, 0.98)",
        border: "1px solid var(--border)",
        borderRadius: "10px",
        padding: "14px 16px",
        minWidth: "220px",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      {/* Header + Toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "12px",
        }}
      >
        <span
          style={{
            fontSize: "13px",
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          Local Engine
        </span>
        {/* CSS Toggle Switch */}
        <button
          onClick={handleToggle}
          style={{
            position: "relative",
            width: "36px",
            height: "20px",
            borderRadius: "10px",
            border: "none",
            cursor: sidecarStarting ? "wait" : "pointer",
            backgroundColor: toggleOn ? "var(--accent)" : "var(--bg-tertiary)",
            transition: "background-color 0.2s",
            padding: 0,
            flexShrink: 0,
          }}
          title={
            sidecarStarting
              ? "Starting..."
              : isRunning
                ? "Stop sidecar"
                : "Start sidecar"
          }
        >
          <span
            style={{
              position: "absolute",
              top: "2px",
              left: toggleOn ? "18px" : "2px",
              width: "16px",
              height: "16px",
              borderRadius: "50%",
              backgroundColor: "#fff",
              transition: "left 0.2s",
              boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
            }}
          />
        </button>
      </div>

      {/* Status line */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          marginBottom: "10px",
          paddingBottom: "10px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            backgroundColor: sidecarStarting
              ? "#f59e0b"
              : isRunning
                ? "#4ADE80"
                : "var(--text-muted)",
            display: "inline-block",
            boxShadow: sidecarStarting
              ? "0 0 6px rgba(245, 158, 11, 0.6)"
              : isRunning
                ? "0 0 6px rgba(74, 222, 128, 0.5)"
                : "none",
            animation: sidecarStarting
              ? "breathe 1.5s ease-in-out infinite"
              : undefined,
          }}
        />
        <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
          {sidecarStarting ? "Starting…" : isRunning ? "Running" : "Stopped"}
        </span>
      </div>

      {/* Detail rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            ASR
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span
              style={{
                width: "5px",
                height: "5px",
                borderRadius: "50%",
                backgroundColor: isRunning ? "#4ADE80" : "var(--text-muted)",
                display: "inline-block",
              }}
            />
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              {isRunning ? "Ready" : "Offline"}
            </span>
          </div>
        </div>

        {ttsProviderName && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              TTS
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span
                style={{
                  width: "5px",
                  height: "5px",
                  borderRadius: "50%",
                  backgroundColor: ttsProviderReady
                    ? "#4ADE80"
                    : "var(--text-muted)",
                  display: "inline-block",
                }}
              />
              <span
                style={{ fontSize: "12px", color: "var(--text-secondary)" }}
              >
                {ttsProviderReady ? "Ready" : "Offline"}
              </span>
            </div>
          </div>
        )}

        {sidecarPort != null && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              Port
            </span>
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              {sidecarPort}
            </span>
          </div>
        )}
      </div>
    </div>
  );
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
  sidecarPort,
}: ControlBarProps): React.ReactElement {
  const selectedModel = models.find((m) => m.id === selectedModelId);
  const needsDownload = selectedModel && !selectedModel.downloaded;
  const [showPopover, setShowPopover] = useState(false);

  // Derive indicator state
  let indicatorColor: string;
  let indicatorLabel: string;
  let indicatorGlow: string;
  let indicatorAnimation: string | undefined;
  let indicatorClickable = false;

  if (isRecording) {
    indicatorColor = "var(--danger)";
    indicatorLabel = "Recording";
    indicatorGlow = "0 0 6px rgba(239, 68, 68, 0.6)";
    indicatorAnimation = "breathe 1.5s ease-in-out infinite";
  } else if (!activeProviderName) {
    indicatorColor = "var(--text-muted)";
    indicatorLabel = "No Provider";
    indicatorGlow = "none";
    indicatorAnimation = undefined;
  } else if (isSidecarActive) {
    indicatorClickable = true;
    if (sidecarStarting) {
      indicatorColor = "#f59e0b";
      indicatorLabel = "Starting…";
      indicatorGlow = "0 0 6px rgba(245, 158, 11, 0.6)";
      indicatorAnimation = "breathe 1.5s ease-in-out infinite";
    } else if (sidecarReady) {
      indicatorColor = "#4ADE80";
      indicatorLabel = "Sidecar";
      indicatorGlow = "0 0 6px rgba(74, 222, 128, 0.5)";
      indicatorAnimation = undefined;
    } else {
      indicatorColor = "var(--text-muted)";
      indicatorLabel = "Sidecar";
      indicatorGlow = "none";
      indicatorAnimation = undefined;
    }
  } else {
    // External provider — show provider name, not clickable
    indicatorColor = "#3b82f6";
    indicatorLabel = activeProviderName;
    indicatorGlow = "0 0 6px rgba(59, 130, 246, 0.5)";
    indicatorAnimation = undefined;
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
        zIndex: 50,
      }}
    >
      {/* Left section: brand + status indicator */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          position: "relative",
          zIndex: 100,
        }}
      >
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
        <div
          role={indicatorClickable ? "button" : undefined}
          tabIndex={indicatorClickable ? 0 : undefined}
          onClick={
            indicatorClickable
              ? () => setShowPopover((prev) => !prev)
              : undefined
          }
          onKeyDown={
            indicatorClickable
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setShowPopover((prev) => !prev);
                  }
                }
              : undefined
          }
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            cursor: indicatorClickable ? "pointer" : "default",
            padding: "2px 6px",
            borderRadius: "4px",
            transition: "background-color 0.15s",
            ...(indicatorClickable
              ? {
                  backgroundColor: showPopover
                    ? "rgba(255,255,255,0.06)"
                    : "transparent",
                }
              : {}),
          }}
          title={
            indicatorClickable
              ? "Click to manage sidecar"
              : `Provider: ${activeProviderName ?? "None"}`
          }
        >
          <span
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              backgroundColor: indicatorColor,
              display: "inline-block",
              boxShadow: indicatorGlow,
              animation: indicatorAnimation,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: "11px",
              color: "var(--text-muted)",
              whiteSpace: "nowrap",
            }}
          >
            {indicatorLabel}
          </span>
        </div>

        {/* Sidecar popover */}
        {showPopover && isSidecarActive && (
          <SidecarPopover
            sidecarReady={sidecarReady}
            sidecarStarting={sidecarStarting}
            ttsProviderReady={ttsProviderReady}
            ttsProviderName={ttsProviderName}
            sidecarPort={sidecarPort}
            onStartSidecar={onStartSidecar}
            onStopSidecar={onStopSidecar}
            onClose={() => setShowPopover(false)}
          />
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
