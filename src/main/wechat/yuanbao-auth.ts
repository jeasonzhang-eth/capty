/**
 * Tencent Yuanbao login for 视频号 resolution.
 *
 * Resolving a 视频号 share link needs the user's own yuanbao login. We keep that
 * login in a dedicated Electron session partition (`persist:yuanbao`) that the
 * user signs into once via an embedded window. Resolver requests run through
 * that session's cookie jar, so credentials never leave the partition — we
 * never read another app's cookie store.
 *
 * Yuanbao's web client decorates its API calls with device/fingerprint headers
 * (`x-hy*`, `x-device-id`, `t-userid`, `sec-ch-ua*`, ...). They are NOT required
 * (a bare cookie works), but sending the user's own current values makes the
 * request look like a normal browser and reduces the chance of being rate-
 * limited. Rather than hardcoding someone else's captured values, we sniff them
 * live from the user's own yuanbao traffic via `webRequest` and replay them.
 */

import { BrowserWindow, session as electronSession } from "electron";
import type { Session } from "electron";
import type { FetchLike } from "./resolver";

const PARTITION = "persist:yuanbao";
const YUANBAO_URL = "https://yuanbao.tencent.com/";

export function getYuanbaoSession(): Session {
  return electronSession.fromPartition(PARTITION);
}

/** True if the partition holds a yuanbao login cookie (`hy_token`). */
export async function hasYuanbaoLogin(): Promise<boolean> {
  const ses = getYuanbaoSession();
  const hasToken = (cookies: Electron.Cookie[]): boolean =>
    cookies.some((c) => c.name === "hy_token" && !!c.value);
  try {
    // `url` filter matches domain/path robustly (the `domain` filter can miss
    // cookies stored with a leading-dot domain).
    if (hasToken(await ses.cookies.get({ url: YUANBAO_URL }))) return true;
    return hasToken(await ses.cookies.get({}));
  } catch {
    return false;
  }
}

// ── Live device/fingerprint header capture ──────────────────────────────────

/** Headers worth replaying — device/fingerprint/UA hints, never cookies. */
function isInterestingHeader(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.startsWith("x-hy") ||
    n === "x-id" ||
    n === "x-instance-id" ||
    n === "x-source" ||
    n === "x-platform" ||
    n === "x-language" ||
    n === "x-os_version" ||
    n === "x-web-third-source" ||
    n === "x-webversion" ||
    n === "x-commit-tag" ||
    n === "x-requested-with" ||
    n === "x-device-id" ||
    n === "t-userid" ||
    n.startsWith("sec-ch-ua")
  );
}

/**
 * Merge live-captured device headers under the caller's explicit headers
 * (explicit wins). Pure helper so it can be unit-tested without Electron.
 */
export function mergeYuanbaoHeaders(
  captured: Record<string, string>,
  explicit: Record<string, string>,
): Record<string, string> {
  return { ...captured, ...explicit };
}

let capturedHeaders: Record<string, string> = {};
let captureInstalled = false;

/** Install a one-time webRequest sniffer that snapshots yuanbao's own headers. */
function installCapture(): void {
  if (captureInstalled) return;
  captureInstalled = true;
  getYuanbaoSession().webRequest.onBeforeSendHeaders(
    { urls: ["https://yuanbao.tencent.com/api/*"] },
    (details, callback) => {
      const snap: Record<string, string> = {};
      for (const [k, v] of Object.entries(details.requestHeaders ?? {})) {
        if (typeof v === "string" && isInterestingHeader(k)) snap[k] = v;
      }
      // Only adopt a snapshot from a real signed API call (has an x-hy* token).
      if (Object.keys(snap).some((k) => k.toLowerCase().startsWith("x-hy"))) {
        capturedHeaders = snap;
      }
      callback({ requestHeaders: details.requestHeaders });
    },
  );
}

/**
 * Best-effort: make sure we have device headers captured from a live yuanbao
 * session. If none yet (e.g. already logged in, no window opened this run),
 * briefly load yuanbao in a hidden window so its startup API calls are sniffed.
 */
export async function ensureYuanbaoHeaders(timeoutMs = 6000): Promise<void> {
  installCapture();
  if (Object.keys(capturedHeaders).length > 0) return;
  await new Promise<void>((resolve) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: { partition: PARTITION },
    });
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(deadline);
      if (!win.isDestroyed()) win.destroy();
      resolve();
    };
    const poll = setInterval(() => {
      if (Object.keys(capturedHeaders).length > 0) finish();
    }, 400);
    const deadline = setTimeout(finish, timeoutMs);
    void win.loadURL(YUANBAO_URL);
  });
}

/**
 * Open a window for the user to log into yuanbao. Resolves true once the
 * `hy_token` cookie appears, false if the user closes the window first.
 */
export function openYuanbaoLogin(parent?: BrowserWindow): Promise<boolean> {
  installCapture();
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 1000,
      height: 820,
      parent,
      modal: false,
      title: "登录腾讯元宝（用于解析视频号链接）",
      webPreferences: { partition: PARTITION },
    });

    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      if (!win.isDestroyed()) win.close();
      resolve(ok);
    };

    const timer = setInterval(async () => {
      try {
        if (await hasYuanbaoLogin()) finish(true);
      } catch {
        // ignore transient cookie read errors
      }
    }, 1500);

    win.on("closed", () => finish(false));
    void win.loadURL(YUANBAO_URL);
  });
}

/** Clear the yuanbao login (cookies + storage) and forget captured headers. */
export async function clearYuanbaoLogin(): Promise<void> {
  capturedHeaders = {};
  await getYuanbaoSession().clearStorageData();
}

/**
 * A {@link FetchLike} bound to the yuanbao session: carries the partition's
 * cookies and replays the live-captured device headers (caller headers win).
 */
export function yuanbaoFetch(): FetchLike {
  const ses = getYuanbaoSession();
  return async (url, init) => {
    const resp = await ses.fetch(url, {
      method: init.method,
      headers: mergeYuanbaoHeaders(capturedHeaders, init.headers),
      body: init.body,
    });
    return { status: resp.status, text: () => resp.text() };
  };
}
