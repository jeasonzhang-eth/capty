import React, { useCallback, useEffect, useState } from "react";

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

export interface LlmProvider {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly isPreset: boolean;
}

export interface AsrProviderConfig {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly isSidecar: boolean;
}

export interface TtsProviderConfig {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly voice: string;
  readonly isSidecar: boolean;
}

interface SettingsModalProps {
  readonly dataDir: string | null;
  readonly configDir: string | null;
  readonly models: readonly ModelInfo[];
  readonly selectedModelId: string;
  readonly isDownloading: boolean;
  readonly downloadingModelId: string | null;
  readonly downloadProgress: number;
  readonly downloadError: string | null;
  readonly isRecording: boolean;
  readonly hfMirrorUrl: string;
  readonly defaultHfUrl: string;
  readonly llmProviders: readonly LlmProvider[];
  readonly asrProviders: readonly AsrProviderConfig[];
  readonly selectedAsrProviderId: string | null;
  readonly sidecarReady: boolean;
  readonly downloads: Record<
    string,
    {
      readonly modelId: string;
      readonly category: "asr" | "tts";
      readonly percent: number;
      readonly status: string;
      readonly error?: string;
    }
  >;
  readonly ttsProviders: readonly TtsProviderConfig[];
  readonly selectedTtsProviderId: string | null;
  readonly ttsModels: readonly ModelInfo[];
  readonly selectedTtsModelId: string;
  readonly isTtsDownloading: boolean;
  readonly ttsDownloadingModelId: string | null;
  readonly ttsDownloadProgress: number;
  readonly ttsDownloadError: string | null;
  readonly onChangeDataDir: () => void;
  readonly onSelectModel: (modelId: string) => void;
  readonly onDownloadModel: (model: ModelInfo) => void;
  readonly onDeleteModel: (modelId: string) => void;
  readonly onSearchModels: (query: string) => Promise<ModelInfo[]>;
  readonly onChangeHfMirrorUrl: (url: string) => void;
  readonly onSaveLlmProviders: (providers: LlmProvider[]) => void;
  readonly onSaveAsrSettings: (settings: {
    asrProviders: AsrProviderConfig[];
    selectedAsrProviderId: string | null;
  }) => void;
  readonly onPauseDownload: (modelId: string) => void;
  readonly onResumeDownload: (modelId: string) => void;
  readonly onCancelDownload: (modelId: string) => void;
  readonly onSaveTtsSettings: (settings: {
    ttsProviders: TtsProviderConfig[];
    selectedTtsProviderId: string | null;
  }) => void;
  readonly onSelectTtsModel: (modelId: string) => void;
  readonly onDownloadTtsModel: (model: ModelInfo) => void;
  readonly onDeleteTtsModel: (modelId: string) => void;
  readonly onSearchTtsModels: (query: string) => Promise<ModelInfo[]>;
  readonly onClose: () => void;
}

/* ─── Shared style constants ─── */

const cardStyle: React.CSSProperties = {
  backgroundColor: "var(--bg-tertiary)",
  borderRadius: "10px",
  border: "1px solid var(--border)",
  padding: "16px",
  marginBottom: "16px",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
  color: "var(--text-primary)",
  marginBottom: "8px",
};

const sectionDescStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "var(--text-muted)",
  marginBottom: "8px",
};

const labelStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "var(--text-muted)",
  marginBottom: "4px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: "32px",
  padding: "0 10px",
  fontSize: "12px",
  backgroundColor: "var(--bg-surface)",
  color: "var(--text-primary)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  outline: "none",
  boxSizing: "border-box",
  transition: "border-color 0.2s",
  fontFamily: "'DM Sans', sans-serif",
};

const primaryBtnStyle: React.CSSProperties = {
  height: "32px",
  padding: "0 14px",
  fontSize: "12px",
  borderRadius: "6px",
  border: "none",
  backgroundColor: "var(--accent)",
  color: "white",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const secondaryBtnStyle: React.CSSProperties = {
  height: "32px",
  padding: "0 14px",
  fontSize: "12px",
  borderRadius: "6px",
  border: "1px solid var(--border)",
  backgroundColor: "transparent",
  color: "var(--text-primary)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const tagStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 6px",
  borderRadius: "4px",
  fontSize: "10px",
  fontWeight: 600,
  lineHeight: "14px",
};

type TabId = "general" | "speech" | "tts" | "language-models";

const TABS: readonly {
  readonly id: TabId;
  readonly icon: string;
  readonly label: string;
}[] = [
  { id: "general", icon: "\u2699\ufe0f", label: "General" },
  { id: "speech", icon: "\ud83c\udf99\ufe0f", label: "ASR Providers" },
  { id: "tts", icon: "\ud83d\udd0a", label: "TTS Providers" },
  { id: "language-models", icon: "\ud83e\udde0", label: "Language Models" },
];

/* ─── Small reusable components ─── */

const TYPE_STYLES: Record<
  string,
  { bg: string; color: string; label: string }
> = {
  whisper: {
    bg: "rgba(74, 222, 128, 0.12)",
    color: "#4ADE80",
    label: "Whisper",
  },
  "qwen-asr": {
    bg: "rgba(245, 166, 35, 0.12)",
    color: "#F5A623",
    label: "Qwen",
  },
  parakeet: {
    bg: "rgba(96, 165, 250, 0.12)",
    color: "#60A5FA",
    label: "Parakeet",
  },
};
const DEFAULT_TYPE_STYLE = {
  bg: "rgba(148, 163, 184, 0.12)",
  color: "#94A3B8",
  label: "ASR",
};

const TTS_TYPE_STYLES: Record<
  string,
  { bg: string; color: string; label: string }
> = {
  kokoro: {
    bg: "rgba(168, 85, 247, 0.12)",
    color: "#A855F7",
    label: "Kokoro",
  },
};
const DEFAULT_TTS_TYPE_STYLE = {
  bg: "rgba(148, 163, 184, 0.12)",
  color: "#94A3B8",
  label: "TTS",
};

function TypeTag({ type }: { readonly type: string }): React.ReactElement {
  const s = TYPE_STYLES[type] ?? DEFAULT_TYPE_STYLE;
  return (
    <span style={{ ...tagStyle, backgroundColor: s.bg, color: s.color }}>
      {s.label}
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
  downloadStatus,
  downloadError,
  isRecording,
  isDownloading,
  onDownloadModel,
  onSelectModel,
  onDelete,
  onPause,
  onResume,
  onCancel,
}: {
  readonly model: ModelInfo;
  readonly isSelected: boolean;
  readonly isThisDownloading: boolean;
  readonly downloadProgress: number;
  readonly downloadStatus: string | null;
  readonly downloadError: string | null;
  readonly isRecording: boolean;
  readonly isDownloading: boolean;
  readonly onDownloadModel: (model: ModelInfo) => void;
  readonly onSelectModel: (id: string) => void;
  readonly onDelete: ((id: string) => void) | null;
  readonly onPause: ((modelId: string) => void) | null;
  readonly onResume: ((modelId: string) => void) | null;
  readonly onCancel: ((modelId: string) => void) | null;
}): React.ReactElement {
  const canSelect = model.downloaded && !isSelected && !isRecording;

  return (
    <div
      onClick={canSelect ? () => onSelectModel(model.id) : undefined}
      style={{
        padding: "12px",
        backgroundColor: isSelected ? "var(--bg-tertiary)" : "transparent",
        border: isSelected
          ? "1px solid var(--accent)"
          : "1px solid var(--border)",
        borderRadius: "8px",
        transition: "border-color 0.2s, background-color 0.15s",
        cursor: canSelect ? "pointer" : "default",
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
                  backgroundColor: "rgba(74, 222, 128, 0.12)",
                  color: "#4ADE80",
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
          {/* Not downloaded & not downloading/paused → show Download or Resume */}
          {!model.downloaded &&
            !isThisDownloading &&
            downloadStatus !== "paused" &&
            downloadStatus !== "failed" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDownloadModel(model);
                }}
                disabled={isRecording || isDownloading}
                style={{
                  ...primaryBtnStyle,
                  height: "28px",
                  padding: "0 12px",
                  fontSize: "11px",
                  cursor:
                    isRecording || isDownloading ? "not-allowed" : "pointer",
                  opacity: isRecording || isDownloading ? 0.5 : 1,
                }}
              >
                Download
              </button>
            )}
          {/* Paused → Resume button */}
          {downloadStatus === "paused" && onResume && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onResume(model.id);
              }}
              style={{
                ...primaryBtnStyle,
                height: "28px",
                padding: "0 12px",
                fontSize: "11px",
              }}
              title="Resume download"
            >
              &#9654; Resume
            </button>
          )}
          {/* Failed → Retry button */}
          {downloadStatus === "failed" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDownloadModel(model);
              }}
              style={{
                ...primaryBtnStyle,
                height: "28px",
                padding: "0 12px",
                fontSize: "11px",
              }}
              title="Retry download"
            >
              &#8635; Retry
            </button>
          )}
          {/* Downloading → Pause button */}
          {isThisDownloading && downloadStatus === "downloading" && onPause && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPause(model.id);
              }}
              style={{
                ...secondaryBtnStyle,
                height: "28px",
                padding: "0 8px",
                fontSize: "11px",
                color: "var(--text-secondary)",
              }}
              title="Pause download"
            >
              &#9646;&#9646;
            </button>
          )}
          {/* Downloading or Paused → Cancel button */}
          {(isThisDownloading || downloadStatus === "paused") && onCancel && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancel(model.id);
              }}
              style={{
                ...secondaryBtnStyle,
                height: "28px",
                padding: "0 8px",
                fontSize: "11px",
                color: "var(--danger, #ef4444)",
              }}
              title="Cancel download"
            >
              &times;
            </button>
          )}
          {/* Failed → Cancel (dismiss) button */}
          {downloadStatus === "failed" && onCancel && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancel(model.id);
              }}
              style={{
                ...secondaryBtnStyle,
                height: "28px",
                padding: "0 8px",
                fontSize: "11px",
                color: "var(--text-muted)",
              }}
              title="Dismiss"
            >
              &times;
            </button>
          )}
          {isSelected && model.downloaded && (
            <span
              style={{
                padding: "0 12px",
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
              onClick={(e) => {
                e.stopPropagation();
                onDelete(model.id);
              }}
              disabled={isRecording || isDownloading}
              style={{
                ...secondaryBtnStyle,
                height: "28px",
                padding: "0 8px",
                fontSize: "11px",
                color: "var(--text-muted)",
                cursor:
                  isRecording || isDownloading ? "not-allowed" : "pointer",
                opacity: isRecording || isDownloading ? 0.5 : 1,
              }}
              title="Delete model"
            >
              &times;
            </button>
          )}
        </div>
      </div>

      {/* Download progress bar */}
      {(isThisDownloading || downloadStatus === "paused") && (
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
                backgroundColor:
                  downloadStatus === "paused"
                    ? "var(--text-muted)"
                    : "var(--accent)",
                transition: "width 0.3s",
                borderRadius: "2px",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "10px",
              color: "var(--text-muted)",
              marginTop: "4px",
            }}
          >
            <span>
              {downloadStatus === "paused" ? "Paused" : "Downloading..."}
            </span>
            <span>{Math.round(downloadProgress)}%</span>
          </div>
        </div>
      )}

      {/* Download error message */}
      {downloadStatus === "failed" && downloadError && (
        <div
          style={{
            marginTop: "6px",
            fontSize: "10px",
            color: "var(--danger, #ef4444)",
            lineHeight: "14px",
          }}
        >
          {downloadError}
        </div>
      )}
    </div>
  );
}

