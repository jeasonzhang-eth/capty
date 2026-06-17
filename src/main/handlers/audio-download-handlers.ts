import { ipcMain, net, dialog } from "electron";
import type { ChildProcess } from "child_process";
import fs from "fs";
import { join } from "path";
import type { IpcDeps } from "./types";
import { spawn } from "../shared/spawn";
import {
  isChannelsShareUrl,
  resolveShareUrl,
  YuanbaoAuthError,
} from "../wechat/resolver";
import { downloadAndDecrypt } from "../wechat/downloader";
import {
  hasYuanbaoLogin,
  openYuanbaoLogin,
  ensureYuanbaoHeaders,
  clearYuanbaoLogin,
  yuanbaoFetch,
} from "../wechat/yuanbao-auth";
import {
  hasYoutubeLogin,
  openYoutubeLogin,
  clearYoutubeLogin,
  exportYoutubeCookies,
} from "../youtube/yt-auth";
import {
  createDownload,
  getDownload,
  listDownloads,
  updateDownload,
  deleteDownload,
} from "../database";
import { createSession, updateSession } from "../database";
import { readConfig, type AppConfig } from "../config";
import { sanitizeSessionDirName } from "../shared/session-name";

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

/** Browsers yt-dlp can extract cookies from via --cookies-from-browser. */
const COOKIE_BROWSERS = new Set([
  "chrome",
  "chromium",
  "brave",
  "edge",
  "firefox",
  "opera",
  "safari",
  "vivaldi",
  "whale",
]);

/**
 * Build the yt-dlp cookie flag for a configured browser. Returns an empty
 * array when no/unknown browser is set, so callers can spread it
 * unconditionally. YouTube blocks anonymous requests with a bot check;
 * supplying browser cookies authenticates as the logged-in user.
 */
export function ytdlpCookieArgs(browser: string | null | undefined): string[] {
  if (!browser) return [];
  const b = browser.toLowerCase().trim();
  return COOKIE_BROWSERS.has(b) ? ["--cookies-from-browser", b] : [];
}

/**
 * yt-dlp flag enabling its remote JS-challenge solver (EJS) so YouTube's
 * "n" challenge can be solved via a local JS runtime (deno). Empty array when
 * disabled. Opt-in because it fetches and runs a script from yt-dlp's GitHub.
 */
export function ytdlpSolverArgs(enabled: boolean | undefined): string[] {
  return enabled ? ["--remote-components", "ejs:github"] : [];
}

/** Check if URL points at YouTube (youtube.com / youtu.be). */
export function isYoutubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return (
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtu.be"
    );
  } catch {
    return false;
  }
}

/**
 * Resolve the yt-dlp cookie args for a URL. Prefers an exported YouTube login
 * (Netscape cookies.txt via `--cookies`) when the URL is YouTube and the user
 * has signed in; otherwise falls back to the configured `--cookies-from-browser`
 * source. `--cookies` and `--cookies-from-browser` are mutually exclusive, so
 * only one is returned.
 */
