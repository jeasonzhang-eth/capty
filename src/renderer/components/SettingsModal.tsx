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
  readonly hfMirrorUrl: string;
  readonly defaultHfUrl: string;
  readonly onChangeDataDir: () => void;
  readonly onSelectModel: (modelId: string) => void;
  readonly onDownloadModel: (modelId: string, repo: string) => void;
  readonly onDeleteModel: (modelId: string) => void;
  readonly onSearchModels: (query: string) => Promise<ModelInfo[]>;
  readonly onChangeHfMirrorUrl: (url: string) => void;
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

function ModelCard({
  model,
  isSelected,
  isThisDownloading,
  downloadProgress,
  isRecording,
  isDownloading,
  onDownloadModel,
  onSelectModel,
  onDelete,
}: {
  readonly model: ModelInfo;
  readonly isSelected: boolean;
  readonly isThisDownloading: boolean;
  readonly downloadProgress: number;
  readonly isRecording: boolean;
  readonly isDownloading: boolean;
  readonly onDownloadModel: (id: string, repo: string) => void;
  readonly onSelectModel: (id: string) => void;
  readonly onDelete: ((id: string) => void) | null;
}): React.ReactElement {
  return (
    <div
      style={{
        padding: "12px",
        backgroundColor: isSelected ? "var(--bg-tertiary)" : "transparent",
        border: isSelected
          ? "1px solid var(--accent)"
          : "1px solid var(--border)",
        borderRadius: "8px",
        transition: "border-color 0.2s",
      }}
    >
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              marginTop: "6px",
              flexWrap: "wrap",
            }}
          >
            {model.size_gb > 0 && (
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
            )}
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
              onClick={() => onDownloadModel(model.id, model.repo)}
              disabled={isRecording || isDownloading}
              style={{
                padding: "5px 12px",
                fontSize: "11px",
                borderRadius: "5px",
                border: "none",
                backgroundColor: "var(--accent)",
                color: "white",
                cursor:
                  isRecording || isDownloading ? "not-allowed" : "pointer",
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
          {model.downloaded && !isSelected && onDelete && (
            <button
              onClick={() => onDelete(model.id)}
              disabled={isRecording || isDownloading}
              style={{
                padding: "5px 8px",
                fontSize: "11px",
                borderRadius: "5px",
                border: "1px solid var(--border)",
                backgroundColor: "transparent",
                color: "var(--text-muted)",
                cursor:
                  isRecording || isDownloading ? "not-allowed" : "pointer",
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
}

export function SettingsModal({
  dataDir,
  models,
  selectedModelId,
  isDownloading,
  downloadingModelId,
  downloadProgress,
  isRecording,
  hfMirrorUrl,
  defaultHfUrl,
  onChangeDataDir,
  onSelectModel,
  onDownloadModel,
  onDeleteModel,
  onSearchModels,
  onChangeHfMirrorUrl,
  onClose,
}: SettingsModalProps): React.ReactElement {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ModelInfo[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // HuggingFace Mirror URL state
  const [editingHfUrl, setEditingHfUrl] = useState(hfMirrorUrl);
  const [hfUrlSaved, setHfUrlSaved] = useState(false);
  const hfUrlChanged = editingHfUrl !== hfMirrorUrl;

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const handleDelete = useCallback(
    (modelId: string) => {
      if (modelId === selectedModelId) return;
      setConfirmDeleteId(modelId);
    },
    [selectedModelId],
  );

  const confirmDelete = useCallback(() => {
    if (confirmDeleteId) {
      onDeleteModel(confirmDeleteId);
      setConfirmDeleteId(null);
    }
  }, [confirmDeleteId, onDeleteModel]);

  const handleSaveHfUrl = useCallback(() => {
    onChangeHfMirrorUrl(editingHfUrl);
    setHfUrlSaved(true);
    setTimeout(() => setHfUrlSaved(false), 2000);
  }, [editingHfUrl, onChangeHfMirrorUrl]);

  const handleResetHfUrl = useCallback(() => {
    setEditingHfUrl(defaultHfUrl);
  }, [defaultHfUrl]);

  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setIsSearching(true);
    setHasSearched(true);
    try {
      const results = await onSearchModels(q);
      // Filter out models that are already in the builtin list
      const builtinIds = new Set(models.map((m) => m.id));
      setSearchResults(results.filter((r) => !builtinIds.has(r.id)));
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, onSearchModels, models]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleSearch();
    },
    [handleSearch],
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
          width: "520px",
          maxHeight: "85vh",
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
          <div style={{ ...sectionTitleStyle, marginBottom: "4px" }}>
            Models
          </div>
          <div style={labelStyle}>
            Built-in models and models discovered from HuggingFace.
          </div>

          {/* HuggingFace Mirror URL */}
          <div
            style={{
              marginTop: "10px",
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
              HuggingFace Mirror (model download source)
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input
                type="text"
                value={editingHfUrl}
                onChange={(e) => setEditingHfUrl(e.target.value)}
                placeholder={defaultHfUrl}
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
              {hfUrlChanged && (
                <button
                  onClick={handleSaveHfUrl}
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
              {!hfUrlChanged && hfUrlSaved && (
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
                onClick={handleResetHfUrl}
                disabled={editingHfUrl === defaultHfUrl}
                style={{
                  padding: "5px 8px",
                  fontSize: "10px",
                  borderRadius: "4px",
                  border: "1px solid var(--border)",
                  backgroundColor: "transparent",
                  color: "var(--text-muted)",
                  cursor:
                    editingHfUrl === defaultHfUrl ? "not-allowed" : "pointer",
                  opacity: editingHfUrl === defaultHfUrl ? 0.4 : 1,
                  whiteSpace: "nowrap",
                }}
                title="Reset to default"
              >
                Reset
              </button>
            </div>
          </div>

          {/* Built-in models */}
          <div
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--text-secondary)",
              marginBottom: "8px",
            }}
          >
            Built-in
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              marginBottom: "16px",
            }}
          >
            {models.map((model) => (
              <ModelCard
                key={model.id}
                model={model}
                isSelected={model.id === selectedModelId}
                isThisDownloading={
                  isDownloading && downloadingModelId === model.id
                }
                downloadProgress={downloadProgress}
                isRecording={isRecording}
                isDownloading={isDownloading}
                onDownloadModel={onDownloadModel}
                onSelectModel={onSelectModel}
                onDelete={handleDelete}
              />
            ))}
            {models.length === 0 && (
              <div
                style={{
                  padding: "12px",
                  textAlign: "center",
                  color: "var(--text-muted)",
                  fontSize: "13px",
                }}
              >
                No built-in models available
              </div>
            )}
          </div>

          {/* Search HuggingFace */}
          <div
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--text-secondary)",
              marginBottom: "8px",
            }}
          >
            Search HuggingFace
          </div>
          <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search ASR models, e.g. whisper, wav2vec2..."
              style={{
                flex: 1,
                padding: "8px 10px",
                fontSize: "12px",
                backgroundColor: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                outline: "none",
              }}
            />
            <button
              onClick={handleSearch}
              disabled={isSearching || !searchQuery.trim()}
              style={{
                padding: "8px 14px",
                fontSize: "12px",
                borderRadius: "6px",
                border: "none",
                backgroundColor: "var(--accent)",
                color: "white",
                cursor:
                  isSearching || !searchQuery.trim()
                    ? "not-allowed"
                    : "pointer",
                opacity: isSearching || !searchQuery.trim() ? 0.5 : 1,
                whiteSpace: "nowrap",
              }}
            >
              {isSearching ? "Searching..." : "Search"}
            </button>
          </div>

          {/* Search results */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            {searchResults.map((model) => (
              <ModelCard
                key={model.id}
                model={model}
                isSelected={model.id === selectedModelId}
                isThisDownloading={
                  isDownloading && downloadingModelId === model.id
                }
                downloadProgress={downloadProgress}
                isRecording={isRecording}
                isDownloading={isDownloading}
                onDownloadModel={onDownloadModel}
                onSelectModel={onSelectModel}
                onDelete={null}
              />
            ))}
            {hasSearched && !isSearching && searchResults.length === 0 && (
              <div
                style={{
                  padding: "12px",
                  textAlign: "center",
                  color: "var(--text-muted)",
                  fontSize: "12px",
                }}
              >
                No models found. Try different keywords.
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
                {models.find((m) => m.id === confirmDeleteId)?.name ??
                  confirmDeleteId}
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
