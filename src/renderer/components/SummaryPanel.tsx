import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { marked } from "marked";
import type { LlmProvider } from "./SettingsModal";

export interface PromptType {
  readonly id: string;
  readonly label: string;
  readonly systemPrompt: string;
  readonly isBuiltin: boolean;
}

export interface Summary {
  readonly id: number;
  readonly session_id: number;
  readonly content: string;
  readonly model_name: string;
  readonly provider_id: string;
  readonly prompt_type: string;
  readonly created_at: string;
}

interface SummaryPanelProps {
  readonly summaries: readonly Summary[];
  readonly isGenerating: boolean;
  readonly generateError: string | null;
  readonly currentSessionId: number | null;
  readonly hasSegments: boolean;
  readonly llmProviders: readonly LlmProvider[];
  readonly selectedLlmProviderId: string | null;
  readonly promptTypes: readonly PromptType[];
  readonly activePromptType: string;
  readonly initialWidth: number;
  readonly onWidthChange: (width: number) => void;
  readonly onSummarize: (providerId: string, promptType: string) => void;
  readonly onChangePromptType: (promptType: string) => void;
  readonly onSavePromptTypes: (types: PromptType[]) => void;
}

const MIN_WIDTH = 220;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 320;

// Configure marked for safe rendering
marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(md: string): string {
  return marked.parse(md) as string;
}

function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString();
  } catch {
    return dateStr;
  }
}

