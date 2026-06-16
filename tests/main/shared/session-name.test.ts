import { describe, it, expect } from "vitest";
import { sanitizeSessionDirName } from "../../../src/main/shared/session-name";

describe("sanitizeSessionDirName", () => {
  it("replaces filesystem-illegal characters with dashes", () => {
    expect(sanitizeSessionDirName('a/b\\c:d*e?f"g<h>i|j')).toBe(
      "a-b-c-d-e-f-g-h-i-j",
    );
  });

  it("keeps a 视频号 title with a readable timestamp (colons replaced)", () => {
    expect(sanitizeSessionDirName("2026-06-16 23:54:28 天使之翼")).toBe(
      "2026-06-16 23-54-28 天使之翼",
    );
  });

  it("strips leading dots and surrounding whitespace", () => {
    expect(sanitizeSessionDirName("  ...hidden  ")).toBe("hidden");
  });

  it("returns empty string when nothing usable remains (caller falls back)", () => {
    expect(sanitizeSessionDirName("  ")).toBe("");
    expect(sanitizeSessionDirName("...")).toBe("");
  });

  it("leaves a plain title untouched", () => {
    expect(sanitizeSessionDirName("和我妈妈的聊天")).toBe("和我妈妈的聊天");
  });
});
