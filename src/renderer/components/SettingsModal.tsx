import React, { useCallback, useState } from "react";

interface ModelInfo {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly repo: string;
  readonly downloaded: boolean;
  readonly size_gb: number;
  readonly languages: readonly string[];
  readonly description: string;
}

interface SettingsModalProps {
  readonly dataDir: string | null;
  readonly models: readonly ModelInfo[];
  readonly selectedModelId: string;
  readonly isDownloading: boolean;
  readonly downloadingModelId: string | null;
  readonly downloadProgress: number;
  readonly isRecording: boolean;
  readonly registryUrl: string;
  readonly defaultRegistryUrl: string;
  readonly onChangeDataDir: () => void;
  readonly onSelectModel: (modelId: string) => void;
  readonly onDownloadModel: (modelId: string) => void;
  readonly onDeleteModel: (modelId: string) => void;
  readonly onRefreshModels: () => void;
  readonly onChangeRegistryUrl: (url: string) => void;
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

const tagStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 6px",
  borderRadius: "4px",
  fontSize: "10px",
  fontWeight: 600,
  lineHeight: "14px",
};

function TypeTag({ type }: { readonly type: string }): React.ReactElement {
  const isWhisper = type === "whisper";
  return (
    <span
      style={{
        ...tagStyle,
        backgroundColor: isWhisper
          ? "rgba(16, 163, 127, 0.15)"
          : "rgba(99, 102, 241, 0.15)",
        color: isWhisper ? "#10a37f" : "#6366f1",
      }}
    >
      {isWhisper ? "Whisper" : "Qwen"}
    </span>
  );
}

function LanguageTags({
  languages,
}: {
  readonly languages: readonly string[];
}): React.ReactElement {
  return (
    <>
      {languages.map((lang) => (
        <span
          key={lang}
          style={{
            ...tagStyle,
            backgroundColor: "rgba(255, 255, 255, 0.08)",
            color: "var(--text-muted)",
          }}
        >
          {lang}
        </span>
      ))}
    </>
  );
}

