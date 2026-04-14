import { create } from "zustand";
import type { LlmProvider } from "../components/SettingsModal";
import type { SessionCategory } from "../components/HistoryPanel";
import type { PromptType } from "../components/SummaryPanel";

export type { LlmProvider, SessionCategory, PromptType };

export type ModelSelection = { providerId: string; model: string } | null;

const DEFAULT_HF_URL = "https://huggingface.co";

const DEFAULT_RAPID_RENAME_PROMPT =
  "Based on the following meeting transcript, generate a concise and descriptive Chinese title (max 10 words). Return ONLY the title text, no quotes, no timestamp, no extra text.";

const DEFAULT_TRANSLATE_PROMPT =
  "You are a professional translator. Translate the following text to {{target_language}}. Rules:\n1. Translate ONLY the text content, preserving the exact number of lines\n2. Each line in the output corresponds to the same line in the input\n3. Do NOT add, remove, or merge lines\n4. Do NOT add any explanations, notes, or extra text\n5. Maintain the original tone and meaning\n\n{{text}}";

export const DEFAULT_HISTORY_WIDTH = 240;
export const DEFAULT_SUMMARY_WIDTH = 320;

interface SettingsState {
  // Config path
  readonly configDir: string | null;

  // HuggingFace mirror
  readonly hfMirrorUrl: string;

  // Sidecar
  readonly autoStartSidecar: boolean;

  // Layout
  readonly zoomFactor: number;
  readonly historyPanelWidth: number;
  readonly summaryPanelWidth: number;

  // LLM
  readonly llmProviders: readonly LlmProvider[];
  readonly selectedSummaryModel: ModelSelection;
  readonly selectedTranslateModel: ModelSelection;
  readonly selectedRapidModel: ModelSelection;
  readonly rapidRenamePrompt: string;
  readonly translatePrompt: string;

  // Categories and prompt types
  readonly sessionCategories: readonly SessionCategory[];
  readonly promptTypes: readonly PromptType[];

  // Setters
  readonly setConfigDir: (dir: string | null) => void;
  readonly setHfMirrorUrl: (url: string) => void;
  readonly setAutoStartSidecar: (v: boolean) => void;
  readonly setZoomFactor: (v: number) => void;
  readonly setHistoryPanelWidth: (w: number) => void;
  readonly setSummaryPanelWidth: (w: number) => void;
  readonly setLlmProviders: (providers: LlmProvider[]) => void;
  readonly setSelectedSummaryModel: (sel: ModelSelection) => void;
  readonly setSelectedTranslateModel: (sel: ModelSelection) => void;
  readonly setSelectedRapidModel: (sel: ModelSelection) => void;
  readonly setRapidRenamePrompt: (p: string) => void;
  readonly setTranslatePrompt: (p: string) => void;
  readonly setSessionCategories: (cats: SessionCategory[]) => void;
  readonly setPromptTypes: (types: PromptType[]) => void;

  // Async actions
  readonly loadConfig: () => Promise<void>;
  readonly saveConfig: (partial: Record<string, unknown>) => Promise<void>;
  readonly saveLayoutWidths: (
    historyWidth: number,
    summaryWidth: number,
  ) => void;
  readonly addCategory: (cat: { label: string; icon: string }) => Promise<void>;
  readonly deleteCategory: (id: string) => Promise<void>;
  readonly savePromptTypes: (types: PromptType[]) => Promise<void>;
}

const initialState = {
  configDir: null as string | null,
  hfMirrorUrl: DEFAULT_HF_URL,
  autoStartSidecar: true,
  zoomFactor: 1.0,
  historyPanelWidth: DEFAULT_HISTORY_WIDTH,
  summaryPanelWidth: DEFAULT_SUMMARY_WIDTH,
  llmProviders: [] as LlmProvider[],
  selectedSummaryModel: null as ModelSelection,
  selectedTranslateModel: null as ModelSelection,
  selectedRapidModel: null as ModelSelection,
  rapidRenamePrompt: DEFAULT_RAPID_RENAME_PROMPT,
  translatePrompt: DEFAULT_TRANSLATE_PROMPT,
  sessionCategories: [] as SessionCategory[],
  promptTypes: [] as PromptType[],
};

