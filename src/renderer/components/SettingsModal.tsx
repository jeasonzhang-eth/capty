import React, { useCallback, useEffect, useRef, useState } from "react";

interface ModelInfo {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly repo: string;
  readonly downloaded: boolean;
  readonly size_gb: number;
  readonly languages: readonly string[];
  readonly description: string;
  readonly supported?: boolean;
}

export interface LlmProvider {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly models: string[];
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

/** Shared base for ASR/TTS provider configs */
interface BaseProviderConfig {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly isSidecar: boolean;
}

interface BaseEditForm {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface TtsEditForm extends BaseEditForm {
  voice: string;
}

interface ProviderCategoryConfig<
  P extends BaseProviderConfig,
  F extends BaseEditForm,
> {
  readonly category: "asr" | "tts";
  readonly sidecarColor: string;
  readonly sidecarBg: string;
  readonly categoryLabel: string;
  readonly idPrefix: string;
  readonly defaultName: string;
  readonly fallbackName: string;
  readonly createBlankForm: () => F;
  readonly providerToForm: (provider: P) => F;
  readonly applyForm: (provider: P, form: F) => P;
  readonly createNewProvider: (id: string) => P;
  readonly testProvider: (
    provider: P,
  ) => Promise<{ ok: boolean; message: string }>;
  readonly canTest: (provider: P) => boolean;
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
  readonly selectedTtsVoice: string;
  readonly ttsVoices: readonly {
    id: string;
    name: string;
    lang: string;
    gender: string;
  }[];
  readonly onChangeTtsVoice: (voice: string) => void;
  readonly onChangeTtsModel: (modelId: string) => void;
  readonly selectedSummaryModel: {
    providerId: string;
    model: string;
  } | null;
  readonly onChangeSummaryModel: (sel: {
    providerId: string;
    model: string;
  }) => void;
  readonly selectedRapidModel: {
    providerId: string;
    model: string;
  } | null;
  readonly onChangeRapidModel: (sel: {
    providerId: string;
    model: string;
  }) => void;
  readonly rapidRenamePrompt: string;
  readonly onChangeRapidRenamePrompt: (prompt: string) => void;
  readonly selectedTranslateModel: {
    providerId: string;
    model: string;
  } | null;
  readonly onChangeTranslateModel: (sel: {
    providerId: string;
    model: string;
  }) => void;
  readonly translatePrompt: string;
  readonly onChangeTranslatePrompt: (prompt: string) => void;
  readonly autoStartSidecar: boolean;
  readonly onChangeAutoStartSidecar: (value: boolean) => void;
  readonly initialTab?: TabId;
  readonly onTabChange?: (tab: TabId) => void;
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

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: "6px",
  border: "1px solid var(--border)",
  backgroundColor: "var(--bg-primary)",
  color: "var(--text-primary)",
  fontSize: "13px",
  outline: "none",
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

export type TabId = "general" | "default-models" | "asr" | "tts" | "llm";

const TABS: readonly {
  readonly id: TabId;
  readonly icon: string;
  readonly label: string;
}[] = [
  { id: "general", icon: "\u2699\ufe0f", label: "General" },
  { id: "default-models", icon: "\ud83c\udfaf", label: "Default Models" },
  { id: "asr", icon: "\ud83c\udf99\ufe0f", label: "ASR Providers" },
  { id: "tts", icon: "\ud83d\udd0a", label: "TTS Providers" },
  { id: "llm", icon: "\ud83e\udde0", label: "LLM Providers" },
];

/* ─── Small reusable components ─── */

const MODEL_TYPE_STYLES: Record<
  string,
  { bg: string; color: string; label: string }
> = {
  // ASR types
  whisper: {
    bg: "rgba(74, 222, 128, 0.12)",
    color: "#4ADE80",
    label: "Whisper",
  },
  "qwen-asr": {
    bg: "rgba(245, 166, 35, 0.12)",
    color: "#F5A623",
    label: "Qwen ASR",
  },
  parakeet: {
    bg: "rgba(96, 165, 250, 0.12)",
    color: "#60A5FA",
    label: "Parakeet",
  },
  // TTS types
  "qwen3-tts": {
    bg: "rgba(245, 166, 35, 0.12)",
    color: "#F5A623",
    label: "Qwen TTS",
  },
  kokoro: {
    bg: "rgba(168, 85, 247, 0.12)",
    color: "#A855F7",
    label: "Kokoro",
  },
  "spark-tts": {
    bg: "rgba(251, 146, 60, 0.12)",
    color: "#FB923C",
    label: "Spark TTS",
  },
  outetts: {
    bg: "rgba(34, 211, 238, 0.12)",
    color: "#22D3EE",
    label: "OuteTTS",
  },
  chatterbox: {
    bg: "rgba(244, 114, 182, 0.12)",
    color: "#F472B6",
    label: "Chatterbox",
  },
  voxtral: {
    bg: "rgba(129, 140, 248, 0.12)",
    color: "#818CF8",
    label: "Voxtral",
  },
};

const DEFAULT_ASR_STYLE = {
  bg: "rgba(148, 163, 184, 0.12)",
  color: "#94A3B8",
  label: "ASR",
};

const DEFAULT_TTS_STYLE = {
  bg: "rgba(148, 163, 184, 0.12)",
  color: "#94A3B8",
  label: "TTS",
};

function TypeTag({
  type,
  category,
}: {
  readonly type: string;
  readonly category: "asr" | "tts";
}): React.ReactElement {
  const fallback = category === "tts" ? DEFAULT_TTS_STYLE : DEFAULT_ASR_STYLE;
  const s = MODEL_TYPE_STYLES[type] ?? fallback;
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
  category,
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
  readonly category: "asr" | "tts";
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
  const isSupported = model.supported !== false;
  const canSelect =
    model.downloaded && isSupported && !isSelected && !isRecording;

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
            <TypeTag type={model.type} category={category} />
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
            {model.downloaded && isSupported && (
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
            {model.supported === true && !model.downloaded && (
              <span
                style={{
                  ...tagStyle,
                  backgroundColor: "rgba(59, 130, 246, 0.12)",
                  color: "#60A5FA",
                }}
                title="This model type is supported by mlx-audio"
              >
                Compatible
              </span>
            )}
            {model.supported === false && (
              <span
                style={{
                  ...tagStyle,
                  backgroundColor: "rgba(239, 68, 68, 0.12)",
                  color: "#EF4444",
                }}
                title="This model type is not supported by mlx-audio"
              >
                Unsupported
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
          {model.downloaded && onDelete && (
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

/* ─── Inline Model Market (used inside provider expand areas) ─── */

interface InlineModelMarketProps {
  readonly category: "asr" | "tts";
  readonly models: readonly ModelInfo[];
  readonly selectedModelId: string;
  readonly isDownloading: boolean;
  readonly downloadingModelId: string | null;
  readonly downloadProgress: number;
  readonly downloadError: string | null;
  readonly isRecording: boolean;
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
  readonly onPauseDownload: (modelId: string) => void;
  readonly onResumeDownload: (modelId: string) => void;
  readonly onCancelDownload: (modelId: string) => void;
}

function InlineModelMarket({
  category,
  models,
  selectedModelId,
  isDownloading,
  downloadingModelId,
  downloadProgress,
  downloadError,
  isRecording,
  downloads,
  onSelectModel,
  onDownloadModel,
  onDeleteModel,
  onSearchModels,
  onPauseDownload,
  onResumeDownload,
  onCancelDownload,
}: InlineModelMarketProps): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ModelInfo[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
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

  const handleDeleteModel = useCallback((modelId: string) => {
    setConfirmDeleteId(modelId);
  }, []);

  const confirmDelete = useCallback(() => {
    if (confirmDeleteId) {
      onDeleteModel(confirmDeleteId);
      setConfirmDeleteId(null);
    }
  }, [confirmDeleteId, onDeleteModel]);

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
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Search */}
      <div style={{ display: "flex", gap: "6px" }}>
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
              isSearching || !searchQuery.trim() ? "not-allowed" : "pointer",
            opacity: isSearching || !searchQuery.trim() ? 0.5 : 1,
          }}
        >
          {isSearching ? "Searching..." : "Search"}
        </button>
      </div>

      {/* Download error */}
      {downloadError && (
        <div
          style={{
            padding: "8px 12px",
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
      <div>
        <div style={sectionHeaderStyle}>Installed ({installed.length})</div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
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
              category={category}
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
      </div>

      {/* Recommended */}
      {recommended.length > 0 && (
        <div>
          <div style={sectionHeaderStyle}>Recommended</div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
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
        </div>
      )}

      {/* Search Results */}
      {(searchResults.length > 0 || (hasSearched && !isSearching)) && (
        <div>
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
        </div>
      )}

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
  autoStartSidecar,
  hfMirrorUrl,
  defaultHfUrl,
  onChangeDataDir,
  onChangeAutoStartSidecar,
  onChangeHfMirrorUrl,
}: {
  readonly dataDir: string | null;
  readonly configDir: string | null;
  readonly isRecording: boolean;
  readonly autoStartSidecar: boolean;
  readonly hfMirrorUrl: string;
  readonly defaultHfUrl: string;
  readonly onChangeDataDir: () => void;
  readonly onChangeAutoStartSidecar: (value: boolean) => void;
  readonly onChangeHfMirrorUrl: (url: string) => void;
}): React.ReactElement {
  const [editingHfUrl, setEditingHfUrl] = useState(hfMirrorUrl);
  const [hfUrlSaved, setHfUrlSaved] = useState(false);
  const hfUrlChanged = editingHfUrl !== hfMirrorUrl;

  const handleSaveHfUrl = useCallback(() => {
    onChangeHfMirrorUrl(editingHfUrl);
    setHfUrlSaved(true);
    setTimeout(() => setHfUrlSaved(false), 2000);
  }, [editingHfUrl, onChangeHfMirrorUrl]);

  const handleResetHfUrl = useCallback(() => {
    setEditingHfUrl(defaultHfUrl);
  }, [defaultHfUrl]);

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

      {/* Auto-start Sidecar Engine */}
      <div style={sectionTitleStyle}>Local Engine</div>
      <div style={sectionDescStyle}>
        The sidecar engine provides local speech recognition and text-to-speech.
      </div>
      <div style={cardStyle}>
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
                fontWeight: 500,
                color: "var(--text-primary)",
              }}
            >
              Auto-start engine
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "var(--text-muted)",
                marginTop: "2px",
              }}
            >
              Launch sidecar automatically when app starts
            </div>
          </div>
          <button
            onClick={() => onChangeAutoStartSidecar(!autoStartSidecar)}
            style={{
              position: "relative",
              width: "36px",
              height: "20px",
              borderRadius: "10px",
              border: "none",
              backgroundColor: autoStartSidecar
                ? "var(--accent)"
                : "var(--bg-surface)",
              cursor: "pointer",
              transition: "background-color 0.2s",
              flexShrink: 0,
              padding: 0,
            }}
          >
            <span
              style={{
                position: "absolute",
                top: "2px",
                left: autoStartSidecar ? "18px" : "2px",
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
      </div>

      {/* HuggingFace Mirror */}
      <div style={sectionTitleStyle}>HuggingFace Mirror</div>
      <div style={sectionDescStyle}>
        Use a mirror URL when downloading models from HuggingFace.
      </div>
      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <input
            type="text"
            value={editingHfUrl}
            onChange={(e) => setEditingHfUrl(e.target.value)}
            placeholder={defaultHfUrl}
            style={{
              ...inputStyle,
              flex: 1,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "12px",
            }}
          />
          {hfUrlChanged && (
            <button
              onClick={handleSaveHfUrl}
              style={{ ...primaryBtnStyle, fontSize: "12px" }}
            >
              Save
            </button>
          )}
          {!hfUrlChanged && hfUrlSaved && (
            <span
              style={{
                fontSize: "12px",
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
              fontSize: "12px",
              padding: "0 8px",
              color: "var(--text-muted)",
              cursor: editingHfUrl === defaultHfUrl ? "not-allowed" : "pointer",
              opacity: editingHfUrl === defaultHfUrl ? 0.4 : 1,
            }}
            title="Reset to default"
          >
            Reset
          </button>
        </div>
      </div>
    </>
  );
}

/* ─── Shared Provider Hook ─── */

function useProviderManagement<
  P extends BaseProviderConfig,
  F extends BaseEditForm,
>(
  initialProviders: readonly P[],
  initialSelectedId: string | null,
  config: ProviderCategoryConfig<P, F>,
  onSave: (providers: P[], selectedId: string | null) => void,
) {
  const [providers, setProviders] = useState<P[]>([...initialProviders]);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId,
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<F>(config.createBlankForm());
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; message: string }>
  >({});
  const [testingId, setTestingId] = useState<string | null>(null);

  const saveProviders = useCallback(
    (next: P[], nextSelectedId: string | null) => {
      setProviders(next);
      setSelectedId(nextSelectedId);
      onSave(next, nextSelectedId);
    },
    [onSave],
  );

  const handleAddProvider = useCallback(() => {
    const id = `${config.idPrefix}-${Date.now()}`;
    const newProvider = config.createNewProvider(id);
    const next = [...providers, newProvider];
    saveProviders(next, selectedId);
    setExpandedId(id);
    setEditForm(config.createBlankForm());
  }, [providers, selectedId, saveProviders, config]);

  const handleUseProvider = useCallback(
    (providerId: string) => {
      saveProviders([...providers], providerId);
    },
    [providers, saveProviders],
  );

  const handleToggleExpand = useCallback(
    (provider: P) => {
      if (expandedId === provider.id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(provider.id);
      setEditForm(config.providerToForm(provider));
    },
    [expandedId, config],
  );

  const handleSaveEdit = useCallback(() => {
    if (!expandedId) return;
    const next = providers.map((p) =>
      p.id === expandedId ? config.applyForm(p, editForm) : p,
    );
    saveProviders(next, selectedId);
  }, [expandedId, editForm, providers, selectedId, saveProviders, config]);

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
    async (provider: P) => {
      if (!config.canTest(provider)) return;
      setTestingId(provider.id);
      try {
        const result = await config.testProvider(provider);
        setTestResults((prev) => ({ ...prev, [provider.id]: result }));
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
            const copy = { ...prev };
            delete copy[provider.id];
            return copy;
          });
        }, 5000);
      }
    },
    [config],
  );

  return {
    providers,
    selectedId,
    expandedId,
    editForm,
    setEditForm,
    testResults,
    testingId,
    handleAddProvider,
    handleUseProvider,
    handleToggleExpand,
    handleSaveEdit,
    handleDeleteProvider,
    handleTestProvider,
  };
}

/* ─── Shared Provider Card ─── */

function ProviderCard({
  provider,
  isActive,
  isExpanded,
  isRecording,
  sidecarReady,
  sidecarColor,
  sidecarBg,
  testingId,
  testResult,
  sidecarTestDisabled,
  sidecarTestDisabledTitle,
  onToggleExpand,
  onUseProvider,
  onDeleteProvider,
  onTestProvider,
  renderExpandedContent,
}: {
  readonly provider: BaseProviderConfig;
  readonly isActive: boolean;
  readonly isExpanded: boolean;
  readonly isRecording: boolean;
  readonly sidecarReady: boolean;
  readonly sidecarColor: string;
  readonly sidecarBg: string;
  readonly testingId: string | null;
  readonly testResult: { ok: boolean; message: string } | undefined;
  readonly sidecarTestDisabled: boolean;
  readonly sidecarTestDisabledTitle: string;
  readonly onToggleExpand: () => void;
  readonly onUseProvider: () => void;
  readonly onDeleteProvider: () => void;
  readonly onTestProvider: () => void;
  readonly renderExpandedContent: () => React.ReactNode;
}): React.ReactElement {
  const isTesting = testingId === provider.id;
  const testDisabled = isTesting || (provider.isSidecar && sidecarTestDisabled);

  return (
    <div
      style={{
        ...cardStyle,
        marginBottom: "0",
        borderColor: isActive ? "var(--accent)" : "var(--border)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div
          style={{ flex: 1, minWidth: 0, cursor: "pointer" }}
          onClick={onToggleExpand}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{
                fontSize: "10px",
                color: "var(--text-muted)",
                display: "inline-block",
                transition: "transform 0.2s",
                transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)",
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
                  backgroundColor: sidecarBg,
                  color: sidecarColor,
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
                maxWidth: "140px",
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
              onTestProvider();
            }}
            disabled={testDisabled}
            style={{
              ...secondaryBtnStyle,
              height: "28px",
              padding: "0 10px",
              fontSize: "11px",
              color: "var(--text-secondary)",
              cursor: testDisabled ? "not-allowed" : "pointer",
              opacity: testDisabled ? 0.4 : 1,
            }}
            title={
              provider.isSidecar && sidecarTestDisabled
                ? sidecarTestDisabledTitle
                : undefined
            }
          >
            {isTesting ? "Testing..." : "Test"}
          </button>
          {!isActive && (
            <button
              onClick={onUseProvider}
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
              onClick={onDeleteProvider}
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

      {/* Expanded content */}
      {isExpanded && (
        <div
          style={{
            marginTop: "12px",
            borderTop: "1px solid var(--border)",
            paddingTop: "12px",
          }}
        >
          {renderExpandedContent()}
        </div>
      )}
    </div>
  );
}

/* ─── Page: Speech (Provider list + Local Models) ─── */

function SpeechTab({
  asrProviders: initialProviders,
  selectedAsrProviderId: initialSelectedId,
  sidecarReady,
  isRecording,
  models,
  selectedModelId,
  isDownloading,
  downloadingModelId,
  downloadProgress,
  downloadError,
  downloads,
  onSaveAsrSettings,
  onSelectModel,
  onDownloadModel,
  onDeleteModel,
  onSearchModels,
  onPauseDownload,
  onResumeDownload,
  onCancelDownload,
}: {
  readonly asrProviders: readonly AsrProviderConfig[];
  readonly selectedAsrProviderId: string | null;
  readonly sidecarReady: boolean;
  readonly isRecording: boolean;
  readonly models: readonly ModelInfo[];
  readonly selectedModelId: string;
  readonly isDownloading: boolean;
  readonly downloadingModelId: string | null;
  readonly downloadProgress: number;
  readonly downloadError: string | null;
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
  readonly onPauseDownload: (modelId: string) => void;
  readonly onResumeDownload: (modelId: string) => void;
  readonly onCancelDownload: (modelId: string) => void;
}): React.ReactElement {
  const asrConfig: ProviderCategoryConfig<AsrProviderConfig, BaseEditForm> = {
    category: "asr",
    sidecarColor: "#F5A623",
    sidecarBg: "rgba(245, 166, 35, 0.12)",
    categoryLabel: "ASR",
    idPrefix: "ext",
    defaultName: "New Provider",
    fallbackName: "External ASR",
    createBlankForm: () => ({
      name: "New Provider",
      baseUrl: "",
      apiKey: "",
      model: "",
    }),
    providerToForm: (p) => ({
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      model: p.model,
    }),
    applyForm: (p, f) => ({
      ...p,
      name: p.isSidecar ? p.name : f.name || "External ASR",
      baseUrl: f.baseUrl,
      apiKey: f.apiKey,
      model: p.isSidecar ? p.model : f.model,
    }),
    createNewProvider: (id) => ({
      id,
      name: "New Provider",
      baseUrl: "",
      apiKey: "",
      model: "",
      isSidecar: false,
    }),
    canTest: (p) => p.isSidecar || (!!p.baseUrl && !!p.model),
    testProvider: async (p) => {
      await window.capty.asrTest({
        baseUrl: p.baseUrl ?? "",
        apiKey: p.apiKey ?? "",
        model: p.model ?? "",
        isSidecar: p.isSidecar,
      });
      return { ok: true, message: "ASR test passed" };
    },
  };

  const {
    providers,
    selectedId,
    expandedId,
    editForm,
    setEditForm,
    testResults,
    testingId,
    handleAddProvider,
    handleUseProvider,
    handleToggleExpand,
    handleSaveEdit,
    handleDeleteProvider,
    handleTestProvider,
  } = useProviderManagement<AsrProviderConfig, BaseEditForm>(
    initialProviders,
    initialSelectedId,
    asrConfig,
    (next, nextSelectedId) =>
      onSaveAsrSettings({
        asrProviders: next,
        selectedAsrProviderId: nextSelectedId,
      }),
  );

  // ASR-specific state
  const [fetchedModels, setFetchedModels] = useState<
    Record<string, Array<{ id: string; name: string }>>
  >({});
  const [modelsFetchingId, setModelsFetchingId] = useState<string | null>(null);
  const [useCustomModel, setUseCustomModel] = useState<Record<string, boolean>>(
    {},
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
          const providerFetchedModels = fetchedModels[provider.id] ?? [];
          const providerUseCustom = useCustomModel[provider.id] ?? false;

          return (
            <ProviderCard
              key={provider.id}
              provider={provider}
              isActive={selectedId === provider.id}
              isExpanded={expandedId === provider.id}
              isRecording={isRecording}
              sidecarReady={sidecarReady}
              sidecarColor={asrConfig.sidecarColor}
              sidecarBg={asrConfig.sidecarBg}
              testingId={testingId}
              testResult={testResults[provider.id]}
              sidecarTestDisabled={!selectedModelId}
              sidecarTestDisabledTitle="Select an ASR model first"
              onToggleExpand={() => handleToggleExpand(provider)}
              onUseProvider={() => handleUseProvider(provider.id)}
              onDeleteProvider={() => handleDeleteProvider(provider.id)}
              onTestProvider={() => handleTestProvider(provider)}
              renderExpandedContent={() =>
                provider.isSidecar ? (
                  <InlineModelMarket
                    category="asr"
                    models={models}
                    selectedModelId={selectedModelId}
                    isDownloading={isDownloading}
                    downloadingModelId={downloadingModelId}
                    downloadProgress={downloadProgress}
                    downloadError={downloadError}
                    isRecording={isRecording}
                    downloads={downloads}
                    onSelectModel={onSelectModel}
                    onDownloadModel={onDownloadModel}
                    onDeleteModel={onDeleteModel}
                    onSearchModels={onSearchModels}
                    onPauseDownload={onPauseDownload}
                    onResumeDownload={onResumeDownload}
                    onCancelDownload={onCancelDownload}
                  />
                ) : (
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
                          setEditForm({ ...editForm, name: e.target.value })
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
                          setEditForm({ ...editForm, baseUrl: e.target.value })
                        }
                        placeholder="http://localhost:8080"
                        style={{ ...inputStyle, fontFamily: "monospace" }}
                      />
                    </div>
                    <div>
                      <div style={labelStyle}>API Key (optional)</div>
                      <input
                        type="password"
                        value={editForm.apiKey}
                        onChange={(e) =>
                          setEditForm({ ...editForm, apiKey: e.target.value })
                        }
                        placeholder="sk-..."
                        style={{ ...inputStyle, fontFamily: "monospace" }}
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
                            style={{ ...inputStyle, flex: 1, width: "auto" }}
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
                          cursor: !editForm.baseUrl ? "not-allowed" : "pointer",
                          opacity: !editForm.baseUrl ? 0.5 : 1,
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )
              }
            />
          );
        })}
      </div>
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
  downloads,
  onSaveTtsSettings,
  onSelectTtsModel,
  onDownloadTtsModel,
  onDeleteTtsModel,
  onSearchTtsModels,
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
  readonly onPauseDownload: (modelId: string) => void;
  readonly onResumeDownload: (modelId: string) => void;
  readonly onCancelDownload: (modelId: string) => void;
}): React.ReactElement {
  const ttsConfig: ProviderCategoryConfig<TtsProviderConfig, TtsEditForm> = {
    category: "tts",
    sidecarColor: "#A855F7",
    sidecarBg: "rgba(168, 85, 247, 0.12)",
    categoryLabel: "TTS",
    idPrefix: "tts-ext",
    defaultName: "New TTS Provider",
    fallbackName: "External TTS",
    createBlankForm: () => ({
      name: "New TTS Provider",
      baseUrl: "",
      apiKey: "",
      model: "",
      voice: "auto",
    }),
    providerToForm: (p) => ({
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      model: p.model,
      voice: p.voice,
    }),
    applyForm: (p, f) => ({
      ...p,
      name: p.isSidecar ? p.name : f.name || "External TTS",
      baseUrl: f.baseUrl,
      apiKey: f.apiKey,
      model: p.isSidecar ? p.model : f.model,
      voice: f.voice,
    }),
    createNewProvider: (id) => ({
      id,
      name: "New TTS Provider",
      baseUrl: "",
      apiKey: "",
      model: "",
      voice: "auto",
      isSidecar: false,
    }),
    canTest: (p) => p.isSidecar || !!p.baseUrl,
    testProvider: async (p) => {
      const result = await window.capty.ttsTest({
        baseUrl: p.baseUrl ?? "",
        apiKey: p.apiKey ?? "",
        model: p.model ?? "",
        isSidecar: p.isSidecar,
      });
      return {
        ok: true,
        message: `TTS test passed (${Math.round(result.bytes / 1024)}KB)`,
      };
    },
  };

  const {
    providers,
    selectedId,
    expandedId,
    editForm,
    setEditForm,
    testResults,
    testingId,
    handleAddProvider,
    handleUseProvider,
    handleToggleExpand,
    handleSaveEdit,
    handleDeleteProvider,
    handleTestProvider,
  } = useProviderManagement<TtsProviderConfig, TtsEditForm>(
    initialProviders,
    initialSelectedId,
    ttsConfig,
    (next, nextSelectedId) =>
      onSaveTtsSettings({
        ttsProviders: next,
        selectedTtsProviderId: nextSelectedId,
      }),
  );

  return (
    <>
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
        {providers.map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            isActive={selectedId === provider.id}
            isExpanded={expandedId === provider.id}
            isRecording={isRecording}
            sidecarReady={sidecarReady}
            sidecarColor={ttsConfig.sidecarColor}
            sidecarBg={ttsConfig.sidecarBg}
            testingId={testingId}
            testResult={testResults[provider.id]}
            sidecarTestDisabled={!selectedTtsModelId}
            sidecarTestDisabledTitle="Select a TTS model first"
            onToggleExpand={() => handleToggleExpand(provider)}
            onUseProvider={() => handleUseProvider(provider.id)}
            onDeleteProvider={() => handleDeleteProvider(provider.id)}
            onTestProvider={() => handleTestProvider(provider)}
            renderExpandedContent={() =>
              provider.isSidecar ? (
                <InlineModelMarket
                  category="tts"
                  models={ttsModels}
                  selectedModelId={selectedTtsModelId}
                  isDownloading={isTtsDownloading}
                  downloadingModelId={ttsDownloadingModelId}
                  downloadProgress={ttsDownloadProgress}
                  downloadError={ttsDownloadError}
                  isRecording={isRecording}
                  downloads={downloads}
                  onSelectModel={onSelectTtsModel}
                  onDownloadModel={onDownloadTtsModel}
                  onDeleteModel={onDeleteTtsModel}
                  onSearchModels={onSearchTtsModels}
                  onPauseDownload={onPauseDownload}
                  onResumeDownload={onResumeDownload}
                  onCancelDownload={onCancelDownload}
                />
              ) : (
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
                        setEditForm({ ...editForm, name: e.target.value })
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
                        setEditForm({ ...editForm, baseUrl: e.target.value })
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
                        setEditForm({ ...editForm, apiKey: e.target.value })
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
                        setEditForm({ ...editForm, model: e.target.value })
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
                        setEditForm({ ...editForm, voice: e.target.value })
                      }
                      placeholder="auto"
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
                      disabled={!editForm.baseUrl}
                      style={{
                        ...primaryBtnStyle,
                        cursor: !editForm.baseUrl ? "not-allowed" : "pointer",
                        opacity: !editForm.baseUrl ? 0.5 : 1,
                      }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              )
            }
          />
        ))}
      </div>
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

/* ─── Fetch Models Dialog ─── */

function FetchModelsDialog({
  providerName,
  fetchedModels,
  existingModels,
  onAdd,
  onClose,
  onRefresh,
  isRefreshing,
}: {
  readonly providerName: string;
  readonly fetchedModels: readonly { id: string; name: string }[];
  readonly existingModels: readonly string[];
  readonly onAdd: (modelId: string) => void;
  readonly onClose: () => void;
  readonly onRefresh: () => void;
  readonly isRefreshing: boolean;
}): React.ReactElement {
  const [search, setSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );
  const existingSet = new Set(existingModels);

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  // Filter by search
  const filtered = search
    ? fetchedModels.filter(
        (m) =>
          m.id.toLowerCase().includes(search.toLowerCase()) ||
          m.name.toLowerCase().includes(search.toLowerCase()),
      )
    : fetchedModels;

  // Grouping logic
  const shouldGroup = filtered.length > 20;

  const groups: { name: string; models: typeof filtered }[] = [];
  if (shouldGroup) {
    const groupMap = new Map<string, typeof filtered>();
    for (const m of filtered) {
      const slashIdx = m.id.indexOf("/");
      const groupName =
        slashIdx > 0 ? m.id.substring(0, slashIdx) : providerName;
      if (!groupMap.has(groupName)) groupMap.set(groupName, []);
      groupMap.get(groupName)!.push(m);
    }
    for (const [name, models] of groupMap) {
      groups.push({ name, models });
    }
    groups.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    groups.push({ name: "", models: filtered });
  }

  const toggleGroup = (name: string): void => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const getInitial = (modelId: string): string => {
    const slashIdx = modelId.indexOf("/");
    const name = slashIdx > 0 ? modelId.substring(0, slashIdx) : modelId;
    return name.charAt(0).toUpperCase();
  };

  return (
    <div
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
        zIndex: 10000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "var(--bg-primary, #1a1a1a)",
          borderRadius: "12px",
          width: "520px",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--border, #333)",
        }}
      >
        {/* Title bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderBottom: "1px solid var(--border, #333)",
          }}
        >
          <span
            style={{
              fontSize: "15px",
              fontWeight: 600,
              color: "var(--text-primary, #ccc)",
            }}
          >
            {providerName} Models
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted, #888)",
              cursor: "pointer",
              fontSize: "18px",
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>

        {/* Search bar */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border, #333)",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: "var(--bg-surface, #222)",
              border: "1px solid var(--border, #333)",
              borderRadius: "8px",
              padding: "8px 12px",
            }}
          >
            <span
              style={{
                color: "var(--text-muted, #666)",
                fontSize: "14px",
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search model ID or name..."
              style={{
                flex: 1,
                background: "none",
                border: "none",
                outline: "none",
                color: "var(--text-primary, #ccc)",
                fontSize: "13px",
              }}
            />
          </div>
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted, #888)",
              cursor: isRefreshing ? "default" : "pointer",
              fontSize: "18px",
              padding: "4px",
              opacity: isRefreshing ? 0.5 : 1,
            }}
            title="Refresh"
          >
            &#8635;
          </button>
        </div>