async function resolveCookieArgs(
  url: string,
  config: AppConfig,
  cookieFilePath: string,
): Promise<string[]> {
  if (isYoutubeUrl(url)) {
    try {
      if (await exportYoutubeCookies(cookieFilePath)) {
        return ["--cookies", cookieFilePath];
      }
    } catch {
      // fall through to browser cookies
    }
  }
  return ytdlpCookieArgs(config.ytdlpCookiesFromBrowser);
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
    const isWxch = isChannelsShareUrl(url);

    // 1. Check yt-dlp exists (skip for Xiaoyuzhou / 视频号 — direct HTTP)
    if (!isXyz && !isWxch) {
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
        // For 视频号: the decrypted MP4 to optionally keep in the session dir.
        let keepVideoSourcePath: string | null = null;

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
        } else if (isWxch) {
          // ── WeChat Channels (视频号) path ──
          // Ensure the user is logged into yuanbao (needed to resolve the link).
          if (!(await hasYuanbaoLogin())) {
            const ok = await openYuanbaoLogin(win ?? undefined);
            if (!ok) {
              throw new YuanbaoAuthError(
                "未登录腾讯元宝，无法解析视频号链接。请登录后重试。",
              );
            }
          }

          // Capture the user's own live device/fingerprint headers (best effort).
          await ensureYuanbaoHeaders();
          const resolved = await resolveShareUrl(url, yuanbaoFetch());
          videoTitle = resolved.title;
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

          downloadedFilePath = join(tempDir, `${dirTimestamp}.mp4`);
          await downloadAndDecrypt(
            resolved.videoUrl,
            resolved.decodeKey,
            downloadedFilePath,
            (u, init) => net.fetch(u, init),
          );
          updateDownload(db, downloadId, { progress: 100 });

          const currentDl = getDownload(db, downloadId);
          if (currentDl?.status === "cancelled") return;

          // Ask whether to keep the source video alongside the audio.
          if (win) {
            const { response } = await dialog.showMessageBox(win, {
              type: "question",
              buttons: ["仅音频", "保留视频"],
              defaultId: 0,
              cancelId: 0,
              title: "视频号下载",
              message: "是否在会话目录中保留原视频文件？",
              detail: "默认仅保留转录用的音频；保留视频会额外占用空间。",
            });
            if (response === 1) keepVideoSourcePath = downloadedFilePath;
          }
        } else {
          // ── yt-dlp download path ──

          // Cookie flag (YouTube bot check) — prefers an exported YouTube login
          // (cookies.txt), else the configured browser cookie source.
          const cookieArgs = await resolveCookieArgs(
            url,
            config,
            join(configDir, "youtube-cookies.txt"),
          );
          // JS-challenge solver flag (YouTube "n" challenge) — empty when off.
          const solverArgs = ytdlpSolverArgs(config.ytdlpSolveJsChallenges);

          // Fetch video title
          try {
            videoTitle = await new Promise<string>((resolve, reject) => {
              const proc = spawn("yt-dlp", [
                ...solverArgs,
                ...cookieArgs,
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
            ...solverArgs,
            ...cookieArgs,
            "-f",
            "ba/b",
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

        // Session title shown in the UI.
        const sessionTitle = videoTitle
          ? `${readableTimestamp} ${videoTitle}`
          : readableTimestamp;

        // Name the on-disk folder after the (sanitized) session title so it
        // matches the displayed name — same convention as the rename handler
        // in session-handlers.ts. Falls back to the timestamp when the title
        // sanitizes to nothing.
        const sanitizedBase =
          sanitizeSessionDirName(sessionTitle) || dirTimestamp;

        // Deduplicate session directory
        let dirName = sanitizedBase;
        let sessionDir = join(dataDir, "audio", dirName);
        let suffix = 1;
        while (fs.existsSync(sessionDir)) {
          dirName = `${sanitizedBase}-${suffix}`;
          sessionDir = join(dataDir, "audio", dirName);
          suffix++;
        }
        fs.mkdirSync(sessionDir, { recursive: true });

        const wavPath = join(sessionDir, `${dirName}.wav`);
        await convertToWav(downloadedFilePath, wavPath);

        // Optionally keep the source video (视频号) alongside the audio.
        if (keepVideoSourcePath) {
          try {
            fs.copyFileSync(
              keepVideoSourcePath,
              join(sessionDir, `${dirName}.mp4`),
            );
          } catch {
            // keeping the video is best-effort; transcription already succeeded
          }
        }

        // Calculate duration
        const wavStat = fs.statSync(wavPath);
        const pcmBytes = wavStat.size - 44;
        const durationSeconds = Math.round(pcmBytes / 32000); // 16kHz * 16bit * mono

        // Create session
        const modelTag = isXyz
          ? "xiaoyuzhou"
          : isWxch
            ? "wechat-channels"
            : "yt-dlp";
        const sessionId = createSession(db, {
          modelName: modelTag,
          category: "download",
        });
        updateSession(db, sessionId, {
          audioPath: dirName,
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

  // ─── 视频号 / Tencent Yuanbao login management ───

  ipcMain.handle("wechat:yuanbao-status", async () => {
    return { loggedIn: await hasYuanbaoLogin() };
  });

  ipcMain.handle("wechat:yuanbao-logout", async () => {
    await clearYuanbaoLogin();
    return { ok: true };
  });

  // ─── YouTube login management (cookies for yt-dlp) ───

  ipcMain.handle("youtube:status", async () => {
    return { loggedIn: await hasYoutubeLogin() };
  });

  ipcMain.handle("youtube:login", async () => {
    const win = getMainWindow();
    const ok = await openYoutubeLogin(win ?? undefined);
    return { loggedIn: ok };
  });

  ipcMain.handle("youtube:logout", async () => {
    await clearYoutubeLogin();
    return { ok: true };
  });
}
