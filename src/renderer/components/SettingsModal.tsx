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
  readonly selectedLlmProviderId: string | null;
  readonly onChangeDataDir: () => void;
  readonly onSelectModel: (modelId: string) => void;
  readonly onDownloadModel: (model: ModelInfo) => void;
  readonly onDeleteModel: (modelId: string) => void;
  readonly onSearchModels: (query: string) => Promise<ModelInfo[]>;
  readonly onChangeHfMirrorUrl: (url: string) => void;
  readonly onSaveLlmProviders: (
    providers: LlmProvider[],
    selectedId: string | null,
  ) => void;
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

type TabId = "general" | "speech-models" | "language-models";

const TABS: readonly { readonly id: TabId; readonly label: string }[] = [
  { id: "general", label: "General" },
  { id: "speech-models", label: "Speech Models" },
  { id: "language-models", label: "Language Models" },
];

/* ─── Small reusable components ─── */

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
  readonly onDownloadModel: (model: ModelInfo) => void;
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
              onClick={() => onDownloadModel(model)}
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

/* ─── Tab: General ─── */

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

      {/* Config Directory */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Config Directory</div>
        <div style={labelStyle}>
          Application configuration files are stored here.
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
            title={configDir ?? ""}
          >
            {configDir ?? "\u2014"}
          </div>
          <button
            onClick={() => window.capty.openConfigDir()}
            style={{
              padding: "8px 14px",
              fontSize: "12px",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              backgroundColor: "var(--bg-tertiary)",
              color: "var(--text-primary)",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Open
          </button>
        </div>
      </div>
    </>
  );
}

/* ─── Tab: Speech Models ─── */

function SpeechModelsTab({
  models,
  selectedModelId,
  isDownloading,
  downloadingModelId,
  downloadProgress,
  downloadError,
  isRecording,
  hfMirrorUrl,
  defaultHfUrl,
  onSelectModel,
  onDownloadModel,
  onDeleteModel,
  onSearchModels,
  onChangeHfMirrorUrl,
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
  readonly onSelectModel: (modelId: string) => void;
  readonly onDownloadModel: (model: ModelInfo) => void;
  readonly onDeleteModel: (modelId: string) => void;
  readonly onSearchModels: (query: string) => Promise<ModelInfo[]>;
  readonly onChangeHfMirrorUrl: (url: string) => void;
}): React.ReactElement {
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

  // Sync search results' downloaded status when models list changes
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

  return (
    <>
      {/* HuggingFace Mirror URL */}
      <div
        style={{
          marginBottom: "16px",
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
              cursor: editingHfUrl === defaultHfUrl ? "not-allowed" : "pointer",
              opacity: editingHfUrl === defaultHfUrl ? 0.4 : 1,
              whiteSpace: "nowrap",
            }}
            title="Reset to default"
          >
            Reset
          </button>
        </div>
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
            color: "#ef4444",
            lineHeight: "18px",
          }}
        >
          {downloadError}
        </div>
      )}

      {/* Search HuggingFace */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Search HuggingFace</div>
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
                isSearching || !searchQuery.trim() ? "not-allowed" : "pointer",
              opacity: isSearching || !searchQuery.trim() ? 0.5 : 1,
              whiteSpace: "nowrap",
            }}
          >
            {isSearching ? "Searching..." : "Search"}
          </button>
        </div>

        {/* Search results */}
        {(searchResults.length > 0 || (hasSearched && !isSearching)) && (
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
        )}
      </div>

      {/* My Models */}
      <div>
        <div style={sectionTitleStyle}>My Models</div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
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
              No models yet. Search HuggingFace above to add models.
            </div>
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

/* ─── Tab: Language Models ─── */