        {/* Model list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {filtered.length === 0 && (
            <div
              style={{
                padding: "24px",
                textAlign: "center",
                color: "var(--text-muted, #666)",
                fontSize: "13px",
              }}
            >
              {isRefreshing ? "Fetching models..." : "No models found"}
            </div>
          )}
          {groups.map((group) => (
            <div key={group.name || "__flat"}>
              {/* Group header (only if grouping) */}
              {shouldGroup && (
                <div
                  onClick={() => toggleGroup(group.name)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "10px 16px",
                    cursor: "pointer",
                    borderBottom: "1px solid var(--border, #222)",
                  }}
                >
                  <span
                    style={{
                      color: "var(--text-muted, #555)",
                      fontSize: "10px",
                      marginRight: "8px",
                    }}
                  >
                    {collapsedGroups.has(group.name) ? "\u25B6" : "\u25BC"}
                  </span>
                  <span
                    style={{
                      color: "var(--text-primary, #ccc)",
                      fontSize: "13px",
                      fontWeight: 500,
                    }}
                  >
                    {group.name}
                  </span>
                  <span
                    style={{
                      background: "rgba(74,222,128,0.15)",
                      color: "#4ade80",
                      fontSize: "11px",
                      padding: "1px 8px",
                      borderRadius: "10px",
                      marginLeft: "8px",
                    }}
                  >
                    {group.models.length}
                  </span>
                </div>
              )}
              {/* Model rows */}
              {!collapsedGroups.has(group.name) && (
                <div
                  style={{
                    padding: shouldGroup ? "0 16px 8px" : "0 16px",
                  }}
                >
                  {group.models.map((m) => {
                    const isAdded = existingSet.has(m.id);
                    return (
                      <div
                        key={m.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          padding: "8px 12px",
                          marginBottom: "4px",
                          background: isAdded
                            ? "rgba(139,139,240,0.08)"
                            : "var(--bg-surface, #1e1e1e)",
                          borderRadius: "8px",
                          opacity: isAdded ? 0.5 : 1,
                        }}
                      >
                        <div
                          style={{
                            width: "28px",
                            height: "28px",
                            borderRadius: "50%",
                            background: "rgba(139,139,240,0.15)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "var(--accent, #8b8bf0)",
                            fontSize: "12px",
                            fontWeight: 700,
                            marginRight: "10px",
                            flexShrink: 0,
                          }}
                        >
                          {getInitial(m.id)}
                        </div>
                        <div
                          style={{
                            flex: 1,
                            minWidth: 0,
                            color: "var(--text-primary, #ddd)",
                            fontSize: "13px",
                            fontFamily: "monospace",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {m.id}
                        </div>
                        {isAdded ? (
                          <span
                            style={{
                              color: "var(--text-muted, #555)",
                              fontSize: "11px",
                              marginLeft: "8px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Added
                          </span>
                        ) : (
                          <button
                            onClick={() => onAdd(m.id)}
                            style={{
                              background: "rgba(139,139,240,0.15)",
                              color: "var(--accent, #8b8bf0)",
                              border: "1px solid rgba(139,139,240,0.3)",
                              borderRadius: "50%",
                              width: "24px",
                              height: "24px",
                              fontSize: "16px",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                              lineHeight: 1,
                              marginLeft: "8px",
                            }}
                          >
                            +
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Page: Language Models ─── */

function LanguageModelsTab({
  llmProviders,
  onSave,
}: {
  readonly llmProviders: readonly LlmProvider[];
  readonly onSave: (providers: LlmProvider[]) => void;
}): React.ReactElement {
  const [providers, setProviders] = useState<LlmProvider[]>([...llmProviders]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    baseUrl: "",
    apiKey: "",
    models: [] as string[],
  });
  const [showFetchDialog, setShowFetchDialog] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<
    { id: string; name: string }[]
  >([]);
  const [isFetching, setIsFetching] = useState(false);
  const [manualModelInput, setManualModelInput] = useState("");
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
        models: [],
        isPreset: true,
      };
      const next = [...providers, newProvider];
      save(next);
      setExpandedId(newProvider.id);
      setEditForm({
        name: newProvider.name,
        baseUrl: newProvider.baseUrl,
        apiKey: "",
        models: [],
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
      models: [],
      isPreset: false,
    };
    const next = [...providers, newProvider];
    save(next);
    setExpandedId(id);
    setEditForm({
      name: "Custom Provider",
      baseUrl: "",
      apiKey: "",
      models: [],
    });
  }, [providers, save]);

  const handleToggleExpand = useCallback(
    (provider: LlmProvider) => {
      if (expandedId === provider.id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(provider.id);
      setEditForm({
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        models: provider.models ?? (provider.model ? [provider.model] : []),
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
            name: p.isPreset ? p.name : editForm.name,
            baseUrl: p.isPreset ? p.baseUrl : editForm.baseUrl,
            apiKey: editForm.apiKey,
            model: editForm.models[0] ?? "",
            models: editForm.models,
          }
        : p,
    );
    save(next);
    setExpandedId(null);
  }, [expandedId, editForm, providers, save]);

  const handleDelete = useCallback(
    (providerId: string) => {
      const next = providers.filter((p) => p.id !== providerId);
      save(next);
      if (expandedId === providerId) setExpandedId(null);
    },
    [providers, expandedId, save],
  );

  const handleTest = useCallback(async (provider: LlmProvider) => {
    setTestingId(provider.id);
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[provider.id];
      return next;
    });
    try {
      const testModel = provider.models?.[0] ?? provider.model;
      const result = await window.capty.testLlmProvider({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: testModel,
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

  const handleFetchModels = useCallback(async () => {
    if (!editForm.baseUrl) return;
    setIsFetching(true);
    try {
      const models = await window.capty.llmFetchModels({
        baseUrl: editForm.baseUrl,
        apiKey: editForm.apiKey,
      });
      setFetchedModels(models);
      setShowFetchDialog(true);
    } catch (err) {
      console.warn("Failed to fetch models:", err);
      setFetchedModels([]);
      setShowFetchDialog(true);
    } finally {
      setIsFetching(false);
    }
  }, [editForm.baseUrl, editForm.apiKey]);

  const handleAddModelFromFetch = useCallback(
    (modelId: string) => {
      if (editForm.models.includes(modelId)) return;
      setEditForm((prev) => ({
        ...prev,
        models: [...prev.models, modelId],
      }));
    },
    [editForm.models],
  );

  const handleRemoveModel = useCallback((modelId: string) => {
    setEditForm((prev) => ({
      ...prev,
      models: prev.models.filter((m) => m !== modelId),
    }));
  }, []);

  const handleAddManualModel = useCallback(() => {
    const trimmed = manualModelInput.trim();
    if (!trimmed || editForm.models.includes(trimmed)) return;
    setEditForm((prev) => ({
      ...prev,
      models: [...prev.models, trimmed],
    }));
    setManualModelInput("");
  }, [manualModelInput, editForm.models]);

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
          const modelCount =
            provider.models?.length ?? (provider.model ? 1 : 0);
          const isExpanded = expandedId === provider.id;
          const isTestDisabled =
            testingId === provider.id || !provider.apiKey || modelCount === 0;

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
                        textAlign: "center",
                      }}
                    >
                      ▼
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
                    {modelCount > 0 && (
                      <span
                        style={{
                          ...tagStyle,
                          backgroundColor: "rgba(139,139,240,0.12)",
                          color: "var(--accent, #8b8bf0)",
                        }}
                      >
                        {modelCount} model{modelCount !== 1 ? "s" : ""}
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
                    {provider.baseUrl || "No URL set"}
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
                      handleTest(provider);
                    }}
                    disabled={isTestDisabled}
                    style={{
                      ...secondaryBtnStyle,
                      height: "28px",
                      padding: "0 10px",
                      fontSize: "11px",
                      color: "var(--text-secondary)",
                      cursor: isTestDisabled ? "not-allowed" : "pointer",
                      opacity: isTestDisabled ? 0.4 : 1,
                    }}
                    title={
                      !provider.apiKey
                        ? "Set API key first"
                        : modelCount === 0
                          ? "Add at least one model"
                          : undefined
                    }
                  >
                    {testingId === provider.id ? "Testing..." : "Test"}
                  </button>
                  {!provider.isPreset && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(provider.id);
                      }}
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
              {isExpanded && (
                <div
                  style={{
                    marginTop: "12px",
                    borderTop: "1px solid var(--border)",
                    paddingTop: "12px",
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
                    <div style={labelStyle}>
                      <span>
                        API Key{" "}
                        <span
                          style={{
                            color: "var(--text-muted)",
                            fontSize: "11px",
                          }}
                        >
                          (optional for local models)
                        </span>
                      </span>
                    </div>
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

                  {/* Models Section */}
                  <div
                    style={{
                      borderTop: "1px solid var(--border)",
                      paddingTop: "16px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: "12px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "14px",
                            color: "var(--text-primary)",
                            fontWeight: 600,
                          }}
                        >
                          Models
                        </span>
                        <span
                          style={{
                            background: "rgba(139,139,240,0.15)",
                            color: "var(--accent)",
                            fontSize: "11px",
                            padding: "1px 8px",
                            borderRadius: "10px",
                          }}
                        >
                          {editForm.models.length}
                        </span>
                      </div>
                      <button
                        onClick={handleFetchModels}
                        disabled={!editForm.baseUrl || isFetching}
                        style={{
                          background: "rgba(139,139,240,0.1)",
                          color: "var(--accent)",
                          border: "1px solid rgba(139,139,240,0.3)",
                          borderRadius: "4px",
                          padding: "3px 12px",
                          fontSize: "12px",
                          cursor:
                            !editForm.baseUrl || isFetching
                              ? "default"
                              : "pointer",
                          opacity: !editForm.baseUrl || isFetching ? 0.5 : 1,
                        }}
                      >
                        {isFetching ? "Fetching..." : "\u21BB Fetch Models"}
                      </button>
                    </div>

                    {/* Model list */}
                    {editForm.models.length > 0 && (
                      <div
                        style={{
                          background: "var(--bg-surface, #1e1e1e)",
                          border: "1px solid var(--border)",
                          borderRadius: "8px",
                          overflow: "hidden",
                          marginBottom: "10px",
                        }}
                      >
                        {editForm.models.map((modelId, idx) => (
                          <div
                            key={modelId}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "8px 12px",
                              borderBottom:
                                idx < editForm.models.length - 1
                                  ? "1px solid var(--border-muted, #2a2a2a)"
                                  : undefined,
                            }}
                          >
                            <span
                              style={{
                                color: "var(--text-primary)",
                                fontSize: "13px",
                                fontFamily: "monospace",
                              }}
                            >
                              {modelId}
                            </span>
                            <button
                              onClick={() => handleRemoveModel(modelId)}
                              style={{
                                background: "none",
                                border: "none",
                                color: "var(--text-muted)",
                                cursor: "pointer",
                                fontSize: "16px",
                                padding: "0 4px",
                              }}
                            >
                              &times;
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Manual add */}
                    <div style={{ display: "flex", gap: "8px" }}>
                      <input
                        type="text"
                        value={manualModelInput}
                        onChange={(e) => setManualModelInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleAddManualModel();
                        }}
                        placeholder="Type model name to add..."
                        style={{
                          flex: 1,
                          background: "var(--bg-surface, #2a2a2a)",
                          border: "1px solid var(--border)",
                          borderRadius: "6px",
                          padding: "6px 10px",
                          color: "var(--text-primary)",
                          fontSize: "12px",
                          fontFamily: "monospace",
                          outline: "none",
                        }}
                      />
                      <button
                        onClick={handleAddManualModel}
                        disabled={!manualModelInput.trim()}
                        style={{
                          background: "rgba(139,139,240,0.1)",
                          color: "var(--accent)",
                          border: "1px solid rgba(139,139,240,0.3)",
                          borderRadius: "4px",
                          padding: "4px 12px",
                          fontSize: "12px",
                          cursor: manualModelInput.trim()
                            ? "pointer"
                            : "default",
                          opacity: manualModelInput.trim() ? 1 : 0.5,
                          whiteSpace: "nowrap",
                        }}
                      >
                        + Add
                      </button>
                    </div>
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
                      style={{
                        ...primaryBtnStyle,
                        cursor: "pointer",
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

      {showFetchDialog && (
        <FetchModelsDialog
          providerName={providers.find((p) => p.id === expandedId)?.name ?? ""}
          fetchedModels={fetchedModels}
          existingModels={editForm.models}
          onAdd={handleAddModelFromFetch}
          onClose={() => setShowFetchDialog(false)}
          onRefresh={handleFetchModels}
          isRefreshing={isFetching}
        />
      )}
    </>
  );
}

/* ─── Unified Model Selector ─── */

function UnifiedModelSelector({
  providers,
  selected,
  onChange,
  onGearClick,
}: {
  readonly providers: readonly LlmProvider[];
  readonly selected: { providerId: string; model: string } | null;
  readonly onChange: (sel: { providerId: string; model: string }) => void;
  readonly onGearClick?: () => void;
}): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setSearch("");
      }
    };
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Build flat list: all models from all providers that have models
  const allModels: {
    providerId: string;
    providerName: string;
    model: string;
  }[] = [];
  for (const p of providers) {
    const models = p.models?.length ? p.models : p.model ? [p.model] : [];
    for (const m of models) {
      allModels.push({ providerId: p.id, providerName: p.name, model: m });
    }
  }

  // Filter
  const filtered = search
    ? allModels.filter(
        (m) =>
          m.model.toLowerCase().includes(search.toLowerCase()) ||
          m.providerName.toLowerCase().includes(search.toLowerCase()),
      )
    : allModels;

  // Group by provider
  const groups = new Map<string, typeof filtered>();
  for (const m of filtered) {
    if (!groups.has(m.providerName)) groups.set(m.providerName, []);
    groups.get(m.providerName)!.push(m);
  }

  // Find current selection display
  const selectedEntry = selected
    ? allModels.find(
        (m) =>
          m.providerId === selected.providerId && m.model === selected.model,
      )
    : null;

  const getInitial = (name: string): string => name.charAt(0).toUpperCase();

  return (
    <div
      ref={dropdownRef}
      style={{
        position: "relative",
        marginRight: onGearClick ? "40px" : 0,
      }}
    >
      {/* Closed state */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: "var(--bg-primary)",
          border: `1px solid ${isOpen ? "var(--accent)" : "var(--border)"}`,
          borderRadius: isOpen ? "6px 6px 0 0" : "6px",
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          cursor: "pointer",
          fontSize: "13px",
        }}
      >
        {selectedEntry ? (
          <>
            <div
              style={{
                width: "18px",
                height: "18px",
                borderRadius: "50%",
                background: "rgba(139,139,240,0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent)",
                fontSize: "9px",
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {getInitial(selectedEntry.providerName)}
            </div>
            <span
              style={{
                color: "var(--text-primary)",
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {selectedEntry.model}
            </span>
            <span
              style={{
                color: "var(--text-muted)",
                fontSize: "12px",
                flexShrink: 0,
              }}
            >
              {selectedEntry.providerName}
            </span>
          </>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>Select a model...</span>
        )}
        <span
          style={{
            color: "var(--text-muted)",
            marginLeft: "auto",
            flexShrink: 0,
          }}
        >
          {isOpen ? "\u25B4" : "\u25BE"}
        </span>
      </div>

      {/* Gear button — navigates to Language Models settings tab */}
      {onGearClick && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onGearClick();
          }}
          style={{
            position: "absolute",
            right: "-36px",
            top: "50%",
            transform: "translateY(-50%)",
            background: "var(--bg-primary)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            padding: "6px",
            cursor: "pointer",
            color: "var(--text-muted)",
            display: "flex",
            alignItems: "center",
          }}
          title="Configure providers"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
        </button>
      )}

      {/* Dropdown */}
      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: "var(--bg-surface, #1e1e1e)",
            border: "1px solid var(--accent)",
            borderTop: "1px solid var(--border)",
            borderRadius: "0 0 6px 6px",
            maxHeight: "280px",
            overflowY: "auto",
            zIndex: 1000,
          }}
        >
          {/* Search */}
          <div
            style={{
              padding: "6px 8px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter..."
              autoFocus
              style={{
                width: "100%",
                background: "var(--bg-primary, #1a1a1a)",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                padding: "4px 8px",
                color: "var(--text-primary)",
                fontSize: "12px",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Grouped items */}
          {allModels.length === 0 && (
            <div
              style={{
                padding: "12px",
                textAlign: "center",
                color: "var(--text-muted)",
                fontSize: "12px",
              }}
            >
              No models available. Add models in Language Models tab.
            </div>
          )}
          {Array.from(groups).map(([providerName, models]) => (
            <div key={providerName}>
              <div
                style={{
                  padding: "6px 12px 2px",
                  color: "var(--text-muted)",
                  fontSize: "11px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                {providerName}
              </div>
              {models.map((m) => {
                const isSelected =
                  selected?.providerId === m.providerId &&
                  selected?.model === m.model;
                return (
                  <div
                    key={`${m.providerId}-${m.model}`}
                    onClick={() => {
                      onChange({
                        providerId: m.providerId,
                        model: m.model,
                      });
                      setIsOpen(false);
                      setSearch("");
                    }}
                    style={{
                      padding: "6px 12px",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      cursor: "pointer",
                      background: isSelected
                        ? "rgba(139,139,240,0.1)"
                        : "transparent",
                    }}
                  >
                    <div
                      style={{
                        width: "18px",
                        height: "18px",
                        borderRadius: "50%",
                        background: "rgba(139,139,240,0.15)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--accent)",
                        fontSize: "9px",
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {getInitial(m.providerName)}
                    </div>
                    <span
                      style={{
                        color: isSelected
                          ? "var(--accent)"
                          : "var(--text-primary)",
                        fontSize: "13px",
                      }}
                    >
                      {m.model}
                    </span>
                    <span
                      style={{
                        color: "var(--text-muted)",
                        fontSize: "11px",
                        marginLeft: "auto",
                      }}
                    >
                      {m.providerName}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Default Models Tab ─── */

function DefaultModelsTab({
  models,
  selectedModelId,
  onSelectModel,
  ttsModels,
  selectedTtsModelId,
  selectedTtsVoice,
  ttsVoices,
  onChangeTtsModel,
  onChangeTtsVoice,
  llmProviders,
  selectedSummaryModel,
  onChangeSummaryModel,
  selectedRapidModel,
  onChangeRapidModel,
  rapidRenamePrompt,
  onChangeRapidRenamePrompt,
  selectedTranslateModel,
  onChangeTranslateModel,
  translatePrompt,
  onChangeTranslatePrompt,
  onSwitchToTab,
}: {
  readonly models: readonly ModelInfo[];
  readonly selectedModelId: string;
  readonly onSelectModel: (modelId: string) => void;
  readonly ttsModels: readonly ModelInfo[];
  readonly selectedTtsModelId: string;
  readonly selectedTtsVoice: string;
  readonly ttsVoices: readonly {
    id: string;
    name: string;
    lang: string;
    gender: string;
  }[];
  readonly onChangeTtsModel: (modelId: string) => void;
  readonly onChangeTtsVoice: (voice: string) => void;
  readonly llmProviders: readonly LlmProvider[];
  readonly selectedSummaryModel: {
    providerId: string;
    model: string;
  } | null;
  readonly onChangeSummaryModel: (sel: {
    providerId: string;
    model: string;
  }) => void;
  readonly selectedRapidModel: {
    providerId: string;
    model: string;
  } | null;
  readonly onChangeRapidModel: (sel: {
    providerId: string;
    model: string;
  }) => void;
  readonly rapidRenamePrompt: string;
  readonly onChangeRapidRenamePrompt: (prompt: string) => void;
  readonly selectedTranslateModel: {
    providerId: string;
    model: string;
  } | null;
  readonly onChangeTranslateModel: (sel: {
    providerId: string;
    model: string;
  }) => void;
  readonly translatePrompt: string;
  readonly onChangeTranslatePrompt: (prompt: string) => void;
  readonly onSwitchToTab?: (tab: string) => void;
}): React.ReactElement {
  const downloadedAsrModels = models.filter(
    (m) => m.downloaded && m.supported !== false,
  );
  const downloadedTtsModels = ttsModels.filter((m) => m.downloaded);

  // Group voices by language
  const voicesByLang = ttsVoices.reduce<
    Record<string, { id: string; name: string; gender: string }[]>
  >((acc, v) => {
    const lang = v.lang || "Unknown";
    if (!acc[lang]) acc[lang] = [];
    acc[lang].push({ id: v.id, name: v.name, gender: v.gender });
    return acc;
  }, {});

  return (
    <>
      <h2
        style={{
          fontSize: "20px",
          fontWeight: 700,
          color: "var(--text-primary)",
          marginBottom: "20px",
        }}
      >
        Default Models
      </h2>

      {/* ASR Model */}
      <div style={cardStyle}>
        <div style={sectionTitleStyle}>ASR Model</div>
        <div style={{ ...sectionDescStyle, marginBottom: "10px" }}>
          Default speech recognition model for transcription
        </div>
        <select
          value={selectedModelId}
          onChange={(e) => onSelectModel(e.target.value)}
          style={{
            width: "100%",
            padding: "8px 10px",
            borderRadius: "6px",
            border: "1px solid var(--border)",
            backgroundColor: "var(--bg-primary)",
            color: "var(--text-primary)",
            fontSize: "13px",
            outline: "none",
          }}
        >
          {downloadedAsrModels.length === 0 && (
            <option value="">No downloaded ASR models</option>
          )}
          {downloadedAsrModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      {/* TTS Model & Voice */}
      <div style={cardStyle}>
        <div style={sectionTitleStyle}>TTS Model</div>
        <div style={{ ...sectionDescStyle, marginBottom: "10px" }}>
          Default text-to-speech model and voice for reading summaries
        </div>
        <select
          value={selectedTtsModelId}
          onChange={(e) => onChangeTtsModel(e.target.value)}
          style={{
            width: "100%",
            padding: "8px 10px",
            borderRadius: "6px",
            border: "1px solid var(--border)",
            backgroundColor: "var(--bg-primary)",
            color: "var(--text-primary)",
            fontSize: "13px",
            outline: "none",
            marginBottom: ttsVoices.length > 0 ? "12px" : "0",
          }}
        >
          {downloadedTtsModels.length === 0 && (
            <option value="">No downloaded TTS models</option>
          )}
          {downloadedTtsModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>

        {ttsVoices.length > 0 && (
          <>
            <div
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: "6px",
              }}
            >
              Voice
            </div>
            <select
              value={selectedTtsVoice}
              onChange={(e) => onChangeTtsVoice(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--bg-primary)",
                color: "var(--text-primary)",
                fontSize: "13px",
                outline: "none",
              }}
            >
              <option value="auto">Auto</option>
              {Object.entries(voicesByLang)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([lang, voices]) => (
                  <optgroup key={lang} label={lang}>
                    {voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.gender})
                      </option>
                    ))}
                  </optgroup>
                ))}
            </select>
          </>
        )}
      </div>

      {/* Summary Model */}
      <div style={cardStyle}>
        <div style={sectionTitleStyle}>Summary Model</div>
        <div style={{ ...sectionDescStyle, marginBottom: "10px" }}>
          Language model for generating summaries and analysis
        </div>
        <UnifiedModelSelector
          providers={llmProviders}
          selected={selectedSummaryModel}
          onChange={onChangeSummaryModel}
          onGearClick={() => onSwitchToTab?.("llm")}
        />
      </div>

      {/* Rapid Model */}
      <div style={cardStyle}>
        <div style={sectionTitleStyle}>Rapid Model</div>
        <div style={{ ...sectionDescStyle, marginBottom: "10px" }}>
          Fast language model for quick tasks like renaming sessions
        </div>
        <UnifiedModelSelector
          providers={llmProviders}
          selected={selectedRapidModel}
          onChange={onChangeRapidModel}
          onGearClick={() => onSwitchToTab?.("llm")}
        />
        <div
          style={{
            fontSize: "13px",
            fontWeight: 600,
            color: "var(--text-secondary)",
            marginTop: "12px",
            marginBottom: "6px",
          }}
        >
          Rename Prompt
        </div>
        <textarea
          value={rapidRenamePrompt}
          onChange={(e) => onChangeRapidRenamePrompt(e.target.value)}
          rows={4}
          style={{
            width: "100%",
            padding: "8px 10px",
            fontSize: "13px",
            fontFamily: "'JetBrains Mono', monospace",
            backgroundColor: "var(--bg-surface, rgba(255,255,255,0.04))",
            color: "var(--text-primary)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            resize: "vertical",
            outline: "none",
            boxSizing: "border-box",
            lineHeight: 1.5,
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--accent)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--border)";
          }}
        />
      </div>

      {/* Translate Model */}
      <div style={cardStyle}>
        <div style={sectionTitleStyle}>Translate Model</div>
        <div style={{ ...sectionDescStyle, marginBottom: "10px" }}>
          Language model for translating transcription text
        </div>
        <UnifiedModelSelector
          providers={llmProviders}
          selected={selectedTranslateModel}
          onChange={onChangeTranslateModel}
          onGearClick={() => onSwitchToTab?.("llm")}
        />
        <div
          style={{
            fontSize: "13px",
            fontWeight: 600,
            color: "var(--text-secondary)",
            marginTop: "12px",
            marginBottom: "6px",
          }}
        >
          Translate Prompt
        </div>
        <textarea
          value={translatePrompt}
          onChange={(e) => onChangeTranslatePrompt(e.target.value)}
          rows={6}
          style={{
            width: "100%",
            padding: "8px 10px",
            fontSize: "13px",
            fontFamily: "'JetBrains Mono', monospace",
            backgroundColor: "var(--bg-surface, rgba(255,255,255,0.04))",
            color: "var(--text-primary)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            resize: "vertical",
            outline: "none",
            boxSizing: "border-box",
            lineHeight: 1.5,
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--accent)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--border)";
          }}
        />
        <div
          style={{
            fontSize: "11px",
            color: "var(--text-muted)",
            marginTop: "4px",
          }}
        >
          Use {"{{target_language}}"} and {"{{text}}"} as placeholders
        </div>
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
  downloads,
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
  onPauseDownload,
  onResumeDownload,
  onCancelDownload,
  onSaveTtsSettings,
  onSelectTtsModel,
  onDownloadTtsModel,
  onDeleteTtsModel,
  onSearchTtsModels,
  selectedTtsVoice,
  ttsVoices,
  onChangeTtsVoice,
  onChangeTtsModel,
  selectedSummaryModel,
  onChangeSummaryModel,
  selectedRapidModel,
  onChangeRapidModel,
  rapidRenamePrompt,
  onChangeRapidRenamePrompt,
  selectedTranslateModel,
  onChangeTranslateModel,
  translatePrompt,
  onChangeTranslatePrompt,
  autoStartSidecar,
  onChangeAutoStartSidecar,
  initialTab,
  onTabChange,
  onClose,
}: SettingsModalProps): React.ReactElement {
  const [activeTab, setActiveTabRaw] = useState<TabId>(initialTab ?? "general");
  const setActiveTab = useCallback(
    (tab: TabId) => {
      setActiveTabRaw(tab);
      onTabChange?.(tab);
    },
    [onTabChange],
  );

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

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
              width: "180px",
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
                autoStartSidecar={autoStartSidecar}
                hfMirrorUrl={hfMirrorUrl}
                defaultHfUrl={defaultHfUrl}
                onChangeDataDir={onChangeDataDir}
                onChangeAutoStartSidecar={onChangeAutoStartSidecar}
                onChangeHfMirrorUrl={onChangeHfMirrorUrl}
              />
            )}
            {activeTab === "default-models" && (
              <DefaultModelsTab
                models={models}
                selectedModelId={selectedModelId}
                onSelectModel={onSelectModel}
                ttsModels={ttsModels}
                selectedTtsModelId={selectedTtsModelId}
                selectedTtsVoice={selectedTtsVoice}
                ttsVoices={ttsVoices}
                onChangeTtsModel={onChangeTtsModel}
                onChangeTtsVoice={onChangeTtsVoice}
                llmProviders={llmProviders}
                selectedSummaryModel={selectedSummaryModel}
                onChangeSummaryModel={onChangeSummaryModel}
                selectedRapidModel={selectedRapidModel}
                onChangeRapidModel={onChangeRapidModel}
                rapidRenamePrompt={rapidRenamePrompt}
                onChangeRapidRenamePrompt={onChangeRapidRenamePrompt}
                selectedTranslateModel={selectedTranslateModel}
                onChangeTranslateModel={onChangeTranslateModel}
                translatePrompt={translatePrompt}
                onChangeTranslatePrompt={onChangeTranslatePrompt}
                onSwitchToTab={(tab) => setActiveTab(tab as TabId)}
              />
            )}
            {activeTab === "asr" && (
              <SpeechTab
                asrProviders={asrProviders}
                selectedAsrProviderId={selectedAsrProviderId}
                sidecarReady={sidecarReady}
                isRecording={isRecording}
                models={models}
                selectedModelId={selectedModelId}
                isDownloading={isDownloading}
                downloadingModelId={downloadingModelId}
                downloadProgress={downloadProgress}
                downloadError={downloadError}
                downloads={downloads}
                onSaveAsrSettings={onSaveAsrSettings}
                onSelectModel={onSelectModel}
                onDownloadModel={onDownloadModel}
                onDeleteModel={onDeleteModel}
                onSearchModels={onSearchModels}
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
                downloads={downloads}
                onSaveTtsSettings={onSaveTtsSettings}
                onSelectTtsModel={onSelectTtsModel}
                onDownloadTtsModel={onDownloadTtsModel}
                onDeleteTtsModel={onDeleteTtsModel}
                onSearchTtsModels={onSearchTtsModels}
                onPauseDownload={onPauseDownload}
                onResumeDownload={onResumeDownload}
                onCancelDownload={onCancelDownload}
              />
            )}
            {activeTab === "llm" && (
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
