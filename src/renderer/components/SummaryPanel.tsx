import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { toPng, toBlob } from "html-to-image";
import { useAppStore } from "../stores/appStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useSummaryStore } from "../stores/summaryStore";
import { useTtsStore } from "../stores/ttsStore";

import type { PromptType } from "../stores/settingsStore";
export type { PromptType } from "../stores/settingsStore";
export type { Summary } from "../stores/summaryStore";

const MIN_WIDTH = 220;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 320;

// Configure marked for safe rendering
marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(md: string): string {
  const rawHtml = marked.parse(md) as string;
  return DOMPurify.sanitize(rawHtml);
}

function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString();
  } catch {
    return dateStr;
  }
}

function stripThinking(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
}

function hasThinking(content: string): boolean {
  return /<think>[\s\S]*?<\/think>/.test(content);
}

function generateWordHtml(htmlContent: string): string {
  return `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset="utf-8"><style>
body { font-family: 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.6; color: #333; }
h1,h2,h3,h4 { margin: 16px 0 8px; } ul,ol { padding-left: 24px; }
blockquote { border-left: 3px solid #ccc; padding-left: 12px; color: #666; }
code { background: #f5f5f5; padding: 2px 4px; border-radius: 3px; font-size: 13px; }
pre { background: #f5f5f5; padding: 12px; border-radius: 6px; overflow-x: auto; }
table { border-collapse: collapse; } th,td { border: 1px solid #ddd; padding: 8px; }
</style></head><body>${htmlContent}</body></html>`;
}

