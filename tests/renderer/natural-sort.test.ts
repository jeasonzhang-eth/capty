import { describe, it, expect } from "vitest";
import { sortPathsByName } from "../../src/renderer/shared/natural-sort";

describe("sortPathsByName", () => {
  it("orders DJI-style numbered files in ascending numeric order", () => {
    const input = [
      "/x/DJI_20260401_182020.wav",
      "/x/DJI_20260401_163715.wav",
      "/x/DJI_20260401_170000.wav",
    ];
    expect(sortPathsByName(input)).toEqual([
      "/x/DJI_20260401_163715.wav",
      "/x/DJI_20260401_170000.wav",
      "/x/DJI_20260401_182020.wav",
    ]);
  });

  it("sorts by basename, numeric-aware (2 before 10)", () => {
    const input = ["/a/clip-10.m4a", "/a/clip-2.m4a", "/a/clip-1.m4a"];
    expect(sortPathsByName(input)).toEqual([
      "/a/clip-1.m4a",
      "/a/clip-2.m4a",
      "/a/clip-10.m4a",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = ["/a/b.wav", "/a/a.wav"];
    const copy = [...input];
    sortPathsByName(input);
    expect(input).toEqual(copy);
  });
});