export function SummaryPanel({
  summaries,
  isGenerating,
  generateError,
  currentSessionId,
  hasSegments,
  llmProviders,
  selectedLlmProviderId,
  promptTypes,
  activePromptType,
  initialWidth,
  onWidthChange,
  onSummarize,
  onChangePromptType,
  onSavePromptTypes,
}: SummaryPanelProps): React.ReactElement {
  // Only show configured providers in the dropdown
  const configuredProviders = useMemo(
    () => llmProviders.filter((p) => p.apiKey && p.model),
    [llmProviders],
  );

  const [localProviderId, setLocalProviderId] = useState<string>(
    () =>
      (selectedLlmProviderId &&
      configuredProviders.some((p) => p.id === selectedLlmProviderId)
        ? selectedLlmProviderId
        : configuredProviders[0]?.id) ?? "",
  );

  const hasProvider = configuredProviders.length > 0 && localProviderId !== "";
  const canGenerate =
    currentSessionId !== null && hasSegments && hasProvider && !isGenerating;

  // Reversed summaries: newest first
  const reversedSummaries = useMemo(
    () => [...summaries].reverse(),
    [summaries],
  );

  // Edit modal state
  const [editingType, setEditingType] = useState<PromptType | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editPrompt, setEditPrompt] = useState("");

  // Add new tab state
  const [isAdding, setIsAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newPrompt, setNewPrompt] = useState("");

  // Resizable width
  const [panelWidth, setPanelWidth] = useState(initialWidth);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(initialWidth);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true;
      startX.current = e.clientX;
      startWidth.current = panelWidth;
      e.preventDefault();
    },
    [panelWidth],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent): void => {
      if (!isDragging.current) return;
      const delta = startX.current - e.clientX;
      const newWidth = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, startWidth.current + delta),
      );
      setPanelWidth(newWidth);
    };

    const handleMouseUp = (): void => {
      if (isDragging.current) {
        isDragging.current = false;
        onWidthChange(panelWidth);
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onWidthChange, panelWidth]);

  const openEdit = useCallback((pt: PromptType) => {
    setEditingType(pt);
    setEditLabel(pt.label);
    setEditPrompt(pt.systemPrompt);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingType) return;
    const updated = promptTypes.map((pt) =>
      pt.id === editingType.id
        ? { ...pt, label: editLabel, systemPrompt: editPrompt }
        : pt,
    );
    onSavePromptTypes(updated as PromptType[]);
    setEditingType(null);
  }, [editingType, editLabel, editPrompt, promptTypes, onSavePromptTypes]);

  const handleResetEdit = useCallback(() => {
    if (!editingType) return;
    // Remove the override so it falls back to default
    const filtered = promptTypes.filter((pt) => pt.id !== editingType.id);
    onSavePromptTypes(filtered as PromptType[]);
    setEditingType(null);
  }, [editingType, promptTypes, onSavePromptTypes]);

  const handleDeleteType = useCallback(
    (typeId: string) => {
      const filtered = promptTypes.filter((pt) => pt.id !== typeId);
      onSavePromptTypes(filtered as PromptType[]);
      if (activePromptType === typeId) {
        onChangePromptType("summarize");
      }
    },
    [promptTypes, onSavePromptTypes, activePromptType, onChangePromptType],
  );

  const handleAddNew = useCallback(() => {
    if (!newLabel.trim() || !newPrompt.trim()) return;
    const id = `custom-${Date.now()}`;
    const newType: PromptType = {
      id,
      label: newLabel.trim(),
      systemPrompt: newPrompt.trim(),
      isBuiltin: false,
    };
    onSavePromptTypes([...promptTypes, newType] as PromptType[]);
    setIsAdding(false);
    setNewLabel("");
    setNewPrompt("");
    onChangePromptType(id);
  }, [newLabel, newPrompt, promptTypes, onSavePromptTypes, onChangePromptType]);

  const activeType = promptTypes.find((pt) => pt.id === activePromptType);

  return (
    <div
      style={{
        width: `${panelWidth}px`,
        minWidth: `${MIN_WIDTH}px`,
        maxWidth: `${MAX_WIDTH}px`,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--bg-primary)",
        position: "relative",
      }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          width: "4px",
          cursor: "col-resize",
          zIndex: 10,
          borderLeft: "1px solid var(--border)",
        }}
      />

      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          borderBottom: "1px solid var(--border)",
          overflowX: "auto",
          flexShrink: 0,
        }}
      >
        {promptTypes.map((pt) => (
          <div
            key={pt.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "2px",
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => onChangePromptType(pt.id)}
              style={{
                padding: "8px 12px",
                fontSize: "12px",
                fontWeight: activePromptType === pt.id ? 600 : 400,
                color:
                  activePromptType === pt.id
                    ? "var(--accent)"
                    : "var(--text-muted)",
                backgroundColor: "transparent",
                border: "none",
                borderBottom:
                  activePromptType === pt.id
                    ? "2px solid var(--accent)"
                    : "2px solid transparent",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {pt.label}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                openEdit(pt);
              }}
              title="Edit prompt"
              style={{
                padding: "2px 4px",
                fontSize: "10px",
                color: "var(--text-muted)",
                backgroundColor: "transparent",
                border: "none",
                cursor: "pointer",
                opacity: 0.6,
                flexShrink: 0,
              }}
            >
              ✎
            </button>
          </div>
        ))}
        <button
          onClick={() => setIsAdding(true)}
          title="Add custom tab"
          style={{
            padding: "8px 10px",
            fontSize: "14px",
            color: "var(--text-muted)",
            backgroundColor: "transparent",
            border: "none",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          +
        </button>
      </div>

      {/* Header: provider + generate button */}
      <div
        style={{
          padding: "8px 16px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {configuredProviders.length > 0 && (
            <select
              value={localProviderId}
              onChange={(e) => setLocalProviderId(e.target.value)}
              disabled={isGenerating}
              style={{
                flex: 1,
                padding: "4px 8px",
                fontSize: "11px",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                cursor: isGenerating ? "not-allowed" : "pointer",
                outline: "none",
                marginRight: "8px",
              }}
            >
              {configuredProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.model})
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => onSummarize(localProviderId, activePromptType)}
            disabled={!canGenerate}
            style={{
              padding: "5px 12px",
              fontSize: "11px",
              borderRadius: "5px",
              border: "none",
              backgroundColor: canGenerate
                ? "var(--accent)"
                : "var(--bg-tertiary)",
              color: canGenerate ? "white" : "var(--text-muted)",
              cursor: canGenerate ? "pointer" : "not-allowed",
              opacity: canGenerate ? 1 : 0.6,
              display: "flex",
              alignItems: "center",
              gap: "6px",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {isGenerating && (
              <span
                style={{
                  display: "inline-block",
                  width: "12px",
                  height: "12px",
                  border: "2px solid rgba(255,255,255,0.3)",
                  borderTopColor: "white",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                }}
              />
            )}
            {isGenerating ? "Generating..." : "Generate"}
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 16px",
        }}
      >
        {/* Error */}
        {generateError && (
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
            {generateError}
          </div>
        )}

        {/* Empty states */}
        {currentSessionId === null && (
          <div
            style={{
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: "12px",
              padding: "24px 0",
            }}
          >
            Select a session to view results
          </div>
        )}

        {currentSessionId !== null && !hasProvider && (
          <div
            style={{
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: "12px",
              padding: "24px 0",
              lineHeight: "20px",
            }}
          >
            Configure a Language Model in Settings first
          </div>
        )}

        {currentSessionId !== null &&
          hasProvider &&
          summaries.length === 0 &&
          !isGenerating && (
            <div
              style={{
                textAlign: "center",
                color: "var(--text-muted)",
                fontSize: "12px",
                padding: "24px 0",
              }}
            >
              Click Generate to create{" "}
              {activeType?.label?.toLowerCase() ?? "content"}
            </div>
          )}

        {/* Summaries list (newest first) */}
        {reversedSummaries.map((summary) => (
          <SummaryCard
            key={summary.id}
            summary={summary}
            providerName={
              llmProviders.find((p) => p.id === summary.provider_id)?.name
            }
          />
        ))}
      </div>

      {/* Edit prompt modal */}
      {editingType && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: "16px",
          }}
        >
          <div
            style={{
              backgroundColor: "var(--bg-primary)",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              padding: "16px",
              width: "100%",
              maxHeight: "90%",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              overflow: "auto",
            }}
          >
            <div
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              Edit: {editingType.label}
            </div>
            <input
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              placeholder="Tab label"
              style={{
                padding: "6px 8px",
                fontSize: "12px",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                outline: "none",
              }}
            />
            <textarea
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              placeholder="System prompt"
              rows={6}
              style={{
                padding: "6px 8px",
                fontSize: "12px",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                outline: "none",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
            <div
              style={{
                display: "flex",
                gap: "8px",
                justifyContent: "flex-end",
              }}
            >
              {editingType.isBuiltin && (
                <button
                  onClick={handleResetEdit}
                  style={{
                    padding: "5px 10px",
                    fontSize: "11px",
                    borderRadius: "4px",
                    border: "1px solid var(--border)",
                    backgroundColor: "var(--bg-tertiary)",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    marginRight: "auto",
                  }}
                >
                  Reset Default
                </button>
              )}
              {!editingType.isBuiltin && (
                <button
                  onClick={() => {
                    handleDeleteType(editingType.id);
                    setEditingType(null);
                  }}
                  style={{
                    padding: "5px 10px",
                    fontSize: "11px",
                    borderRadius: "4px",
                    border: "1px solid rgba(239,68,68,0.3)",
                    backgroundColor: "rgba(239,68,68,0.1)",
                    color: "#ef4444",
                    cursor: "pointer",
                    marginRight: "auto",
                  }}
                >
                  Delete
                </button>
              )}
              <button
                onClick={() => setEditingType(null)}
                style={{
                  padding: "5px 10px",
                  fontSize: "11px",
                  borderRadius: "4px",
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--bg-tertiary)",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={!editLabel.trim() || !editPrompt.trim()}
                style={{
                  padding: "5px 10px",
                  fontSize: "11px",
                  borderRadius: "4px",
                  border: "none",
                  backgroundColor: "var(--accent)",
                  color: "white",
                  cursor:
                    editLabel.trim() && editPrompt.trim()
                      ? "pointer"
                      : "not-allowed",
                  opacity: editLabel.trim() && editPrompt.trim() ? 1 : 0.6,
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add new tab modal */}
      {isAdding && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: "16px",
          }}
        >
          <div
            style={{
              backgroundColor: "var(--bg-primary)",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              padding: "16px",
              width: "100%",
              maxHeight: "90%",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              overflow: "auto",
            }}
          >
            <div
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              New Tab
            </div>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Tab name (e.g. Action Items)"
              style={{
                padding: "6px 8px",
                fontSize: "12px",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                outline: "none",
              }}
            />
            <textarea
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              placeholder="System prompt for this tab..."
              rows={6}
              style={{
                padding: "6px 8px",
                fontSize: "12px",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                outline: "none",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
            <div
              style={{
                display: "flex",
                gap: "8px",
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={() => {
                  setIsAdding(false);
                  setNewLabel("");
                  setNewPrompt("");
                }}
                style={{
                  padding: "5px 10px",
                  fontSize: "11px",
                  borderRadius: "4px",
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--bg-tertiary)",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddNew}
                disabled={!newLabel.trim() || !newPrompt.trim()}
                style={{
                  padding: "5px 10px",
                  fontSize: "11px",
                  borderRadius: "4px",
                  border: "none",
                  backgroundColor: "var(--accent)",
                  color: "white",
                  cursor:
                    newLabel.trim() && newPrompt.trim()
                      ? "pointer"
                      : "not-allowed",
                  opacity: newLabel.trim() && newPrompt.trim() ? 1 : 0.6,
                }}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inline CSS for spinner animation + markdown styles */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .summary-md h1, .summary-md h2, .summary-md h3, .summary-md h4 {
          margin: 8px 0 4px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .summary-md h1 { font-size: 16px; }
        .summary-md h2 { font-size: 14px; }
        .summary-md h3 { font-size: 13px; }
        .summary-md p { margin: 4px 0; }
        .summary-md ul, .summary-md ol { margin: 4px 0; padding-left: 20px; }
        .summary-md li { margin: 2px 0; }
        .summary-md code {
          background: var(--bg-tertiary);
          padding: 1px 4px;
          border-radius: 3px;
          font-size: 12px;
        }
        .summary-md pre {
          background: var(--bg-tertiary);
          padding: 8px;
          border-radius: 4px;
          overflow-x: auto;
          margin: 6px 0;
        }
        .summary-md pre code { background: none; padding: 0; }
        .summary-md blockquote {
          border-left: 3px solid var(--border);
          margin: 6px 0;
          padding: 2px 10px;
          color: var(--text-muted);
        }
        .summary-md a { color: var(--accent); text-decoration: none; }
        .summary-md a:hover { text-decoration: underline; }
        .summary-md strong { color: var(--text-primary); }
        .summary-md hr { border: none; border-top: 1px solid var(--border); margin: 8px 0; }
        .summary-md table { border-collapse: collapse; width: 100%; margin: 6px 0; }
        .summary-md th, .summary-md td {
          border: 1px solid var(--border);
          padding: 4px 8px;
          font-size: 12px;
          text-align: left;
        }
        .summary-md th { background: var(--bg-tertiary); font-weight: 600; }
      `}</style>
    </div>
  );
}

function SummaryCard({
  summary,
  providerName,
}: {
  readonly summary: Summary;
  readonly providerName: string | undefined;
}): React.ReactElement {
  const html = useMemo(
    () => renderMarkdown(summary.content),
    [summary.content],
  );

  return (
    <div
      style={{
        marginBottom: "16px",
        padding: "12px",
        backgroundColor: "var(--bg-secondary)",
        borderRadius: "8px",
        border: "1px solid var(--border)",
      }}
    >
      <div
        className="summary-md"
        style={{
          fontSize: "13px",
          color: "var(--text-primary)",
          lineHeight: "20px",
          wordBreak: "break-word",
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div
        style={{
          marginTop: "8px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "10px",
          color: "var(--text-muted)",
        }}
      >
        <span>
          {providerName ? `${providerName} · ` : ""}
          {summary.model_name}
        </span>
        <span>{formatTime(summary.created_at)}</span>
      </div>
    </div>
  );
}
