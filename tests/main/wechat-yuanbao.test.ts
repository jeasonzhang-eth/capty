import { describe, it, expect } from "vitest";
import { mergeYuanbaoHeaders } from "../../src/main/wechat/yuanbao-auth";

describe("mergeYuanbaoHeaders", () => {
  it("merges captured device headers under explicit ones (explicit wins)", () => {
    const captured = {
      "x-hy92": "abc",
      "x-device-id": "dev123",
      "t-userid": "u1",
      "user-agent": "yuanbao-ua",
    };
    const explicit = {
      "content-type": "application/json",
      "user-agent": "our-ua",
    };
    const merged = mergeYuanbaoHeaders(captured, explicit);
    expect(merged["x-hy92"]).toBe("abc");
    expect(merged["x-device-id"]).toBe("dev123");
    expect(merged["t-userid"]).toBe("u1");
    expect(merged["content-type"]).toBe("application/json");
    // explicit overrides captured on conflict
    expect(merged["user-agent"]).toBe("our-ua");
  });

  it("works with no captured headers (cookie-only fallback)", () => {
    const merged = mergeYuanbaoHeaders({}, { "content-type": "application/json" });
    expect(merged).toEqual({ "content-type": "application/json" });
  });
});