// Debounce timer for layout saves
let layoutTimer: ReturnType<typeof setTimeout> | null = null;

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...initialState,

  // Simple setters
  setConfigDir: (dir) => set({ configDir: dir }),
  setHfMirrorUrl: (url) => set({ hfMirrorUrl: url }),
  setAutoStartSidecar: (v) => set({ autoStartSidecar: v }),
  setZoomFactor: (v) => set({ zoomFactor: v }),
  setHistoryPanelWidth: (w) => set({ historyPanelWidth: w }),
  setSummaryPanelWidth: (w) => set({ summaryPanelWidth: w }),
  setLlmProviders: (providers) => set({ llmProviders: providers }),
  setSelectedSummaryModel: (sel) => set({ selectedSummaryModel: sel }),
  setSelectedTranslateModel: (sel) => set({ selectedTranslateModel: sel }),
  setSelectedRapidModel: (sel) => set({ selectedRapidModel: sel }),
  setRapidRenamePrompt: (p) => set({ rapidRenamePrompt: p }),
  setTranslatePrompt: (p) => set({ translatePrompt: p }),
  setSessionCategories: (cats) => set({ sessionCategories: cats }),
  setPromptTypes: (types) => set({ promptTypes: types }),

  // Load all settings from backend config
  loadConfig: async () => {
    const config = await window.capty.getConfig();

    const savedHistoryWidth = config.historyPanelWidth as number | null;
    const savedSummaryWidth = config.summaryPanelWidth as number | null;
    const savedHfUrl = config.hfMirrorUrl as string | null;
    const savedProviders = config.llmProviders as LlmProvider[] | undefined;
    const savedRenamePrompt = config.rapidRenamePrompt as string | undefined;
    const savedTranslatePrompt = config.translatePrompt as string | undefined;
    const sidecarCfg = config.sidecar as
      | { port: number; autoStart: boolean }
      | undefined;

    const patch: Partial<typeof initialState> = {};

    if (savedHistoryWidth !== null && savedHistoryWidth !== undefined) {
      patch.historyPanelWidth = savedHistoryWidth;
    }
    if (savedSummaryWidth !== null && savedSummaryWidth !== undefined) {
      patch.summaryPanelWidth = savedSummaryWidth;
    }
    if (savedHfUrl) {
      patch.hfMirrorUrl = savedHfUrl;
    }
    if (savedProviders?.length) {
      patch.llmProviders = savedProviders;
    }
    if (config.selectedSummaryModel) {
      patch.selectedSummaryModel = config.selectedSummaryModel as ModelSelection;
    }
    if (config.selectedTranslateModel) {
      patch.selectedTranslateModel =
        config.selectedTranslateModel as ModelSelection;
    }
    if (config.selectedRapidModel) {
      patch.selectedRapidModel = config.selectedRapidModel as ModelSelection;
    }
    if (savedRenamePrompt) {
      patch.rapidRenamePrompt = savedRenamePrompt;
    }
    if (savedTranslatePrompt) {
      patch.translatePrompt = savedTranslatePrompt;
    }
    if (sidecarCfg) {
      patch.autoStartSidecar = sidecarCfg.autoStart !== false;
    }

    set(patch);

    // Load zoom factor (separate IPC call)
    const savedZoom = await window.capty.getZoomFactor();
    if (savedZoom && savedZoom !== 1.0) {
      set({ zoomFactor: savedZoom as number });
    }

    // Load config dir
    const configDir = await window.capty.getConfigDir();
    set({ configDir: configDir as string | null });

    // Load prompt types
    try {
      const types = await window.capty.listPromptTypes();
      set({ promptTypes: types as PromptType[] });
    } catch {
      // Prompt types not available
    }

    // Load session categories
    try {
      const cats = await window.capty.listSessionCategories();
      set({ sessionCategories: cats as SessionCategory[] });
    } catch {
      // Session categories not available
    }
  },

  // Save a partial config update to backend
  saveConfig: async (partial) => {
    const config = await window.capty.getConfig();
    await window.capty.setConfig({ ...config, ...partial });
  },

  // Debounced layout width save
  saveLayoutWidths: (historyWidth, summaryWidth) => {
    set({ historyPanelWidth: historyWidth, summaryPanelWidth: summaryWidth });
    if (layoutTimer) clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => {
      window.capty.saveLayout({
        historyPanelWidth: historyWidth,
        summaryPanelWidth: summaryWidth,
      });
    }, 500);
  },

  // Add a custom session category
  addCategory: async (cat) => {
    const id = `custom-${Date.now()}`;
    const newCat: SessionCategory = {
      id,
      label: cat.label,
      icon: cat.icon,
      isBuiltin: false,
    };
    const current = get().sessionCategories;
    const updated = [...current, newCat];
    await window.capty.saveSessionCategories(updated);
    const cats = await window.capty.listSessionCategories();
    set({ sessionCategories: cats as SessionCategory[] });
  },

  // Delete a session category by ID
  deleteCategory: async (id) => {
    await window.capty.deleteSessionCategory(id);
    const cats = await window.capty.listSessionCategories();
    set({ sessionCategories: cats as SessionCategory[] });
  },

  // Save prompt types and reload effective list from backend
  savePromptTypes: async (types) => {
    await window.capty.savePromptTypes(types);
    const effective = await window.capty.listPromptTypes();
    set({ promptTypes: effective as PromptType[] });
  },
}));
