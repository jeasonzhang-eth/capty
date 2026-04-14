import { create } from "zustand";

interface TranslationRow {
  readonly segment_id: number;
  readonly translated_text: string;
}

interface TranslationState {
  // Per-session translation progress: sessionId → 0-100
  readonly translationProgressMap: Record<number, number>;
  // Per-session translated text: segmentId → translated text
  readonly translations: Record<number, string>;
  // Currently selected target language (null = no language selected)
  readonly activeTranslationLang: string | null;
  // Abort flags: sessionId → true means abort requested
  readonly abortMap: Record<number, boolean>;

  // Actions
  readonly setActiveTranslationLang: (lang: string | null) => void;
  readonly loadTranslations: (
    sessionId: number,
    targetLanguage: string,
  ) => Promise<void>;
  readonly setProgress: (sessionId: number, percent: number) => void;
  readonly setTranslation: (
    sessionId: number,
    text: Record<number, string>,
  ) => void;
  readonly requestAbort: (sessionId: number) => void;
  readonly clearAbort: (sessionId: number) => void;
  readonly isAborted: (sessionId: number) => boolean;
  readonly reset: () => void;
}

const STORAGE_KEY = "capty:activeTranslationLang";

function readInitialLang(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export const useTranslationStore = create<TranslationState>((set, get) => ({
  translationProgressMap: {},
  translations: {},
  activeTranslationLang: readInitialLang(),
  abortMap: {},

  setActiveTranslationLang: (lang) => {
    if (lang) {
      localStorage.setItem("capty:activeTranslationLang", lang);
    } else {
      localStorage.removeItem("capty:activeTranslationLang");
    }
    set({ activeTranslationLang: lang });
  },

  loadTranslations: async (sessionId, targetLanguage) => {
    try {
      const rows = (await window.capty.listTranslations(
        sessionId,
        targetLanguage,
      )) as TranslationRow[];
      const map: Record<number, string> = {};
      for (const row of rows) {
        map[row.segment_id] = row.translated_text;
      }
      set({ translations: map, activeTranslationLang: targetLanguage });
      if (targetLanguage) {
        localStorage.setItem("capty:activeTranslationLang", targetLanguage);
      }
    } catch {
      set({ translations: {} });
    }
  },

  setProgress: (sessionId, percent) =>
    set((state) => ({
      translationProgressMap: {
        ...state.translationProgressMap,
        [sessionId]: percent,
      },
    })),

  setTranslation: (sessionId, text) => set({ translations: { ...text } }),

  requestAbort: (sessionId) =>
    set((state) => ({
      abortMap: { ...state.abortMap, [sessionId]: true },
    })),

  clearAbort: (sessionId) =>
    set((state) => {
      const next = { ...state.abortMap };
      delete next[sessionId];
      return { abortMap: next };
    }),

  isAborted: (sessionId) => Boolean(get().abortMap[sessionId]),

  reset: () =>
    set({
      translationProgressMap: {},
      translations: {},
      activeTranslationLang: null,
      abortMap: {},
    }),
}));