/* ─── Model Market Modal ─── */

function ModelMarketModal({
  models,
  selectedModelId,
  isDownloading,
  downloadingModelId,
  downloadProgress,
  downloadError,
  isRecording,
  hfMirrorUrl,
  defaultHfUrl,
  downloads,
  onSelectModel,
  onDownloadModel,
  onDeleteModel,
  onSearchModels,
  onChangeHfMirrorUrl,
  onPauseDownload,
  onResumeDownload,
  onCancelDownload,
  onClose,
}: {
  readonly models: readonly ModelInfo[];
  readonly selectedModelId: string;
  readonly isDownloading: boolean;
  readonly downloadingModelId: string | null;
  readonly downloadProgress: number;
  readonly downloadError: string | null;
  readonly isRecording: boolean;
  readonly hfMirrorUrl: string;
  readonly defaultHfUrl: string;
  readonly downloads: Record<
    string,
    {
      modelId: string;
      category: string;
      percent: number;
      status: string;
      error?: string;
    }
  >;
  readonly onSelectModel: (modelId: string) => void;
  readonly onDownloadModel: (model: ModelInfo) => void;
  readonly onDeleteModel: (modelId: string) => void;
  readonly onSearchModels: (query: string) => Promise<ModelInfo[]>;
  readonly onChangeHfMirrorUrl: (url: string) => void;
  readonly onPauseDownload: (modelId: string) => void;
  readonly onResumeDownload: (modelId: string) => void;
  readonly onCancelDownload: (modelId: string) => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ModelInfo[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [editingHfUrl, setEditingHfUrl] = useState(hfMirrorUrl);
  const [hfUrlSaved, setHfUrlSaved] = useState(false);
  const hfUrlChanged = editingHfUrl !== hfMirrorUrl;
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Sync search results' downloaded status
  useEffect(() => {
    if (searchResults.length === 0) return;
    const downloadedIds = new Set(
      models.filter((m) => m.downloaded).map((m) => m.id),
    );
    const needsUpdate = searchResults.some(
      (r) => !r.downloaded && downloadedIds.has(r.id),
    );
    if (needsUpdate) {
      setSearchResults((prev) =>
        prev.map((r) =>
          downloadedIds.has(r.id) ? { ...r, downloaded: true } : r,
        ),
      );
    }
  }, [models, searchResults]);

  const installed = models.filter((m) => m.downloaded);
  const recommended = models.filter((m) => !m.downloaded);

  const handleDeleteModel = useCallback(
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
      const existingIds = new Set(models.map((m) => m.id));
      setSearchResults(results.filter((r) => !existingIds.has(r.id)));
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

  const sectionHeaderStyle: React.CSSProperties = {
    fontSize: "12px",
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    marginBottom: "8px",
    paddingBottom: "6px",
    borderBottom: "1px solid var(--border)",
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 4000,
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          backgroundColor: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          width: "720px",
          maxWidth: "90vw",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
          overflow: "hidden",
        }}
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
          <h2
            style={{
              fontSize: "16px",
              fontWeight: 700,
              margin: 0,
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            Model Market
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
              borderRadius: "4px",
            }}
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {/* Search */}
          <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search models on HuggingFace..."
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={handleSearch}
              disabled={isSearching || !searchQuery.trim()}
              style={{
                ...primaryBtnStyle,
                cursor:
                  isSearching || !searchQuery.trim()
                    ? "not-allowed"
                    : "pointer",
                opacity: isSearching || !searchQuery.trim() ? 0.5 : 1,
              }}
            >
              {isSearching ? "Searching..." : "Search"}
            </button>
          </div>

          {/* HuggingFace Mirror URL */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              marginBottom: "16px",
            }}
          >
            <span
              style={{
                fontSize: "11px",
                color: "var(--text-muted)",
                whiteSpace: "nowrap",
              }}
            >
              HuggingFace Mirror:
            </span>
            <input
              type="text"
              value={editingHfUrl}
              onChange={(e) => setEditingHfUrl(e.target.value)}
              placeholder={defaultHfUrl}
              style={{
                ...inputStyle,
                flex: 1,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "11px",
              }}
            />
            {hfUrlChanged && (
              <button
                onClick={handleSaveHfUrl}
                style={{ ...primaryBtnStyle, fontSize: "11px" }}
              >
                Save
              </button>
            )}
            {!hfUrlChanged && hfUrlSaved && (
              <span
                style={{
                  fontSize: "11px",
                  color: "#4ADE80",
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
                ...secondaryBtnStyle,
                fontSize: "11px",
                padding: "0 8px",
                color: "var(--text-muted)",
                cursor:
                  editingHfUrl === defaultHfUrl ? "not-allowed" : "pointer",
                opacity: editingHfUrl === defaultHfUrl ? 0.4 : 1,
              }}
              title="Reset to default"
            >
              Reset
            </button>
          </div>

          {/* Download error */}
          {downloadError && (
            <div
              style={{
                padding: "8px 12px",
                marginBottom: "12px",
                backgroundColor: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: "6px",
                fontSize: "12px",
                color: "#EF4444",
                lineHeight: "18px",
              }}
            >
              {downloadError}
            </div>
          )}

          {/* Installed */}
          <div style={sectionHeaderStyle}>Installed ({installed.length})</div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              marginBottom: "20px",
            }}
          >
            {installed.length === 0 && (
              <div
                style={{
                  padding: "12px",
                  textAlign: "center",
                  color: "var(--text-muted)",
                  fontSize: "12px",
                }}
              >
                No models installed yet.
              </div>
            )}
            {installed.map((model) => (
              <ModelCard
                key={model.id}
                model={model}
                isSelected={model.id === selectedModelId}
                isThisDownloading={
                  isDownloading && downloadingModelId === model.id
                }
                downloadProgress={
                  downloads[model.id]?.percent ?? downloadProgress
                }
                downloadStatus={downloads[model.id]?.status ?? null}
                downloadError={downloads[model.id]?.error ?? null}
                isRecording={isRecording}
                isDownloading={isDownloading}
                onDownloadModel={onDownloadModel}
                onSelectModel={onSelectModel}
                onDelete={handleDeleteModel}
                onPause={onPauseDownload}
                onResume={onResumeDownload}
                onCancel={onCancelDownload}
              />
            ))}
          </div>

          {/* Recommended */}
          {recommended.length > 0 && (
            <>
              <div style={sectionHeaderStyle}>Recommended</div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  marginBottom: "20px",
                }}
              >
                {recommended.map((model) => (
                  <ModelCard
                    key={model.id}
                    model={model}
                    isSelected={model.id === selectedModelId}
                    isThisDownloading={
                      isDownloading && downloadingModelId === model.id
                    }
                    downloadProgress={
                      downloads[model.id]?.percent ?? downloadProgress
                    }
                    downloadStatus={downloads[model.id]?.status ?? null}
                    downloadError={downloads[model.id]?.error ?? null}
                    isRecording={isRecording}
                    isDownloading={isDownloading}
                    onDownloadModel={onDownloadModel}
                    onSelectModel={onSelectModel}
                    onDelete={null}
                    onPause={onPauseDownload}
                    onResume={onResumeDownload}
                    onCancel={onCancelDownload}
                  />
                ))}
              </div>
            </>
          )}

          {/* Search Results */}
          {(searchResults.length > 0 || (hasSearched && !isSearching)) && (
            <>
              <div style={sectionHeaderStyle}>Search Results</div>
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
                    downloadProgress={
                      downloads[model.id]?.percent ?? downloadProgress
                    }
                    downloadStatus={downloads[model.id]?.status ?? null}
                    downloadError={downloads[model.id]?.error ?? null}
                    isRecording={isRecording}
                    isDownloading={isDownloading}
                    onDownloadModel={onDownloadModel}
                    onSelectModel={onSelectModel}
                    onDelete={null}
                    onPause={onPauseDownload}
                    onResume={onResumeDownload}
                    onCancel={onCancelDownload}
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
            </>
          )}
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
            backgroundColor: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 5000,
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
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
                style={secondaryBtnStyle}
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                style={{
                  ...primaryBtnStyle,
                  backgroundColor: "#ef4444",
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

/* ─── Page: General ─── */

function GeneralTab({
  dataDir,
  configDir,
  isRecording,
  onChangeDataDir,
}: {
  readonly dataDir: string | null;
  readonly configDir: string | null;
  readonly isRecording: boolean;
  readonly onChangeDataDir: () => void;
}): React.ReactElement {
  return (
    <>
      {/* Data Directory */}
      <div style={sectionTitleStyle}>Data Directory</div>
      <div style={sectionDescStyle}>
        Recordings, transcripts, and models are stored here.
      </div>
      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <div
            style={{
              flex: 1,
              padding: "0 10px",
              height: "32px",
              lineHeight: "32px",
              backgroundColor: "var(--bg-primary)",
              borderRadius: "6px",
              fontSize: "13px",
              fontFamily: "monospace",
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
              ...secondaryBtnStyle,
              cursor: isRecording ? "not-allowed" : "pointer",
              opacity: isRecording ? 0.5 : 1,
            }}
          >
            Change
          </button>
        </div>
      </div>

      {/* Config Directory */}
      <div style={sectionTitleStyle}>Config Directory</div>
      <div style={sectionDescStyle}>
        Application configuration files are stored here.
      </div>
      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <div
            style={{
              flex: 1,
              padding: "0 10px",
              height: "32px",
              lineHeight: "32px",
              backgroundColor: "var(--bg-primary)",
              borderRadius: "6px",
              fontSize: "13px",
              fontFamily: "monospace",
              color: "var(--text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={configDir ?? ""}
          >
            {configDir ?? "\u2014"}
          </div>
          <button
            onClick={() => window.capty.openConfigDir()}
            style={secondaryBtnStyle}
          >
            Open
          </button>
        </div>
      </div>
    </>
  );
}

/* ─── Page: Speech (Provider list + Local Models) ─── */

function SpeechTab({
  asrProviders: initialProviders,
  selectedAsrProviderId: initialSelectedId,
  sidecarReady,
  isRecording,
  dataDir,
  models,
  selectedModelId,
  isDownloading,
  downloadingModelId,
  downloadProgress,
  downloadError,
  hfMirrorUrl,
  defaultHfUrl,
  downloads,
  onSaveAsrSettings,
  onSelectModel,
  onDownloadModel,
  onDeleteModel,
  onSearchModels,
  onChangeHfMirrorUrl,
  onPauseDownload,
  onResumeDownload,
  onCancelDownload,
}: {
  readonly asrProviders: readonly AsrProviderConfig[];
  readonly selectedAsrProviderId: string | null;
  readonly sidecarReady: boolean;
  readonly isRecording: boolean;
  readonly dataDir: string | null;
  readonly models: readonly ModelInfo[];
  readonly selectedModelId: string;
  readonly isDownloading: boolean;
  readonly downloadingModelId: string | null;
  readonly downloadProgress: number;
  readonly downloadError: string | null;
  readonly hfMirrorUrl: string;
  readonly defaultHfUrl: string;
  readonly downloads: Record<
    string,
    {
      modelId: string;
      category: string;
      percent: number;
      status: string;
      error?: string;
    }
  >;
  readonly onSaveAsrSettings: (settings: {
    asrProviders: AsrProviderConfig[];
    selectedAsrProviderId: string | null;
  }) => void;
  readonly onSelectModel: (modelId: string) => void;
  readonly onDownloadModel: (model: ModelInfo) => void;
  readonly onDeleteModel: (modelId: string) => void;
  readonly onSearchModels: (query: string) => Promise<ModelInfo[]>;
  readonly onChangeHfMirrorUrl: (url: string) => void;
  readonly onPauseDownload: (modelId: string) => void;
  readonly onResumeDownload: (modelId: string) => void;
  readonly onCancelDownload: (modelId: string) => void;
}): React.ReactElement {
  // Provider list state
  const [providers, setProviders] = useState<AsrProviderConfig[]>([
    ...initialProviders,
  ]);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId,
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    baseUrl: "",
    apiKey: "",
    model: "",
  });
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; message: string }>
  >({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [fetchedModels, setFetchedModels] = useState<
    Record<string, Array<{ id: string; name: string }>>
  >({});
  const [modelsFetchingId, setModelsFetchingId] = useState<string | null>(null);
  const [useCustomModel, setUseCustomModel] = useState<Record<string, boolean>>(
    {},
  );

  // Model Market modal state
  const [showModelMarket, setShowModelMarket] = useState(false);

  const modelsDir = dataDir ? `${dataDir}/models` : "<dataDir>/models";

  const saveProviders = useCallback(
    (next: AsrProviderConfig[], nextSelectedId: string | null) => {
      setProviders(next);
      setSelectedId(nextSelectedId);
      onSaveAsrSettings({
        asrProviders: next,
        selectedAsrProviderId: nextSelectedId,
      });
    },
    [onSaveAsrSettings],
  );

  const handleAddProvider = useCallback(() => {
    const id = `ext-${Date.now()}`;
    const newProvider: AsrProviderConfig = {
      id,
      name: "New Provider",
      baseUrl: "",
      apiKey: "",
      model: "",
      isSidecar: false,
    };
    const next = [...providers, newProvider];
    saveProviders(next, selectedId);
    setExpandedId(id);
    setEditForm({ name: "New Provider", baseUrl: "", apiKey: "", model: "" });
  }, [providers, selectedId, saveProviders]);

  const handleUseProvider = useCallback(
    (providerId: string) => {
      saveProviders([...providers], providerId);
    },
    [providers, saveProviders],
  );

  const handleToggleExpand = useCallback(
    (provider: AsrProviderConfig) => {
      if (expandedId === provider.id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(provider.id);
      setEditForm({
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
      });
    },
    [expandedId],
  );

  const handleSaveEdit = useCallback(() => {
    if (!expandedId) return;
    const next = providers.map((p) =>
      p.id === expandedId
        ? {
            ...p,
            name: p.isSidecar ? p.name : editForm.name || "External ASR",
            baseUrl: editForm.baseUrl,
            apiKey: editForm.apiKey,
            model: p.isSidecar ? p.model : editForm.model,
          }
        : p,
    );
    saveProviders(next, selectedId);
  }, [expandedId, editForm, providers, selectedId, saveProviders]);

  const handleDeleteProvider = useCallback(
    (providerId: string) => {
      const next = providers.filter((p) => p.id !== providerId);
      const nextSelectedId =
        selectedId === providerId ? (next[0]?.id ?? null) : selectedId;
      saveProviders(next, nextSelectedId);
      if (expandedId === providerId) setExpandedId(null);
    },
    [providers, selectedId, expandedId, saveProviders],
  );

  const handleTestProvider = useCallback(
    async (provider: AsrProviderConfig) => {
      if (provider.isSidecar) {
        // Test sidecar health
        setTestingId(provider.id);
        try {
          const result = await window.capty.checkSidecarHealth();
          setTestResults((prev) => ({
            ...prev,
            [provider.id]: {
              ok: result.online,
              message: result.online
                ? "Sidecar is online"
                : "Sidecar is offline",
            },
          }));
        } catch {
          setTestResults((prev) => ({
            ...prev,
            [provider.id]: { ok: false, message: "Sidecar is offline" },
          }));
        } finally {
          setTestingId(null);
          setTimeout(() => {
            setTestResults((prev) => {
              const next = { ...prev };
              delete next[provider.id];
              return next;
            });
          }, 5000);
        }
      } else {
        // Test external ASR
        if (!provider.baseUrl || !provider.model) return;
        setTestingId(provider.id);
        try {
          await window.capty.asrTest({
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            model: provider.model,
          });
          setTestResults((prev) => ({
            ...prev,
            [provider.id]: { ok: true, message: "Connection OK" },
          }));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Connection failed";
          setTestResults((prev) => ({
            ...prev,
            [provider.id]: { ok: false, message: msg },
          }));
        } finally {
          setTestingId(null);
          setTimeout(() => {
            setTestResults((prev) => {
              const next = { ...prev };
              delete next[provider.id];
              return next;
            });
          }, 5000);
        }
      }
    },
    [],
  );

  const handleFetchModels = useCallback(
    async (providerId: string) => {
      const provider = providers.find((p) => p.id === providerId);
      if (!provider?.baseUrl) return;
      setModelsFetchingId(providerId);
      try {
        const fetched = await window.capty.asrFetchModels({
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
        });
        setFetchedModels((prev) => ({ ...prev, [providerId]: fetched }));
        setUseCustomModel((prev) => ({ ...prev, [providerId]: false }));
      } catch {
        setFetchedModels((prev) => ({ ...prev, [providerId]: [] }));
      } finally {
        setModelsFetchingId(null);
      }
    },
    [providers],
  );

  return (
    <>
      {/* ASR Providers */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          marginBottom: "12px",
        }}
      >
        <button
          onClick={handleAddProvider}
          disabled={isRecording}
          style={{
            ...secondaryBtnStyle,
            height: "28px",
            padding: "0 12px",
            fontSize: "11px",
            cursor: isRecording ? "not-allowed" : "pointer",
            opacity: isRecording ? 0.5 : 1,
          }}
        >
          + Add Provider
        </button>
      </div>

      {providers.length === 0 && (
        <div
          style={{
            padding: "24px",
            textAlign: "center",
            color: "var(--text-muted)",
            fontSize: "13px",
            marginBottom: "16px",
          }}
        >
          No ASR providers configured.
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          marginBottom: "24px",
        }}
      >
        {providers.map((provider) => {
          const isActive = selectedId === provider.id;
          const isExpanded = expandedId === provider.id;
          const providerFetchedModels = fetchedModels[provider.id] ?? [];
          const providerUseCustom = useCustomModel[provider.id] ?? false;

          return (
            <div
              key={provider.id}
              style={{
                ...cardStyle,
                marginBottom: "0",
                borderColor: isActive ? "var(--accent)" : "var(--border)",
              }}
            >
              {/* Provider header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div
                  style={{ flex: 1, minWidth: 0, cursor: "pointer" }}
                  onClick={() => handleToggleExpand(provider)}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "10px",
                        color: "var(--text-muted)",
                        display: "inline-block",
                        transition: "transform 0.2s",
                        transform: isExpanded
                          ? "rotate(0deg)"
                          : "rotate(-90deg)",
                        width: "12px",
                        textAlign: "center" as const,
                      }}
                    >
                      &#9660;
                    </span>
                    <span
                      style={{
                        fontSize: "13px",
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      {provider.name}
                    </span>
                    {provider.isSidecar && (
                      <span
                        style={{
                          ...tagStyle,
                          backgroundColor: "rgba(245, 166, 35, 0.12)",
                          color: "#F5A623",
                        }}
                      >
                        Sidecar
                      </span>
                    )}
                    {isActive && (
                      <span
                        style={{
                          ...tagStyle,
                          backgroundColor: "rgba(74, 222, 128, 0.12)",
                          color: "#4ADE80",
                        }}
                      >
                        Active
                      </span>
                    )}
                    {provider.isSidecar && (
                      <span
                        style={{
                          ...tagStyle,
                          backgroundColor: sidecarReady
                            ? "rgba(74, 222, 128, 0.12)"
                            : "rgba(239, 68, 68, 0.12)",
                          color: sidecarReady ? "#4ADE80" : "#EF4444",
                        }}
                      >
                        {sidecarReady ? "Online" : "Offline"}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--text-muted)",
                      marginTop: "4px",
                      paddingLeft: "18px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {provider.baseUrl || "No URL set"}
                    </span>
                    {!provider.isSidecar && provider.model
                      ? ` \u00b7 ${provider.model}`
                      : ""}
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
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTestProvider(provider);
                    }}
                    disabled={testingId === provider.id}
                    style={{
                      ...secondaryBtnStyle,
                      height: "28px",
                      padding: "0 10px",
                      fontSize: "11px",
                      color: "var(--text-secondary)",
                      cursor:
                        testingId === provider.id ? "not-allowed" : "pointer",
                      opacity: testingId === provider.id ? 0.6 : 1,
                    }}
                  >
                    {testingId === provider.id ? "Testing..." : "Test"}
                  </button>
                  {!isActive && (
                    <button
                      onClick={() => handleUseProvider(provider.id)}
                      disabled={isRecording}
                      style={{
                        ...secondaryBtnStyle,
                        height: "28px",
                        padding: "0 10px",
                        fontSize: "11px",
                        borderColor: "var(--accent)",
                        color: "var(--accent)",
                        cursor: isRecording ? "not-allowed" : "pointer",
                        opacity: isRecording ? 0.5 : 1,
                      }}
                    >
                      Use
                    </button>
                  )}
                  {!provider.isSidecar && (
                    <button
                      onClick={() => handleDeleteProvider(provider.id)}
                      disabled={isRecording}
                      style={{
                        ...secondaryBtnStyle,
                        height: "28px",
                        padding: "0 8px",
                        fontSize: "11px",
                        color: "var(--text-muted)",
                        cursor: isRecording ? "not-allowed" : "pointer",
                        opacity: isRecording ? 0.5 : 1,
                      }}
                      title="Delete provider"
                    >
                      &times;
                    </button>
                  )}
                </div>
              </div>

              {/* Test result */}
              {testResults[provider.id] && (
                <div
                  style={{
                    marginTop: "8px",
                    padding: "6px 10px",
                    borderRadius: "6px",
                    fontSize: "11px",
                    lineHeight: "16px",
                    backgroundColor: testResults[provider.id].ok
                      ? "rgba(34, 197, 94, 0.1)"
                      : "rgba(239, 68, 68, 0.1)",
                    color: testResults[provider.id].ok ? "#22c55e" : "#ef4444",
                    wordBreak: "break-word",
                  }}
                >
                  {testResults[provider.id].message}
                </div>
              )}

              {/* Expanded content */}
              {isExpanded && (
                <div
                  style={{
                    marginTop: "12px",
                    borderTop: "1px solid var(--border)",
                    paddingTop: "12px",
                  }}
                >
                  {provider.isSidecar ? (
                    <>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "10px",
                        }}
                      >
                        <div>
                          <div style={labelStyle}>Base URL</div>
                          <input
                            type="text"
                            value={editForm.baseUrl}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                baseUrl: e.target.value,
                              })
                            }
                            placeholder="http://localhost:8765"
                            style={{
                              ...inputStyle,
                              fontFamily: "'JetBrains Mono', monospace",
                            }}
                          />
                        </div>
                        <div
                          style={{
                            padding: "10px 12px",
                            backgroundColor: "var(--bg-primary)",
                            borderRadius: "6px",
                            fontSize: "11px",
                            color: "var(--text-muted)",
                            lineHeight: "18px",
                          }}
                        >
                          <div style={{ marginBottom: "4px", fontWeight: 600 }}>
                            Start command:
                          </div>
                          <code
                            style={{
                              display: "block",
                              padding: "6px 8px",
                              backgroundColor: "var(--bg-tertiary)",
                              borderRadius: "4px",
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: "11px",
                              wordBreak: "break-all",
                            }}
                          >
                            capty-sidecar --models-dir {modelsDir} --port 8765
                          </code>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "flex-end",
                            marginTop: "4px",
                          }}
                        >
                          <button
                            onClick={handleSaveEdit}
                            disabled={!editForm.baseUrl}
                            style={{
                              ...primaryBtnStyle,
                              cursor: !editForm.baseUrl
                                ? "not-allowed"
                                : "pointer",
                              opacity: !editForm.baseUrl ? 0.5 : 1,
                            }}
                          >
                            Save
                          </button>
                        </div>
                      </div>

                      {/* Model Market Entry */}
                      <div
                        style={{
                          marginTop: "16px",
                          borderTop: "1px solid var(--border)",
                          paddingTop: "12px",
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
                            <div style={sectionTitleStyle}>Model Market</div>
                            <div
                              style={{
                                fontSize: "12px",
                                color: "var(--text-muted)",
                              }}
                            >
                              {models.filter((m) => m.downloaded).length}{" "}
                              model(s) installed
                            </div>
                          </div>
                          <button
                            onClick={() => setShowModelMarket(true)}
                            style={primaryBtnStyle}
                          >
                            Browse
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "10px",
                        }}
                      >
                        <div>
                          <div style={labelStyle}>Name</div>
                          <input
                            type="text"
                            value={editForm.name}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                name: e.target.value,
                              })
                            }
                            placeholder="My ASR Server"
                            style={inputStyle}
                          />
                        </div>
                        <div>
                          <div style={labelStyle}>Base URL</div>
                          <input
                            type="text"
                            value={editForm.baseUrl}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                baseUrl: e.target.value,
                              })
                            }
                            placeholder="http://localhost:8080"
                            style={{
                              ...inputStyle,
                              fontFamily: "monospace",
                            }}
                          />
                        </div>
                        <div>
                          <div style={labelStyle}>API Key (optional)</div>
                          <input
                            type="password"
                            value={editForm.apiKey}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                apiKey: e.target.value,
                              })
                            }
                            placeholder="sk-..."
                            style={{
                              ...inputStyle,
                              fontFamily: "monospace",
                            }}
                          />
                        </div>
                        <div>
                          <div style={labelStyle}>Model</div>
                          <div style={{ display: "flex", gap: "6px" }}>
                            {providerFetchedModels.length > 0 &&
                            !providerUseCustom ? (
                              <select
                                value={editForm.model}
                                onChange={(e) => {
                                  if (e.target.value === "__custom__") {
                                    setUseCustomModel((prev) => ({
                                      ...prev,
                                      [provider.id]: true,
                                    }));
                                  } else {
                                    setEditForm({
                                      ...editForm,
                                      model: e.target.value,
                                    });
                                  }
                                }}
                                style={{
                                  ...inputStyle,
                                  flex: 1,
                                  width: "auto",
                                }}
                              >
                                <option value="" disabled>
                                  Select a model...
                                </option>
                                {providerFetchedModels.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.name}
                                  </option>
                                ))}
                                <option value="__custom__">Custom...</option>
                              </select>
                            ) : (
                              <input
                                type="text"
                                value={editForm.model}
                                onChange={(e) =>
                                  setEditForm({
                                    ...editForm,
                                    model: e.target.value,
                                  })
                                }
                                placeholder="e.g. whisper-1"
                                style={{ ...inputStyle, flex: 1 }}
                              />
                            )}
                            <button
                              onClick={() => handleFetchModels(provider.id)}
                              disabled={
                                modelsFetchingId === provider.id ||
                                !editForm.baseUrl
                              }
                              style={{
                                ...secondaryBtnStyle,
                                color: "var(--text-muted)",
                                cursor:
                                  modelsFetchingId === provider.id ||
                                  !editForm.baseUrl
                                    ? "not-allowed"
                                    : "pointer",
                                opacity:
                                  modelsFetchingId === provider.id ||
                                  !editForm.baseUrl
                                    ? 0.5
                                    : 1,
                              }}
                            >
                              {modelsFetchingId === provider.id
                                ? "Fetching..."
                                : "Fetch Models"}
                            </button>
                          </div>
                          {providerUseCustom &&
                            providerFetchedModels.length > 0 && (
                              <button
                                onClick={() =>
                                  setUseCustomModel((prev) => ({
                                    ...prev,
                                    [provider.id]: false,
                                  }))
                                }
                                style={{
                                  marginTop: "4px",
                                  padding: "0",
                                  fontSize: "11px",
                                  color: "var(--accent)",
                                  background: "none",
                                  border: "none",
                                  cursor: "pointer",
                                }}
                              >
                                Back to model list
                              </button>
                            )}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "flex-end",
                            marginTop: "4px",
                          }}
                        >
                          <button
                            onClick={handleSaveEdit}
                            disabled={!editForm.baseUrl}
                            style={{
                              ...primaryBtnStyle,
                              cursor: !editForm.baseUrl
                                ? "not-allowed"
                                : "pointer",
                              opacity: !editForm.baseUrl ? 0.5 : 1,
                            }}
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Model Market Modal */}
      {showModelMarket && (
        <ModelMarketModal
          models={models}
          selectedModelId={selectedModelId}
          isDownloading={isDownloading}
          downloadingModelId={downloadingModelId}
          downloadProgress={downloadProgress}
          downloadError={downloadError}
          isRecording={isRecording}
          hfMirrorUrl={hfMirrorUrl}
          defaultHfUrl={defaultHfUrl}
          downloads={downloads}
          onSelectModel={onSelectModel}
          onDownloadModel={onDownloadModel}
          onDeleteModel={onDeleteModel}
          onSearchModels={onSearchModels}
          onChangeHfMirrorUrl={onChangeHfMirrorUrl}
          onPauseDownload={onPauseDownload}
          onResumeDownload={onResumeDownload}
          onCancelDownload={onCancelDownload}
          onClose={() => setShowModelMarket(false)}
        />
      )}
    </>
  );
}

