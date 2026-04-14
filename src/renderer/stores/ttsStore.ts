import { create } from "zustand";

// Copied from SettingsModal.tsx — do not import from there to keep stores independent
export interface TtsProviderConfig {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly voice: string;
  readonly isSidecar: boolean;
}

export interface TtsModel {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly repo: string;
  readonly downloaded: boolean;
  readonly size_gb: number;
  readonly languages: readonly string[];
  readonly description: string;
}

export interface TtsVoice {
  readonly id: string;
  readonly name: string;
  readonly lang: string;
  readonly gender: string;
}

interface TtsState {
  readonly ttsProviders: readonly TtsProviderConfig[];
  readonly selectedTtsProviderId: string | null;
  readonly ttsModels: readonly TtsModel[];
  readonly selectedTtsModelId: string;
  readonly selectedTtsVoice: string;
  readonly ttsVoices: readonly TtsVoice[];

  // Actions
  readonly setTtsProviders: (providers: TtsProviderConfig[]) => void;
  readonly setSelectedTtsProviderId: (id: string | null) => void;
  readonly setTtsModels: (models: TtsModel[]) => void;
  readonly setSelectedTtsModel: (modelId: string) => void;
  readonly setSelectedTtsVoice: (voice: string) => void;
  readonly setTtsVoices: (voices: TtsVoice[]) => void;

  /**
   * Save TTS provider settings (providers + selected provider + current model)
   * and update local state.
   */
  readonly saveTtsSettings: (settings: {
    ttsProviders: TtsProviderConfig[];
    selectedTtsProviderId: string | null;
    selectedTtsModelId?: string;
  }) => Promise<void>;

  /**
   * Fetch available voices for the currently active TTS model and update state.
   * Falls back to empty list on error.
   */
  readonly loadVoices: () => Promise<void>;

  readonly reset: () => void;
}

const initialState = {
  ttsProviders: [] as TtsProviderConfig[],
  selectedTtsProviderId: null as string | null,
  ttsModels: [] as TtsModel[],
  selectedTtsModelId: "",
  selectedTtsVoice: "",
  ttsVoices: [] as TtsVoice[],
};

export const useTtsStore = create<TtsState>()((set, get) => ({
  ...initialState,

  setTtsProviders: (providers) => set({ ttsProviders: providers }),
  setSelectedTtsProviderId: (id) => set({ selectedTtsProviderId: id }),
  setTtsModels: (models) => set({ ttsModels: models }),
  setSelectedTtsModel: (modelId) => set({ selectedTtsModelId: modelId }),
  setSelectedTtsVoice: (voice) => set({ selectedTtsVoice: voice }),
  setTtsVoices: (voices) => set({ ttsVoices: voices }),

  saveTtsSettings: async (settings) => {
    set({
      ttsProviders: settings.ttsProviders,
      selectedTtsProviderId: settings.selectedTtsProviderId,
    });
    if (settings.selectedTtsModelId !== undefined) {
      set({ selectedTtsModelId: settings.selectedTtsModelId });
    }
    await window.capty.saveTtsSettings({
      ttsProviders: settings.ttsProviders,
      selectedTtsProviderId: settings.selectedTtsProviderId,
      selectedTtsModelId:
        settings.selectedTtsModelId ?? get().selectedTtsModelId,
    });
  },

  loadVoices: async () => {
    try {
      const result = await window.capty.ttsListVoices();
      const voices = (result as { voices: TtsVoice[] }).voices ?? [];
      set({ ttsVoices: voices });
      // If the current saved voice is not in the list, default to first
      const currentVoice = get().selectedTtsVoice;
      if (voices.length > 0 && !voices.some((v) => v.id === currentVoice)) {
        set({ selectedTtsVoice: voices[0].id });
      }
    } catch {
      set({ ttsVoices: [] });
    }
  },

  reset: () => set(initialState),
}));
