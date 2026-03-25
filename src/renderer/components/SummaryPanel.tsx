import React, { useMemo, useState } from "react";
import { marked } from "marked";
import type { LlmProvider } from "./SettingsModal";

export interface Summary {
  readonly id: number;
  readonly session_id: number;
  readonly content: string;
  readonly model_name: string;
  readonly provider_id: string;
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
  readonly onSummarize: (providerId: string) => void;
}

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
  onSummarize,
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
  const canSummarize =
    currentSessionId !== null && hasSegments && hasProvider && !isGenerating;

  return (
    <div
      style={{
        width: "320px",
        minWidth: "280px",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--bg-primary)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
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
          <span
            style={{
              fontSize: "14px",
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            Summary
          </span>
          <button
            onClick={() => onSummarize(localProviderId)}
            disabled={!canSummarize}
            style={{
              padding: "5px 12px",
              fontSize: "11px",
              borderRadius: "5px",
              border: "none",
              backgroundColor: canSummarize
                ? "var(--accent)"
                : "var(--bg-tertiary)",
              color: canSummarize ? "white" : "var(--text-muted)",
              cursor: canSummarize ? "pointer" : "not-allowed",
              opacity: canSummarize ? 1 : 0.6,
              display: "flex",
              alignItems: "center",
              gap: "6px",
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
            {isGenerating ? "Generating..." : "Summarize"}
          </button>
        </div>
        {configuredProviders.length > 0 && (
          <div style={{ marginTop: "8px" }}>
            <select
              value={localProviderId}
              onChange={(e) => setLocalProviderId(e.target.value)}
              disabled={isGenerating}
              style={{
                width: "100%",
                padding: "4px 8px",
                fontSize: "11px",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                cursor: isGenerating ? "not-allowed" : "pointer",
                outline: "none",
              }}
            >
              {configuredProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.model})
                </option>
              ))}
            </select>
          </div>
        )}
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
            Select a session to view summaries
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
              Click Summarize to generate a summary
            </div>
          )}

        {/* Summaries list */}
        {summaries.map((summary) => (
          <SummaryCard key={summary.id} summary={summary} />
        ))}
      </div>

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
}: {
  readonly summary: Summary;
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
        <span>{summary.model_name}</span>
        <span>{formatTime(summary.created_at)}</span>
      </div>
    </div>
  );
}
