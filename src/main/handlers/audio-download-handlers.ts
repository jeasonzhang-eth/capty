import { ipcMain, net } from "electron";
import type { ChildProcess } from "child_process";
import fs from "fs";
import { join } from "path";
import type { IpcDeps } from "./types";
import { spawn } from "../shared/spawn";
import {
  createDownload,
  getDownload,
  listDownloads,
  updateDownload,
  deleteDownload,
} from "../database";
import { createSession, updateSession } from "../database";
import { readConfig } from "../config";

/** Track active yt-dlp child processes by download ID for cancel support. */
const activeDownloads = new Map<number, ChildProcess>();
const activeHttpDownloads = new Map<number, AbortController>();

/** Extract domain from URL for display. */
export function extractSource(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

/** Parse yt-dlp download progress line. */
function parseYtdlpProgress(line: string): {
  percent: number;
  speed: string;
  eta: string;
} | null {
  const m = line.match(
    /\[download\]\s+([\d.]+)%\s+of\s+~?[\d.]+\S+\s+at\s+([\d.]+\S+)\s+ETA\s+(\S+)/,
  );
  if (!m) return null;
  return { percent: parseFloat(m[1]), speed: m[2], eta: m[3] };
}

/** Check if URL is a Xiaoyuzhou (小宇宙) podcast episode. */
export function isXiaoyuzhouUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "www.xiaoyuzhoufm.com" || host === "xiaoyuzhoufm.com";
  } catch {
    return false;
  }
}

