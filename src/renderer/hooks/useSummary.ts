import { useState, useCallback, useRef, useEffect } from "react";
import type { LlmProvider } from "../components/SettingsModal";
import type { Summary, PromptType } from "../components/SummaryPanel";
import type { AsrProviderState } from "../stores/appStore";
import { useAppStore } from "../stores/appStore";

export type ModelSelection = { providerId: string; model: string } | null;

export const DEFAULT_RAPID_RENAME_PROMPT =
  "Based on the following meeting transcript, generate a concise and descriptive Chinese title (max 10 words). Return ONLY the title text, no quotes, no timestamp, no extra text.";

interface UseSummaryParams {
  readonly store: {
    readonly currentSessionId: number | null;
    readonly sessions: ReadonlyArray<{
      readonly id: number;
      readonly title: string;
      readonly started_at: string;
    }>;
    readonly loadSessions: () => Promise<void>;
    readonly setAsrProviders: (providers: AsrProviderState[]) => void;
    readonly setSelectedAsrProviderId: (id: string | null) => void;
    readonly setSidecarReady: (v: boolean) => void;
  };
}

export function useSummary({ store }: UseSummaryParams) {
  // Keep store ref fresh for callbacks
  const storeRef = useRef(store);
  storeRef.current = store;

  // LLM provider state
  const [llmProviders, setLlmProviders] = useState<LlmProvider[]>([]);
  // Provider + model pair per feature
  const [selectedSummaryModel, setSelectedSummaryModel] =
    useState<ModelSelection>(null);
  const [selectedRapidModel, setSelectedRapidModel] =
    useState<ModelSelection>(null);
  const [rapidRenamePrompt, setRapidRenamePrompt] = useState(
    DEFAULT_RAPID_RENAME_PROMPT,
  );
  const [aiRenamingSessionId, setAiRenamingSessionId] = useState<number | null>(
    null,
  );

  // Summary state (per-session x per-tab generation support).
  // Keys are `${sessionId}:${promptType}` so multiple sessions can generate
  // simultaneously without leaking into each other.
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [generatingTabs, setGeneratingTabs] = useState<Set<string>>(new Set());
  const generatingTabsRef = useRef(generatingTabs);
  generatingTabsRef.current = generatingTabs;
  const [streamingContentMap, setStreamingContentMap] = useState<
    Record<string, string>
  >({});
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Prompt type state
  const [promptTypes, setPromptTypes] = useState<PromptType[]>([]);
  const [activePromptType, setActivePromptType] = useState("summarize");
  const activePromptTypeRef = useRef(activePromptType);
  activePromptTypeRef.current = activePromptType;

  // ── Handlers ──

  const handleSaveLlmProviders = useCallback(
    async (providers: LlmProvider[]) => {
      setLlmProviders(providers);
      const config = await window.capty.getConfig();
      await window.capty.setConfig({
        ...config,
        llmProviders: providers,
      });
    },
    [],
  );

  const handleSaveAsrSettings = useCallback(
    async (settings: {
      asrProviders: AsrProviderState[];
      selectedAsrProviderId: string | null;
    }) => {
      storeRef.current.setAsrProviders(settings.asrProviders);
      storeRef.current.setSelectedAsrProviderId(settings.selectedAsrProviderId);
      const config = await window.capty.getConfig();
      await window.capty.setConfig({
        ...config,
        asrProviders: settings.asrProviders,
        selectedAsrProviderId: settings.selectedAsrProviderId,
      });
      // Always re-check sidecar health (sidecar is independent of provider list)
      try {
        const health = await window.capty.checkSidecarHealth();
        storeRef.current.setSidecarReady(health.online);
      } catch {
        storeRef.current.setSidecarReady(false);
      }
    },
    [],
  );

  const handleChangeSummaryModel = useCallback(
    async (selection: { providerId: string; model: string }) => {
      setSelectedSummaryModel(selection);
      const config = await window.capty.getConfig();
      await window.capty.setConfig({
        ...config,
        selectedSummaryModel: selection,
      });
    },
    [],
  );

  const handleChangeRapidModel = useCallback(
    async (selection: { providerId: string; model: string }) => {
      setSelectedRapidModel(selection);
      const config = await window.capty.getConfig();
      await window.capty.setConfig({
        ...config,
        selectedRapidModel: selection,
      });
    },
    [],
  );

  const handleChangeRapidRenamePrompt = useCallback(async (prompt: string) => {
    setRapidRenamePrompt(prompt);
    const config = await window.capty.getConfig();
    await window.capty.setConfig({
      ...config,
      rapidRenamePrompt: prompt,
    });
  }, []);

  const handleSummarize = useCallback(
    async (providerId: string, model: string, promptType: string) => {
      const originSessionId = storeRef.current.currentSessionId;
      if (!originSessionId) return;
      const key = `${originSessionId}:${promptType}`;
      if (generatingTabsRef.current.has(key)) return;
      setStreamingContentMap((prev) => ({ ...prev, [key]: "" }));
      setGeneratingTabs((prev) => new Set(prev).add(key));
      setGenerateError(null);
      try {
        await window.capty.summarize(
          originSessionId,
          providerId,
          model,
          promptType,
        );
        // Clear streaming content for this session:tab
        setStreamingContentMap((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        // Reload summaries if still viewing the origin session
        const currentId = useAppStore.getState().currentSessionId;
        if (currentId === originSessionId) {
          const currentTab = activePromptTypeRef.current;
          const freshSummaries = await window.capty.listSummaries(
            originSessionId,
            currentTab,
          );
          setSummaries(freshSummaries as Summary[]);
        }
        // Remember last used model selection (always, regardless of session switch)
        setSelectedSummaryModel({ providerId, model });
        const config = await window.capty.getConfig();
        await window.capty.setConfig({
          ...config,
          selectedSummaryModel: { providerId, model },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to generate";
        console.error("Summarize error:", err);
        if (useAppStore.getState().currentSessionId === originSessionId) {
          setGenerateError(msg);
        }
      } finally {
        setGeneratingTabs((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        setStreamingContentMap((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [],
  );

  const handleChangePromptType = useCallback(
    async (promptType: string) => {
      setActivePromptType(promptType);
      setGenerateError(null);
      // Reload summaries for new prompt type
      const sessionId = storeRef.current.currentSessionId;
      if (sessionId) {
        try {
          const sessionSummaries = await window.capty.listSummaries(
            sessionId,
            promptType,
          );
          setSummaries(sessionSummaries as Summary[]);
        } catch {
          setSummaries([]);
        }
      }
    },
    [],
  );

  const handleSavePromptTypes = useCallback(async (types: PromptType[]) => {
    await window.capty.savePromptTypes(types);
    // Reload effective prompt types from backend
    const effective = await window.capty.listPromptTypes();
    setPromptTypes(effective as PromptType[]);
  }, []);

  const handleAiRename = useCallback(
    async (sessionId: number) => {
      if (aiRenamingSessionId) return;
      const sel = selectedRapidModel;
      const provider = sel
        ? llmProviders.find((p) => p.id === sel.providerId)
        : llmProviders.find((p) => (p.models?.length ?? 0) > 0);
      if (!provider) {
        console.warn("AI rename: no LLM provider configured");
        return;
      }
      const modelToUse = sel?.model || provider.models[0] || provider.model;
      setAiRenamingSessionId(sessionId);
      try {
        const rawTitle = await window.capty.generateTitle(
          sessionId,
          provider.id,
          modelToUse,
          rapidRenamePrompt,
        );
        if (rawTitle) {
          const sess = storeRef.current.sessions.find(
            (s: { readonly id: number }) => s.id === sessionId,
          );
          let finalTitle = rawTitle;
          if (sess?.started_at) {
            const d = new Date(sess.started_at);
            const pad = (n: number): string => String(n).padStart(2, "0");
            const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
            finalTitle = `${ts}：${rawTitle}`;
          }
          await window.capty.renameSession(sessionId, finalTitle);
          await storeRef.current.loadSessions();
        }
      } catch (err) {
        console.error("AI rename failed:", err);
      } finally {
        setAiRenamingSessionId(null);
      }
    },
    [selectedRapidModel, llmProviders, rapidRenamePrompt, aiRenamingSessionId],
  );

  // ── Effects ──

  // Validate model selections when providers change
  useEffect(() => {
    const validateSelection = (
      sel: ModelSelection,
      setSel: (s: ModelSelection) => void,
    ): void => {
      if (!sel) return;
      const provider = llmProviders.find((p) => p.id === sel.providerId);
      if (!provider) {
        setSel(null);
        return;
      }
      const models = provider.models?.length
        ? provider.models
        : provider.model
          ? [provider.model]
          : [];
      if (!models.includes(sel.model)) {
        if (models.length > 0) {
          setSel({ providerId: provider.id, model: models[0] });
        } else {
          setSel(null);
        }
      }
    };
    validateSelection(selectedSummaryModel, setSelectedSummaryModel);
    validateSelection(selectedRapidModel, setSelectedRapidModel);
  }, [llmProviders]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for LLM streaming chunks. Each chunk is keyed by (sessionId, promptType)
  // so background generation for a different session accumulates into its own
  // buffer without affecting what the user currently sees.
  useEffect(() => {
    const unsub = window.capty.onSummaryChunk(
      ({ content, done, promptType, sessionId }) => {
        if (done) return;
        const key = `${sessionId}:${promptType}`;
        setStreamingContentMap((prev) => ({
          ...prev,
          [key]: (prev[key] || "") + content,
        }));
      },
    );
    return unsub;
  }, []);

  // ── Init ──

  const initFromConfig = useCallback(
    async (config: Record<string, unknown>) => {
      // Restore LLM providers
      const savedProviders = config.llmProviders as LlmProvider[] | undefined;
      if (savedProviders?.length) {
        setLlmProviders(savedProviders);
      }
      // Restore model selections
      if (config.selectedSummaryModel) {
        setSelectedSummaryModel(
          config.selectedSummaryModel as ModelSelection,
        );
      }
      if (config.selectedRapidModel) {
        setSelectedRapidModel(config.selectedRapidModel as ModelSelection);
      }
      const savedRenamePrompt = config.rapidRenamePrompt as
        | string
        | undefined;
      if (savedRenamePrompt) {
        setRapidRenamePrompt(savedRenamePrompt);
      }

      // Load prompt types
      try {
        const types = await window.capty.listPromptTypes();
        setPromptTypes(types as PromptType[]);
      } catch {
        // Prompt types not available
      }
    },
    [],
  );

  return {
    // State
    llmProviders,
    selectedSummaryModel,
    selectedRapidModel,
    rapidRenamePrompt,
    aiRenamingSessionId,
    summaries,
    generatingTabs,
    streamingContentMap,
    generateError,
    promptTypes,
    activePromptType,

    // Setters needed externally
    setSummaries,
    setGenerateError,

    // Handlers
    handleSaveLlmProviders,
    handleSaveAsrSettings,
    handleChangeSummaryModel,
    handleChangeRapidModel,
    handleChangeRapidRenamePrompt,
    handleSummarize,
    handleChangePromptType,
    handleSavePromptTypes,
    handleAiRename,

    // Init
    initFromConfig,
  };
}
