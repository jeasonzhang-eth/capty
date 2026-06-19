import { describe, it, expect, vi, beforeEach } from "vitest";

// Mutable cookie store backing the mocked Electron partition session, so we can
// drive hasYoutubeLogin/exportYoutubeCookies with controlled cookie sets.
const store = vi.hoisted(() => ({
  cookies: [] as Array<Record<string, unknown>>,
}));

vi.mock("electron", () => ({
  BrowserWindow: class {},
  session: {
    fromPartition: () => ({
      cookies: {
        get: async (filter?: { name?: string }) =>
          filter?.name
            ? store.cookies.filter((c) => c.name === filter.name)
            : store.cookies,
      },
    }),
  },
}));

import {
  cookiesToNetscape,
  hasYoutubeLogin,
} from "../../src/main/youtube/yt-auth";

describe("hasYoutubeLogin", () => {
  beforeEach(() => {
    store.cookies = [];
  });

  it("is false when only google.com account cookies are present (no LOGIN_INFO)", async () => {
    store.cookies = [
      { name: "SAPISID", value: "x", domain: ".google.com" },
      { name: "__Secure-3PSID", value: "y", domain: ".google.com" },
    ];
    expect(await hasYoutubeLogin()).toBe(false);
  });

  it("is true when a youtube.com LOGIN_INFO cookie is present", async () => {
    store.cookies = [
      { name: "LOGIN_INFO", value: "abc", domain: ".youtube.com" },
    ];
    expect(await hasYoutubeLogin()).toBe(true);
  });

  it("ignores a LOGIN_INFO cookie scoped to a non-youtube domain or with no value", async () => {
    store.cookies = [{ name: "LOGIN_INFO", value: "", domain: ".youtube.com" }];
    expect(await hasYoutubeLogin()).toBe(false);
    store.cookies = [
      { name: "LOGIN_INFO", value: "abc", domain: ".example.com" },
    ];
    expect(await hasYoutubeLogin()).toBe(false);
  });
});

describe("cookiesToNetscape", () => {
  it("emits the Netscape header and one tab-separated line per cookie", () => {
    const out = cookiesToNetscape([
      {
        name: "SAPISID",
        value: "abc123",
        domain: ".google.com",
        path: "/",
        secure: true,
        httpOnly: false,
        expirationDate: 1893456000,
      },
    ]);
    const lines = out.trimEnd().split("\n");
    expect(lines[0]).toBe("# Netscape HTTP Cookie File");
    const fields = lines[lines.length - 1].split("\t");
    expect(fields).toEqual([
      ".google.com",
      "TRUE", // leading-dot domain → include subdomains
      "/",
      "TRUE", // secure
      "1893456000",
      "SAPISID",
      "abc123",
    ]);
  });

  it("prefixes httpOnly cookies with #HttpOnly_ and marks host-only domains FALSE", () => {
    const out = cookiesToNetscape([
      {
        name: "LOGIN_INFO",
        value: "xyz",
        domain: "youtube.com",
        path: "/",
        secure: true,
        httpOnly: true,
        expirationDate: 1893456000,
      },
    ]);
    const fields = out.trimEnd().split("\n").pop()!.split("\t");
    expect(fields[0]).toBe("#HttpOnly_youtube.com");
    expect(fields[1]).toBe("FALSE"); // no leading dot → host-only
  });

  it("uses 0 expiry for session cookies and defaults path to /", () => {
    const out = cookiesToNetscape([
      { name: "S", value: "1", domain: ".youtube.com" },
    ]);
    const fields = out.trimEnd().split("\n").pop()!.split("\t");
    expect(fields[2]).toBe("/"); // default path
    expect(fields[3]).toBe("FALSE"); // not secure
    expect(fields[4]).toBe("0"); // session cookie
  });

  it("skips cookies with no name", () => {
    const out = cookiesToNetscape([
      { name: "", value: "x", domain: ".youtube.com" },
      { name: "real", value: "y", domain: ".youtube.com" },
    ]);
    const dataLines = out
      .trimEnd()
      .split("\n")
      .filter((l) => l && !l.startsWith("#"));
    expect(dataLines).toHaveLength(1);
    expect(dataLines[0].split("\t")[5]).toBe("real");
  });
});