export function SummaryPanel(): React.ReactElement {
  // ── Read state from stores ──
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const segments = useAppStore((s) => s.segments);
  const ttsProviderReady = useAppStore((s) => s.ttsProviderReady);

  const llmProviders = useSettingsStore((s) => s.llmProviders);
  const selectedSummaryModel = useSettingsStore((s) => s.selectedSummaryModel);
  const promptTypes = useSettingsStore((s) => s.promptTypes);
  const initialWidth = useSettingsStore((s) => s.summaryPanelWidth);

  const summaries = useSummaryStore((s) => s.summaries);
  const generatingTabs = useSummaryStore((s) => s.generatingTabs);
  const streamingContentMap = useSummaryStore((s) => s.streamingContentMap);
  const generateError = useSummaryStore((s) => s.generateError);
  const activePromptType = useSummaryStore((s) => s.activePromptType);

  const ttsModelsRaw = useTtsStore((s) => s.ttsModels);
  const selectedTtsModelId = useTtsStore((s) => s.selectedTtsModelId);
  const selectedTtsVoice = useTtsStore((s) => s.selectedTtsVoice);
  const ttsVoices = useTtsStore((s) => s.ttsVoices);
  const ttsProviders = useTtsStore((s) => s.ttsProviders);
  const selectedTtsProviderId = useTtsStore((s) => s.selectedTtsProviderId);

  // ── Derived values ──
  const hasSegments = segments.length > 0;
  const isGenerating = generatingTabs.has(activePromptType);
  const generatingPromptType = isGenerating ? activePromptType : null;
  const streamingContent = streamingContentMap[activePromptType] || "";
  const ttsModels = useMemo(
    () => ttsModelsRaw.filter((m) => m.downloaded),
    [ttsModelsRaw],
  );
  const selectedTtsProvider = useMemo(
    () => ttsProviders.find((p) => p.id === selectedTtsProviderId) ?? null,
    [ttsProviders, selectedTtsProviderId],
  );
  const isSidecarTts = selectedTtsProvider?.isSidecar ?? false;
  const ttsProviderName = selectedTtsProvider?.name ?? null;
  const ttsProviderModel = selectedTtsProvider?.model ?? "";
  const ttsProviderVoice = selectedTtsProvider?.voice ?? "";

  // ── Inline callbacks (formerly props from App.tsx) ──
  const onWidthChange = useCallback((newWidth: number) => {
    useSettingsStore
      .getState()
      .saveLayoutWidths(
        useSettingsStore.getState().historyPanelWidth,
        newWidth,
      );
  }, []);

  const onSummarize = useCallback(
    async (providerId: string, model: string, promptType: string) => {
      const ss = useSummaryStore.getState();
      if (!currentSessionId || ss.generatingTabs.has(promptType)) return;
      ss.startGeneration(promptType);
      ss.clearError();
      try {
        await window.capty.summarize(
          currentSessionId,
          providerId,
          model,
          promptType,
        );
        await useSummaryStore.getState().loadSummaries(currentSessionId);
        useSettingsStore
          .getState()
          .setSelectedSummaryModel({ providerId, model });
        await useSettingsStore
          .getState()
          .saveConfig({ selectedSummaryModel: { providerId, model } });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to generate";
        console.error("Summarize error:", err);
        useSummaryStore.getState().setError(msg);
      } finally {
        useSummaryStore.getState().stopGeneration(promptType);
      }
    },
    [currentSessionId],
  );

  const onChangePromptType = useCallback(
    async (promptType: string) => {
      useSummaryStore.getState().setActivePromptType(promptType);
      useSummaryStore.getState().clearError();
      if (currentSessionId) {
        try {
          await useSummaryStore.getState().loadSummaries(currentSessionId);
        } catch {
          useSummaryStore.getState().setSummaries([]);
        }
      }
    },
    [currentSessionId],
  );

  const onSavePromptTypes = useCallback(async (types: PromptType[]) => {
    await useSettingsStore.getState().savePromptTypes(types);
  }, []);

  const onChangeTtsModel = useCallback(async (modelId: string) => {
    const ts = useTtsStore.getState();
    ts.setSelectedTtsModel(modelId);
    ts.setSelectedTtsVoice("");
    ts.setTtsVoices([]);

    const config = await window.capty.getConfig();
    await window.capty.setConfig({
      ...config,
      selectedTtsModelId: modelId,
      selectedTtsVoice: "",
    });

    try {
      const result = await window.capty.ttsListVoices();
      useTtsStore.getState().setTtsVoices(result.voices);
      if (result.voices.length > 0) {
        const firstVoice = result.voices[0].id;
        useTtsStore.getState().setSelectedTtsVoice(firstVoice);
        const cfg = await window.capty.getConfig();
        await window.capty.setConfig({ ...cfg, selectedTtsVoice: firstVoice });
      }
    } catch {
      useTtsStore.getState().setTtsVoices([]);
    }
  }, []);

  const onChangeTtsVoice = useCallback(async (voice: string) => {
    useTtsStore.getState().setSelectedTtsVoice(voice);
    const config = await window.capty.getConfig();
    await window.capty.setConfig({ ...config, selectedTtsVoice: voice });
  }, []);

  const availableProviders = useMemo(
    () => llmProviders.filter((p) => (p.models?.length ?? 0) > 0 || p.model),
    [llmProviders],
  );

  const [localSelection, setLocalSelection] = useState<{
    providerId: string;
    model: string;
  } | null>(() => {
    if (selectedSummaryModel) return selectedSummaryModel;
    const first = availableProviders[0];
    if (first) {
      const model = first.models?.[0] || first.model || "";
      return { providerId: first.id, model };
    }
    return null;
  });

  // Sync localSelection when providers load asynchronously
  useEffect(() => {
    if (availableProviders.length > 0 && !localSelection) {
      if (selectedSummaryModel) {
        setLocalSelection(selectedSummaryModel);
      } else {
        const first = availableProviders[0];
        if (first) {
          const model = first.models?.[0] || first.model || "";
          setLocalSelection({ providerId: first.id, model });
        }
      }
    }
  }, [availableProviders, selectedSummaryModel, localSelection]);

  const hasProvider = localSelection !== null;
  const canGenerate =
    currentSessionId !== null && hasSegments && hasProvider && !isGenerating;
  // Is the *current* tab the one being generated?
  const isGeneratingThisTab =
    isGenerating && generatingPromptType === activePromptType;

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
  const latestWidthRef = useRef(panelWidth);

  // Sync when initialWidth changes from async config load
  useEffect(() => {
    if (!isDragging.current) {
      setPanelWidth(initialWidth);
      startWidth.current = initialWidth;
      latestWidthRef.current = initialWidth;
    }
  }, [initialWidth]);

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
      latestWidthRef.current = newWidth;
    };

    const handleMouseUp = (): void => {
      if (isDragging.current) {
        isDragging.current = false;
        onWidthChange(latestWidthRef.current);
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onWidthChange]);

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
              gap: "0px",
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
              className="edit-tab-btn"
              style={{
                padding: "2px 4px",
                fontSize: "10px",
                color: "var(--text-muted)",
                backgroundColor: "transparent",
                border: "none",
                cursor: "pointer",
                opacity: 0.3,
                flexShrink: 0,
                transition: "opacity 0.15s ease",
              }}
            >
              ✎
            </button>
          </div>
        ))}
        <button
          onClick={() => setIsAdding(true)}
          title="Add custom tab"
          className="add-tab-btn"
          style={{
            padding: "8px 10px",
            fontSize: "14px",
            color: "var(--text-muted)",
            backgroundColor: "transparent",
            border: "none",
            cursor: "pointer",
            flexShrink: 0,
            transition: "color 0.15s ease",
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
          {availableProviders.length > 0 && (
            <select
              value={
                localSelection
                  ? `${localSelection.providerId}::${localSelection.model}`
                  : ""
              }
              onChange={(e) => {
                const [pid, ...rest] = e.target.value.split("::");
                const model = rest.join("::");
                setLocalSelection({ providerId: pid, model });
              }}
              disabled={isGenerating}
              className="provider-select"
              style={{
                flex: 1,
                padding: "4px 8px",
                fontSize: "11px",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--bg-surface)",
                color: "var(--text-primary)",
                cursor: isGenerating ? "not-allowed" : "pointer",
                outline: "none",
                marginRight: "8px",
                transition: "border-color 0.15s ease",
              }}
            >
              {availableProviders.map((p) => {
                const models = p.models?.length
                  ? p.models
                  : p.model
                    ? [p.model]
                    : [];
                return models.map((m) => (
                  <option key={`${p.id}::${m}`} value={`${p.id}::${m}`}>
                    {p.name} / {m}
                  </option>
                ));
              })}
            </select>
          )}
          <button
            onClick={() => {
              if (localSelection) {
                onSummarize(
                  localSelection.providerId,
                  localSelection.model,
                  activePromptType,
                );
              }
            }}
            disabled={!canGenerate}
            style={{
              padding: "5px 12px",
              fontSize: "11px",
              borderRadius: "6px",
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
            {isGeneratingThisTab && (
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
            {isGeneratingThisTab ? "Generating..." : "Generate"}
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
              color: "var(--danger)",
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
          !isGeneratingThisTab && (
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

        {/* Streaming card (shown while generating this tab) */}
        {isGeneratingThisTab && <StreamingCard content={streamingContent} />}

        {/* Summaries list (newest first) */}
        {reversedSummaries.map((summary) => (
          <SummaryCard
            key={summary.id}
            summary={summary}
            providerName={
              llmProviders.find((p) => p.id === summary.provider_id)?.name
            }
            ttsModels={ttsModels}
            selectedTtsModelId={selectedTtsModelId}
            selectedTtsVoice={selectedTtsVoice}
            ttsVoices={ttsVoices}
            ttsProviderReady={ttsProviderReady}
            isSidecarTts={isSidecarTts}
            ttsProviderName={ttsProviderName}
            ttsProviderModel={ttsProviderModel}
            ttsProviderVoice={ttsProviderVoice}
            onChangeTtsModel={onChangeTtsModel}
            onChangeTtsVoice={onChangeTtsVoice}
          />
        ))}
      </div>

      {/* Edit prompt modal */}
      {editingType && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: "16px",
          }}
        >
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              borderRadius: "10px",
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
              className="modal-input"
              style={{
                padding: "6px 8px",
                fontSize: "12px",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--bg-surface)",
                color: "var(--text-primary)",
                outline: "none",
                transition: "border-color 0.15s ease",
              }}
            />
            <textarea
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              placeholder="System prompt"
              rows={6}
              className="modal-input"
              style={{
                padding: "6px 8px",
                fontSize: "12px",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--bg-surface)",
                color: "var(--text-primary)",
                outline: "none",
                resize: "vertical",
                fontFamily: "inherit",
                transition: "border-color 0.15s ease",
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
                    color: "var(--danger)",
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
            backgroundColor: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: "16px",
          }}
        >
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              borderRadius: "10px",
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
              className="modal-input"
              style={{
                padding: "6px 8px",
                fontSize: "12px",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--bg-surface)",
                color: "var(--text-primary)",
                outline: "none",
                transition: "border-color 0.15s ease",
              }}
            />
            <textarea
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              placeholder="System prompt for this tab..."
              rows={6}
              className="modal-input"
              style={{
                padding: "6px 8px",
                fontSize: "12px",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--bg-surface)",
                color: "var(--text-primary)",
                outline: "none",
                resize: "vertical",
                fontFamily: "inherit",
                transition: "border-color 0.15s ease",
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
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        .edit-tab-btn:hover {
          opacity: 0.7 !important;
        }
        .add-tab-btn:hover {
          color: var(--accent) !important;
        }
        .provider-select:focus {
          border-color: var(--accent) !important;
        }
        .tts-play-btn:hover:not([style*="not-allowed"]) {
          opacity: 1 !important;
          color: var(--accent) !important;
        }
        .tts-model-select:focus, .tts-voice-select:focus {
          border-color: var(--accent) !important;
        }
        .tts-model-select option, .tts-voice-select option {
          background-color: var(--bg-secondary);
          color: var(--text-primary);
        }
        .modal-input:focus {
          border-color: var(--accent) !important;
        }
        .export-menu-trigger:hover {
          opacity: 1 !important;
          color: var(--accent) !important;
        }
        .export-menu-item:hover {
          background-color: var(--bg-tertiary) !important;
        }
        .streaming-cursor {
          display: inline-block;
          width: 6px;
          height: 14px;
          background-color: var(--accent);
          margin-left: 2px;
          vertical-align: text-bottom;
          animation: blink 1s step-end infinite;
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
          border-left: 3px solid var(--border-accent);
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

function StreamingCard({
  content,
}: {
  readonly content: string;
}): React.ReactElement {
  const html = useMemo(
    () => (content ? renderMarkdown(content) : ""),
    [content],
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as content grows
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content]);

  return (
    <div
      style={{
        marginBottom: "16px",
        padding: "12px",
        backgroundColor: "var(--bg-secondary)",
        borderRadius: "8px",
        border: "1px solid var(--border-accent)",
        boxShadow: "0 0 12px rgba(245, 166, 35, 0.08)",
        position: "relative",
      }}
    >
      {content ? (
        <div ref={scrollRef} style={{ maxHeight: "400px", overflowY: "auto" }}>
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
          <span className="streaming-cursor" />
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            color: "var(--text-muted)",
            fontSize: "12px",
          }}
        >
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
          Waiting for response...
        </div>
      )}
    </div>
  );
}

// Global ref to track the currently playing audio across all cards
let globalAudioCtx: AudioContext | null = null;
let globalSourceNode: AudioBufferSourceNode | null = null;
let globalPlayingCardId: number | null = null;
// Streaming: track scheduled source nodes for gapless playback
let globalStreamSourceNodes: AudioBufferSourceNode[] = [];
let globalStreamId: string | null = null;

function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function VoiceSelect({
  voices,
  value,
  onChange,
}: {
  readonly voices: readonly TtsVoiceInfo[];
  readonly value: string;
  readonly onChange: (voice: string) => void;
}): React.ReactElement {
  // Group voices by language
  const grouped = useMemo(() => {
    const groups: Record<string, TtsVoiceInfo[]> = {};
    for (const v of voices) {
      const key = v.lang || "Other";
      if (!groups[key]) groups[key] = [];
      groups[key].push(v);
    }
    return groups;
  }, [voices]);

  const formatLabel = (v: TtsVoiceInfo): string => {
    const genderChar = v.gender ? ` (${v.gender[0]})` : "";
    return `${v.name}${genderChar}`;
  };

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="tts-voice-select"
      style={{
        fontSize: "9px",
        padding: "1px 2px",
        backgroundColor: "transparent",
        border: "1px solid var(--border)",
        borderRadius: "3px",
        color: "var(--text-muted)",
        cursor: "pointer",
        outline: "none",
        maxWidth: "100px",
      }}
    >
      {Object.entries(grouped).map(([lang, langVoices]) => (
        <optgroup key={lang} label={lang}>
          {langVoices.map((v) => (
            <option key={v.id} value={v.id}>
              {formatLabel(v)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function ExportMenu({
  content,
  contentRef,
  onClose,
}: {
  readonly content: string;
  readonly contentRef: React.RefObject<HTMLDivElement>;
  readonly onClose: () => void;
}): React.ReactElement {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click or ESC
  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const handleCopyText = useCallback(async () => {
    const plain = stripMarkdown(stripThinking(content));
    await navigator.clipboard.writeText(plain);
    onClose();
  }, [content, onClose]);

  /** Temporarily widen the element before capture so html-to-image reads correct
   *  dimensions for the SVG viewport, then restore original styles. */
  const captureWithFixedWidth = useCallback(
    async (mode: "blob" | "png"): Promise<Blob | string | null> => {
      if (!contentRef.current) return null;
      const el = contentRef.current;
      // Save original inline styles
      const origCss = el.style.cssText;
      // Expand element for capture
      el.style.width = "640px";
      el.style.maxWidth = "none";
      el.style.padding = "20px";
      // Force synchronous reflow so html-to-image reads the new layout
      void el.offsetHeight;
      try {
        const opts = { backgroundColor: "#1e1e20" };
        if (mode === "blob") {
          return await toBlob(el, opts);
        }
        return await toPng(el, opts);
      } finally {
        // Restore original styles
        el.style.cssText = origCss;
      }
    },
    [contentRef],
  );

  const handleCopyImage = useCallback(async () => {
    try {
      const blob = await captureWithFixedWidth("blob");
      if (blob && blob instanceof Blob) {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
      }
    } catch (err) {
      console.error("Copy image failed:", err);
    }
    onClose();
  }, [captureWithFixedWidth, onClose]);

  const handleExportImage = useCallback(async () => {
    try {
      const dataUrl = await captureWithFixedWidth("png");
      if (dataUrl && typeof dataUrl === "string") {
        const byteString = atob(dataUrl.split(",")[1]);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
          ia[i] = byteString.charCodeAt(i);
        }
        await window.capty.saveBuffer("summary.png", ia, [
          { name: "PNG Image", extensions: ["png"] },
        ]);
      }
    } catch (err) {
      console.error("Export image failed:", err);
    }
    onClose();
  }, [captureWithFixedWidth, onClose]);

  const handleExportMarkdown = useCallback(async () => {
    const md = stripThinking(content);
    await window.capty.saveFile("summary.md", md);
    onClose();
  }, [content, onClose]);

  const handleExportMarkdownWithThinking = useCallback(async () => {
    await window.capty.saveFile("summary.md", content);
    onClose();
  }, [content, onClose]);

  const handleExportWord = useCallback(async () => {
    const cleanMd = stripThinking(content);
    const html = renderMarkdown(cleanMd);
    const wordHtml = generateWordHtml(html);
    const encoder = new TextEncoder();
    const data = encoder.encode(wordHtml);
    await window.capty.saveBuffer("summary.doc", data, [
      { name: "Word Document", extensions: ["doc"] },
    ]);
    onClose();
  }, [content, onClose]);

  const showThinking = hasThinking(content);

  const menuItems = [
    { label: "Copy as Plain Text", icon: "📋", onClick: handleCopyText },
    { label: "Copy as Image", icon: "🖼", onClick: handleCopyImage },
    { label: "Export as Image", icon: "💾", onClick: handleExportImage },
    { label: "Export as Markdown", icon: "📝", onClick: handleExportMarkdown },
    ...(showThinking
      ? [
          {
            label: "Export as Markdown (with thinking)",
            icon: "🧠",
            onClick: handleExportMarkdownWithThinking,
          },
        ]
      : []),
    { label: "Export as Word", icon: "📄", onClick: handleExportWord },
  ];

  return (
    <div
      ref={menuRef}
      style={{
        position: "absolute",
        bottom: "100%",
        right: 0,
        marginBottom: "4px",
        backgroundColor: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        padding: "4px 0",
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
        zIndex: 50,
        minWidth: "220px",
        backdropFilter: "blur(12px)",
      }}
    >
      {menuItems.map((item) => (
        <button
          key={item.label}
          onClick={item.onClick}
          className="export-menu-item"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            width: "100%",
            padding: "6px 12px",
            fontSize: "12px",
            color: "var(--text-primary)",
            backgroundColor: "transparent",
            border: "none",
            cursor: "pointer",
            textAlign: "left",
            transition: "background-color 0.1s ease",
          }}
        >
          <span style={{ fontSize: "13px", flexShrink: 0 }}>{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** Stop all streaming source nodes and reset streaming state. */
function stopStreamPlayback(): void {
  for (const node of globalStreamSourceNodes) {
    try {
      node.stop();
      node.disconnect();
    } catch {
      // already stopped
    }
  }
  globalStreamSourceNodes = [];
  if (globalStreamId) {
    window.capty.ttsCancelStream(globalStreamId).catch(() => {});
    globalStreamId = null;
  }
}

/** Stop any currently playing audio (streaming or non-streaming). */
function stopAllPlayback(): void {
  // Non-streaming
  if (globalSourceNode) {
    globalSourceNode.stop();
    globalSourceNode.disconnect();
    globalSourceNode = null;
  }
  // Streaming
  stopStreamPlayback();
  globalPlayingCardId = null;
}

/** Decode base64-encoded PCM int16 data to Float32Array. */
function decodeBase64ToFloat32(b64: string): Float32Array {
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

function SummaryCard({
  summary,
  providerName,
  ttsModels,
  selectedTtsModelId,
  selectedTtsVoice,
  ttsVoices,
  ttsProviderReady,
  isSidecarTts,
  ttsProviderName,
  ttsProviderModel,
  ttsProviderVoice,
  onChangeTtsModel,
  onChangeTtsVoice,
}: {
  readonly summary: Summary;
  readonly providerName: string | undefined;
  readonly ttsModels: readonly TtsModelInfo[];
  readonly selectedTtsModelId: string;
  readonly selectedTtsVoice: string;
  readonly ttsVoices: readonly TtsVoiceInfo[];
  readonly ttsProviderReady: boolean;
  readonly isSidecarTts: boolean;
  readonly ttsProviderName: string | null;
  readonly ttsProviderModel: string;
  readonly ttsProviderVoice: string;
  readonly onChangeTtsModel: (modelId: string) => void;
  readonly onChangeTtsVoice: (voice: string) => void;
}): React.ReactElement {
  const html = useMemo(
    () => renderMarkdown(summary.content),
    [summary.content],
  );

  const contentRef = useRef<HTMLDivElement>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const [ttsState, setTtsState] = useState<"idle" | "loading" | "playing">(
    "idle",
  );
  const currentStreamIdRef = useRef<string | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const streamEndedRef = useRef<boolean>(false);

  // Sync state if another card started playing
  useEffect(() => {
    const interval = setInterval(() => {
      if (ttsState === "playing" && globalPlayingCardId !== summary.id) {
        setTtsState("idle");
      }
    }, 200);
    return () => clearInterval(interval);
  }, [ttsState, summary.id]);

  /** Non-streaming TTS playback (for external providers). */
  const handleTtsNonStreaming = useCallback(async () => {
    setTtsState("loading");
    try {
      const plainText = stripMarkdown(summary.content);
      const buffer = await window.capty.ttsSpeak(plainText, {
        voice: selectedTtsVoice,
      });
      if (globalPlayingCardId !== null && globalPlayingCardId !== summary.id) {
        setTtsState("idle");
        return;
      }

      const bytes =
        buffer instanceof ArrayBuffer
          ? new Uint8Array(buffer)
          : new Uint8Array(buffer as unknown as ArrayBufferLike);

      if (!globalAudioCtx) {
        globalAudioCtx = new AudioContext();
      }
      if (globalAudioCtx.state === "suspended") {
        await globalAudioCtx.resume();
      }

      const arrayBuf = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );
      const audioBuffer = await globalAudioCtx.decodeAudioData(arrayBuf);

      const source = globalAudioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(globalAudioCtx.destination);
      source.onended = () => {
        globalSourceNode = null;
        globalPlayingCardId = null;
        setTtsState("idle");
      };

      source.start();
      globalSourceNode = source;
      globalPlayingCardId = summary.id;
      setTtsState("playing");
    } catch (err) {
      console.error("[TTS] Non-streaming TTS failed:", err);
      globalPlayingCardId = null;
      setTtsState("idle");
    }
  }, [summary.content, summary.id, selectedTtsVoice]);

  /** Streaming TTS playback (all providers). */
  const handleTtsStreaming = useCallback(async () => {
    const streamId = `tts-${summary.id}-${Date.now()}`;
    currentStreamIdRef.current = streamId;
    globalStreamId = streamId;
    globalPlayingCardId = summary.id;
    streamEndedRef.current = false;
    nextStartTimeRef.current = 0;
    setTtsState("loading");

    if (!globalAudioCtx) {
      globalAudioCtx = new AudioContext();
    }
    if (globalAudioCtx.state === "suspended") {
      await globalAudioCtx.resume();
    }

    const unsubs: Array<() => void> = [];

    const cleanup = (): void => {
      for (const unsub of unsubs) unsub();
      unsubs.length = 0;
      currentStreamIdRef.current = null;
    };

    // Header event
    unsubs.push(
      window.capty.onTtsStreamHeader(({ streamId: sid, sampleRate }) => {
        if (sid !== streamId) return;
        console.log("[TTS Stream] Header received, sampleRate:", sampleRate);
      }),
    );

    // Audio data event
    unsubs.push(
      window.capty.onTtsStreamData(({ streamId: sid, data, sampleRate }) => {
        if (sid !== streamId || !data) return;

        const float32 = decodeBase64ToFloat32(data);
        if (float32.length === 0) return;

        const audioCtx = globalAudioCtx!;
        const audioBuffer = audioCtx.createBuffer(
          1,
          float32.length,
          sampleRate,
        );
        audioBuffer.getChannelData(0).set(float32);

        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);

        // Gapless scheduling
        if (nextStartTimeRef.current < audioCtx.currentTime) {
          nextStartTimeRef.current = audioCtx.currentTime + 0.02;
        }
        source.start(nextStartTimeRef.current);
        nextStartTimeRef.current += audioBuffer.duration;
        globalStreamSourceNodes.push(source);

        // Transition to playing on first chunk
        if (ttsState !== "playing") {
          setTtsState("playing");
        }

        // Last node ended handler — check if stream already ended
        source.onended = () => {
          const idx = globalStreamSourceNodes.indexOf(source);
          if (idx >= 0) globalStreamSourceNodes.splice(idx, 1);
          // If stream has ended and this was the last scheduled node
          if (
            streamEndedRef.current &&
            globalStreamSourceNodes.length === 0 &&
            globalPlayingCardId === summary.id
          ) {
            globalPlayingCardId = null;
            globalStreamId = null;
            setTtsState("idle");
            cleanup();
          }
        };
      }),
    );

    // Stream end event
    unsubs.push(
      window.capty.onTtsStreamEnd(({ streamId: sid }) => {
        if (sid !== streamId) return;
        console.log("[TTS Stream] Stream ended");
        streamEndedRef.current = true;
        // If no nodes are playing, clean up immediately
        if (globalStreamSourceNodes.length === 0) {
          globalPlayingCardId = null;
          globalStreamId = null;
          setTtsState("idle");
          cleanup();
        }
      }),
    );

    // Error event
    unsubs.push(
      window.capty.onTtsStreamError(({ streamId: sid, error }) => {
        if (sid !== streamId) return;
        console.error("[TTS Stream] Error:", error);
        stopStreamPlayback();
        globalPlayingCardId = null;
        setTtsState("idle");
        cleanup();
      }),
    );

    // Start the stream
    const plainText = stripMarkdown(summary.content);
    window.capty.ttsSpeakStream(streamId, plainText, {
      voice: selectedTtsVoice,
    });
  }, [summary.content, summary.id, selectedTtsVoice, ttsState]);

  const handleTtsClick = useCallback(async () => {
    if (ttsState === "playing" || ttsState === "loading") {
      // Stop playback
      stopAllPlayback();
      globalPlayingCardId = null;
      setTtsState("idle");
      return;
    }

    // Stop any other card's playback
    stopAllPlayback();

    await handleTtsStreaming();
  }, [ttsState, handleTtsStreaming]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (globalPlayingCardId === summary.id) {
        stopAllPlayback();
      }
    };
  }, [summary.id]);

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
        ref={contentRef}
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
          alignItems: "flex-start",
          fontSize: "10px",
          fontFamily: "'JetBrains Mono', monospace",
          color: "var(--text-muted)",
        }}
      >
        <span
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            minWidth: 0,
          }}
        >
          {/* Row 1: play button + provider name */}
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <button
              onClick={
                ttsModels.length > 0 && ttsProviderReady
                  ? handleTtsClick
                  : undefined
              }
              title={
                ttsModels.length === 0
                  ? "Download a TTS model in Settings"
                  : !ttsProviderReady
                    ? "TTS provider is not available"
                    : ttsState === "idle"
                      ? "Read aloud"
                      : ttsState === "loading"
                        ? "Loading..."
                        : "Stop"
              }
              className="tts-play-btn"
              style={{
                padding: "2px 4px",
                fontSize: "12px",
                backgroundColor: "transparent",
                border: "none",
                cursor:
                  ttsModels.length > 0 && ttsProviderReady
                    ? "pointer"
                    : "not-allowed",
                color:
                  ttsState === "playing"
                    ? "var(--accent)"
                    : "var(--text-muted)",
                opacity:
                  ttsModels.length === 0 || !ttsProviderReady
                    ? 0.3
                    : ttsState === "loading"
                      ? 0.5
                      : 0.7,
                transition: "opacity 0.15s ease, color 0.15s ease",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "18px",
                height: "18px",
                flexShrink: 0,
              }}
            >
              {ttsState === "loading" ? (
                <span
                  style={{
                    display: "inline-block",
                    width: "10px",
                    height: "10px",
                    border: "1.5px solid var(--text-muted)",
                    borderTopColor: "var(--accent)",
                    borderRadius: "50%",
                    animation: "spin 0.8s linear infinite",
                  }}
                />
              ) : ttsState === "playing" ? (
                "■"
              ) : (
                "▶"
              )}
            </button>
            {ttsProviderName && (
              <span style={{ opacity: 0.7 }}>{ttsProviderName}</span>
            )}
          </span>
          {/* Row 2: model + voice (sidecar: selectors, external: static labels) */}
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              paddingLeft: "22px",
              opacity: 0.7,
            }}
          >
            {isSidecarTts ? (
              <>
                {ttsModels.length >= 1 && (
                  <select
                    value={selectedTtsModelId}
                    onChange={(e) => onChangeTtsModel(e.target.value)}
                    className="tts-model-select"
                    style={{
                      fontSize: "9px",
                      padding: "1px 2px",
                      backgroundColor: "transparent",
                      border: "1px solid var(--border)",
                      borderRadius: "3px",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      outline: "none",
                      maxWidth: "100px",
                    }}
                  >
                    {ttsModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                )}
                {ttsVoices.length > 0 && (
                  <>
                    <span style={{ opacity: 0.4 }}>·</span>
                    <VoiceSelect
                      voices={ttsVoices}
                      value={selectedTtsVoice}
                      onChange={onChangeTtsVoice}
                    />
                  </>
                )}
              </>
            ) : (
              <>
                {ttsProviderModel && <span>{ttsProviderModel}</span>}
                {ttsProviderVoice && ttsProviderVoice !== "auto" && (
                  <>
                    <span style={{ opacity: 0.4 }}>·</span>
                    <span>{ttsProviderVoice}</span>
                  </>
                )}
              </>
            )}
          </span>
        </span>
        <span
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "2px",
            position: "relative",
            flexShrink: 0,
          }}
        >
          <span style={{ opacity: 0.7 }}>
            {providerName ? `${providerName} · ` : ""}
            {summary.model_name}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {formatTime(summary.created_at)}
            <button
              onClick={() => setShowExportMenu((v) => !v)}
              title="Export"
              className="export-menu-trigger"
              style={{
                padding: "2px 4px",
                fontSize: "12px",
                backgroundColor: "transparent",
                border: "none",
                cursor: "pointer",
                color: showExportMenu ? "var(--accent)" : "var(--text-muted)",
                opacity: showExportMenu ? 1 : 0.5,
                transition: "opacity 0.15s ease, color 0.15s ease",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "18px",
                height: "18px",
                flexShrink: 0,
              }}
            >
              ⬇
            </button>
            {showExportMenu && (
              <ExportMenu
                content={summary.content}
                contentRef={contentRef as React.RefObject<HTMLDivElement>}
                onClose={() => setShowExportMenu(false)}
              />
            )}
          </span>
        </span>
      </div>
    </div>
  );
}
