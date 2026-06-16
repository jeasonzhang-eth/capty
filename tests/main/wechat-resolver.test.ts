import { describe, it, expect, vi } from "vitest";
import {
  resolveShareUrl,
  isChannelsShareUrl,
  YuanbaoAuthError,
  type FetchLike,
} from "../../src/main/wechat/resolver";

const PLAYABLE =
  "https://channels.weixin.qq.com/finder-preview/pages/feed?appid=51&token=GENTOKEN123&eid=export%2FABC123";

function jsonResp(status: number, obj: unknown) {
  return { status, text: async () => JSON.stringify(obj) };
}

describe("isChannelsShareUrl", () => {
  it("accepts /sph/ links and channels host, rejects others", () => {
    expect(isChannelsShareUrl("https://weixin.qq.com/sph/Axv548mzBF")).toBe(true);
    expect(isChannelsShareUrl("https://channels.weixin.qq.com/finder-preview/pages/sph?id=x")).toBe(true);
    expect(isChannelsShareUrl("https://example.com/sph/x")).toBe(false);
    expect(isChannelsShareUrl("not a url")).toBe(false);
  });
});

describe("resolveShareUrl", () => {
  it("resolves share link → videoUrl + decodeKey via two calls", async () => {
    const calls: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push(url);
      if (url.includes("get_parse_result")) {
        expect(JSON.parse(init.body).type).toBe("video_channel_url");
        return jsonResp(200, { code: 0, data: { playable_url: PLAYABLE } });
      }
      // get_feed_info
      const body = JSON.parse(init.body);
      expect(body.baseReq.generalToken).toBe("GENTOKEN123");
      expect(body.exportId).toBe("export/ABC123");
      return jsonResp(201, {
        errCode: 0,
        data: {
          authorInfo: { nickname: "小报纸" },
          feedInfo: {
            description: "天使之翼\n第二行",
            videoUrl: "https://finder.video.qq.com/x?encfilekey=K&token=T",
            decodeKey: "123456789",
            coverUrl: "https://cover",
          },
        },
      });
    };
    const r = await resolveShareUrl("https://weixin.qq.com/sph/Axv548mzBF", fetchFn);
    expect(r.videoUrl).toContain("encfilekey=K");
    expect(r.decodeKey).toBe(123456789n);
    expect(r.title).toBe("天使之翼");
    expect(r.author).toBe("小报纸");
    expect(calls.length).toBe(2);
  });

  it("treats missing/empty decodeKey as 0n (unencrypted)", async () => {
    const fetchFn: FetchLike = async (url) =>
      url.includes("get_parse_result")
        ? jsonResp(200, { code: 0, data: { playable_url: PLAYABLE } })
        : jsonResp(200, {
            errCode: 0,
            data: { feedInfo: { videoUrl: "https://v/x", description: "t" } },
          });
    const r = await resolveShareUrl("https://weixin.qq.com/sph/x", fetchFn);
    expect(r.decodeKey).toBe(0n);
  });

  it("throws YuanbaoAuthError on 401", async () => {
    const fetchFn: FetchLike = async () => jsonResp(401, { error: "x" });
    await expect(resolveShareUrl("https://weixin.qq.com/sph/x", fetchFn)).rejects.toBeInstanceOf(
      YuanbaoAuthError,
    );
  });

  it("throws when feedInfo has no videoUrl (app-only gated)", async () => {
    const fetchFn: FetchLike = async (url) =>
      url.includes("get_parse_result")
        ? jsonResp(200, { code: 0, data: { playable_url: PLAYABLE } })
        : jsonResp(200, { errCode: 0, data: { feedInfo: { description: "meta only" } } });
    await expect(resolveShareUrl("https://weixin.qq.com/sph/x", fetchFn)).rejects.toThrow(
      /videoUrl/,
    );
  });
});
