/**
 * Platform/source detection for downloaded media. Maps a URL to a display
 * badge (label + colors). Shared by the Download manager and the session list
 * so a downloaded session shows the same "where it came from" badge.
 */

export interface PlatformInfo {
  readonly label: string;
  readonly color: string;
  readonly bg: string;
}

const PLATFORM_MAP: readonly { pattern: RegExp; info: PlatformInfo }[] = [
  {
    pattern: /youtu\.?be/i,
    info: { label: "YouTube", color: "#ff0000", bg: "rgba(255,0,0,0.12)" },
  },
  {
    pattern: /bilibili\.com|b23\.tv/i,
    info: { label: "Bilibili", color: "#00a1d6", bg: "rgba(0,161,214,0.12)" },
  },
  {
    pattern: /twitter\.com|x\.com/i,
    info: { label: "X", color: "#a0a0a0", bg: "rgba(160,160,160,0.12)" },
  },
  {
    pattern: /tiktok\.com|douyin\.com/i,
    info: { label: "TikTok", color: "#ee1d52", bg: "rgba(238,29,82,0.12)" },
  },
  {
    pattern: /soundcloud\.com/i,
    info: { label: "SoundCloud", color: "#ff5500", bg: "rgba(255,85,0,0.12)" },
  },
  {
    pattern: /instagram\.com/i,
    info: { label: "Instagram", color: "#c13584", bg: "rgba(193,53,132,0.12)" },
  },
  {
    pattern: /facebook\.com|fb\.watch/i,
    info: { label: "Facebook", color: "#1877f2", bg: "rgba(24,119,242,0.12)" },
  },
  {
    pattern: /vimeo\.com/i,
    info: { label: "Vimeo", color: "#1ab7ea", bg: "rgba(26,183,234,0.12)" },
  },
  {
    pattern: /twitch\.tv/i,
    info: { label: "Twitch", color: "#9146ff", bg: "rgba(145,70,255,0.12)" },
  },
  {
    pattern: /reddit\.com/i,
    info: { label: "Reddit", color: "#ff4500", bg: "rgba(255,69,0,0.12)" },
  },
  {
    pattern: /spotify\.com/i,
    info: { label: "Spotify", color: "#1db954", bg: "rgba(29,185,84,0.12)" },
  },
  {
    pattern: /bandcamp\.com/i,
    info: { label: "Bandcamp", color: "#629aa9", bg: "rgba(98,154,169,0.12)" },
  },
  {
    pattern: /dailymotion\.com/i,
    info: {
      label: "Dailymotion",
      color: "#00d2f3",
      bg: "rgba(0,210,243,0.12)",
    },
  },
  {
    pattern: /podcasts\.apple\.com/i,
    info: {
      label: "Apple Podcasts",
      color: "#9933cc",
      bg: "rgba(153,51,204,0.12)",
    },
  },
  {
    pattern: /music\.163\.com/i,
    info: { label: "NetEase", color: "#c20c0c", bg: "rgba(194,12,12,0.12)" },
  },
  {
    // 视频号 share links — must precede the generic qq.com rule below.
    pattern: /weixin\.qq\.com\/sph|channels\.weixin\.qq\.com/i,
    info: { label: "视频号", color: "#fa9d3b", bg: "rgba(250,157,59,0.12)" },
  },
  {
    pattern: /qq\.com/i,
    info: { label: "QQ", color: "#12b7f5", bg: "rgba(18,183,245,0.12)" },
  },
  {
    pattern: /xiaoyuzhoufm\.com/i,
    info: {
      label: "小宇宙",
      color: "#ee6723",
      bg: "rgba(238,103,35,0.12)",
    },
  },
];

export const FALLBACK_PLATFORM: PlatformInfo = {
  label: "Web",
  color: "#888",
  bg: "rgba(136,136,136,0.12)",
};

/** Match a URL to its platform badge, or {@link FALLBACK_PLATFORM} if unknown. */
export function getPlatform(url: string): PlatformInfo {
  for (const { pattern, info } of PLATFORM_MAP) {
    if (pattern.test(url)) return info;
  }
  return FALLBACK_PLATFORM;
}