/* ─── Page: TTS Providers ─── */

function TtsTab({
  ttsProviders: initialProviders,
  selectedTtsProviderId: initialSelectedId,
  sidecarReady,
  isRecording,
  ttsModels,
  selectedTtsModelId,
  isTtsDownloading,
  ttsDownloadingModelId,
  ttsDownloadProgress,
  ttsDownloadError,
  hfMirrorUrl,
  defaultHfUrl,
  downloads,
  onSaveTtsSettings,
  onSelectTtsModel,
  onDownloadTtsModel,
  onDeleteTtsModel,
  onSearchTtsModels,
  onChangeHfMirrorUrl,
  onPauseDownload,
  onResumeDownload,
  onCancelDownload,
}: {
  readonly ttsProviders: readonly TtsProviderConfig[];
  readonly selectedTtsProviderId: string | null;
  readonly sidecarReady: boolean;
  readonly isRecording: boolean;
  readonly ttsModels: readonly ModelInfo[];
  readonly selectedTtsModelId: string;
  readonly isTtsDownloading: boolean;
  readonly ttsDownloadingModelId: string | null;
  readonly ttsDownloadProgress: number;
  readonly ttsDownloadError: string | null;
  readonly hfMirrorUrl: string;
  readonly defaultHfUrl: string;
  readonly downloads: Record<
    string,
    {
      modelId: string;
      category: string;
      percent: number;
      status: string;
      error?: string;
    }
  >;
  readonly onSaveTtsSettings: (settings: {
    ttsProviders: TtsProviderConfig[];
    selectedTtsProviderId: string | null;
  }) => void;
  readonly onSelectTtsModel: (modelId: string) => void;
  readonly onDownloadTtsModel: (model: ModelInfo) => void;
  readonly onDeleteTtsModel: (modelId: string) => void;
  readonly onSearchTtsModels: (query: string) => Promise<ModelInfo[]>;
  readonly onChangeHfMirrorUrl: (url: string) => void;
  readonly onPauseDownload: (modelId: string) => void;
  readonly onResumeDownload: (modelId: string) => void;
  readonly onCancelDownload: (modelId: string) => void;
}): React.ReactElement {
  const [providers, setProviders] = useState<TtsProviderConfig[]>([
    ...initialProviders,
  ]);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId,
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    baseUrl: "",
    apiKey: "",
    model: "",
    voice: "auto",
  });
  const [showModelMarket, setShowModelMarket] = useState(false);
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; message: string }>
  >({});
  const [testingId, setTestingId] = useState<string | null>(null);

  const saveProviders = useCallback(
    (next: TtsProviderConfig[], nextSelectedId: string | null) => {
      setProviders(next);
      setSelectedId(nextSelectedId);
      onSaveTtsSettings({
        ttsProviders: next,
        selectedTtsProviderId: nextSelectedId,
      });
    },
    [onSaveTtsSettings],
  );

  const handleAddProvider = useCallback(() => {
    const id = `tts-ext-${Date.now()}`;
    const newProvider: TtsProviderConfig = {
      id,
      name: "New TTS Provider",
      baseUrl: "",
      apiKey: "",
      model: "",
      voice: "auto",
      isSidecar: false,
    };
    const next = [...providers, newProvider];
    saveProviders(next, selectedId);
    setExpandedId(id);
    setEditForm({
      name: "New TTS Provider",
      baseUrl: "",
      apiKey: "",
      model: "",
      voice: "auto",
    });
  }, [providers, selectedId, saveProviders]);

  const handleUseProvider = useCallback(
    (providerId: string) => {
      saveProviders([...providers], providerId);
    },
    [providers, saveProviders],
  );

  const handleToggleExpand = useCallback(
    (provider: TtsProviderConfig) => {
      if (expandedId === provider.id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(provider.id);
      setEditForm({
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
        voice: provider.voice,
      });
    },
    [expandedId],
  );

  const handleSaveEdit = useCallback(() => {
    if (!expandedId) return;
    const next = providers.map((p) =>
      p.id === expandedId
        ? {
            ...p,
            name: p.isSidecar ? p.name : editForm.name || "External TTS",
            baseUrl: editForm.baseUrl,
            apiKey: editForm.apiKey,
            model: p.isSidecar ? p.model : editForm.model,
            voice: editForm.voice,
          }
        : p,
    );
    saveProviders(next, selectedId);
  }, [expandedId, editForm, providers, selectedId, saveProviders]);

  const handleDeleteProvider = useCallback(
    (providerId: string) => {
      const next = providers.filter((p) => p.id !== providerId);
      const nextSelectedId =
        selectedId === providerId ? (next[0]?.id ?? null) : selectedId;
      saveProviders(next, nextSelectedId);
      if (expandedId === providerId) setExpandedId(null);
    },
    [providers, selectedId, expandedId, saveProviders],
  );

  const handleTestProvider = useCallback(
    async (provider: TtsProviderConfig) => {
      if (provider.isSidecar) {
        setTestingId(provider.id);
        try {
          const result = await window.capty.checkSidecarHealth();
          setTestResults((prev) => ({
            ...prev,
            [provider.id]: {
              ok: result.online,
              message: result.online
                ? "Sidecar is online"
                : "Sidecar is offline",
            },
          }));
        } catch {
          setTestResults((prev) => ({
            ...prev,
            [provider.id]: { ok: false, message: "Sidecar is offline" },
          }));
        } finally {
          setTestingId(null);
          setTimeout(() => {
            setTestResults((prev) => {
              const next = { ...prev };
              delete next[provider.id];
              return next;
            });
          }, 5000);
        }
      } else {
        // Test external TTS provider
        if (!provider.baseUrl) return;
        setTestingId(provider.id);
        try {
          const result = await window.capty.ttsTest({
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            model: provider.model,
          });
          setTestResults((prev) => ({
            ...prev,
            [provider.id]: {
              ok: true,
              message: `TTS working (${Math.round(result.bytes / 1024)}KB)`,
            },
          }));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Connection failed";
          setTestResults((prev) => ({
            ...prev,
            [provider.id]: { ok: false, message: msg },
          }));
        } finally {
          setTestingId(null);
          setTimeout(() => {
            setTestResults((prev) => {
              const next = { ...prev };
              delete next[provider.id];
              return next;
            });
          }, 5000);
        }
      }
    },
    [],
  );

  return (
    <>
      {/* Add Provider button */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          marginBottom: "12px",
        }}
      >
        <button
          onClick={handleAddProvider}
          disabled={isRecording}
          style={{
            ...secondaryBtnStyle,
            height: "28px",
            padding: "0 12px",
            fontSize: "11px",
            cursor: isRecording ? "not-allowed" : "pointer",
            opacity: isRecording ? 0.5 : 1,
          }}
        >
          + Add Provider
        </button>
      </div>

      {providers.length === 0 && (
        <div
          style={{
            padding: "24px",
            textAlign: "center",
            color: "var(--text-muted)",
            fontSize: "13px",
            marginBottom: "16px",
          }}
        >
          No TTS providers configured.
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          marginBottom: "24px",
        }}
      >
        {providers.map((provider) => {
          const isActive = selectedId === provider.id;
          const isExpanded = expandedId === provider.id;
          const testResult = testResults[provider.id];

          return (
            <div
              key={provider.id}
              style={{
                ...cardStyle,
                marginBottom: "0",
                borderColor: isActive ? "var(--accent)" : "var(--border)",
              }}
            >
              {/* Provider header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div
                  style={{ flex: 1, minWidth: 0, cursor: "pointer" }}
                  onClick={() => handleToggleExpand(provider)}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "10px",
                        color: "var(--text-muted)",
                        display: "inline-block",
                        transition: "transform 0.2s",
                        transform: isExpanded
                          ? "rotate(0deg)"
                          : "rotate(-90deg)",
                        width: "12px",
                        textAlign: "center" as const,
                      }}
                    >
                      &#9660;
                    </span>
                    <span
                      style={{
                        fontSize: "13px",
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      {provider.name}
                    </span>
                    {provider.isSidecar && (
                      <span
                        style={{
                          ...tagStyle,
                          backgroundColor: "rgba(168, 85, 247, 0.12)",
                          color: "#A855F7",
                        }}
                      >
                        Sidecar
                      </span>
                    )}
                    {isActive && (
                      <span
                        style={{
                          ...tagStyle,
                          backgroundColor: "rgba(74, 222, 128, 0.12)",
                          color: "#4ADE80",
                        }}
                      >
                        Active
                      </span>
                    )}
                    {provider.isSidecar && (
                      <span
                        style={{
                          ...tagStyle,
                          backgroundColor: sidecarReady
                            ? "rgba(74, 222, 128, 0.12)"
                            : "rgba(239, 68, 68, 0.12)",
                          color: sidecarReady ? "#4ADE80" : "#EF4444",
                        }}
                      >
                        {sidecarReady ? "Online" : "Offline"}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--text-muted)",
                      marginTop: "4px",
                      paddingLeft: "18px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {provider.baseUrl || "No URL set"}
                    </span>
                    {!provider.isSidecar && provider.model
                      ? ` \u00b7 ${provider.model}`
                      : ""}
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: "6px",
                    alignItems: "center",
                    flexShrink: 0,
                    marginLeft: "12px",
                  }}
                >
                  {testResult && (
                    <span
                      style={{
                        fontSize: "11px",
                        color: testResult.ok ? "#4ADE80" : "#EF4444",
                        maxWidth: "120px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {testResult.message}
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTestProvider(provider);
                    }}
                    disabled={testingId === provider.id}
                    style={{
                      ...secondaryBtnStyle,
                      height: "28px",
                      padding: "0 10px",
                      fontSize: "11px",
                      color: "var(--text-secondary)",
                      cursor:
                        testingId === provider.id ? "not-allowed" : "pointer",
                      opacity: testingId === provider.id ? 0.6 : 1,
                    }}
                  >
                    {testingId === provider.id ? "Testing..." : "Test"}
                  </button>
                  {!isActive && (
                    <button
                      onClick={() => handleUseProvider(provider.id)}
                      disabled={isRecording}
                      style={{
                        ...primaryBtnStyle,
                        height: "26px",
                        padding: "0 10px",
                        fontSize: "11px",
                        cursor: isRecording ? "not-allowed" : "pointer",
                        opacity: isRecording ? 0.5 : 1,
                      }}
                    >
                      Use
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded panel */}
              {isExpanded && (
                <div
                  style={{
                    marginTop: "12px",
                    borderTop: "1px solid var(--border)",
                    paddingTop: "12px",
                  }}
                >
                  {provider.isSidecar ? (
                    <>
                      <div style={sectionDescStyle}>
                        TTS models are managed by the local sidecar. Use the TTS
                        Model Market to download models.
                      </div>
                      <button
                        onClick={() => setShowModelMarket(true)}
                        style={{ ...primaryBtnStyle, marginBottom: "8px" }}
                      >
                        Open TTS Model Market
                      </button>
                    </>
                  ) : (
                    <>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                        }}
                      >
                        <div>
                          <div style={labelStyle}>Name</div>
                          <input
                            type="text"
                            value={editForm.name}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                name: e.target.value,
                              })
                            }
                            style={inputStyle}
                          />
                        </div>
                        <div>
                          <div style={labelStyle}>Base URL</div>
                          <input
                            type="text"
                            value={editForm.baseUrl}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                baseUrl: e.target.value,
                              })
                            }
                            placeholder="https://api.example.com/v1"
                            style={inputStyle}
                          />
                        </div>
                        <div>
                          <div style={labelStyle}>API Key</div>
                          <input
                            type="password"
                            value={editForm.apiKey}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                apiKey: e.target.value,
                              })
                            }
                            placeholder="sk-..."
                            style={{ ...inputStyle, fontFamily: "monospace" }}
                          />
                        </div>
                        <div>
                          <div style={labelStyle}>Model</div>
                          <input
                            type="text"
                            value={editForm.model}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                model: e.target.value,
                              })
                            }
                            placeholder="e.g. tts-1"
                            style={inputStyle}
                          />
                        </div>
                        <div>
                          <div style={labelStyle}>Voice</div>
                          <input
                            type="text"
                            value={editForm.voice}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                voice: e.target.value,
                              })
                            }
                            placeholder="auto"
                            style={inputStyle}
                          />
                        </div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            marginTop: "4px",
                          }}
                        >
                          <button
                            onClick={() => handleDeleteProvider(provider.id)}
                            style={{
                              ...secondaryBtnStyle,
                              color: "#EF4444",
                              borderColor: "rgba(239, 68, 68, 0.3)",
                            }}
                          >
                            Delete
                          </button>
                          <button
                            onClick={handleSaveEdit}
                            disabled={!editForm.baseUrl}
                            style={{
                              ...primaryBtnStyle,
                              cursor: !editForm.baseUrl
                                ? "not-allowed"
                                : "pointer",
                              opacity: !editForm.baseUrl ? 0.5 : 1,
                            }}
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* TTS Model Market Modal */}
      {showModelMarket && (
        <ModelMarketModal
          models={ttsModels}
          selectedModelId={selectedTtsModelId}
          isDownloading={isTtsDownloading}
          downloadingModelId={ttsDownloadingModelId}
          downloadProgress={ttsDownloadProgress}
          downloadError={ttsDownloadError}
          isRecording={isRecording}
          hfMirrorUrl={hfMirrorUrl}
          defaultHfUrl={defaultHfUrl}
          downloads={downloads}
          onSelectModel={onSelectTtsModel}
          onDownloadModel={onDownloadTtsModel}
          onDeleteModel={onDeleteTtsModel}
          onSearchModels={onSearchTtsModels}
          onChangeHfMirrorUrl={onChangeHfMirrorUrl}
          onPauseDownload={onPauseDownload}
          onResumeDownload={onResumeDownload}
          onCancelDownload={onCancelDownload}
          onClose={() => setShowModelMarket(false)}
        />
      )}
    </>
  );
}

