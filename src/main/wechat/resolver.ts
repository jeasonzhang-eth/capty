/**
 * Resolve a WeChat Channels (视频号) share link into a downloadable video URL.
 *
 * Two-step flow (verified end-to-end):
 *   1. Tencent Yuanbao `get_parse_result` (needs the user's own yuanbao login
 *      cookie, carried by `fetchFn`) turns the `/sph/<code>` share link into a
 *      `playable_url` containing `token` (generalToken) + `eid` (exportId).
 *   2. 视频号 `get_feed_info` (no cookie) returns the real `videoUrl` and, for
 *      encrypted videos, a `decodeKey`.
 */

/** Minimal fetch surface so this module is unit-testable without Electron. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface ResolvedVideo {
  /** Best-effort human title (video description, first line). */
  readonly title: string;
  readonly author: string;
  /** Direct video URL (carries encfilekey + token). */
  readonly videoUrl: string;
  /** Per-video decryption key; 0n means the video is not encrypted. */
  readonly decodeKey: bigint;
  readonly coverUrl: string;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

export class YuanbaoAuthError extends Error {
  constructor(message = "腾讯元宝登录态无效或已过期，请重新登录") {
    super(message);
    this.name = "YuanbaoAuthError";
  }
}

function firstLine(s: string, max = 80): string {
  const line = (s || "").split("\n")[0].trim();
  return line.length > max ? line.slice(0, max) : line;
}

async function parseShareUrl(
  shareUrl: string,
  fetchFn: FetchLike,
): Promise<{ generalToken: string; exportId: string }> {
  const resp = await fetchFn(
    "https://yuanbao.tencent.com/api/weixin/get_parse_result",
    {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": UA },
      body: JSON.stringify({ type: "video_channel_url", url: shareUrl, scene: 1 }),
    },
  );
  if (resp.status === 401 || resp.status === 403) throw new YuanbaoAuthError();
  const text = await resp.text();
  if (resp.status !== 200) {
    throw new Error(`元宝解析失败 (HTTP ${resp.status}): ${text.slice(0, 200)}`);
  }
  let json: { code?: number; data?: { playable_url?: string } };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("元宝返回非 JSON，可能登录态失效");
  }
  const playable = json?.data?.playable_url;
  if (!playable) {
    throw new Error(`元宝未返回 playable_url (code=${json?.code})`);
  }
  const u = new URL(playable);
  const generalToken = u.searchParams.get("token") ?? "";
  const exportId = u.searchParams.get("eid") ?? "";
  if (!generalToken || !exportId) {
    throw new Error("playable_url 缺少 token 或 eid");
  }
  return { generalToken, exportId };
}

function makeRid(): string {
  const ts = Math.floor(Date.now() / 1000).toString(16);
  const rand = Math.floor(Math.random() * 0xffffffff).toString(16);
  return `${ts}-${rand}`;
}

async function getFeedInfo(
  generalToken: string,
  exportId: string,
  fetchFn: FetchLike,
): Promise<ResolvedVideo> {
  const apiUrl =
    `https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info` +
    `?_rid=${makeRid()}&_pageUrl=https%3A%2F%2Fchannels.weixin.qq.com%2Ffinder-preview%2Fpages%2Ffeed`;
  const referer =
    `https://channels.weixin.qq.com/finder-preview/pages/feed` +
    `?token=${encodeURIComponent(generalToken)}&eid=${encodeURIComponent(exportId)}`;
  const resp = await fetchFn(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://channels.weixin.qq.com",
      referer,
      "user-agent": UA,
    },
    body: JSON.stringify({ baseReq: { generalToken }, exportId }),
  });
  const text = await resp.text();
  let json: {
    errCode?: number;
    errMsg?: string;
    data?: {
      feedInfo?: {
        videoUrl?: string;
        decodeKey?: string | number;
        description?: string;
        coverUrl?: string;
      };
      authorInfo?: { nickname?: string };
    };
  };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`get_feed_info 返回非 JSON (HTTP ${resp.status})`);
  }
  if (json.errCode && json.errCode !== 0) {
    throw new Error(`get_feed_info 失败: ${json.errMsg ?? json.errCode}`);
  }
  const fi = json?.data?.feedInfo;
  if (!fi?.videoUrl) {
    throw new Error("未获取到 videoUrl（视频可能仅限 App 观看或解析过期）");
  }
  const rawKey = fi.decodeKey;
  let decodeKey = 0n;
  if (rawKey !== undefined && rawKey !== null && `${rawKey}` !== "") {
    try {
      decodeKey = BigInt(rawKey);
    } catch {
      decodeKey = 0n;
    }
  }
  return {
    title: firstLine(fi.description ?? "") || "视频号视频",
    author: json?.data?.authorInfo?.nickname ?? "",
    videoUrl: fi.videoUrl,
    decodeKey,
    coverUrl: fi.coverUrl ?? "",
  };
}

/** Resolve a 视频号 share link into a downloadable, decryptable video. */
export async function resolveShareUrl(
  shareUrl: string,
  fetchFn: FetchLike,
): Promise<ResolvedVideo> {
  const { generalToken, exportId } = await parseShareUrl(shareUrl, fetchFn);
  return getFeedInfo(generalToken, exportId, fetchFn);
}

/** Heuristic check for a 视频号 share link. */
export function isChannelsShareUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return (
      /(^|\.)weixin\.qq\.com$/.test(u.hostname) && u.pathname.startsWith("/sph/")
    ) || (
      u.hostname === "channels.weixin.qq.com"
    );
  } catch {
    return false;
  }
}
