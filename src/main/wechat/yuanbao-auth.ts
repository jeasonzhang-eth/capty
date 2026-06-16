/**
 * Tencent Yuanbao login for 视频号 resolution.
 *
 * Resolving a 视频号 share link needs the user's own yuanbao login. We keep that
 * login in a dedicated Electron session partition (`persist:yuanbao`) that the
 * user signs into once via an embedded window. Resolver requests run through
 * that session's cookie jar, so credentials never leave the partition — we
 * never read another app's cookie store.
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
  const cookies = await getYuanbaoSession().cookies.get({
    domain: "yuanbao.tencent.com",
  });
  return cookies.some((c) => c.name === "hy_token" && !!c.value);
}

/**
 * Open a window for the user to log into yuanbao. Resolves true once the
 * `hy_token` cookie appears, false if the user closes the window first.
 */
export function openYuanbaoLogin(parent?: BrowserWindow): Promise<boolean> {
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

/** A {@link FetchLike} bound to the yuanbao session (carries its cookies). */
export function yuanbaoFetch(): FetchLike {
  const ses = getYuanbaoSession();
  return async (url, init) => {
    const resp = await ses.fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
    });
    return { status: resp.status, text: () => resp.text() };
  };
}
