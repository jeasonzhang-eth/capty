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
  readonly asrBackend: "builtin" | "external";
  readonly sidecarUrl: string;
  readonly asrProvider: AsrProviderConfig | null;
  readonly onChangeDataDir: () => void;
  readonly onSelectModel: (modelId: string) => void;
  readonly onDownloadModel: (model: ModelInfo) => void;
  readonly onDeleteModel: (modelId: string) => void;
  readonly onSearchModels: (query: string) => Promise<ModelInfo[]>;
  readonly onChangeHfMirrorUrl: (url: string) => void;
  readonly onSaveLlmProviders: (providers: LlmProvider[]) => void;
  readonly onSaveAsrSettings: (settings: {
    asrBackend: "builtin" | "external";
    sidecarUrl: string;
    asrProvider: AsrProviderConfig | null;
  }) => void;
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

type TabId = "general" | "speech" | "language-models";

const TABS: readonly {
  readonly id: TabId;
  readonly icon: string;
  readonly label: string;
}[] = [
  { id: "general", icon: "\u2699\ufe0f", label: "General" },
  { id: "speech", icon: "\ud83c\udf99\ufe0f", label: "Speech" },
  { id: "language-models", icon: "\ud83e\udde0", label: "Language Models" },
];

/* ─── Segmented Control ─── */

