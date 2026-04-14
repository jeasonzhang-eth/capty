import { create } from "zustand";
import type { DownloadItem } from "../components/DownloadManagerDialog";

export interface DownloadInfo {
  readonly modelId: string;
  readonly category: "asr" | "tts";
  readonly percent: number;
  readonly status: string; // downloading | paused | failed | completed | pending
  readonly error?: string;
}

interface DownloadState {
  // State
  readonly downloads: Record<string, DownloadInfo>;
  readonly audioDownloads: readonly DownloadItem[];
  readonly downloadBadge: "active" | "failed" | null;
  readonly showDownloadManager: boolean;

  // Actions
  readonly setDownload: (modelId: string, info: DownloadInfo) => void;
  readonly removeDownload: (modelId: string) => void;
  readonly setAudioDownloads: (items: DownloadItem[]) => void;
  readonly loadAudioDownloads: () => Promise<void>;
  readonly setShowDownloadManager: (v: boolean) => void;
  readonly computeBadge: () => void;
}

function computeDownloadBadge(
  list: readonly DownloadItem[],
): "active" | "failed" | null {
  const hasActive = list.some((d) =>
    ["pending", "fetching-info", "downloading", "converting"].includes(
      d.status,
    ),
  );
  if (hasActive) return "active";
  const hasFailed = list.some((d) => d.status === "failed");
  if (hasFailed) return "failed";
  return null;
}

const initialState = {
  downloads: {} as Record<string, DownloadInfo>,
  audioDownloads: [] as DownloadItem[],
  downloadBadge: null as "active" | "failed" | null,
  showDownloadManager: false,
};

export const useDownloadStore = create<DownloadState>((set, get) => ({
  ...initialState,

  setDownload: (modelId, info) =>
    set((state) => ({
      downloads: { ...state.downloads, [modelId]: info },
    })),

  removeDownload: (modelId) =>
    set((state) => {
      const next = { ...state.downloads };
      delete next[modelId];
      return { downloads: next };
    }),

  setAudioDownloads: (items) =>
    set({
      audioDownloads: items,
      downloadBadge: computeDownloadBadge(items),
    }),

  loadAudioDownloads: async () => {
    const items = (await window.capty.getAudioDownloads()) as DownloadItem[];
    set({
      audioDownloads: items,
      downloadBadge: computeDownloadBadge(items),
    });
  },

  setShowDownloadManager: (v) => set({ showDownloadManager: v }),

  computeBadge: () => {
    const { audioDownloads } = get();
    set({ downloadBadge: computeDownloadBadge(audioDownloads) });
  },
}));
