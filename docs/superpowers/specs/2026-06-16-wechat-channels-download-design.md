# WeChat Channels (视频号) Link → Transcribe — Design

**Date:** 2026-06-16
**Status:** Implemented (pending in-app e2e)
**Author:** Jeason + Claude

## Context

Users want to paste a WeChat Channels (视频号) share link and have Capty
download it and transcribe it, the same way it already handles YouTube /
Bilibili / 小宇宙 links in the Download Audio manager.

视频号 videos are protected: the MP4's first **131072 bytes (128 KiB)** are
encrypted with an ISAAC64 stream cipher keyed by a per-video `decodeKey`
(uint64). To play/download a video you need its real `videoUrl` (carrying
`encfilekey` + `token`) and, when encrypted, the `decodeKey`. Both come only
from the 视频号 `get_feed_info` API, which requires an `exportId` +
`generalToken` derived from the share short-code.

## Paths investigated (empirically)

- **C′ — anonymous/web-login web page:** ❌ rejected. The finder-preview share
  page is hard-gated ("可扫码前往微信观看此内容"); anonymous and even
  creator-platform-logged-in browsers only receive metadata — `videoUrl` /
  `decodeKey` are never sent to the web.
- **A — MITM the WeChat desktop client:** works for all videos but requires
  installing a root CA + system proxy. Too heavy; rejected.
- **B — Tencent Yuanbao (chosen):** ✅ verified end-to-end. Using the user's
  **own** yuanbao login cookie (cookie only; the original author's
  device-fingerprint headers are NOT required), `get_parse_result` turns the
  share link into a `playable_url` (token + eid), then `get_feed_info`
  (no cookie) returns `videoUrl` + optional `decodeKey`. Most videos are
  unencrypted (`decodeKey` absent → 0).

## Architecture (Electron-side)

Everything lives in the Electron main process, where the login webview session,
`net`/`session.fetch`, ffmpeg, and the session-import pipeline already are. The
Python sidecar stays ML-only.

```
share link (pasted into Download Audio manager)
  → [yuanbao-auth] ensure one-time yuanbao login (persist:yuanbao partition)
  → [resolver] get_parse_result (session cookie) → playable_url(token+eid)
              → get_feed_info (no cookie)       → videoUrl + decodeKey
  → [downloader] net.fetch videoUrl → decrypt first 128 KiB if decodeKey≠0 → MP4
  → ask "keep video?"
  → existing pipeline: ffmpeg → 16k mono WAV → session (model "wechat-channels",
    category "download") → optionally copy MP4 into the session dir
```

### Modules (`src/main/wechat/`)

- `isaac.ts` — ISAAC64 + `decryptPrefix(buf, key, ENC_LIMIT)`. Ported from the Go
  reference; verified with golden keystream vectors.
- `resolver.ts` — `resolveShareUrl(url, fetchFn)`, `isChannelsShareUrl`,
  `YuanbaoAuthError`. Injectable `FetchLike` for unit tests.
- `downloader.ts` — `downloadAndDecrypt(videoUrl, decodeKey, dest, fetchFn)`.
- `yuanbao-auth.ts` — `persist:yuanbao` session partition, `hasYuanbaoLogin`,
  `openYuanbaoLogin`, `yuanbaoFetch`. Credentials never leave the partition; we
  never read another app's cookie store.

### Integration

`audio:download-start` (in `audio-download-handlers.ts`) gains a 视频号 branch
alongside the existing 小宇宙 / yt-dlp branches, then rejoins the shared
convert → session → cleanup tail. The Download manager UI shows a "视频号" badge.

## Error handling

- Not logged into yuanbao / cookie expired → open login window; if the user
  closes it, fail with `YuanbaoAuthError` ("请登录后重试").
- `get_feed_info` without `videoUrl` (app-only gated video) → clear error.
- Decryption is a no-op when `decodeKey == 0` (unencrypted).
- ffmpeg / network failures surface through the existing download error stage.

## Testing

- `tests/main/wechat-isaac.test.ts` — golden-vector cross-check + involution.
- `tests/main/wechat-resolver.test.ts` — two-step resolve, missing-key → 0,
  401 → `YuanbaoAuthError`, app-only-gated → error.
- `tests/main/wechat-downloader.test.ts` — plain copy, prefix decrypt round-trip,
  non-2xx. (14 tests total.)
- Feasibility verified out-of-app with a real yuanbao login + real share link
  (resolve → videoUrl → real MP4 stream).

## Risks

1. **Fragility:** yuanbao's parse endpoint / 视频号 APIs can change; the feature's
   lifetime is uncertain. Documented as best-effort.
2. **Legal/open-source:** decrypts content the platform serves to logged-in users
   via Tencent's own resolve API; closer to yt-dlp than DRM circumvention, but a
   gray area — note disclaimer.
3. **In-app e2e** (login window flow + transcription) still to be confirmed by
   running the built app.
