import { describe, it, expect } from "vitest";
import { getExtendedEnv } from "../../../src/main/shared/spawn";

describe("getExtendedEnv", () => {
  it("returns object with PATH including standard binary dirs", () => {
    const env = getExtendedEnv();
    expect(env.PATH).toBeDefined();
    expect(env.PATH).toContain("/usr/local/bin");
  });

  it("preserves existing PATH from process.env", () => {
    const env = getExtendedEnv();
    if (process.env.PATH) {
      const segments = process.env.PATH.split(":");
      expect(segments.every((seg) => env.PATH!.includes(seg))).toBe(true);
    }
  });
});
