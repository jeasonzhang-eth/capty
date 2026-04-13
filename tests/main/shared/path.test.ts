import { describe, it, expect } from "vitest";
import path from "path";
import os from "os";
import fs from "fs";
import { assertPathWithin } from "../../../src/main/shared/path";

describe("assertPathWithin", () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "path-test-"));

  it("allows path inside base", () => {
    const target = path.join(baseDir, "subdir", "file.txt");
    expect(() => assertPathWithin(baseDir, target)).not.toThrow();
  });

  it("allows the base path itself", () => {
    expect(() => assertPathWithin(baseDir, baseDir)).not.toThrow();
  });

  it("rejects path outside base", () => {
    const outside = path.join(os.tmpdir(), "outside.txt");
    expect(() => assertPathWithin(baseDir, outside)).toThrow();
  });

  it("rejects path that uses prefix bypass", () => {
    const evil = `${baseDir}-evil/file.txt`;
    expect(() => assertPathWithin(baseDir, evil)).toThrow();
  });

  it("rejects path with .. traversal", () => {
    const traversal = path.join(baseDir, "..", "..", "etc", "passwd");
    expect(() => assertPathWithin(baseDir, traversal)).toThrow();
  });
});
