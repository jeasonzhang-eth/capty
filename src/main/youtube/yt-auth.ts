/**
 * YouTube login for yt-dlp downloads.
 *
 * YouTube increasingly blocks anonymous downloads (bot check + JS challenge).
 * Reading cookies from the system Chrome is fragile (recent Chrome on macOS
 * uses app-bound cookie encryption yt-dlp can't always read). Instead we let
 * the user sign into YouTube once inside an embedded window backed by a
 * dedicated Electron session partition (`persist:youtube`), then export that
 * partition's cookies to a Netscape `cookies.txt` that yt-dlp consumes via
 * `--cookies <file>`. Credentials stay in the partition; we never touch another
 * app's cookie store.
 */

import { BrowserWindow, session as electronSession } from "electron";
import type { Session } from "electron";
import fs from "fs";
import { dirname } from "path";

const PARTITION = "persist:youtube";
const YOUTUBE_URL = "https://www.youtube.com/";

/**
 * The YouTube-specific authentication cookie. yt-dlp's youtube extractor keys
 * off this cookie (scoped to `.youtube.com`) to decide you are signed in.
 * Account cookies on `.google.com` alone (SAPISID/SID/…) are NOT enough —
 * without `LOGIN_INFO` YouTube returns "Sign in to confirm you're not a bot".
 */
const YOUTUBE_LOGIN_COOKIE = "LOGIN_INFO";

/** Google account cookies that appear as soon as you sign into Google. */
const GOOGLE_AUTH_COOKIE_NAMES = new Set([
  "SAPISID",
  "__Secure-3PAPISID",
  "__Secure-3PSID",
]);

/** Domains whose cookies yt-dlp needs to authenticate to YouTube. */
function isYoutubeAuthDomain(domain: string): boolean {
  const d = domain.replace(/^\./, "").toLowerCase();
  return (
    d === "youtube.com" ||
    d.endsWith(".youtube.com") ||
    d === "google.com" ||
    d.endsWith(".google.com")
  );
}

function isYoutubeDomain(domain: string): boolean {
  const d = domain.replace(/^\./, "").toLowerCase();
  return d === "youtube.com" || d.endsWith(".youtube.com");
}

export function getYoutubeSession(): Session {
  return electronSession.fromPartition(PARTITION);
}

/**
 * True only when the partition holds the youtube.com `LOGIN_INFO` cookie — the
 * cookie yt-dlp actually needs to authenticate. We deliberately do NOT accept
 * google.com account cookies alone, because those get set the instant you sign
 * into Google (before youtube.com sets LOGIN_INFO) and would make us declare
 * success too early, exporting a cookie set that still fails YouTube's bot
 * check.
 */
export async function hasYoutubeLogin(): Promise<boolean> {
  try {
    const cookies = await getYoutubeSession().cookies.get({
      name: YOUTUBE_LOGIN_COOKIE,
    });
    return cookies.some((c) => !!c.value && isYoutubeDomain(c.domain));
  } catch {
    return false;
  }
}

/** True if Google account cookies are present (signed into Google). */
async function hasGoogleAuth(): Promise<boolean> {
  try {
    const cookies = await getYoutubeSession().cookies.get({});
    return cookies.some(
      (c) => GOOGLE_AUTH_COOKIE_NAMES.has(c.name) && !!c.value,
    );
  } catch {
    return false;
  }
}

/**
 * Open a window for the user to log into YouTube. Resolves true once the
 * youtube.com `LOGIN_INFO` cookie appears, false if the user closes the window
 * first.
 *
 * Signing into Google sets `.google.com` cookies immediately, but youtube.com
 * only sets `LOGIN_INFO` after it loads in an authenticated state. If the user
 * finishes the Google sign-in on an account/consent page, we nudge the window
 * back to youtube.com (once) so YouTube issues `LOGIN_INFO`.
 */
export function openYoutubeLogin(parent?: BrowserWindow): Promise<boolean> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 1000,
      height: 820,
      parent,
      modal: false,
      title: "登录 YouTube（用于下载视频）",
      webPreferences: { partition: PARTITION },
    });

    let settled = false;
    let nudged = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      if (!win.isDestroyed()) win.close();
      resolve(ok);
    };

    const timer = setInterval(async () => {
      try {
        if (await hasYoutubeLogin()) {
          finish(true);
          return;
        }
        // Signed into Google but YouTube hasn't issued LOGIN_INFO yet — reload
        // youtube.com once to make it set the cookie.
        if (!nudged && (await hasGoogleAuth()) && !win.isDestroyed()) {
          nudged = true;
          void win.loadURL(YOUTUBE_URL);
        }
      } catch {
        // ignore transient cookie read errors
      }
    }, 1500);

    win.on("closed", () => finish(false));
    void win.loadURL(YOUTUBE_URL);
  });
}

/** Clear the YouTube login (cookies + storage). */
export async function clearYoutubeLogin(): Promise<void> {
  await getYoutubeSession().clearStorageData();
}

/** A single cookie's fields relevant to Netscape serialization. */
export interface NetscapeCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path?: string;
  readonly secure?: boolean;
  readonly httpOnly?: boolean;
  /** Seconds since epoch; absent/0 means a session cookie. */
  readonly expirationDate?: number;
}

/**
 * Serialize cookies into Netscape `cookies.txt` format (what yt-dlp expects).
 * httpOnly cookies get the `#HttpOnly_` domain prefix yt-dlp recognizes. Pure
 * function so it can be unit-tested without Electron.
 */
export function cookiesToNetscape(cookies: readonly NetscapeCookie[]): string {
  const lines = [
    "# Netscape HTTP Cookie File",
    "# Generated by Capty. Do not edit.",
    "",
  ];
  for (const c of cookies) {
    if (!c.name) continue;
    const domain = c.domain ?? "";
    const includeSub = domain.startsWith(".") ? "TRUE" : "FALSE";
    const path = c.path || "/";
    const secure = c.secure ? "TRUE" : "FALSE";
    const expiry = c.expirationDate ? Math.floor(c.expirationDate) : 0;
    const domainField = (c.httpOnly ? "#HttpOnly_" : "") + domain;
    lines.push(
      [
        domainField,
        includeSub,
        path,
        secure,
        String(expiry),
        c.name,
        c.value,
      ].join("\t"),
    );
  }
  return lines.join("\n") + "\n";
}

/**
 * Export the partition's YouTube/Google cookies to a Netscape cookies.txt at
 * `filePath`. Returns true if a logged-in cookie set was written, false if not
 * logged in (in which case no file is written).
 */
export async function exportYoutubeCookies(filePath: string): Promise<boolean> {
  let cookies;
  try {
    cookies = await getYoutubeSession().cookies.get({});
  } catch {
    return false;
  }
  const relevant = cookies.filter((c) => isYoutubeAuthDomain(c.domain));
  // Require the youtube.com LOGIN_INFO cookie — the only reliable signal that
  // YouTube itself considers this session authenticated. Without it the export
  // would still fail YouTube's bot check.
  const loggedIn = relevant.some(
    (c) =>
      c.name === YOUTUBE_LOGIN_COOKIE && !!c.value && isYoutubeDomain(c.domain),
  );
  if (!loggedIn) return false;

  const content = cookiesToNetscape(
    relevant.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      expirationDate: c.expirationDate,
    })),
  );
  // Ensure the parent directory exists before writing. yt-dlp also writes the
  // cookie jar BACK to this path on exit (even on failed downloads); if the
  // directory is missing it dies with a raw `FileNotFoundError`. Creating it
  // here guarantees both our write and yt-dlp's writeback succeed.
  fs.mkdirSync(dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
  return true;
}
