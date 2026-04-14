import { create } from "zustand";

export interface Summary {
  readonly id: number;
  readonly session_id: number;
  readonly content: string;
  readonly model_name: string;
  readonly provider_id: string;
  readonly prompt_type: string;
  readonly created_at: string;
}

interface SummaryState {
  // State
  readonly summaries: readonly Summary[];
  readonly generatingTabs: ReadonlySet<string>;
  readonly streamingContentMap: Readonly<Record<string, string>>;
  readonly generateError: string | null;
  readonly activePromptType: string;

  // Actions
  readonly loadSummaries: (sessionId: number) => Promise<void>;
  readonly deleteSummary: (id: number) => Promise<void>;
  readonly startGeneration: (promptType: string) => void;
  readonly stopGeneration: (promptType: string) => void;
  readonly appendStreamContent: (promptType: string, chunk: string) => void;
  readonly setActivePromptType: (type: string) => void;
  readonly clearError: () => void;
  readonly setError: (msg: string) => void;
  readonly setSummaries: (summaries: Summary[]) => void;
  readonly reset: () => void;
}

const initialState = {
  summaries: [] as Summary[],
  generatingTabs: new Set<string>(),
  streamingContentMap: {} as Record<string, string>,
  generateError: null as string | null,
  activePromptType: "summarize",
};

export const useSummaryStore = create<SummaryState>((set, get) => ({
  ...initialState,

  loadSummaries: async (sessionId: number) => {
    const activePromptType = get().activePromptType;
    const summaries = await window.capty.listSummaries(sessionId, activePromptType);
    set({ summaries: summaries as Summary[], generateError: null });
  },

  deleteSummary: async (id: number) => {
    await window.capty.deleteSummary(id);
  },

  startGeneration: (promptType: string) => {
    set((state) => ({
      generatingTabs: new Set(state.generatingTabs).add(promptType),
      streamingContentMap: { ...state.streamingContentMap, [promptType]: "" },
    }));
  },

  stopGeneration: (promptType: string) => {
    set((state) => {
      const next = new Set(state.generatingTabs);
      next.delete(promptType);
      const nextMap = { ...state.streamingContentMap };
      delete nextMap[promptType];
      return { generatingTabs: next, streamingContentMap: nextMap };
    });
  },

  appendStreamContent: (promptType: string, chunk: string) => {
    set((state) => ({
      streamingContentMap: {
        ...state.streamingContentMap,
        [promptType]: (state.streamingContentMap[promptType] ?? "") + chunk,
      },
    }));
  },

  setActivePromptType: (type: string) => {
    set({ activePromptType: type });
  },

  clearError: () => {
    set({ generateError: null });
  },

  setError: (msg: string) => {
    set({ generateError: msg });
  },

  setSummaries: (summaries: Summary[]) => {
    set({ summaries });
  },

  reset: () => set({ ...initialState, generatingTabs: new Set<string>(), streamingContentMap: {} }),
}));