function SegmentedControl({
  value,
  onChange,
  disabled,
  options,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
}): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        height: "36px",
        borderRadius: "8px",
        backgroundColor: "var(--bg-primary)",
        padding: "3px",
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? "not-allowed" : "default",
      }}
    >
      {options.map((opt) => {
        const isSelected = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => {
              if (!disabled) onChange(opt.value);
            }}
            disabled={disabled}
            style={{
              flex: 1,
              height: "100%",
              borderRadius: "6px",
              border: "none",
              fontSize: "12px",
              fontWeight: 600,
              cursor: disabled ? "not-allowed" : "pointer",
              transition: "all 0.2s ease",
              backgroundColor: isSelected ? "var(--accent)" : "transparent",
              color: isSelected ? "#141416" : "var(--text-muted)",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Small reusable components ─── */

function TypeTag({ type }: { readonly type: string }): React.ReactElement {
  const isWhisper = type === "whisper";
  return (
    <span
      style={{
        ...tagStyle,
        backgroundColor: isWhisper
          ? "rgba(74, 222, 128, 0.12)"
          : "rgba(245, 166, 35, 0.12)",
        color: isWhisper ? "#4ADE80" : "#F5A623",
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
          {!model.downloaded && !isThisDownloading && (
            <button
              onClick={() => onDownloadModel(model)}
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
          {model.downloaded && !isSelected && (
            <button
              onClick={() => onSelectModel(model.id)}
              disabled={isRecording}
              style={{
                ...secondaryBtnStyle,
                height: "28px",
                padding: "0 12px",
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
              onClick={() => onDelete(model.id)}
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

/* ─── Page: Speech (merged Backend + Models) ─── */

function SpeechTab({
  asrBackend,
  sidecarUrl,
  asrProvider,
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
  onSaveAsrSettings,
  onSelectModel,
  onDownloadModel,
  onDeleteModel,
  onSearchModels,
  onChangeHfMirrorUrl,
}: {
  readonly asrBackend: "builtin" | "external";
  readonly sidecarUrl: string;
  readonly asrProvider: AsrProviderConfig | null;
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
  readonly onSaveAsrSettings: (settings: {
    asrBackend: "builtin" | "external";
    sidecarUrl: string;
    asrProvider: AsrProviderConfig | null;
  }) => void;
  readonly onSelectModel: (modelId: string) => void;
  readonly onDownloadModel: (model: ModelInfo) => void;
  readonly onDeleteModel: (modelId: string) => void;
  readonly onSearchModels: (query: string) => Promise<ModelInfo[]>;
  readonly onChangeHfMirrorUrl: (url: string) => void;
}): React.ReactElement {
  // Backend state (from SpeechBackendTab)
  const [backend, setBackend] = useState(asrBackend);
  const [editSidecarUrl, setEditSidecarUrl] = useState(sidecarUrl);
  const [editProvider, setEditProvider] = useState({
    name: asrProvider?.name ?? "",
    baseUrl: asrProvider?.baseUrl ?? "",
    apiKey: asrProvider?.apiKey ?? "",
    model: asrProvider?.model ?? "",
  });
  const [sidecarStatus, setSidecarStatus] = useState<
    "checking" | "online" | "offline" | null
  >(null);
  const [asrTestResult, setAsrTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [asrTesting, setAsrTesting] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [modelsFetching, setModelsFetching] = useState(false);
  const [useCustomModel, setUseCustomModel] = useState(false);

  // Models state (from SpeechModelsTab)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ModelInfo[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [editingHfUrl, setEditingHfUrl] = useState(hfMirrorUrl);
  const [hfUrlSaved, setHfUrlSaved] = useState(false);
  const hfUrlChanged = editingHfUrl !== hfMirrorUrl;

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

  const modelsDir = dataDir ? `${dataDir}/models` : "<dataDir>/models";

  // Backend handlers
  const handleBackendChange = useCallback(
    (newBackend: string) => {
      if (isRecording) return;
      const nb = newBackend as "builtin" | "external";
      setBackend(nb);
      if (nb === "builtin") {
        onSaveAsrSettings({
          asrBackend: "builtin",
          sidecarUrl: editSidecarUrl,
          asrProvider: asrProvider,
        });
      } else {
        onSaveAsrSettings({
          asrBackend: "external",
          sidecarUrl: editSidecarUrl,
          asrProvider: editProvider.baseUrl
            ? {
                id: asrProvider?.id ?? `ext-${Date.now()}`,
                name: editProvider.name || "External ASR",
                baseUrl: editProvider.baseUrl,
                apiKey: editProvider.apiKey,
                model: editProvider.model,
              }
            : null,
        });
      }
    },
    [isRecording, editSidecarUrl, editProvider, asrProvider, onSaveAsrSettings],
  );

  const handleTestSidecar = useCallback(async () => {
    setSidecarStatus("checking");
    try {
      const result = await window.capty.checkSidecarHealth();
      setSidecarStatus(result.online ? "online" : "offline");
    } catch {
      setSidecarStatus("offline");
    }
    setTimeout(() => setSidecarStatus(null), 5000);
  }, []);

  const handleSaveSidecarUrl = useCallback(() => {
    onSaveAsrSettings({
      asrBackend: backend,
      sidecarUrl: editSidecarUrl,
      asrProvider: asrProvider,
    });
  }, [backend, editSidecarUrl, asrProvider, onSaveAsrSettings]);

  const handleSaveAsrProvider = useCallback(() => {
    const provider: AsrProviderConfig = {
      id: asrProvider?.id ?? `ext-${Date.now()}`,
      name: editProvider.name || "External ASR",
      baseUrl: editProvider.baseUrl,
      apiKey: editProvider.apiKey,
      model: editProvider.model,
    };
    onSaveAsrSettings({
      asrBackend: backend,
      sidecarUrl: editSidecarUrl,
      asrProvider: provider,
    });
  }, [backend, editSidecarUrl, editProvider, asrProvider, onSaveAsrSettings]);

  const handleTestAsr = useCallback(async () => {
    if (!editProvider.baseUrl || !editProvider.model) return;
    setAsrTesting(true);
    setAsrTestResult(null);
    try {
      await window.capty.asrTest({
        baseUrl: editProvider.baseUrl,
        apiKey: editProvider.apiKey,
        model: editProvider.model,
      });
      setAsrTestResult({ ok: true, message: "Connection OK" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      setAsrTestResult({ ok: false, message: msg });
    } finally {
      setAsrTesting(false);
      setTimeout(() => setAsrTestResult(null), 5000);
    }
  }, [editProvider]);

  const handleFetchModels = useCallback(async () => {
    if (!editProvider.baseUrl) return;
    setModelsFetching(true);
    try {
      const fetched = await window.capty.asrFetchModels({
        baseUrl: editProvider.baseUrl,
        apiKey: editProvider.apiKey,
      });
      setFetchedModels(fetched);
      setUseCustomModel(false);
    } catch {
      setFetchedModels([]);
    } finally {
      setModelsFetching(false);
    }
  }, [editProvider.baseUrl, editProvider.apiKey]);

  // Models handlers
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
      {/* Section 1: Backend */}
      <div style={sectionTitleStyle}>Backend</div>
      <div style={{ marginBottom: "16px" }}>
        <SegmentedControl
          value={backend}
          onChange={handleBackendChange}
          disabled={isRecording}
          options={[
            { value: "builtin", label: "Built-in Sidecar" },
            { value: "external", label: "External ASR" },
          ]}
        />
      </div>

      {/* Built-in config */}
      {backend === "builtin" && (
        <div style={cardStyle}>
          <div style={labelStyle}>Sidecar URL</div>
          <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
            <input
              type="text"
              value={editSidecarUrl}
              onChange={(e) => setEditSidecarUrl(e.target.value)}
              placeholder="http://localhost:8765"
              style={{
                ...inputStyle,
                flex: 1,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            />
            {editSidecarUrl !== sidecarUrl && (
              <button onClick={handleSaveSidecarUrl} style={primaryBtnStyle}>
                Save
              </button>
            )}
            <button
              onClick={handleTestSidecar}
              disabled={sidecarStatus === "checking"}
              style={{
                ...secondaryBtnStyle,
                color: "var(--text-muted)",
                cursor:
                  sidecarStatus === "checking" ? "not-allowed" : "pointer",
              }}
            >
              {sidecarStatus === "checking" ? "Checking..." : "Test"}
            </button>
          </div>
          {sidecarStatus === "online" && (
            <div
              style={{
                marginBottom: "12px",
                fontSize: "11px",
                color: "#4ADE80",
              }}
            >
              Sidecar is online
            </div>
          )}
          {sidecarStatus === "offline" && (
            <div
              style={{
                marginBottom: "12px",
                fontSize: "11px",
                color: "#EF4444",
              }}
            >
              Sidecar is offline
            </div>
          )}

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
        </div>
      )}

      {/* External config */}
      {backend === "external" && (
        <div style={cardStyle}>
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
                value={editProvider.name}
                onChange={(e) =>
                  setEditProvider({ ...editProvider, name: e.target.value })
                }
                placeholder="My ASR Server"
                style={inputStyle}
              />
            </div>
            <div>
              <div style={labelStyle}>Base URL</div>
              <input
                type="text"
                value={editProvider.baseUrl}
                onChange={(e) =>
                  setEditProvider({ ...editProvider, baseUrl: e.target.value })
                }
                placeholder="http://localhost:8080"
                style={{ ...inputStyle, fontFamily: "monospace" }}
              />
            </div>
            <div>
              <div style={labelStyle}>API Key (optional)</div>
              <input
                type="password"
                value={editProvider.apiKey}
                onChange={(e) =>
                  setEditProvider({ ...editProvider, apiKey: e.target.value })
                }
                placeholder="sk-..."
                style={{ ...inputStyle, fontFamily: "monospace" }}
              />
            </div>
            <div>
              <div style={labelStyle}>Model</div>
              <div style={{ display: "flex", gap: "6px" }}>
                {fetchedModels.length > 0 && !useCustomModel ? (
                  <select
                    value={editProvider.model}
                    onChange={(e) => {
                      if (e.target.value === "__custom__") {
                        setUseCustomModel(true);
                      } else {
                        setEditProvider({
                          ...editProvider,
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
                    {fetchedModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                    <option value="__custom__">Custom...</option>
                  </select>
                ) : (
                  <input
                    type="text"
                    value={editProvider.model}
                    onChange={(e) =>
                      setEditProvider({
                        ...editProvider,
                        model: e.target.value,
                      })
                    }
                    placeholder="e.g. whisper-1"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                )}
                <button
                  onClick={handleFetchModels}
                  disabled={modelsFetching || !editProvider.baseUrl}
                  style={{
                    ...secondaryBtnStyle,
                    color: "var(--text-muted)",
                    cursor:
                      modelsFetching || !editProvider.baseUrl
                        ? "not-allowed"
                        : "pointer",
                    opacity: modelsFetching || !editProvider.baseUrl ? 0.5 : 1,
                  }}
                >
                  {modelsFetching ? "Fetching..." : "Fetch Models"}
                </button>
              </div>
              {useCustomModel && fetchedModels.length > 0 && (
                <button
                  onClick={() => setUseCustomModel(false)}
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
                gap: "8px",
                marginTop: "4px",
              }}
            >
              <button
                onClick={handleTestAsr}
                disabled={
                  asrTesting || !editProvider.baseUrl || !editProvider.model
                }
                style={{
                  ...secondaryBtnStyle,
                  color: "var(--text-muted)",
                  cursor:
                    asrTesting || !editProvider.baseUrl || !editProvider.model
                      ? "not-allowed"
                      : "pointer",
                  opacity:
                    asrTesting || !editProvider.baseUrl || !editProvider.model
                      ? 0.5
                      : 1,
                }}
              >
                {asrTesting ? "Testing..." : "Test"}
              </button>
              <button
                onClick={handleSaveAsrProvider}
                disabled={!editProvider.baseUrl || !editProvider.model}
                style={{
                  ...primaryBtnStyle,
                  cursor:
                    !editProvider.baseUrl || !editProvider.model
                      ? "not-allowed"
                      : "pointer",
                  opacity:
                    !editProvider.baseUrl || !editProvider.model ? 0.5 : 1,
                }}
              >
                Save
              </button>
            </div>
            {asrTestResult && (
              <div
                style={{
                  padding: "6px 10px",
                  borderRadius: "6px",
                  fontSize: "11px",
                  backgroundColor: asrTestResult.ok
                    ? "rgba(34, 197, 94, 0.1)"
                    : "rgba(239, 68, 68, 0.1)",
                  color: asrTestResult.ok ? "#22c55e" : "#ef4444",
                  wordBreak: "break-word",
                }}
              >
                {asrTestResult.message}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Section 2: My Models (Built-in only) */}
      {backend === "builtin" && (
        <>
          <div style={sectionTitleStyle}>My Models</div>
          <div style={cardStyle}>
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
                  No models yet. Search HuggingFace below to add models.
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Section 3: Download Models (Built-in only) */}
      {backend === "builtin" && (
        <>
          <div style={sectionTitleStyle}>Download Models</div>

          {/* HuggingFace Mirror URL */}
          <div style={cardStyle}>
            <div
              style={{
                fontSize: "11px",
                color: "var(--text-muted)",
                marginBottom: "8px",
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

          {/* Search HuggingFace */}
          <div style={{ marginBottom: "16px" }}>
            <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search ASR models, e.g. whisper, wav2vec2..."
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
        </>
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
            zIndex: 4000,
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
  asrBackend,
  sidecarUrl,
  asrProvider,
  onChangeDataDir,
  onSelectModel,
  onDownloadModel,
  onDeleteModel,
  onSearchModels,
  onChangeHfMirrorUrl,
  onSaveLlmProviders,
  onSaveAsrSettings,
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
          maxHeight: "85vh",
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
                asrBackend={asrBackend}
                sidecarUrl={sidecarUrl}
                asrProvider={asrProvider}
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
                onSaveAsrSettings={onSaveAsrSettings}
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
                onSave={onSaveLlmProviders}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