/* ─── Preset LLM provider templates ─── */

const PRESET_PROVIDERS: readonly {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
}[] = [
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
  },
];

/* ─── Page: Language Models ─── */

function LanguageModelsTab({
  llmProviders,
  onSave,
}: {
  readonly llmProviders: readonly LlmProvider[];
  readonly onSave: (providers: LlmProvider[]) => void;
}): React.ReactElement {
  const [providers, setProviders] = useState<LlmProvider[]>([...llmProviders]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    baseUrl: "",
    apiKey: "",
    model: "",
  });
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; message: string }>
  >({});

  const save = useCallback(
    (next: LlmProvider[]) => {
      setProviders(next);
      onSave(next);
    },
    [onSave],
  );

  const handleAddPreset = useCallback(
    (presetId: string) => {
      const preset = PRESET_PROVIDERS.find((p) => p.id === presetId);
      if (!preset) return;
      if (providers.some((p) => p.id === preset.id)) return;
      const newProvider: LlmProvider = {
        id: preset.id,
        name: preset.name,
        baseUrl: preset.baseUrl,
        apiKey: "",
        model: "",
        isPreset: true,
      };
      const next = [...providers, newProvider];
      save(next);
      setEditingId(newProvider.id);
      setEditForm({
        name: newProvider.name,
        baseUrl: newProvider.baseUrl,
        apiKey: "",
        model: "",
      });
    },
    [providers, save],
  );

  const handleAddCustom = useCallback(() => {
    const id = `custom-${Date.now()}`;
    const newProvider: LlmProvider = {
      id,
      name: "Custom Provider",
      baseUrl: "",
      apiKey: "",
      model: "",
      isPreset: false,
    };
    const next = [...providers, newProvider];
    save(next);
    setEditingId(id);
    setEditForm({
      name: "Custom Provider",
      baseUrl: "",
      apiKey: "",
      model: "",
    });
  }, [providers, save]);

  const handleEdit = useCallback(
    (provider: LlmProvider) => {
      if (editingId === provider.id) {
        setEditingId(null);
        return;
      }
      setEditingId(provider.id);
      setEditForm({
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
      });
    },
    [editingId],
  );

  const handleSaveEdit = useCallback(() => {
    if (!editingId) return;
    const next = providers.map((p) =>
      p.id === editingId
        ? {
            ...p,
            name: p.isPreset ? p.name : editForm.name,
            baseUrl: p.isPreset ? p.baseUrl : editForm.baseUrl,
            apiKey: editForm.apiKey,
            model: editForm.model,
          }
        : p,
    );
    save(next);
    setEditingId(null);
  }, [editingId, editForm, providers, save]);

  const handleDelete = useCallback(
    (providerId: string) => {
      const next = providers.filter((p) => p.id !== providerId);
      save(next);
      if (editingId === providerId) setEditingId(null);
    },
    [providers, editingId, save],
  );

  const handleTest = useCallback(async (provider: LlmProvider) => {
    setTestingId(provider.id);
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[provider.id];
      return next;
    });
    try {
      const result = await window.capty.testLlmProvider({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
      });
      setTestResults((prev) => ({
        ...prev,
        [provider.id]: {
          ok: true,
          message: `Connection OK (model: ${result.model})`,
        },
      }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setTestResults((prev) => ({
        ...prev,
        [provider.id]: { ok: false, message: msg },
      }));
    } finally {
      setTestingId(null);
      setTimeout(() => {
        setTestResults((prev) => {
          const next = { ...prev };
          delete next[provider.id];
          return next;
        });
      }, 5000);
    }
  }, []);

  const availablePresets = PRESET_PROVIDERS.filter(
    (preset) => !providers.some((p) => p.id === preset.id),
  );

  return (
    <>
      {/* Add buttons */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        {availablePresets.length > 0 && (
          <select
            onChange={(e) => {
              if (e.target.value) handleAddPreset(e.target.value);
              e.target.value = "";
            }}
            defaultValue=""
            style={{
              ...inputStyle,
              width: "auto",
              padding: "0 10px",
              cursor: "pointer",
            }}
          >
            <option value="" disabled>
              Add Preset...
            </option>
            {availablePresets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <button onClick={handleAddCustom} style={secondaryBtnStyle}>
          + Custom
        </button>
      </div>

      {/* Provider list */}
      {providers.length === 0 && (
        <div
          style={{
            padding: "24px",
            textAlign: "center",
            color: "var(--text-muted)",
            fontSize: "13px",
          }}
        >
          No Language Model providers configured. Add a preset or custom
          provider to enable summarization.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {providers.map((provider) => {
          const isConfigured = Boolean(provider.apiKey && provider.model);
          const isEditing = editingId === provider.id;

          return (
            <div
              key={provider.id}
              style={{
                ...cardStyle,
                marginBottom: "8px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "13px",
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      {provider.name}
                    </span>
                    {provider.isPreset && (
                      <span
                        style={{
                          ...tagStyle,
                          backgroundColor: "rgba(245, 166, 35, 0.12)",
                          color: "#F5A623",
                        }}
                      >
                        Preset
                      </span>
                    )}
                    <span
                      style={{
                        ...tagStyle,
                        backgroundColor: isConfigured
                          ? "rgba(74, 222, 128, 0.12)"
                          : "rgba(239, 68, 68, 0.12)",
                        color: isConfigured ? "#4ADE80" : "#EF4444",
                      }}
                    >
                      {isConfigured ? "Configured" : "Not configured"}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--text-muted)",
                      marginTop: "4px",
                    }}
                  >
                    {provider.baseUrl || "No URL set"}
                    {provider.model ? ` \u00b7 ${provider.model}` : ""}
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
                  {isConfigured && (
                    <button
                      onClick={() => handleTest(provider)}
                      disabled={testingId === provider.id}
                      style={{
                        ...secondaryBtnStyle,
                        height: "28px",
                        padding: "0 10px",
                        fontSize: "11px",
                        color: "var(--text-muted)",
                        cursor:
                          testingId === provider.id ? "not-allowed" : "pointer",
                        opacity: testingId === provider.id ? 0.6 : 1,
                      }}
                    >
                      {testingId === provider.id ? "Testing..." : "Test"}
                    </button>
                  )}
                  <button
                    onClick={() => handleEdit(provider)}
                    style={{
                      ...secondaryBtnStyle,
                      height: "28px",
                      padding: "0 10px",
                      fontSize: "11px",
                      color: "var(--text-muted)",
                    }}
                  >
                    {isEditing ? "Cancel" : "Edit"}
                  </button>
                  {!provider.isPreset && (
                    <button
                      onClick={() => handleDelete(provider.id)}
                      style={{
                        ...secondaryBtnStyle,
                        height: "28px",
                        padding: "0 8px",
                        fontSize: "11px",
                        color: "var(--text-muted)",
                      }}
                      title="Delete provider"
                    >
                      &times;
                    </button>
                  )}
                </div>
              </div>

              {/* Test result */}
              {testResults[provider.id] && (
                <div
                  style={{
                    marginTop: "8px",
                    padding: "6px 10px",
                    borderRadius: "6px",
                    fontSize: "11px",
                    lineHeight: "16px",
                    backgroundColor: testResults[provider.id].ok
                      ? "rgba(34, 197, 94, 0.1)"
                      : "rgba(239, 68, 68, 0.1)",
                    color: testResults[provider.id].ok ? "#22c55e" : "#ef4444",
                    wordBreak: "break-word",
                  }}
                >
                  {testResults[provider.id].message}
                </div>
              )}

              {/* Edit form */}
              {isEditing && (
                <div
                  style={{
                    marginTop: "12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  {!provider.isPreset && (
                    <>
                      <div>
                        <div style={labelStyle}>Name</div>
                        <input
                          type="text"
                          value={editForm.name}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              name: e.target.value,
                            })
                          }
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <div style={labelStyle}>Base URL</div>
                        <input
                          type="text"
                          value={editForm.baseUrl}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              baseUrl: e.target.value,
                            })
                          }
                          placeholder="https://api.example.com/v1"
                          style={{ ...inputStyle, fontFamily: "monospace" }}
                        />
                      </div>
                    </>
                  )}
                  <div>
                    <div style={labelStyle}>API Key</div>
                    <input
                      type="password"
                      value={editForm.apiKey}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          apiKey: e.target.value,
                        })
                      }
                      placeholder="sk-..."
                      style={{ ...inputStyle, fontFamily: "monospace" }}
                    />
                  </div>
                  <div>
                    <div style={labelStyle}>Model Name</div>
                    <input
                      type="text"
                      value={editForm.model}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          model: e.target.value,
                        })
                      }
                      placeholder="e.g. gpt-4o, deepseek-chat"
                      style={inputStyle}
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      marginTop: "4px",
                    }}
                  >
                    <button
                      onClick={handleSaveEdit}
                      disabled={!editForm.apiKey || !editForm.model}
                      style={{
                        ...primaryBtnStyle,
                        cursor:
                          !editForm.apiKey || !editForm.model
                            ? "not-allowed"
                            : "pointer",
                        opacity: !editForm.apiKey || !editForm.model ? 0.5 : 1,
                      }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ─── Main Settings Modal ─── */

export function SettingsModal({
  dataDir,
  configDir,
  models,
  selectedModelId,
  isDownloading,
  downloadingModelId,
  downloadProgress,
  downloadError,
  isRecording,
  hfMirrorUrl,
  defaultHfUrl,
  llmProviders,
  asrProviders,
  selectedAsrProviderId,
  sidecarReady,
  ttsProviders,
  selectedTtsProviderId,
  ttsModels,
  selectedTtsModelId,
  isTtsDownloading,
  ttsDownloadingModelId,
  ttsDownloadProgress,
  ttsDownloadError,
  onChangeDataDir,
  onSelectModel,
  onDownloadModel,
  onDeleteModel,
  onSearchModels,
  onChangeHfMirrorUrl,
  onSaveLlmProviders,
  onSaveAsrSettings,
  onSaveTtsSettings,
  onSelectTtsModel,
  onDownloadTtsModel,
  onDeleteTtsModel,
  onSearchTtsModels,
  onClose,
}: SettingsModalProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState<TabId>("general");

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
        backgroundColor: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 3000,
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
      onClick={handleOverlayClick}
    >
      <div
        style={{
          backgroundColor: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          width: "640px",
          minWidth: "640px",
          maxWidth: "90vw",
          height: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
          overflow: "hidden",
        }}
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
          <h2
            style={{
              fontSize: "16px",
              fontWeight: 700,
              margin: 0,
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
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
              borderRadius: "4px",
            }}
          >
            &times;
          </button>
        </div>

        {/* Body: Sidebar + Content */}
        <div
          style={{
            display: "flex",
            flex: 1,
            overflow: "hidden",
          }}
        >
          {/* Left sidebar */}
          <div
            style={{
              width: "160px",
              flexShrink: 0,
              backgroundColor: "var(--bg-primary)",
              padding: "12px 8px",
              display: "flex",
              flexDirection: "column",
              gap: "2px",
              borderRight: "1px solid var(--border)",
              borderBottomLeftRadius: "12px",
            }}
          >
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "10px 14px",
                    borderRadius: "6px",
                    border: "none",
                    background: isActive ? "var(--accent)" : "transparent",
                    color: isActive ? "white" : "var(--text-secondary)",
                    fontSize: "13px",
                    fontWeight: isActive ? 600 : 400,
                    cursor: "pointer",
                    transition: "background-color 0.15s ease",
                    textAlign: "left",
                    width: "100%",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor =
                        "rgba(245, 166, 35, 0.08)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = "transparent";
                    }
                  }}
                >
                  <span style={{ fontSize: "16px", lineHeight: 1 }}>
                    {tab.icon}
                  </span>
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Right content */}
          <div
            style={{
              flex: 1,
              padding: "24px",
              overflowY: "auto",
            }}
          >
            {activeTab === "general" && (
              <GeneralTab
                dataDir={dataDir}
                configDir={configDir}
                isRecording={isRecording}
                onChangeDataDir={onChangeDataDir}
              />
            )}
            {activeTab === "speech" && (
              <SpeechTab
                asrProviders={asrProviders}
                selectedAsrProviderId={selectedAsrProviderId}
                sidecarReady={sidecarReady}
                isRecording={isRecording}
                dataDir={dataDir}
                models={models}
                selectedModelId={selectedModelId}
                isDownloading={isDownloading}
                downloadingModelId={downloadingModelId}
                downloadProgress={downloadProgress}
                downloadError={downloadError}
                hfMirrorUrl={hfMirrorUrl}
                defaultHfUrl={defaultHfUrl}
                downloads={downloads}
                onSaveAsrSettings={onSaveAsrSettings}
                onSelectModel={onSelectModel}
                onDownloadModel={onDownloadModel}
                onDeleteModel={onDeleteModel}
                onSearchModels={onSearchModels}
                onChangeHfMirrorUrl={onChangeHfMirrorUrl}
                onPauseDownload={onPauseDownload}
                onResumeDownload={onResumeDownload}
                onCancelDownload={onCancelDownload}
              />
            )}
            {activeTab === "tts" && (
              <TtsTab
                ttsProviders={ttsProviders}
                selectedTtsProviderId={selectedTtsProviderId}
                sidecarReady={sidecarReady}
                isRecording={isRecording}
                ttsModels={ttsModels}
                selectedTtsModelId={selectedTtsModelId}
                isTtsDownloading={isTtsDownloading}
                ttsDownloadingModelId={ttsDownloadingModelId}
                ttsDownloadProgress={ttsDownloadProgress}
                ttsDownloadError={ttsDownloadError}
                hfMirrorUrl={hfMirrorUrl}
                defaultHfUrl={defaultHfUrl}
                downloads={downloads}
                onSaveTtsSettings={onSaveTtsSettings}
                onSelectTtsModel={onSelectTtsModel}
                onDownloadTtsModel={onDownloadTtsModel}
                onDeleteTtsModel={onDeleteTtsModel}
                onSearchTtsModels={onSearchTtsModels}
                onChangeHfMirrorUrl={onChangeHfMirrorUrl}
                onPauseDownload={onPauseDownload}
                onResumeDownload={onResumeDownload}
                onCancelDownload={onCancelDownload}
              />
            )}
            {activeTab === "language-models" && (
              <LanguageModelsTab
                llmProviders={llmProviders}
                onSave={onSaveLlmProviders}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