export function SettingsModal({
  dataDir,
  models,
  selectedModelId,
  isDownloading,
  downloadingModelId,
  downloadProgress,
  isRecording,
  registryUrl,
  defaultRegistryUrl,
  onChangeDataDir,
  onSelectModel,
  onDownloadModel,
  onDeleteModel,
  onRefreshModels,
  onChangeRegistryUrl,
  onClose,
}: SettingsModalProps): React.ReactElement {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [editingUrl, setEditingUrl] = useState(registryUrl);
  const [urlSaved, setUrlSaved] = useState(false);
  const urlChanged = editingUrl !== registryUrl;

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const handleDelete = useCallback(
    (modelId: string) => {
      const model = models.find((m) => m.id === modelId);
      if (!model) return;

      if (modelId === selectedModelId) {
        // Cannot delete active model — user must switch first
        return;
      }

      setConfirmDeleteId(modelId);
    },
    [models, selectedModelId],
  );

  const confirmDelete = useCallback(() => {
    if (confirmDeleteId) {
      onDeleteModel(confirmDeleteId);
      setConfirmDeleteId(null);
    }
  }, [confirmDeleteId, onDeleteModel]);

  const handleSaveUrl = useCallback(() => {
    onChangeRegistryUrl(editingUrl);
    setUrlSaved(true);
    setTimeout(() => setUrlSaved(false), 2000);
    // Auto-refresh after saving a new URL
    setIsRefreshing(true);
    onRefreshModels();
    setTimeout(() => setIsRefreshing(false), 1500);
  }, [editingUrl, onChangeRegistryUrl, onRefreshModels]);

  const handleResetUrl = useCallback(() => {
    setEditingUrl(defaultRegistryUrl);
  }, [defaultRegistryUrl]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      onRefreshModels();
    } finally {
      setTimeout(() => setIsRefreshing(false), 1000);
    }
  }, [onRefreshModels]);

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
          width: "480px",
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

        {/* Model Marketplace */}
        <div style={sectionStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
            }}
          >
            <div style={sectionTitleStyle}>Models</div>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              style={{
                padding: "4px 10px",
                fontSize: "11px",
                borderRadius: "5px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--bg-tertiary)",
                color: "var(--text-secondary)",
                cursor: isRefreshing ? "not-allowed" : "pointer",
                opacity: isRefreshing ? 0.6 : 1,
              }}
            >
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <div style={labelStyle}>
            Browse and manage ASR models for transcription.
          </div>

          {/* Model Source URL */}
          <div
            style={{
              marginTop: "8px",
              marginBottom: "12px",
              padding: "10px 12px",
              backgroundColor: "var(--bg-tertiary)",
              borderRadius: "6px",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                color: "var(--text-muted)",
                marginBottom: "6px",
              }}
            >
              Model Source URL
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <input
                type="text"
                value={editingUrl}
                onChange={(e) => setEditingUrl(e.target.value)}
                placeholder="https://..."
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  fontSize: "11px",
                  backgroundColor: "var(--bg-primary)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  outline: "none",
                  fontFamily: "monospace",
                }}
              />
              {urlChanged && (
                <button
                  onClick={handleSaveUrl}
                  style={{
                    padding: "5px 10px",
                    fontSize: "11px",
                    borderRadius: "4px",
                    border: "none",
                    backgroundColor: "var(--accent)",
                    color: "white",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Save
                </button>
              )}
              {!urlChanged && urlSaved && (
                <span
                  style={{
                    fontSize: "11px",
                    color: "#22c55e",
                    whiteSpace: "nowrap",
                  }}
                >
                  Saved
                </span>
              )}
              <button
                onClick={handleResetUrl}
                disabled={editingUrl === defaultRegistryUrl}
                style={{
                  padding: "5px 8px",
                  fontSize: "10px",
                  borderRadius: "4px",
                  border: "1px solid var(--border)",
                  backgroundColor: "transparent",
                  color: "var(--text-muted)",
                  cursor:
                    editingUrl === defaultRegistryUrl
                      ? "not-allowed"
                      : "pointer",
                  opacity: editingUrl === defaultRegistryUrl ? 0.4 : 1,
                  whiteSpace: "nowrap",
                }}
                title="Reset to default URL"
              >
                Reset
              </button>
            </div>
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
              const isThisDownloading =
                isDownloading && downloadingModelId === model.id;

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
                    transition: "border-color 0.2s",
                  }}
                >
                  {/* Top row: name + tags + action buttons */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "13px",
                            fontWeight: 600,
                            color: "var(--text-primary)",
                          }}
                        >
                          {model.name}
                        </span>
                        <TypeTag type={model.type} />
                      </div>
                      {/* Description */}
                      <div
                        style={{
                          fontSize: "11px",
                          color: "var(--text-muted)",
                          marginTop: "4px",
                          lineHeight: "16px",
                        }}
                      >
                        {model.description}
                      </div>
                      {/* Meta: size + languages */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          marginTop: "6px",
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            ...tagStyle,
                            backgroundColor: "rgba(255, 255, 255, 0.06)",
                            color: "var(--text-muted)",
                          }}
                        >
                          {model.size_gb < 1
                            ? `${Math.round(model.size_gb * 1024)} MB`
                            : `${model.size_gb} GB`}
                        </span>
                        <LanguageTags languages={model.languages} />
                        {model.downloaded && (
                          <span
                            style={{
                              ...tagStyle,
                              backgroundColor: "rgba(34, 197, 94, 0.15)",
                              color: "#22c55e",
                            }}
                          >
                            Downloaded
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div
                      style={{
                        display: "flex",
                        gap: "6px",
                        marginLeft: "8px",
                        flexShrink: 0,
                        alignItems: "center",
                      }}
                    >
                      {!model.downloaded && !isThisDownloading && (
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
                            whiteSpace: "nowrap",
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
                            whiteSpace: "nowrap",
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
                            whiteSpace: "nowrap",
                          }}
                        >
                          Active
                        </span>
                      )}
                      {model.downloaded && !isSelected && (
                        <button
                          onClick={() => handleDelete(model.id)}
                          disabled={isRecording || isDownloading}
                          style={{
                            padding: "5px 8px",
                            fontSize: "11px",
                            borderRadius: "5px",
                            border: "1px solid var(--border)",
                            backgroundColor: "transparent",
                            color: "var(--text-muted)",
                            cursor:
                              isRecording || isDownloading
                                ? "not-allowed"
                                : "pointer",
                            opacity: isRecording || isDownloading ? 0.5 : 1,
                            whiteSpace: "nowrap",
                          }}
                          title="Delete model"
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Download progress */}
                  {isThisDownloading && (
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

      {/* Delete confirmation dialog */}
      {confirmDeleteId !== null && (
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
            zIndex: 4000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmDeleteId(null);
          }}
        >
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: "10px",
              padding: "20px",
              width: "320px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            }}
          >
            <div
              style={{
                fontSize: "14px",
                fontWeight: 600,
                color: "var(--text-primary)",
                marginBottom: "8px",
              }}
            >
              Delete Model
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "var(--text-secondary)",
                marginBottom: "16px",
                lineHeight: "18px",
              }}
            >
              Are you sure you want to delete{" "}
              <strong>
                {models.find((m) => m.id === confirmDeleteId)?.name}
              </strong>
              ? The downloaded model files will be permanently removed.
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "8px",
              }}
            >
              <button
                onClick={() => setConfirmDeleteId(null)}
                style={{
                  padding: "6px 14px",
                  fontSize: "12px",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--bg-tertiary)",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                style={{
                  padding: "6px 14px",
                  fontSize: "12px",
                  borderRadius: "6px",
                  border: "none",
                  backgroundColor: "#ef4444",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
