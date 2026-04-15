import { useState, useCallback, useRef, useEffect } from "react";
import type { LlmProvider } from "../components/SettingsModal";
import type { ModelSelection } from "./useSummary";
import { useAppStore } from "../stores/appStore";

export const DEFAULT_TRANSLATE_PROMPT =
  "You are a professional translator. Translate the following text to {{target_language}}. Rules:\n1. Translate ONLY the text content, preserving the exact number of lines\n2. Each line in the output corresponds to the same line in the input\n3. Do NOT add, remove, or merge lines\n4. Do NOT add any explanations, notes, or extra text\n5. Maintain the original tone and meaning\n\n{{text}}";

interface UseTranslationParams {
  readonly store: {
    readonly currentSessionId: number | null;
    readonly segments: ReadonlyArray<{
      id: number;
      text: string;
      start_time: number;
      end_time: number;
    }>;
  };
  readonly llmProviders: ReadonlyArray<{
    id: string;
    baseUrl: string;
    apiKey: string;
    models?: string[];
    model?: string;
  }>;
}

export function useTranslation({ store, llmProviders }: UseTranslationParams) {
  // Keep store ref fresh for callbacks
  const storeRef = useRef(store);
  storeRef.current = store;

  // Keep llmProviders ref fresh for callbacks
  const llmProvidersRef = useRef(llmProviders);
  llmProvidersRef.current = llmProviders;

  // Translation model + prompt state
  const [selectedTranslateModel, setSelectedTranslateModel] =
    useState<ModelSelection>(null);
  const [translatePrompt, setTranslatePrompt] = useState(
    DEFAULT_TRANSLATE_PROMPT,
  );

  // Per-session translation tracking: sessionId -> progress%
  const [translationProgressMap, setTranslationProgressMap] = useState<
    Record<number, number>
  >({});
  const translateAbortMapRef = useRef<Record<number, boolean>>({});

  // Derived: is the *current* session translating?
  const isTranslating =
    store.currentSessionId != null &&
    store.currentSessionId in translationProgressMap;
  const translationProgress =
    store.currentSessionId != null
      ? (translationProgressMap[store.currentSessionId] ?? 0)
      : 0;

  // Map: segmentId -> translated text (for current session + language)
  const [translations, setTranslations] = useState<Record<number, string>>({});
  const [activeTranslationLang, setActiveTranslationLangRaw] = useState<
    string | null
  >(() => localStorage.getItem("capty:activeTranslationLang"));
  const setActiveTranslationLang = useCallback((lang: string | null) => {
    setActiveTranslationLangRaw(lang);
    if (lang) {
      localStorage.setItem("capty:activeTranslationLang", lang);
    } else {
      localStorage.removeItem("capty:activeTranslationLang");
    }
  }, []);

  // ── Handlers ──

  const handleChangeTranslateModel = useCallback(
    async (selection: { providerId: string; model: string }) => {
      setSelectedTranslateModel(selection);
      const config = await window.capty.getConfig();
      await window.capty.setConfig({
        ...config,
        selectedTranslateModel: selection,
      });
    },
    [],
  );

  const handleChangeTranslatePrompt = useCallback(async (prompt: string) => {
    setTranslatePrompt(prompt);
    const config = await window.capty.getConfig();
    await window.capty.setConfig({
      ...config,
      translatePrompt: prompt,
    });
  }, []);

  const handleTranslate = useCallback(
    async (targetLanguage: string) => {
      if (storeRef.current.segments.length === 0) return;
      const sessionId = storeRef.current.currentSessionId;
      if (!sessionId) return;
      // Already translating this session
      if (sessionId in translateAbortMapRef.current) return;

      // Resolve provider + model for translation
      const sel = selectedTranslateModel;
      const providers = llmProvidersRef.current as LlmProvider[];
      const provider = sel
        ? providers.find((p) => p.id === sel.providerId)
        : providers.find((p) => (p.models?.length ?? 0) > 0);
      if (!provider) {
        console.warn("Translate: no LLM provider configured");
        return;
      }
      const modelToUse = sel?.model || provider.models[0] || provider.model;

      translateAbortMapRef.current[sessionId] = false;
      setTranslationProgressMap((prev) => ({ ...prev, [sessionId]: 0 }));
      setActiveTranslationLang(targetLanguage);

      const segments = [...storeRef.current.segments];
      const total = segments.length;
      const newTranslations: Record<number, string> = {};
      setTranslations({});
      let completed = 0;

      const CONCURRENCY = 3;

      const translateOne = async (
        seg: (typeof segments)[number],
      ): Promise<void> => {
        if (translateAbortMapRef.current[sessionId]) return;
        try {
          const result = await window.capty.translate(
            provider.id,
            modelToUse,
            seg.text,
            targetLanguage,
            translatePrompt,
          );
          if (translateAbortMapRef.current[sessionId]) return;

          newTranslations[seg.id] = result;
          // Only update displayed translations if still viewing this session
          if (useAppStore.getState().currentSessionId === sessionId) {
            setTranslations({ ...newTranslations });
          }

          await window.capty.saveTranslation(
            seg.id,
            sessionId,
            targetLanguage,
            result,
          );
        } catch (err) {
          console.warn(`Translation skipped for segment ${seg.id}:`, err);
        }
        completed++;
        setTranslationProgressMap((prev) => ({
          ...prev,
          [sessionId]: Math.round((completed / total) * 100),
        }));
      };

      // Process segments in batches of CONCURRENCY
      for (let i = 0; i < total; i += CONCURRENCY) {
        if (translateAbortMapRef.current[sessionId]) break;
        const batch = segments.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(translateOne));
      }

      // Cleanup finished session
      delete translateAbortMapRef.current[sessionId];
      setTranslationProgressMap((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
      // If user switched back, reload translations from DB
      if (useAppStore.getState().currentSessionId === sessionId) {
        try {
          const rows = await window.capty.listTranslations(
            sessionId,
            targetLanguage,
          );
          const map: Record<number, string> = {};
          for (const row of rows) {
            map[row.segment_id] = row.translated_text;
          }
          setTranslations(map);
        } catch {
          // keep newTranslations as-is
        }
      }
    },
    [selectedTranslateModel, translatePrompt],
  );

  const handleStopTranslation = useCallback(() => {
    const sid = storeRef.current.currentSessionId;
    if (sid != null) {
      translateAbortMapRef.current[sid] = true;
    }
  }, []);

  // Load saved translations when switching language or session
  const handleLoadTranslations = useCallback(
    async (sessionId: number, targetLanguage: string) => {
      try {
        const rows = await window.capty.listTranslations(
          sessionId,
          targetLanguage,
        );
        const map: Record<number, string> = {};
        for (const row of rows) {
          map[row.segment_id] = row.translated_text;
        }
        setTranslations(map);
        setActiveTranslationLang(targetLanguage);
      } catch {
        setTranslations({});
      }
    },
    [],
  );

  // ── Effects ──

  // Validate translate model selection when providers change
  useEffect(() => {
    if (!selectedTranslateModel) return;
    const provider = llmProviders.find(
      (p) => p.id === selectedTranslateModel.providerId,
    );
    if (!provider) {
      setSelectedTranslateModel(null);
      return;
    }
    const models = provider.models?.length
      ? provider.models
      : provider.model
        ? [provider.model]
        : [];
    if (!models.includes(selectedTranslateModel.model)) {
      if (models.length > 0) {
        setSelectedTranslateModel({
          providerId: provider.id,
          model: models[0],
        });
      } else {
        setSelectedTranslateModel(null);
      }
    }
  }, [llmProviders]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Init ──

  const initFromConfig = useCallback(
    (config: Record<string, unknown>) => {
      if (config.selectedTranslateModel) {
        setSelectedTranslateModel(
          config.selectedTranslateModel as ModelSelection,
        );
      }
      const savedTranslatePrompt = config.translatePrompt as
        | string
        | undefined;
      if (savedTranslatePrompt) {
        setTranslatePrompt(savedTranslatePrompt);
      }
    },
    [],
  );

  return {
    // State
    selectedTranslateModel,
    translatePrompt,
    translationProgressMap,
    isTranslating,
    translationProgress,
    translations,
    activeTranslationLang,

    // Setters needed externally
    setTranslations,
    setActiveTranslationLang,

    // Handlers
    handleTranslate,
    handleStopTranslation,
    handleLoadTranslations,
    handleChangeTranslateModel,
    handleChangeTranslatePrompt,

    // Init
    initFromConfig,
  };
}
