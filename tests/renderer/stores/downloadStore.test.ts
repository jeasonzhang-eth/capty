import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDownloadStore } from "../../../src/renderer/stores/downloadStore";
import type { DownloadInfo } from "../../../src/renderer/stores/downloadStore";
import type { DownloadItem } from "../../../src/renderer/components/DownloadManagerDialog";

function makeDownloadItem(overrides: Partial<DownloadItem> = {}): DownloadItem {
  return {
    id: 1,
    url: "https://example.com/audio",
    title: "Test Audio",
    source: null,
    status: "completed",
    progress: 100,
    speed: null,
    eta: null,
    session_id: null,
    error: null,
    created_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:01:00Z",
    ...overrides,
  };
}

describe("downloadStore", () => {
  beforeEach(() => {
    useDownloadStore.setState({
      downloads: {},
      audioDownloads: [],
      downloadBadge: null,
      showDownloadManager: false,
    });
    vi.clearAllMocks();
  });

  describe("initial state", () => {
    it("has empty downloads map", () => {
      expect(useDownloadStore.getState().downloads).toEqual({});
    });

    it("has empty audioDownloads list", () => {
      expect(useDownloadStore.getState().audioDownloads).toEqual([]);
    });

    it("has null downloadBadge", () => {
      expect(useDownloadStore.getState().downloadBadge).toBeNull();
    });

    it("has showDownloadManager false", () => {
      expect(useDownloadStore.getState().showDownloadManager).toBe(false);
    });
  });

  describe("setDownload", () => {
    it("adds a new entry to the downloads map", () => {
      const info: DownloadInfo = {
        modelId: "model-1",
        category: "asr",
        percent: 50,
        status: "downloading",
      };
      useDownloadStore.getState().setDownload("model-1", info);
      expect(useDownloadStore.getState().downloads["model-1"]).toEqual(info);
    });

    it("updates an existing entry immutably", () => {
      const info1: DownloadInfo = {
        modelId: "model-1",
        category: "asr",
        percent: 50,
        status: "downloading",
      };
      const info2: DownloadInfo = {
        modelId: "model-1",
        category: "asr",
        percent: 80,
        status: "downloading",
      };
      useDownloadStore.getState().setDownload("model-1", info1);
      useDownloadStore.getState().setDownload("model-1", info2);
      expect(useDownloadStore.getState().downloads["model-1"].percent).toBe(80);
    });

    it("does not mutate other entries when adding", () => {
      const info1: DownloadInfo = {
        modelId: "model-1",
        category: "asr",
        percent: 50,
        status: "downloading",
      };
      const info2: DownloadInfo = {
        modelId: "model-2",
        category: "tts",
        percent: 20,
        status: "pending",
      };
      useDownloadStore.getState().setDownload("model-1", info1);
      useDownloadStore.getState().setDownload("model-2", info2);
      expect(Object.keys(useDownloadStore.getState().downloads)).toHaveLength(
        2,
      );
      expect(useDownloadStore.getState().downloads["model-1"]).toEqual(info1);
    });
  });

  describe("removeDownload", () => {
    it("removes an existing entry from the downloads map", () => {
      const info: DownloadInfo = {
        modelId: "model-1",
        category: "asr",
        percent: 100,
        status: "completed",
      };
      useDownloadStore.getState().setDownload("model-1", info);
      useDownloadStore.getState().removeDownload("model-1");
      expect(useDownloadStore.getState().downloads["model-1"]).toBeUndefined();
    });

    it("is a no-op when removing a non-existent key", () => {
      useDownloadStore.getState().removeDownload("nonexistent");
      expect(useDownloadStore.getState().downloads).toEqual({});
    });

    it("does not affect other entries when removing one", () => {
      const info1: DownloadInfo = {
        modelId: "model-1",
        category: "asr",
        percent: 50,
        status: "downloading",
      };
      const info2: DownloadInfo = {
        modelId: "model-2",
        category: "tts",
        percent: 20,
        status: "pending",
      };
      useDownloadStore.getState().setDownload("model-1", info1);
      useDownloadStore.getState().setDownload("model-2", info2);
      useDownloadStore.getState().removeDownload("model-1");
      expect(useDownloadStore.getState().downloads["model-2"]).toEqual(info2);
      expect(useDownloadStore.getState().downloads["model-1"]).toBeUndefined();
    });
  });

  describe("setAudioDownloads", () => {
    it("replaces the audioDownloads list", () => {
      const items = [makeDownloadItem({ id: 1 }), makeDownloadItem({ id: 2 })];
      useDownloadStore.getState().setAudioDownloads(items);
      expect(useDownloadStore.getState().audioDownloads).toEqual(items);
    });

    it("updates downloadBadge based on new list", () => {
      const activeItem = makeDownloadItem({ status: "downloading" });
      useDownloadStore.getState().setAudioDownloads([activeItem]);
      expect(useDownloadStore.getState().downloadBadge).toBe("active");
    });
  });

  describe("loadAudioDownloads", () => {
    it("calls window.capty.getAudioDownloads", async () => {
      (
        window.capty.getAudioDownloads as ReturnType<typeof vi.fn>
      ).mockResolvedValue([]);

      await useDownloadStore.getState().loadAudioDownloads();

      expect(window.capty.getAudioDownloads).toHaveBeenCalledOnce();
    });

    it("updates audioDownloads with the returned items", async () => {
      const items = [makeDownloadItem({ id: 10 }), makeDownloadItem({ id: 11 })];
      (
        window.capty.getAudioDownloads as ReturnType<typeof vi.fn>
      ).mockResolvedValue(items);

      await useDownloadStore.getState().loadAudioDownloads();

      expect(useDownloadStore.getState().audioDownloads).toEqual(items);
    });

    it("recomputes downloadBadge after loading", async () => {
      const failedItem = makeDownloadItem({ status: "failed" });
      (
        window.capty.getAudioDownloads as ReturnType<typeof vi.fn>
      ).mockResolvedValue([failedItem]);

      await useDownloadStore.getState().loadAudioDownloads();

      expect(useDownloadStore.getState().downloadBadge).toBe("failed");
    });
  });

  describe("computeBadge", () => {
    it("returns 'active' when any download is in progress", () => {
      const activeStatuses = [
        "pending",
        "fetching-info",
        "downloading",
        "converting",
      ];
      for (const status of activeStatuses) {
        useDownloadStore.setState({
          audioDownloads: [makeDownloadItem({ status })],
          downloadBadge: null,
        });
        useDownloadStore.getState().computeBadge();
        expect(useDownloadStore.getState().downloadBadge).toBe("active");
      }
    });

    it("returns 'failed' when a download has failed (and none are active)", () => {
      useDownloadStore.setState({
        audioDownloads: [
          makeDownloadItem({ status: "failed" }),
          makeDownloadItem({ status: "completed" }),
        ],
        downloadBadge: null,
      });
      useDownloadStore.getState().computeBadge();
      expect(useDownloadStore.getState().downloadBadge).toBe("failed");
    });

    it("returns null when no downloads or all are completed/cancelled", () => {
      useDownloadStore.setState({
        audioDownloads: [],
        downloadBadge: "active",
      });
      useDownloadStore.getState().computeBadge();
      expect(useDownloadStore.getState().downloadBadge).toBeNull();
    });

    it("prioritises 'active' over 'failed'", () => {
      useDownloadStore.setState({
        audioDownloads: [
          makeDownloadItem({ status: "failed" }),
          makeDownloadItem({ status: "downloading" }),
        ],
        downloadBadge: null,
      });
      useDownloadStore.getState().computeBadge();
      expect(useDownloadStore.getState().downloadBadge).toBe("active");
    });

    it("returns null for completed-only list", () => {
      useDownloadStore.setState({
        audioDownloads: [
          makeDownloadItem({ status: "completed" }),
          makeDownloadItem({ status: "completed" }),
        ],
        downloadBadge: "failed",
      });
      useDownloadStore.getState().computeBadge();
      expect(useDownloadStore.getState().downloadBadge).toBeNull();
    });
  });

  describe("setShowDownloadManager", () => {
    it("toggles showDownloadManager to true", () => {
      useDownloadStore.getState().setShowDownloadManager(true);
      expect(useDownloadStore.getState().showDownloadManager).toBe(true);
    });

    it("toggles showDownloadManager back to false", () => {
      useDownloadStore.getState().setShowDownloadManager(true);
      useDownloadStore.getState().setShowDownloadManager(false);
      expect(useDownloadStore.getState().showDownloadManager).toBe(false);
    });
  });
});
