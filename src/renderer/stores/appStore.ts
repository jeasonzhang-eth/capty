import { create } from "zustand";

interface Segment {
  readonly id: number;
  readonly start_time: number;
  readonly end_time: number;
  readonly text: string;
}

interface SessionSummary {
  readonly id: number;
  readonly title: string;
  readonly started_at: string;
  readonly duration_seconds: number | null;
  readonly model_name: string;
  readonly status: string;
}

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

export interface AsrProviderState {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly isSidecar: boolean;
}

interface AppState {
  // App status
  readonly isRecording: boolean;
  readonly sidecarReady: boolean;
  readonly dataDir: string | null;

  // ASR providers
  readonly asrProviders: readonly AsrProviderState[];
  readonly selectedAsrProviderId: string | null;

  // Current session
  readonly currentSessionId: number | null;
  readonly segments: readonly Segment[];
  readonly partialText: string;
  readonly elapsedSeconds: number;

  // History
  readonly sessions: readonly SessionSummary[];

  // Devices & models
  readonly audioDevices: readonly MediaDeviceInfo[];
  readonly selectedDeviceId: string | null;
  readonly models: readonly ModelInfo[];
  readonly selectedModelId: string;

  // Actions
  readonly setRecording: (v: boolean) => void;
  readonly setSidecarReady: (v: boolean) => void;
  readonly setDataDir: (dir: string | null) => void;
  readonly setAsrProviders: (providers: AsrProviderState[]) => void;
  readonly setSelectedAsrProviderId: (id: string | null) => void;
  readonly setCurrentSessionId: (id: number | null) => void;
  readonly addSegment: (seg: Segment) => void;
  readonly setSegments: (segs: Segment[]) => void;
  readonly clearSegments: () => void;
  readonly setPartialText: (text: string) => void;
  readonly setElapsedSeconds: (s: number) => void;
  readonly setSessions: (sessions: SessionSummary[]) => void;
  readonly setAudioDevices: (devices: MediaDeviceInfo[]) => void;
  readonly setSelectedDeviceId: (id: string | null) => void;
  readonly setModels: (models: ModelInfo[]) => void;
  readonly setSelectedModelId: (id: string) => void;
  readonly loadSessions: () => Promise<void>;
  readonly reset: () => void;
}

const initialState = {
  isRecording: false,
  sidecarReady: false,
  dataDir: null as string | null,
  asrProviders: [] as AsrProviderState[],
  selectedAsrProviderId: null as string | null,
  currentSessionId: null as number | null,
  segments: [] as Segment[],
  partialText: "",
  elapsedSeconds: 0,
  sessions: [] as SessionSummary[],
  audioDevices: [] as MediaDeviceInfo[],
  selectedDeviceId: null as string | null,
  models: [] as ModelInfo[],
  selectedModelId: "qwen3-asr-0.6b",
};

export const useAppStore = create<AppState>((set) => ({
  ...initialState,

  setRecording: (v) => set({ isRecording: v }),
  setSidecarReady: (v) => set({ sidecarReady: v }),
  setDataDir: (dir) => set({ dataDir: dir }),
  setAsrProviders: (providers) => set({ asrProviders: providers }),
  setSelectedAsrProviderId: (id) => set({ selectedAsrProviderId: id }),
  setCurrentSessionId: (id) => set({ currentSessionId: id }),
  addSegment: (seg) => set((state) => ({ segments: [...state.segments, seg] })),
  setSegments: (segs) => set({ segments: segs, partialText: "" }),
  clearSegments: () => set({ segments: [], partialText: "" }),
  setPartialText: (text) => set({ partialText: text }),
  setElapsedSeconds: (s) => set({ elapsedSeconds: s }),
  setSessions: (sessions) => set({ sessions }),
  setAudioDevices: (devices) => set({ audioDevices: devices }),
  setSelectedDeviceId: (id) => set({ selectedDeviceId: id }),
  setModels: (models) => set({ models }),
  setSelectedModelId: (id) => set({ selectedModelId: id }),

  loadSessions: async () => {
    const sessions = await window.capty.listSessions();
    set({ sessions: sessions as SessionSummary[] });
  },

  reset: () => set(initialState),
}));
