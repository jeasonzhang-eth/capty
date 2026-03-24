import React, { useCallback } from "react";

interface ModelInfo {
  readonly id: string;
  readonly name: string;
  readonly downloaded: boolean;
  readonly size_gb: number;
}

interface SettingsModalProps {
  readonly dataDir: string | null;
  readonly models: readonly ModelInfo[];
  readonly selectedModelId: string;
  readonly isDownloading: boolean;
  readonly downloadProgress: number;
  readonly isRecording: boolean;
  readonly onChangeDataDir: () => void;
  readonly onSelectModel: (modelId: string) => void;
  readonly onDownloadModel: (modelId: string) => void;
  readonly onClose: () => void;
}

const sectionStyle: React.CSSProperties = {
  marginBottom: "24px",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
  marginBottom: "12px",
  color: "var(--text-primary)",
};

const labelStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "var(--text-muted)",
  marginBottom: "4px",
};

export function SettingsModal({
  dataDir,
  models,
  selectedModelId,
  isDownloading,
  downloadProgress,
  isRecording,
  onChangeDataDir,
  onSelectModel,
  onDownloadModel,
  onClose,
}: SettingsModalProps): React.ReactElement {
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 3000,
      }}
      onClick={handleOverlayClick}
    >
      <div
        style={{
          backgroundColor: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "24px",
          width: "420px",
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "20px",
          }}
        >
          <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0 }}>
            Settings
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              fontSize: "18px",
              cursor: "pointer",
              padding: "4px 8px",
            }}
          >
            &times;
          </button>
        </div>

        {/* Data Directory */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Data Directory</div>
          <div style={labelStyle}>
            Recordings, transcripts, and models are stored here.
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginTop: "8px",
            }}
          >
            <div
              style={{
                flex: 1,
                padding: "8px 12px",
                backgroundColor: "var(--bg-tertiary)",
                borderRadius: "6px",
                fontSize: "13px",
                color: "var(--text-secondary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={dataDir ?? "Not set"}
            >
              {dataDir ?? "Not set"}
            </div>
            <button
              onClick={onChangeDataDir}
              disabled={isRecording}
              style={{
                padding: "8px 14px",
                fontSize: "12px",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                cursor: isRecording ? "not-allowed" : "pointer",
                opacity: isRecording ? 0.5 : 1,
                whiteSpace: "nowrap",
              }}
            >
              Change
            </button>
          </div>
        </div>

        {/* Models */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Models</div>
          <div style={labelStyle}>
            Select the ASR model for transcription.
          </div>
          <div
            style={{
              marginTop: "8px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            {models.map((model) => {
              const isSelected = model.id === selectedModelId;
              const isCurrentDownloading = isDownloading && isSelected;

              return (
                <div
                  key={model.id}
                  style={{
                    padding: "12px",
                    backgroundColor: isSelected
                      ? "var(--bg-tertiary)"
                      : "transparent",
                    border: isSelected
                      ? "1px solid var(--accent)"
                      : "1px solid var(--border)",
                    borderRadius: "8px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: 600,
                          color: "var(--text-primary)",
                        }}
                      >
                        {model.name}
                      </div>
                      <div
                        style={{
                          fontSize: "11px",
                          color: "var(--text-muted)",
                          marginTop: "2px",
                        }}
                      >
                        {model.size_gb} GB
                        {model.downloaded && " · Downloaded"}
                        {!model.downloaded && " · Not downloaded"}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      {!model.downloaded && !isCurrentDownloading && (
                        <button
                          onClick={() => onDownloadModel(model.id)}
                          disabled={isRecording || isDownloading}
                          style={{
                            padding: "5px 12px",
                            fontSize: "11px",
                            borderRadius: "5px",
                            border: "none",
                            backgroundColor: "var(--accent)",
                            color: "white",
                            cursor:
                              isRecording || isDownloading
                                ? "not-allowed"
                                : "pointer",
                            opacity: isRecording || isDownloading ? 0.5 : 1,
                          }}
                        >
                          Download
                        </button>
                      )}
                      {model.downloaded && !isSelected && (
                        <button
                          onClick={() => onSelectModel(model.id)}
                          disabled={isRecording}
                          style={{
                            padding: "5px 12px",
                            fontSize: "11px",
                            borderRadius: "5px",
                            border: "1px solid var(--accent)",
                            backgroundColor: "transparent",
                            color: "var(--accent)",
                            cursor: isRecording ? "not-allowed" : "pointer",
                            opacity: isRecording ? 0.5 : 1,
                          }}
                        >
                          Use
                        </button>
                      )}
                      {isSelected && model.downloaded && (
                        <span
                          style={{
                            padding: "5px 12px",
                            fontSize: "11px",
                            color: "var(--accent)",
                            fontWeight: 600,
                          }}
                        >
                          Active
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Download progress */}
                  {isCurrentDownloading && (
                    <div style={{ marginTop: "8px" }}>
                      <div
                        style={{
                          height: "4px",
                          backgroundColor: "var(--border)",
                          borderRadius: "2px",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${downloadProgress}%`,
                            backgroundColor: "var(--accent)",
                            transition: "width 0.3s",
                            borderRadius: "2px",
                          }}
                        />
                      </div>
                      <div
                        style={{
                          fontSize: "10px",
                          color: "var(--text-muted)",
                          textAlign: "right",
                          marginTop: "4px",
                        }}
                      >
                        {Math.round(downloadProgress)}%
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {models.length === 0 && (
              <div
                style={{
                  padding: "16px",
                  textAlign: "center",
                  color: "var(--text-muted)",
                  fontSize: "13px",
                }}
              >
                No models available
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