/** Fetch Xiaoyuzhou episode info from __NEXT_DATA__. */
async function fetchXiaoyuzhouEpisode(
  url: string,
): Promise<{ title: string; audioUrl: string; duration: number }> {
  const resp = await net.fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch episode page (${resp.status})`);
  }
  const html = await resp.text();

  // Extract __NEXT_DATA__ JSON
  const m = html.match(
    /<script\s+id="__NEXT_DATA__"\s+type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!m) throw new Error("Could not find __NEXT_DATA__ in episode page");

  const data = JSON.parse(m[1]);
  const episode = data?.props?.pageProps?.episode;
  if (!episode) throw new Error("Episode data not found in __NEXT_DATA__");

  const audioUrl = episode.enclosure?.url || episode.media?.url;
  if (!audioUrl) throw new Error("Audio URL not found in episode data");

  return {
    title: episode.title || "",
    audioUrl,
    duration: episode.duration || 0,
  };
}

/** Download a file via HTTP with progress reporting. */
async function httpDownload(
  audioUrl: string,
  destPath: string,
  opts: {
    onProgress?: (percent: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<void> {
  const resp = await net.fetch(audioUrl, { signal: opts.signal });
  if (!resp.ok) {
    throw new Error(`HTTP download failed (${resp.status})`);
  }

  const totalStr = resp.headers.get("content-length");
  const total = totalStr ? parseInt(totalStr, 10) : 0;
  let downloaded = 0;

  const reader = resp.body?.getReader();
  if (!reader) throw new Error("No response body");

  const fd = fs.openSync(destPath, "w");
  try {
    for (;;) {
      if (opts.signal?.aborted) {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        throw error;
      }
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      fs.writeSync(fd, chunk);
      downloaded += value.byteLength;
      if (total > 0 && opts.onProgress) {
        opts.onProgress(Math.min(99.9, (downloaded / total) * 100));
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** Convert any audio file to 16kHz mono 16-bit WAV via ffmpeg. */
function convertToWav(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i",
      inputPath,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-sample_fmt",
      "s16",
      "-f",
      "wav",
      "-y",
      outputPath,
    ]);
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    ffmpeg.on("error", (err) => {
      reject(
        new Error(
          `Failed to run ffmpeg. Make sure ffmpeg is installed (brew install ffmpeg). ${(err as Error).message}`,
        ),
      );
    });
  });
}

export function register(deps: IpcDeps): void {
  const { db, configDir, getMainWindow } = deps;

  // ─── Audio Download via yt-dlp ───

  ipcMain.handle("audio:download-list", () => {
    return listDownloads(db);
  });

  ipcMain.handle("audio:download-remove", (_event, downloadId: number) => {
    const dl = getDownload(db, downloadId);
    if (dl?.temp_dir) {
      try {
        fs.rmSync(dl.temp_dir, { recursive: true, force: true });
      } catch {
        // temp dir may already be cleaned
      }
    }
    deleteDownload(db, downloadId);
  });

  ipcMain.handle("audio:download-cancel", (_event, downloadId: number) => {
    const proc = activeDownloads.get(downloadId);
    if (proc) {
      proc.kill("SIGTERM");
      activeDownloads.delete(downloadId);
    }
    const controller = activeHttpDownloads.get(downloadId);
    if (controller) {
      controller.abort();
      activeHttpDownloads.delete(downloadId);
    }
    const dl = getDownload(db, downloadId);
    if (dl?.temp_dir) {
      try {
        fs.rmSync(dl.temp_dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    updateDownload(db, downloadId, { status: "cancelled", progress: 0 });
    const win = getMainWindow();
    if (win) {
      win.webContents.send("audio:download-progress", {
        id: downloadId,
        stage: "cancelled" as const,
      });
    }
  });

  ipcMain.handle("audio:download-start", async (_event, url: string) => {
    const win = getMainWindow();
    const source = extractSource(url);
    const isXyz = isXiaoyuzhouUrl(url);

    // 1. Check yt-dlp exists (skip for Xiaoyuzhou — uses direct HTTP)
    if (!isXyz) {
      try {
        await new Promise<void>((resolve, reject) => {
          const check = spawn("which", ["yt-dlp"]);
          check.on("close", (code) =>
            code === 0 ? resolve() : reject(new Error("not found")),
          );
          check.on("error", reject);
        });
      } catch {
        return {
          ok: false,
          error:
            "yt-dlp is not installed. To install:\n" +
            '1. Install Homebrew: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"\n' +
            "2. Install yt-dlp: brew install yt-dlp",
        };
      }
    }

    // 2. Create download record
    const downloadId = createDownload(db, { url, source });

    // 3. Run download async (don't await — return downloadId immediately)
    const config = readConfig(configDir);
    const dataDir = config.dataDir ?? join(configDir, "data");

    (async () => {
      try {
        // Push fetching-info event
        if (win) {
          win.webContents.send("audio:download-progress", {
            id: downloadId,
            stage: "fetching-info",
          });
        }

        // Shared timestamp helpers
        const now = new Date();
        const pad = (n: number): string => String(n).padStart(2, "0");
        const dirTimestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        const readableTimestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

        const tempDir = join(
          dataDir,
          "audio",
          ".downloading",
          String(downloadId),
        );
        fs.mkdirSync(tempDir, { recursive: true });

        let videoTitle = "";
        let downloadedFilePath = "";

        if (isXyz) {
          // ── Xiaoyuzhou (小宇宙) direct download path ──
          const episode = await fetchXiaoyuzhouEpisode(url);
          videoTitle = episode.title;

          if (videoTitle) {
            updateDownload(db, downloadId, { title: videoTitle });
          }

          updateDownload(db, downloadId, {
            temp_dir: tempDir,
            status: "downloading",
          });
          if (win) {
            win.webContents.send("audio:download-progress", {
              id: downloadId,
              stage: "downloading",
              title: videoTitle || undefined,
              source,
            });
          }

          // Determine file extension from audio URL
          const audioExt =
            episode.audioUrl.match(/\.(m4a|mp3|ogg|opus|wav)/i)?.[1] || "m4a";
          downloadedFilePath = join(tempDir, `${dirTimestamp}.${audioExt}`);

          const controller = new AbortController();
          activeHttpDownloads.set(downloadId, controller);
          try {
            await httpDownload(episode.audioUrl, downloadedFilePath, {
              signal: controller.signal,
              onProgress: (percent) => {
                updateDownload(db, downloadId, { progress: percent });
                if (win) {
                  win.webContents.send("audio:download-progress", {
                    id: downloadId,
                    stage: "downloading",
                    percent,
                  });
                }
              },
            });
          } finally {
            activeHttpDownloads.delete(downloadId);
          }

          // Check if cancelled during download
          const currentDl = getDownload(db, downloadId);
          if (currentDl?.status === "cancelled") return;
        } else {
          // ── yt-dlp download path ──

          // Fetch video title
          try {
            videoTitle = await new Promise<string>((resolve, reject) => {
              const proc = spawn("yt-dlp", [
                "--print",
                "title",
                "--no-playlist",
                url,
              ]);
              let out = "";
              proc.stdout?.on("data", (chunk: Buffer) => {
                out += chunk.toString();
              });
              proc.on("close", (code) => {
                if (code === 0) resolve(out.trim());
                else
                  reject(
                    new Error(`yt-dlp title fetch exited with code ${code}`),
                  );
              });
              proc.on("error", reject);
            });
          } catch {
            videoTitle = "";
          }

          if (videoTitle) {
            updateDownload(db, downloadId, { title: videoTitle });
          }

          const outputTemplate = join(tempDir, `${dirTimestamp}.%(ext)s`);
          updateDownload(db, downloadId, {
            temp_dir: tempDir,
            status: "downloading",
          });
          if (win) {
            win.webContents.send("audio:download-progress", {
              id: downloadId,
              stage: "downloading",
              title: videoTitle || undefined,
              source,
            });
          }

          const ytdlp = spawn("yt-dlp", [
            "-f",
            "ba",
            "--continue",
            "--newline",
            "--no-playlist",
            "-o",
            outputTemplate,
            url,
          ]);
          activeDownloads.set(downloadId, ytdlp);

          let stderrBuf = "";
          ytdlp.stderr?.on("data", (chunk: Buffer) => {
            stderrBuf += chunk.toString();
          });

          ytdlp.stdout?.on("data", (chunk: Buffer) => {
            const lines = chunk.toString().split("\n");
            for (const line of lines) {
              const progress = parseYtdlpProgress(line);
              if (progress) {
                updateDownload(db, downloadId, {
                  progress: progress.percent,
                  speed: progress.speed,
                  eta: progress.eta,
                });
                if (win) {
                  win.webContents.send("audio:download-progress", {
                    id: downloadId,
                    stage: "downloading",
                    percent: progress.percent,
                    speed: progress.speed,
                    eta: progress.eta,
                  });
                }
              }
            }
          });

          const exitCode = await new Promise<number | null>((resolve) => {
            ytdlp.on("close", resolve);
          });
          activeDownloads.delete(downloadId);

          // Check if cancelled
          const currentDl = getDownload(db, downloadId);
          if (currentDl?.status === "cancelled") return;

          if (exitCode !== 0) {
            const errMsg =
              stderrBuf.trim().split("\n").pop() ||
              `yt-dlp exited with code ${exitCode}`;
            updateDownload(db, downloadId, {
              status: "failed",
              error: errMsg,
            });
            if (win) {
              win.webContents.send("audio:download-progress", {
                id: downloadId,
                stage: "error",
                error: errMsg,
              });
            }
            return;
          }

          // Find downloaded file
          const files = fs.readdirSync(tempDir);
          const downloadedFile = files.find((f) => !f.endsWith(".part"));
          if (!downloadedFile) {
            updateDownload(db, downloadId, {
              status: "failed",
              error: "Downloaded file not found in temp directory",
            });
            if (win) {
              win.webContents.send("audio:download-progress", {
                id: downloadId,
                stage: "error",
                error: "Downloaded file not found",
              });
            }
            return;
          }
          downloadedFilePath = join(tempDir, downloadedFile);
        }

        // ── Shared: convert → session → cleanup ──

        // Converting stage
        updateDownload(db, downloadId, { status: "converting", progress: 100 });
        if (win) {
          win.webContents.send("audio:download-progress", {
            id: downloadId,
            stage: "converting",
          });
        }

        // Deduplicate session directory
        let finalTimestamp = dirTimestamp;
        let sessionDir = join(dataDir, "audio", finalTimestamp);
        let suffix = 1;
        while (fs.existsSync(sessionDir)) {
          finalTimestamp = `${dirTimestamp}-${suffix}`;
          sessionDir = join(dataDir, "audio", finalTimestamp);
          suffix++;
        }
        fs.mkdirSync(sessionDir, { recursive: true });

        const wavPath = join(sessionDir, `${finalTimestamp}.wav`);
        await convertToWav(downloadedFilePath, wavPath);

        // Calculate duration
        const wavStat = fs.statSync(wavPath);
        const pcmBytes = wavStat.size - 44;
        const durationSeconds = Math.round(pcmBytes / 32000); // 16kHz * 16bit * mono

        // Create session
        const modelTag = isXyz ? "xiaoyuzhou" : "yt-dlp";
        const sessionTitle = videoTitle
          ? `${readableTimestamp} ${videoTitle}`
          : readableTimestamp;
        const sessionId = createSession(db, {
          modelName: modelTag,
          category: "download",
        });
        updateSession(db, sessionId, {
          audioPath: finalTimestamp,
          title: sessionTitle,
          startedAt: readableTimestamp,
          status: "completed",
          durationSeconds,
        });

        // Update download record
        const completedAt = new Date();
        const completedStr = `${completedAt.getFullYear()}-${pad(completedAt.getMonth() + 1)}-${pad(completedAt.getDate())} ${pad(completedAt.getHours())}:${pad(completedAt.getMinutes())}:${pad(completedAt.getSeconds())}`;
        updateDownload(db, downloadId, {
          status: "completed",
          session_id: sessionId,
          completed_at: completedStr,
          progress: 100,
        });

        // Clean up temp dir
        fs.rmSync(tempDir, { recursive: true, force: true });

        // Push completed event
        if (win) {
          win.webContents.send("audio:download-progress", {
            id: downloadId,
            stage: "completed",
            sessionId,
          });
        }
      } catch (err: unknown) {
        const currentDl = getDownload(db, downloadId);
        if (
          currentDl?.status === "cancelled" ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        updateDownload(db, downloadId, { status: "failed", error: message });
        if (win) {
          win.webContents.send("audio:download-progress", {
            id: downloadId,
            stage: "error",
            error: message,
          });
        }
      }
    })();

    return { downloadId };
  });

  ipcMain.handle("audio:download-retry", async (_event, downloadId: number) => {
    const dl = getDownload(db, downloadId);
    if (!dl) throw new Error("Download not found");

    // Delete old record and start a fresh download with the same URL
    const url = dl.url;
    deleteDownload(db, downloadId);

    // Trigger new download via IPC event to renderer, which calls downloadAudio()
    const win = getMainWindow();
    if (win) {
      win.webContents.send("audio:download-retry-trigger", { url });
    }
  });
}