function LanguageModelsTab({
  llmProviders,
  selectedLlmProviderId,
  onSave,
}: {
  readonly llmProviders: readonly LlmProvider[];
  readonly selectedLlmProviderId: string | null;
  readonly onSave: (
    providers: LlmProvider[],
    selectedId: string | null,
  ) => void;
}): React.ReactElement {
  const [providers, setProviders] = useState<LlmProvider[]>([...llmProviders]);
  const [selectedId, setSelectedId] = useState<string | null>(
    selectedLlmProviderId,
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    baseUrl: "",
    apiKey: "",
    model: "",
  });

  const save = useCallback(
    (next: LlmProvider[], nextSelectedId: string | null) => {
      setProviders(next);
      setSelectedId(nextSelectedId);
      onSave(next, nextSelectedId);
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
      save(next, selectedId);
      // Open edit form for the new provider
      setEditingId(newProvider.id);
      setEditForm({
        name: newProvider.name,
        baseUrl: newProvider.baseUrl,
        apiKey: "",
        model: "",
      });
    },
    [providers, selectedId, save],
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
    save(next, selectedId);
    setEditingId(id);
    setEditForm({
      name: "Custom Provider",
      baseUrl: "",
      apiKey: "",
      model: "",
    });
  }, [providers, selectedId, save]);

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
    save(next, selectedId);
    setEditingId(null);
  }, [editingId, editForm, providers, selectedId, save]);

  const handleDelete = useCallback(
    (providerId: string) => {
      const next = providers.filter((p) => p.id !== providerId);
      const nextSelected = selectedId === providerId ? null : selectedId;
      save(next, nextSelected);
      if (editingId === providerId) setEditingId(null);
    },
    [providers, selectedId, editingId, save],
  );

  const handleUse = useCallback(
    (providerId: string) => {
      save([...providers], providerId);
    },
    [providers, save],
  );

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
              padding: "6px 10px",
              fontSize: "12px",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              backgroundColor: "var(--bg-tertiary)",
              color: "var(--text-primary)",
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
        <button
          onClick={handleAddCustom}
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
          const isActive = selectedId === provider.id;
          const isConfigured = Boolean(provider.apiKey && provider.model);
          const isEditing = editingId === provider.id;

          return (
            <div
              key={provider.id}
              style={{
                padding: "12px",
                backgroundColor: isActive
                  ? "var(--bg-tertiary)"
                  : "transparent",
                border: isActive
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
                          backgroundColor: "rgba(99, 102, 241, 0.15)",
                          color: "#6366f1",
                        }}
                      >
                        Preset
                      </span>
                    )}
                    <span
                      style={{
                        ...tagStyle,
                        backgroundColor: isConfigured
                          ? "rgba(34, 197, 94, 0.15)"
                          : "rgba(239, 68, 68, 0.15)",
                        color: isConfigured ? "#22c55e" : "#ef4444",
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
                  {isConfigured && !isActive && (
                    <button
                      onClick={() => handleUse(provider.id)}
                      style={{
                        padding: "5px 12px",
                        fontSize: "11px",
                        borderRadius: "5px",
                        border: "1px solid var(--accent)",
                        backgroundColor: "transparent",
                        color: "var(--accent)",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Use
                    </button>
                  )}
                  {isActive && (
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
                  <button
                    onClick={() => handleEdit(provider)}
                    style={{
                      padding: "5px 10px",
                      fontSize: "11px",
                      borderRadius: "5px",
                      border: "1px solid var(--border)",
                      backgroundColor: "transparent",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isEditing ? "Cancel" : "Edit"}
                  </button>
                  {!provider.isPreset && (
                    <button
                      onClick={() => handleDelete(provider.id)}
                      style={{
                        padding: "5px 8px",
                        fontSize: "11px",
                        borderRadius: "5px",
                        border: "1px solid var(--border)",
                        backgroundColor: "transparent",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                      title="Delete provider"
                    >
                      &times;
                    </button>
                  )}
                </div>
              </div>

              {/* Edit form */}
              {isEditing && (
                <div
                  style={{
                    marginTop: "12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
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
                          style={{
                            width: "100%",
                            padding: "6px 8px",
                            fontSize: "12px",
                            backgroundColor: "var(--bg-primary)",
                            color: "var(--text-primary)",
                            border: "1px solid var(--border)",
                            borderRadius: "4px",
                            outline: "none",
                            boxSizing: "border-box",
                          }}
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
                          style={{
                            width: "100%",
                            padding: "6px 8px",
                            fontSize: "12px",
                            backgroundColor: "var(--bg-primary)",
                            color: "var(--text-primary)",
                            border: "1px solid var(--border)",
                            borderRadius: "4px",
                            outline: "none",
                            fontFamily: "monospace",
                            boxSizing: "border-box",
                          }}
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
                      style={{
                        width: "100%",
                        padding: "6px 8px",
                        fontSize: "12px",
                        backgroundColor: "var(--bg-primary)",
                        color: "var(--text-primary)",
                        border: "1px solid var(--border)",
                        borderRadius: "4px",
                        outline: "none",
                        fontFamily: "monospace",
                        boxSizing: "border-box",
                      }}
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
                      style={{
                        width: "100%",
                        padding: "6px 8px",
                        fontSize: "12px",
                        backgroundColor: "var(--bg-primary)",
                        color: "var(--text-primary)",
                        border: "1px solid var(--border)",
                        borderRadius: "4px",
                        outline: "none",
                        boxSizing: "border-box",
                      }}
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
                        padding: "6px 14px",
                        fontSize: "12px",
                        borderRadius: "6px",
                        border: "none",
                        backgroundColor: "var(--accent)",
                        color: "white",
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
  selectedLlmProviderId,
  onChangeDataDir,
  onSelectModel,
  onDownloadModel,
  onDeleteModel,
  onSearchModels,
  onChangeHfMirrorUrl,
  onSaveLlmProviders,
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
          width: "520px",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "20px 24px 0",
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

        {/* Tab Bar */}
        <div
          style={{
            display: "flex",
            gap: "0",
            padding: "16px 24px 0",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "8px 16px",
                fontSize: "13px",
                fontWeight: activeTab === tab.id ? 600 : 400,
                color:
                  activeTab === tab.id ? "var(--accent)" : "var(--text-muted)",
                background: "none",
                border: "none",
                borderBottom:
                  activeTab === tab.id
                    ? "2px solid var(--accent)"
                    : "2px solid transparent",
                cursor: "pointer",
                marginBottom: "-1px",
                transition: "color 0.15s, border-color 0.15s",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div
          style={{
            padding: "20px 24px 24px",
            overflowY: "auto",
            flex: 1,
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
          {activeTab === "speech-models" && (
            <SpeechModelsTab
              models={models}
              selectedModelId={selectedModelId}
              isDownloading={isDownloading}
              downloadingModelId={downloadingModelId}
              downloadProgress={downloadProgress}
              downloadError={downloadError}
              isRecording={isRecording}
              hfMirrorUrl={hfMirrorUrl}
              defaultHfUrl={defaultHfUrl}
              onSelectModel={onSelectModel}
              onDownloadModel={onDownloadModel}
              onDeleteModel={onDeleteModel}
              onSearchModels={onSearchModels}
              onChangeHfMirrorUrl={onChangeHfMirrorUrl}
            />
          )}
          {activeTab === "language-models" && (
            <LanguageModelsTab
              llmProviders={llmProviders}
              selectedLlmProviderId={selectedLlmProviderId}
              onSave={onSaveLlmProviders}
            />
          )}
        </div>
      </div>
    </div>
  );
}
