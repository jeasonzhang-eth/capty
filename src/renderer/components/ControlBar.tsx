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
  readonly onOpenSettingsTab?: (tab: string) => void;
  readonly isDownloading: boolean;
  readonly downloadProgress: number;
  readonly onDownloadModel: () => void;
  readonly ttsProviderReady: boolean;
  readonly ttsProviderName: string | null;
  readonly selectedTtsModelId: string;
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
  hasAsrModel,
  hasTtsModel,
  sidecarPort,
  triggerRef,
  onStartSidecar,
  onStopSidecar,
  onOpenSettingsTab,
  onClose,
}: {
  readonly sidecarReady: boolean;
  readonly sidecarStarting?: boolean;
  readonly ttsProviderReady: boolean;
  readonly ttsProviderName: string | null;
  readonly hasAsrModel: boolean;
  readonly hasTtsModel: boolean;
  readonly sidecarPort?: number;
  readonly triggerRef: React.RefObject<HTMLDivElement | null>;
  readonly onStartSidecar?: () => void;
  readonly onStopSidecar?: () => void;
  readonly onOpenSettingsTab?: (tab: string) => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      // Keep popover open while sidecar is starting so user sees progress
      if (sidecarStarting) return;
      const target = event.target as Node;
      // Ignore clicks on the trigger (let the trigger's onClick handle toggle)
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, triggerRef, sidecarStarting]);

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

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: "22px",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: "11px",
    color: "var(--text-muted)",
  };
  const valueStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    fontSize: "11px",
    color: "var(--text-secondary)",
  };
  const dotStyle = (on: boolean): React.CSSProperties => ({
    width: "5px",
    height: "5px",
    borderRadius: "50%",
    backgroundColor: on ? "#4ADE80" : "var(--text-muted)",
    display: "inline-block",
    flexShrink: 0,
  });

  return (
    <div
      ref={popoverRef}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: "calc(100% + 4px)",
        left: 0,
        zIndex: 100,
        backgroundColor: "rgba(36, 36, 40, 0.96)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "8px",
        padding: "8px 10px",
        width: "180px",
        boxShadow:
          "0 4px 16px rgba(0, 0, 0, 0.35), 0 0 0 0.5px rgba(255,255,255,0.05)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
      }}
    >
      {/* Header row: title + toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "6px",
          paddingBottom: "6px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          {sidecarStarting ? (
            /* Spinner during startup */
            <span
              style={{
                width: "10px",
                height: "10px",
                border: "1.5px solid rgba(245, 158, 11, 0.25)",
                borderTopColor: "#f59e0b",
                borderRadius: "50%",
                display: "inline-block",
                animation: "spin 0.8s linear infinite",
                flexShrink: 0,
              }}
            />
          ) : (
            <span
              style={{
                width: "5px",
                height: "5px",
                borderRadius: "50%",
                backgroundColor: isRunning ? "#4ADE80" : "var(--text-muted)",
                display: "inline-block",
                boxShadow: isRunning
                  ? "0 0 4px rgba(74, 222, 128, 0.4)"
                  : "none",
                flexShrink: 0,
              }}
            />
          )}
          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: sidecarStarting ? "#f59e0b" : "var(--text-primary)",
            }}
          >
            {sidecarStarting ? "Starting…" : isRunning ? "Running" : "Stopped"}
          </span>
        </div>
        {/* Mini toggle */}
        <button
          onClick={handleToggle}
          style={{
            position: "relative",
            width: "28px",
            height: "16px",
            borderRadius: "8px",
            border: "none",
            cursor: sidecarStarting ? "wait" : "pointer",
            backgroundColor: toggleOn
              ? "var(--accent)"
              : "rgba(255,255,255,0.1)",
            transition: "background-color 0.2s",
            padding: 0,
            flexShrink: 0,
          }}
          title={
            sidecarStarting
              ? "Starting..."
              : isRunning
                ? "Stop engine"
                : "Start engine"
          }
        >
          <span
            style={{
              position: "absolute",
              top: "2px",
              left: toggleOn ? "14px" : "2px",
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              backgroundColor: "#fff",
              transition: "left 0.2s",
              boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
            }}
          />
        </button>
      </div>

      {/* Detail rows */}
      <div
        style={{ ...rowStyle, cursor: "pointer", borderRadius: "4px" }}
        onClick={() => {
          onOpenSettingsTab?.("asr");
          onClose();
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
        }}
        title="Open ASR settings"
      >
        <span style={labelStyle}>ASR</span>
        <span style={valueStyle}>
          <span style={dotStyle(isRunning && hasAsrModel)} />
          {!isRunning ? "Offline" : hasAsrModel ? "Ready" : "No model"}
        </span>
      </div>

      {ttsProviderName && (
        <div
          style={{ ...rowStyle, cursor: "pointer", borderRadius: "4px" }}
          onClick={() => {
            onOpenSettingsTab?.("tts");
            onClose();
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
          }}
          title="Open TTS settings"
        >
          <span style={labelStyle}>TTS</span>
          <span style={valueStyle}>
            <span style={dotStyle(ttsProviderReady && hasTtsModel)} />
            {!ttsProviderReady ? "Offline" : hasTtsModel ? "Ready" : "No model"}
          </span>
        </div>
      )}

      {sidecarPort != null && (
        <div style={rowStyle}>
          <span style={labelStyle}>Port</span>
          <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
            {sidecarPort}
          </span>
        </div>
      )}
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
  onOpenSettingsTab,
  isDownloading,
  downloadProgress,
  onDownloadModel,
  ttsProviderReady,
  ttsProviderName,
  selectedTtsModelId,
  onStartSidecar,
  onStopSidecar,
  sidecarStarting,
  sidecarPort,
}: ControlBarProps): React.ReactElement {
  const selectedModel = models.find((m) => m.id === selectedModelId);
  const needsDownload = selectedModel && !selectedModel.downloaded;
  const [showPopover, setShowPopover] = useState(false);
  const indicatorRef = useRef<HTMLDivElement>(null);

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
      data-testid="control-bar"
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
          ref={indicatorRef}
          role={indicatorClickable ? "button" : undefined}
          tabIndex={indicatorClickable ? 0 : undefined}
          onClick={
            indicatorClickable
              ? () => {
                  if (!showPopover) {
                    setShowPopover(true);
                  } else if (!sidecarStarting) {
                    setShowPopover(false);
                  }
                  // When starting, keep popover open so user sees progress
                }
              : undefined
          }
          onKeyDown={
            indicatorClickable
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (!showPopover) {
                      setShowPopover(true);
                    } else if (!sidecarStarting) {
                      setShowPopover(false);
                    }
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
            outline: "none",
            transition: "background-color 0.15s",
            position: "relative",
            zIndex: 100,
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
              ? showPopover
                ? undefined
                : "Click to manage sidecar"
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

          {/* Sidecar popover — anchored to indicator so left edge aligns with dot */}
          {showPopover && isSidecarActive && (
            <SidecarPopover
              sidecarReady={sidecarReady}
              sidecarStarting={sidecarStarting}
              ttsProviderReady={ttsProviderReady}
              ttsProviderName={ttsProviderName}
              hasAsrModel={!!selectedModelId}
              hasTtsModel={!!selectedTtsModelId}
              sidecarPort={sidecarPort}
              triggerRef={indicatorRef}
              onStartSidecar={onStartSidecar}
              onStopSidecar={onStopSidecar}
              onOpenSettingsTab={onOpenSettingsTab}
              onClose={() => setShowPopover(false)}
            />
          )}
        </div>
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
